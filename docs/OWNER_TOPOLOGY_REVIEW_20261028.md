# Owner topology review — 2026-10-28

The ledger `data/audits/user_reviewed_topology_20261028.json` records all current owner decisions. It corrects the previous audit's false rejection of the G09 walking triangle and resolves all three pending G13 pond-junction rows. G15 東巒大山 and 東郡大山 remain distinct physical locations; only the two explicit erroneous route records are replaced. G16 馬西山口/烏哇拉路 and the G15 misspelled hut endpoints are excluded, rather than renamed into unrelated graph edges. G18 三叉營地 is excluded, not aliased to 三叉稜下營地. G04's separately chart-labeled 三叉營地 is unchanged.

G19 original row 830 already contains the 105/80 summit trail. Its trailhead display becomes 關山嶺山登山口 per owner instruction. Wrong row 831 (summit to 埡口山莊) is excluded so the correction does not create a second copy of the walking trail. No public-road transfer between differently labeled endpoints is inferred.

Private ingest order: previous reviewed directional values → exact-record owner topology review → group/name normalization → consistency audit → source-review queue. The topology step is explicit and optional for programmatic synthetic callers; CLI uses this ledger by default. Changes require exact group/endpoints/original-minute matches. Unknown or changed records fail closed. Reapplying the same ledger is idempotent. Every excluded/replaced record retains before/after evidence in its private report.

Actual full run: 869 input records → 863 candidates, 24 groups, zero conflicting directional keys; publicationAllowed remains false. These are candidate corrections, not approval to ingest every remaining edge into automatic walking routing. User itinerary snapshots and production files are not modified.

Updated original-row audit counts: 770 matching, 65 vehicle/transport, 16 directional-minute differences, 9 conditional/duplicate-time cases, 9 endpoint/connection differences, zero unresolved G13 junction rows. Classification is for the original input; applied fixes are tracked separately. Earlier counts remain recoverable in git.
