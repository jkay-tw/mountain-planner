# Mountain Planner mainland DEM trial grids

These renamed small grids derive from Rudy DEM mix v2026, copyright (c) 2016–2024 Rudy Chung. Credit, conditions and disclaimer are retained in [TERRAIN_SOURCE_NOTICES.md](TERRAIN_SOURCE_NOTICES.md) and the upstream [copyright and distribution notice](https://rudymap.tw/taiwan_topo.html). No upstream endorsement is implied.

The original archive SHA256 is `5965dab6fd19ca1b1ecb077b0219fe4e932b599dd985fa96266d383e166594a0`. This trial changes the packaging and masks points outside the exact-ID closed mainland OSM coastline to NoData; it does not change the remaining original integer HGT samples. The browser uses bilinear estimates along current geometry at intervals no greater than about 30 metres. Missing data stays unknown. The archive includes MOI DTM and JAXA source credits; their applicable terms remain in the upstream notice. Redistribution relies on the upstream overall distribution notice, rather than a separately stated DEM-only license.

Rebuild with `tools/export_trial_coastline.py` and `tools/package_preview_dem.py`; the manifest records both archive and coastline hashes. These grids are trial estimates, not surveyed heights or evidence of trail passability.
