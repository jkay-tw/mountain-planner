#!/usr/bin/env python3
"""Compile owner-reviewed rows to private physical graph, preserving known IDs.

Exact reviewed edge adjacency resolves ambiguous labels. Approved crosswalks
alone allow cross-group identity reuse. No publishing or saved-plan mutation.
"""
import argparse
from collections import defaultdict
import hashlib
import json
from pathlib import Path
import re
ROOT=Path(__file__).resolve().parents[1]
def load(p):return json.loads(Path(p).read_text())
def stable(value):return hashlib.sha256(value.encode()).hexdigest()[:20]

def compile_rows(data,root=ROOT):
    policy=load(root/'data/audits/owner_full_review_policy_20261028.json')
    inventory=root/'data/audits/main_step_chart_label_inventory_20261028.json'
    source_urls={c['chartId']:c['sourceURL'] for c in load(inventory)['charts']} if inventory.exists() else {}
    chart_aliases={c['chartId']:{k:v for k,v in c.get('labelDifferences',{}).items()
                   if v not in {'岔路','岔路口','三岔路口','水源','池有山登山口'}} for c in load(inventory)['charts']} if inventory.exists() else {}
    mapping=root/'data/candidate_group_mapping.json'
    group_charts={x['candidateGroup']:x['officialChartId'] for x in load(mapping)['mapping']} if mapping.exists() else {}
    def chart_name(ch,n):return chart_aliases.get(ch,{}).get(n,n)
    follow=policy['ownerFollowup']; aliases={(x['group'],x['from']):x['to'] for x in policy['displayAliases']}
    def name(g,n):return aliases.get((g,n),chart_name(group_charts.get(g),n))
    cw=load(root/'data/crosswalk-reviewed.json'); shared={};canonical={}
    for c in cw['canonicalNodes']+policy.get('additionalCanonicalNodes',[]):
        nid='shared:'+c['canonicalId'];canonical[nid]=c['name']
        for m in c['members']:shared[(m['group'],name(m['group'],m['name']))]=nid
    base_catalog=root/'data/owner-review-base-catalog.json'
    manifest=load(base_catalog if base_catalog.exists() else root/'data/unified-editor-manifest.json')
    catalogNames={};knownEdges=defaultdict(set);knownNames=defaultdict(set)
    for entry in manifest['routes']:
        r=load(root/entry['file'].split('?')[0]);chart=entry['id']
        for n in r['nodes']:catalogNames[n['id']]=n['name']
        for e in r['segments']:
            for ch in (['G17','G18'] if chart=='G17G18-PREVIEW' else [chart]):
                knownEdges[(ch,chart_name(ch,e['from']),chart_name(ch,e['to']))].add((e['fromId'],e['toId']))
                knownNames[(ch,e['from'])].add(e['fromId']);knownNames[(ch,e['to'])].add(e['toId'])
    groups=defaultdict(list)
    for original in data['rows']:
        if original.get('ownerReviewStatus') not in ('確認','修正'):raise ValueError('Unreviewed row cannot enter owner-reviewed compilation')
        r=dict(original)
        if r['sourceRowId']==follow['sourceRowId']:
            if (r['originalGroup'],r['from'],r['to'])!=(follow['group'],follow['from'],follow['to']):raise ValueError('Follow-up target changed')
            r.update(go=follow['go'],back=follow['back'],note=follow['note'])
        for override in policy.get('timeOverrides',[]):
            if r['sourceRowId']==override['sourceRowId']:
                if (r['originalGroup'],r['from'],r['to'])!=(override['group'],override['from'],override['to']):raise ValueError('Time override target changed')
                r.update(go=override['go'],back=override['back'])
        r['from']=name(r['originalGroup'],r['from']);r['to']=name(r['originalGroup'],r['to'])
        groups[r['sourceRowId']].append(r)
    rows=[];issues=[]
    for rowid,variants in groups.items():
        base=dict(variants[0]);base['evidenceRows']=[v['sheetRow'] for v in variants];base['alternatives']={'go':[],'back':[]}
        for direction in ['go','back']:
            options={v[direction] for v in variants};notes=' '.join(v['note'] for v in variants)
            labeled=re.findall(r'(輕裝|重裝|快|慢)\s*[:：]?\s*(\d+)',notes)
            # A declared direction wins; otherwise the varying direction identifies it.
            relevant=('回程' in notes and direction=='back') or ('去程' in notes and direction=='go') or (len(options)>1 and '回程' not in notes and '去程' not in notes)
            if relevant:
                standards={int(n) for label,n in labeled if label in ('輕裝','快')}
                if len(standards)==1:base[direction]=next(iter(standards))
                alts={(('heavy_pack' if label=='重裝' else 'slow'),int(n)) for label,n in labeled if label in ('重裝','慢')}
                base['alternatives'][direction]=[{'kind':kind,'minutes':n} for kind,n in sorted(alts)]
                explained={base[direction]}|{a['minutes'] for a in base['alternatives'][direction]}
                if not options<=explained:issues.append({'kind':'unexplained_time_variants','rowId':rowid,'direction':direction})
            elif len(options)>1:issues.append({'kind':'unlabelled_time_variants','rowId':rowid,'direction':direction})
        rows.append(base)
    # Seed identities from reviewed edge adjacency, scoped to the original group.
    # A chart can contain different places with the same label in separate groups.
    seeded=defaultdict(set)
    for r in rows:
        matches=knownEdges.get((r['chartId'],r['from'],r['to']),set())
        if len(matches)==1:
            a,b=next(iter(matches))
            seeded[(r['originalGroup'],r['from'])].add(a)
            seeded[(r['originalGroup'],r['to'])].add(b)
    nodes={};edges={};vehicles=[];endpointBindings=[]
    def resolve(r,side):
        g=r['originalGroup'];n=r[side];other=r['to' if side=='from' else 'from'];chart=r['chartId']
        context=None;nid=None
        ambiguous=n in policy['ambiguousLabels'].get(g,[])
        for rule in policy['contextNodes']:
            if (g,n)==(rule['group'],rule['name']) and other in rule['neighbors']:context=rule['context']
        pair=knownEdges.get((chart,r['from'],r['to']),set())
        if len(pair)==1:nid=next(iter(pair))[0 if side=='from' else 1]
        if not nid and not ambiguous:
            nid=shared.get((g,n))
            if not nid and len(seeded.get((g,n),set()))==1:nid=next(iter(seeded[(g,n)]))
        if ambiguous and not nid and not context:
            issues.append({'kind':'unresolved_physical_identity','group':g,'name':n,'other':other,'sheetRows':r['evidenceRows']})
            nid='unresolved:'+stable(g+'|'+r['sourceRowId']+'|'+side)
        if not nid:nid='node:'+stable(g+'|'+(context or n))
        # Explicit physical identities confirmed by the owner on 2026-11-01.
        # Restrict each mapping to both original group and prior physical ID.
        reviewed_snow_ids={
            ('雪山西南稜','node:1c91e71b467300e90b6c'):('g04-045','雪山登山口'),
            ('雪山西南稜','node:fba428b6693c1f3ff1b9'):('node:f6f2ba4c01559d0ff632','武陵農場·遊客中心'),
            ('大霸/聖稜/四秀','g04-045'):('g04-045','雪山登山口'),
        }
        snow=reviewed_snow_ids.get((g,nid))
        if snow:nid=snow[0]
        display=catalogNames.get(nid,canonical.get(nid,n))
        if snow:display=snow[1]
        old=nodes.setdefault(nid,{'id':nid,'name':display,'aliases':[],'groups':[],
            'identityBasis':'existing-reviewed-identity' if nid in catalogNames else ('reviewed-crosswalk' if nid in canonical else ('adjacency-context' if context else 'group-scoped-owner-reviewed-label'))})
        if n!=display and n not in old['aliases']:old['aliases'].append(n)
        source_label=r.get('original',{}).get('候選起點' if side=='from' else '候選終點')
        if source_label and source_label!=display and source_label not in old['aliases']:old['aliases'].append(source_label)
        if r['group'] not in old['groups']:old['groups'].append(r['group'])
        endpointBindings.append({'rowId':r['sourceRowId'],'side':side,'nodeId':nid,'localName':n,'originalGroup':g})
        return nid
    for r in rows:
        a,b=resolve(r,'from'),resolve(r,'to')
        if a==b:
            issues.append({'kind':'self_loop','rowId':r['sourceRowId']});continue
        for direction,x,y in [('go',a,b),('back',b,a)]:
            e={'fromId':x,'toId':y,'from':nodes[x]['name'],'to':nodes[y]['name'],'minutes':r[direction],
               'travelMode':r['travelMode'],'verificationStatus':'verified','verificationBasis':'owner_workbook_review',
               'timeAlternatives':r['alternatives'][direction],
               'sourceRows':[r['sourceRowId']],'evidenceRows':r['evidenceRows'],'sourceGroups':[r['group']],
               'sourceChart':r['chartId'],'source':source_urls.get(r['chartId']),'sourceNote':r['note'],'sourceWorkbookSHA256':data['sourceWorkbookSHA256']}
            e['sources']=[{'group':r['group'],'chartId':r['chartId'],'url':source_urls.get(r['chartId']),
                           'rowId':r['sourceRowId'],'sheetRows':r['evidenceRows'],'minutes':r[direction]}]
            if r['travelMode']=='vehicle':vehicles.append(e);continue
            key=(x,y)
            if key in edges:
                prev=edges[key]
                if prev['minutes']!=e['minutes']:
                    issues.append({'kind':'directed_time_conflict','nodes':[x,y],'values':[prev['minutes'],e['minutes']],'sourceRows':prev['sourceRows']+e['sourceRows']})
                    prev['routingEnabled']=False
                    prev.setdefault('conflictingSources',[]).append(e)
                prev['sources'].extend(e['sources'])
                prev['sourceRows']=sorted(set(prev['sourceRows']+e['sourceRows']))
                prev['evidenceRows']=sorted(set(prev['evidenceRows']+e['evidenceRows']))
                prev['sourceGroups']=sorted(set(prev['sourceGroups']+e['sourceGroups']))
                for alt in e['timeAlternatives']:
                    if alt not in prev['timeAlternatives']:prev['timeAlternatives'].append(alt)
            else:edges[key]=e
    graph={'schemaVersion':1,'route_id':'OWNER-REVIEWED-PRIVATE','route_name':'全圖人工核對路網（待身分編譯驗證）',
           'routingPolicy':'verified-walking-only','routingEnabled':not issues,'publicationEligible':False,
           'nodes':sorted(nodes.values(),key=lambda n:n['id']),'segments':list(edges.values()),'transportSegments':vehicles,
           'sourceWorkbookSHA256':data['sourceWorkbookSHA256']}
    summary={'inputRows':len(data['rows']),'uniqueSourceRows':len(rows),'nodes':len(nodes),'walkingDirections':len(edges),
             'vehicleDirections':len(vehicles),'issues':issues,'routingEnabled':not issues,'publicationEligible':False}
    return graph,summary,endpointBindings

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('review');p.add_argument('--out',required=True);a=p.parse_args()
    graph,summary,bindings=compile_rows(load(a.review));folder=Path(a.out);folder.mkdir(parents=True,exist_ok=True)
    for fn,d in [('owner_graph.private.json',graph),('node_identity_summary.json',summary),('endpoint_bindings.private.json',bindings)]:
        (folder/fn).write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps(summary,ensure_ascii=False,indent=2))
