# 台灣本島 OSM 路網試建（2026-11-13）

本次是資料與架構可行性試點，不是正式路網發布。分支 `codex/osm-mainland-pilot` 接續 IDEA-003 Preview，正式 `main` 不變。已核對遠端 main `39e2374`、IDEA-003 `589c6d1`，以及現有 #6、#10、#12、Draft PR #30 的手機與操作限制。

## 結論與建議

使用 OSM 線形、保留既有上河節點、不另建 OSM 地標資料庫的方向可行。但尋路仍必須保存 OSM 幾何頂點與交會 Node ID；這些是拓樸資料，不是山屋、山頭等地標資料庫。底圖上的地標文字不能替代可尋路資料。

全本島候選線形可離線預建，瀏覽器按區載入；不把完整圖直接塞入目前依上河時間計權的 planner。距離尋路採獨立模組，後續才以具來源的路段結果接到 DAY／局部編輯層。上河時間不能轉給 OSM 路段；OSM 路段時間保持未知。手動點接入必須確認，不以座標接近合併全域 Node ID。

本次可開啟三個真實資料樣本、確認接入、沿 OSM 尋路、計算距離與節點 DEM 升降、匯出完整 GPX；Happyman 可作為額外參考疊圖。**完整 75 區塊尚未接入 DAY、自動跨區載入、拖線編輯或正式統計**；不能把樣本頁描述成全台整合版。

魯地圖與 OSM 不應視為逐條相同。此版本只證明 OSM 資料處理可行，未匯入或核實魯地圖獨有修訂。最完整資料的後續策略為 OSM 基礎圖加上有授權、可追溯、經核對的額外線形；保留不同來源與差異，不從底圖圖片反推可通行連線。

## 實測規模

| 項目 | 結果 |
| --- | --- |
| 原始 Taiwan PBF | 328,388,503 bytes |
| 本島核心線形及一跳接駁 | 323,900 條 OSM way；不是 323,900 條獨立步道 |
| 0.25 度區塊 | 75 塊，gzip 合計 55,731,652 bytes，約 53.2 MiB；尚未加 DEM |
| 最大北部／都會混合區塊 | gzip 5,306,667 bytes；解碼 JSON 23,980,300 bytes；300,267 個幾何點 |
| 雪山原區塊 | gzip 448,513 bytes；34,387 個幾何點 |
| 本機預建時間 | 約 303 秒；不是 CI 或手機效能保證 |

三個公開樣本加了原始頂點 DEM：雪山約 0.53 MiB、玉山約 0.43 MiB、北部局部約 1.56 MiB。實際大小與 SHA256 見 `preview/data/osm-pilot/samples.json`。全量區塊清單、來源雜湊與排除統計見 `build-manifest.json`；全量檔案及原始 PBF 留在本機評估目錄，不加入 Git。

桌面本機瀏覽器載入、解壓、建圖及建立線形圖層合計：雪山約 147 ms、玉山約 155 ms、北部樣本約 542 ms。一次雪山選點尋路為 9.83 km，計算約 4 ms，接入線不算入該距離。這是樣本操作記錄，不是指定山徑的現地驗證。

Node 24 本機額外量測，未含地圖繪製：雪山完整區塊解碼／建圖約 87 ms；最大北部區塊約 999 ms。後者同程序順序量測的 heap 增量約 315 MiB，受 GC 與前一次樣本殘留影響，僅能作警訊。不能把壓縮 5 MiB 當作手機記憶體需求。建議進一步用簡化交會圖、Web Worker、空間索引與區塊快取；跨區應逐步擴大搜尋，區塊內失敗不能推定全台不連通。

台北完整市區範圍仍待討論。本次全量候選保留市區步行道路，避免未經確認就切掉陽明山、郊山與接駁；北部 Preview 僅取 way 中間頂點緯度 25.125～25.25 的整條 way，是檢查樣本，不是已核准的山區邊界。離島由本島封閉海岸線排除，不使用舊版裁掉北台灣的矩形範圍。

## 篩選與連通規則

- 核心類別：`path`、`track`、`footway`、`steps`、`pedestrian`；這是偏完整的候選集合，包含市區人行道、農林道，不能統稱核實登山步道。
- 接駁：既有工具允許的道路類別中，與核心 way 共享**相同 OSM node ID** 的整條 way，只保留一跳。不是完整道路圖；多跳接駁可能缺漏。
- 排除禁止步行、私有且無步行例外、施工／規劃道路、區域面與含禁止條件的道路。保留原標籤，不推論季節開放或合法性。障礙節點採保守阻斷，可能造成假性斷路，須人工核對。
- 依原始 OSM node ID 相接，支援 `oneway:foot`；線形相交或座標相同但 ID 不同不建立邊。圖磚只是顯示，沒有自動接入權威。
- 最大封閉 OSM coastline ring 作為本島多邊形，需通過有效性檢查；海岸線開口不補線。所有原頂點在本島內才保留整條 way，不自行剪出假連接。707 個封閉環及 1 個開鏈都有紀錄；最大環面積 3.191755278 平方度。
- way 依中間頂點分塊，整條保留；跨塊共用頂點沿用原 ID。單塊不是完整獨立尋路區域。

## DEM、GPX 與來源

OSM：[Geofabrik Taiwan](https://download.geofabrik.de/asia/taiwan.html)，快照 `2026-11-12T21:23:05Z`，PBF SHA256 `6db4a97a72f3e9de6d2404359c6bbca0fec1f34ee870e08bb45368e7aa7a1fa7`。© OpenStreetMap contributors，[ODbL 1.0](https://www.openstreetmap.org/copyright)。樣本保留 way ID、版本、時間及標籤，提供可讀 JSON gzip、重建程式與來源資訊。

DEM：[魯地圖 DEM mix v2026](https://rudymap.tw/)，來源 `https://rudymap.tw/v1/hgtmix.zip`，SHA256 `5965dab6fd19ca1b1ecb077b0219fe4e932b599dd985fa96266d383e166594a0`。原 ZIP 約 43.6 MiB，解壓約 420.5 MiB，不整包送手機。本試點沿用專案既有 HGT 雙線性取樣，只對 OSM 原頂點預取樣；**尚未沿線每 30m 重採樣及平滑**，升降只是粗估。三個樣本缺值為 0，不能推論所有路段皆無缺值；缺值輸出 null、不補 0。手動接入線不推估高程或時間，任意手動幾何 DEM 整合仍待後續。

GPX 依序輸出「指定起點 waypoint、指定終點 waypoint、起點接入 track、完整 OSM track、終點接出 track」。手動接入 track 標示未核實，不含虛構高程；OSM track 保留所有尋路頂點、DEM 及使用的 way ID，沒有上河時間。原 DAY、Excel 及 GPX 匯出未改。

Happyman：[官方入口](https://map.happyman.idv.tw/) 提供 WMTS。此版僅以官方圖磚作預設關閉的顯示疊圖，保留來源署名；主 Preview 可調透明度。不是 GPX 向量下載、來源授權合併或逐條作者資訊查詢；個別資料仍需到來源網站查詢。不能從圖磚建立 OSM 連通或匯出為本行程 GPX。無批量下載／離線鏡像，服務暫時不可用時可關閉，行程仍可編輯。

本次未啟用付費 API、付費主機或新增費用。後續以免費靜態資源按區提供可行，但第三方底圖與疊圖服務不保證永久免費、可用或無流量限制；全量鏡像與公開大量流量需另外核對服務條件。

## 重建與驗證

Python 3.11+、`osmium==4.3.2`、`shapely==2.2.0`；原始檔與產物路徑請指定到 Git 外：

```text
python tools/build_osm_mainland_pilot.py <taiwan.osm.pbf> <output-directory>
python tools/make_osm_pilot_samples.py <output-directory> <hgtmix.zip> preview/data/osm-pilot
node --test tests/*.test.mjs preview/tests/*.test.mjs
python -m unittest discover -s tests -p 'test_*.py'
python tools/sync_coordinate_geometry.py --check
```

新增驗證涵蓋精確海岸線端點、不可補海岸線、近座標不同 ID 不合併、方向、障礙、未知時間、樣本雜湊／來源／參照完整性、真實樣本尋路，以及 GPX 的完整點序與來源分離。既有資料完整性、快速加入、圖組切換、節點身分、手動時間與匯出回歸繼續執行。

本機結果：JavaScript 全套與 Preview tests **193/193**，Python **122/122**；Preview 全 JS 語法、既有 app／planner／node-identity 語法、座標幾何同步守門及 `git diff --check` 通過。Python 使用 CI 指定的 numpy／scipy 與 UTF-8 暫存環境；Node 24 不使用舊版的 default-type 旗標。

桌面瀏覽器已驗證三區載入、起終點接入確認、尋路與 GPX 下載；390px 版面可見且無明顯橫向溢出。iPhone Safari／Chrome、Android 實機速度、觸控與捲動尚未驗收。OSM 標籤不能代替路況／安全核實；此試點不宣稱台灣所有實際步道均已收錄。
