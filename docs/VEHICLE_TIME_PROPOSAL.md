# Vehicle time proposal — discussion only

Status: proposed, no UI or time-calculation behavior implemented by this change.

Recommendation: allow a distinct optional 車行／接駁 itinerary segment. Keep vehicle data outside the walking routing graph. A vehicle segment has a user-editable fixed minute value and does not use the Sunriver walking coefficient. Keep walking time, vehicle time, and rests as separate totals; include all known values in elapsed time and arrival clock calculations. Coefficient averages and walking totals exclude vehicle segments.

Example: official walk 100 min × coefficient 0.8 + drive 50 min = elapsed 130 min, not 120 min. Unknown vehicle minutes remain null, not zero: downstream arrival time stays incomplete. Permit users to retain the destination and fill an estimate. A node-only, no-time mode is suitable when intentionally leaving travel logistics unresolved, but should not silently imply zero travel time.

Known chart or owner-confirmed car values may appear as editable references with provenance, not as a promise of current road access or travel duration. The owner-confirmed 合歡山管理站→北合歡山登山口 2/2 is retained as vehicle metadata only. Do not automatically add any vehicle shortcut when searching a walking path.

Keep the existing five-control responsive layout. Optional visibility of transport nodes and a simple segment-type selector are possible implementation choices after owner agreement; no final UI is assumed here. Preserve existing manual times and saved official-minute snapshots during any future schema migration.
