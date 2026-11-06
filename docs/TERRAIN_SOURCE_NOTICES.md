# Terrain build sources 2026-11-06

這是建置資料封存，不是新的應用程式版本。正式應用程式版本維持 v0.9.0。

- `walking-network-roads.json.gz`：以本庫 `tools/extract_walking_network.py` 從 Geofabrik Taiwan 歷史版本 PBF（以 manifest 的 URL 與雜湊為準） 重新擷取，PBF SHA-256 必須與 v0.9.0 記錄一致。並非找回當時壓縮檔的逐位元副本；gzip 時間戳固定為零，來源與擷取程式可重現。
- `hgtmix.zip`：魯地圖 DEM mix v2026 原始壓縮檔，SHA-256 與正式版 provenance 相同，未修改。
- `terrain-sources-manifest.json`：檔案大小、來源與 SHA-256。下載後應驗證，不要信任同名但不同內容的檔案。
- 原始全臺 PBF 不重複上傳；版本下載網址及 SHA-256 見 manifest。

## OpenStreetMap

© OpenStreetMap contributors. Walking network data is provided under the Open Database License (ODbL 1.0): https://www.openstreetmap.org/copyright . Extract source: the verified, dated Taiwan PBF URL recorded in terrain-sources-manifest.json . The derived walking network is distributed under the same database license. This data license is separate from the application code license.

## Rudy DEM

Copyright (c) 2016-2024 Rudy Chung. All rights reserved.

Unmodified DEM archive: https://rudymap.tw/v1/hgtmix.zip . The copyright notice, redistribution conditions and disclaimer are reproduced by reference to the original notice at https://rudymap.tw/taiwan_topo.html (「版權宣告」及「地圖版權與散佈說明」), as permitted for binary redistribution by that notice. This archive retains the original name and bytes. No endorsement is implied.

The upstream notice identifies Taiwan MOI DTM and JAXA AW3D30 among its source data; their respective terms and credits remain applicable. DEM heights are estimates and not independently surveyed elevations. The upstream map and data are supplied “AS IS”; refer to the linked original notice for the complete conditions and disclaimer.
