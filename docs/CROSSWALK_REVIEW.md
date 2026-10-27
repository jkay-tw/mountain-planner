# v0.7 Cross-group node mapping: review workflow

## Safety principle
- Display names do NOT identify physical locations.
- Every source group retains separate route-scoped nodes unless a reviewed pair is explicitly approved.
- Never join routes by `name` or fuzzy matching. Node ID references, not label equality, are the only permissible join.
- `data/crosswalk-policy.json` starts with `approvedSharedNodes: []`; it explicitly rejects the 玉山 vs 奇萊 `主北岔路` collision.
- Candidate matches do not authorize public route generation, and third-party route times are not automatically copied into the published dataset.

## Generate review queue (local use only)
```sh
python tools/build_crosswalk.py /path/to/hiking-segments.json --out audit/crosswalk
```
Output: `cross_group_node_review.csv`, `summary.json`. Review columns:
- `group_a`, `group_b`, `name`: two source nodes sharing a displayed name
- `neighbor_a`, `neighbor_b`, `shared_neighbors`: neighboring labels (not IDs!)
- `matching_directed_times`, `conflicting_directed_times`: consistency clues, not identity proof
- `status`: `do_not_merge`, `high_priority_review`, `review`, `unresolved`
- `canonical_node_id`, `reviewed_by`, `evidence_url`: intentionally empty until human verification

## Review acceptance
1. Confirm both endpoints are the *same physical coordinate/location* against source hiking maps, GPX or trusted map evidence (accounting for naming aliases).
2. Verify surrounding route topology and whether source names or route alignments differ in time.
3. Store durable node IDs independently of the group and name, and record evidence/provenance.
4. Confirm data permission and attribution before incorporating any third-party route content.
5. Add regression tests for both confirmed joins and forbidden joins. Publish only after separate UI and data acceptance.

## User review accepted — 202 cross-map pairs (2026-10-27)
- The two user-edited review workbooks plus explicit CW-004, CW-028 and CW-039 confirmations establish 123 same and 79 different pairs, without transitive contradictions.
- `data/crosswalk-reviewed.json` records 81 stable canonical identity clusters (180 group members) plus all 79 denied pairs.
- `js/crosswalk.js` rejects a canonical cluster that contradicts any denied pair. The generic names are no longer blanket-rejected.
- Identity does **not** imply that hiking time, direction, or edge class has been verified.
- All canonical records have `routingEnabled:false`. In particular, a transit junction such as 霧社 must not turn road travel into a walking connection.
- `data/source-audit-progress.json` tracks chart checks for G06 and G11; other groups remain pending.

## Current scope
The v0.7 preview has only G06 official route segments. Candidate cross-group matches are a separate research workflow, **not yet connected to the planner**, and the production app remains v0.6.2.
