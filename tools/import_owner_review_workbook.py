#!/usr/bin/env python3
"""Read only 全部路段; preserve owner decisions as a private, non-routing ledger.

Uses the XLSX XML container, with no spreadsheet dependency required in CI.
Row ID may repeat for conditional-time variants: (Row ID, occurrence) is the key.
"""
import argparse
from collections import Counter, defaultdict
import hashlib
import json
from pathlib import Path
import posixpath
import re
import xml.etree.ElementTree as ET
from zipfile import ZipFile

NS={'s':'http://schemas.openxmlformats.org/spreadsheetml/2006/main',
    'r':'http://schemas.openxmlformats.org/officeDocument/2006/relationships'}
FIELDS=['Row ID','JSON 群組','官方圖組','候選起點','候選終點','候選去程(分)',
        '候選回程(分)','人工核對狀態','圖上起點（修正）','圖上終點（修正）',
        '交通方式','官方起→迄(分)','官方迄→起(分)','備註/圖上標示']

def read_sheet(path):
    with ZipFile(path) as z:
        book=ET.fromstring(z.read('xl/workbook.xml'))
        matches=[s for s in book.findall('s:sheets/s:sheet',NS) if s.get('name')=='全部路段']
        if len(matches)!=1:raise ValueError('Expected exactly one 全部路段 sheet')
        rid=matches[0].get('{'+NS['r']+'}id')
        rels=ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))
        target=next(r.get('Target') for r in rels if r.get('Id')==rid)
        target=target.lstrip('/') if target.startswith('/') else posixpath.normpath('xl/'+target)
        strings=[]
        if 'xl/sharedStrings.xml' in z.namelist():
            strings=[''.join(e.itertext()) for e in ET.fromstring(z.read('xl/sharedStrings.xml'))]
        grid=[]
        for row in ET.fromstring(z.read(target)).findall('s:sheetData/s:row',NS):
            values={}
            for c in row:
                if c.tag!='{'+NS['s']+'}c':continue
                if c.find('s:f',NS) is not None:raise ValueError('Formula in review input: '+c.get('r',''))
                col=re.match(r'[A-Z]+',c.get('r')).group()
                value=c.find('s:v',NS)
                if c.get('t')=='inlineStr':v=''.join(c.find('s:is',NS).itertext())
                elif value is None:v=None
                elif c.get('t')=='s':v=strings[int(value.text)]
                else:v=value.text
                values[col]=v
            grid.append((int(row.get('r')),values))
        headers=grid[0][1]
        if len(set(headers.values()))!=len(headers):raise ValueError('Duplicate headers')
        if not set(FIELDS)<=set(headers.values()):raise ValueError('Missing required headers')
        return [(n,{headers[k]:v for k,v in row.items() if k in headers}) for n,row in grid[1:] if any(row.values())]

def minutes(value):
    if value is None or str(value).strip()=='':raise ValueError('Missing minutes')
    if isinstance(value,bool):raise ValueError('Boolean minutes')
    number=float(value)
    if not number.is_integer() or number<0:raise ValueError('Invalid minutes: '+str(value))
    return int(number)

def normalize(rows):
    result=[];excluded=[];counts=Counter();seen=Counter();groups=defaultdict(set)
    for number,d in rows:
        def val(k):
            v=d.get(k)
            return str(v).strip() if v is not None else ''
        for k in ['Row ID','JSON 群組','官方圖組','候選起點','候選終點']:
            if not val(k):raise ValueError(f'Row {number}: missing {k}')
        status=val('人工核對狀態')
        if status not in ('確認','修正','排除','待查'):raise ValueError(f'Row {number}: invalid status')
        mode=val('交通方式')
        if mode not in ('','車'):raise ValueError(f'Row {number}: unknown transport mode')
        rowid=val('Row ID');seen[rowid]+=1;counts[status]+=1
        group=val('修正群組名稱') or val('JSON 群組');groups[val('JSON 群組')].add(group)
        out={'reviewRowKey':f'{rowid}:{seen[rowid]}','sourceRowId':rowid,'sheetRow':number,
             'original':d,'originalGroup':val('JSON 群組'),'group':group,'chartId':val('官方圖組'),
             'from':val('圖上起點（修正）') or val('候選起點'),
             'to':val('圖上終點（修正）') or val('候選終點'),
             'travelMode':'vehicle' if mode=='車' else 'walking',
             'ownerReviewStatus':status,'verificationBasis':'owner_workbook_review',
             'note':val('備註/圖上標示'),'routingEnabled':False}
        if status=='排除':excluded.append(out);continue
        out['go']=minutes(val('官方起→迄(分)') or val('候選去程(分)'))
        out['back']=minutes(val('官方迄→起(分)') or val('候選回程(分)'))
        if status=='待查':out['holdReason']='owner_marked_pending'
        result.append(out)
    if any(len(v)!=1 for v in groups.values()):raise ValueError('Inconsistent group rename')
    # Classify repeated row IDs without merging any physical endpoints.
    variants=defaultdict(list)
    for r in result:variants[r['sourceRowId']].append(r)
    issues=[];conditional=[]
    for rowid,rs in variants.items():
        if len({(r['go'],r['back']) for r in rs})<=1:continue
        text=' '.join(r['note'] for r in rs)
        declared=bool(re.search(r'(輕裝|重裝|快|慢).*?\d+',text))
        target=conditional if declared else issues
        target.append({'sourceRowId':rowid,'sheetRows':[r['sheetRow'] for r in rs],
                       'times':[[r['go'],r['back']] for r in rs],
                       'reason':'conditional_variants_preserved' if declared else 'unlabelled_time_variants'})
        for r in rs:r['holdReason']='conditional_times_require_compilation' if declared else 'unlabelled_time_variants'
    summary={'inputRows':len(rows),'statuses':dict(counts),'retainedRows':len(result),
             'excludedRows':len(excluded),'walkingRows':sum(r['travelMode']=='walking' for r in result),
             'vehicleRows':sum(r['travelMode']=='vehicle' for r in result),
             'distinctRowIds':len(seen),'repeatedRowIds':{k:v for k,v in seen.items() if v>1},
             'groupRenames':{k:next(iter(v)) for k,v in groups.items() if next(iter(v))!=k},
             'conditionalVariants':conditional,'issues':issues,
             'reviewCompletedByOwner':counts.get('待查',0)==0,
             'nodeIdentityStatus':'pending_physical_identity_compilation',
             'routingPublished':False}
    return {'schemaVersion':1,'reviewBasis':'owner_workbook_review','rows':result,'excluded':excluded},summary

def process(source,out):
    data,summary=normalize(read_sheet(source))
    checksum=hashlib.sha256(Path(source).read_bytes()).hexdigest()
    data['sourceWorkbookSHA256']=checksum;summary['sourceWorkbookSHA256']=checksum
    folder=Path(out);folder.mkdir(parents=True,exist_ok=True)
    for name,value in [('reviewed_rows.private.json',data),('review_import_summary.json',summary)]:
        (folder/name).write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n')
    return summary

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('workbook');p.add_argument('--out',required=True)
    args=p.parse_args();print(json.dumps(process(args.workbook,args.out),ensure_ascii=False,indent=2))
