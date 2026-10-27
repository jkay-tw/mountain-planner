#!/usr/bin/env python3
"""One-command, fail-closed candidate ingest for offline/private hiking data.

Steps: user-reviewed directional corrections -> group/name normalization ->
deterministic candidate consistency audit. Does not publish routes.
"""
import argparse
import json
from pathlib import Path

from apply_reviewed_times import apply
from normalize_candidate_groups import process
from batch_hiking_pipeline import audit


def run(input_file, ledger_file, mapping_file, crosswalk_file, staging_dir, output_dir):
    out=Path(output_dir)
    review_dir=out/'01_reviewed_times'
    mapped_dir=out/'02_group_normalization'
    validation_dir=out/'03_batch_validation'
    time_result=apply(input_file,ledger_file,review_dir)
    mapping_result=process(review_dir/'reviewed_candidates.json',mapping_file,mapped_dir)
    audit_result=audit(mapped_dir/'normalized_candidate.json',validation_dir,
                       crosswalk=crosswalk_file,staging=staging_dir)
    if audit_result['structuralIssues'] or audit_result['conflictingDirectedKeys']:
        readiness='BLOCKED_DATA_CONFLICTS'
    else:
        readiness='CANDIDATE_ONLY_SOURCE_REVIEW_PENDING'
    summary={'schemaVersion':1,'publicationAllowed':False,'readiness':readiness,
             'timeCorrections':time_result,'groupMapping':mapping_result,
             'batchValidation':audit_result,
             'nextGate':'independently document source for each published walking direction; confirm rights before release'}
    out.mkdir(parents=True,exist_ok=True)
    (out/'ingest_summary.json').write_text(
        json.dumps(summary,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    return summary


if __name__=='__main__':
    p=argparse.ArgumentParser()
    p.add_argument('source_json')
    p.add_argument('--review',default='data/audits/user_reviewed_time_overrides_20261028.json')
    p.add_argument('--mapping',default='data/candidate_group_mapping.json')
    p.add_argument('--crosswalk',default='data/crosswalk-reviewed.json')
    p.add_argument('--staging',default='data/staging')
    p.add_argument('--out',default='audit/private_ingest')
    a=p.parse_args()
    report=run(a.source_json,a.review,a.mapping,a.crosswalk,a.staging,a.out)
    print(json.dumps({'publicationAllowed':report['publicationAllowed'],
                      'readiness':report['readiness'],
                      'candidateRows':report['batchValidation']['candidateRows'],
                      'candidateGroups':report['batchValidation']['groups'],
                      'conflictingDirections':report['batchValidation']['conflictingDirectedKeys']},
                     ensure_ascii=False,indent=2))
