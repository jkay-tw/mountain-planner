# Mountain Planner｜快速加入路網小地圖與座標同步交接（2026-11-05）

> **工作狀態**：Preview 程式已更新，待使用者瀏覽器驗收；正式版 v0.8.8 的入口／JS／CSS 與正式地圖執行期資料未因本次修改而更動。這不是正式版發布公告。

## 目的與使用者回饋

- 路網小地圖改以**真實座標等比例**排列節點，路網邊只代表步行連通，不代表 GPX 路徑。
- 前版為了避免標籤碰撞，把文字移到離節點很遠的備用位置；使用者截圖顯示名稱與圓點對應混亂。
- 本版**只允許文字在節點周邊避讓**；近處實在放不下時，隱藏次要標籤文字（仍畫節點、保留 SVG `<title>` 與上方快速加入名稱），不能移動真實座標圓點。這是資訊取捨，需實機驗收。
- 圖中目前位置使用綠色圓點／光暈／綠底白字標示，連續按「＋地點」後小地圖保持開啟並自動刷新，再點一次「路網小地圖」才關閉。
- 使用者另外觀察到「已修改節點座標但重新整理不更新」：舊程式曾用固定 `?v=v084` 載入**獨立的幾何執行期資料**，修改路網節點或覆寫來源不會自動變更地圖／GPX。

## Preview 驗收入口

https://jkay-tw.github.io/mountain-planner/preview/unified-editor.html?v=coordsync1

測試建議：鞍部叉路、太平谷南口、玉林橋大崩壁、17K水泥橋，以及 G04 的三叉營地／中霸坪叉路／雪山東峰等密集岔路。確認標籤沒有跑到遠方、目前位置清楚、並檢查連續快速加入後地圖不收起。

## 哪份檔案才是座標來源？

**不要把路線 `nodes[]`、圖中 SVG、GPX 與幾何資料當成可以各自修改的獨立座標庫。**

| 資料角色 | 檔案 |
|---|---|
| 使用者人工核對／座標覆寫（經度、緯度） | `data/geometry/sources/owner-coordinate-overrides.json` |
| 來源角色排除與修正 | `data/geometry/sources/owner-update-source-corrections.json` |
| 步行路網節點身分及方向邊 | `data/unified-editor-manifest.json` 指向的 `data/routes/owner-reviewed/*.json` |
| 既有座標、地形、線形與 GPX／距離／升降的共同執行期資料 | `data/geometry/planner-terrain-v1.json`（正式版）與 `preview/data/geometry/planner-terrain-v1.json`（Preview） |
| 使用來源拓樸和 DEM 的增量重算器 | `tools/update_planner_terrain.py` |
| 新增：一致性檢查、增量重算的安全入口、Preview 同步及明示核准的正式推送 | `tools/sync_coordinate_geometry.py` |
| 新增：PR／手動啟動檢查 | `.github/workflows/coordinate-geometry-gate.yml` |
| 新增：防回歸測試 | `tests/test_sync_coordinate_geometry.py` 和 `preview/tests/quick-topology.test.mjs` |

目前現有幾何資料為 **724 節點、622 個有座標的有效點、56 個尚缺座標的有效點、另外 46 個車行／忽略點**（以本次 GitHub 讀取結果為準）。`ownerUpdateInputFingerprint` 對來源內容建立 SHA256 指紋，新的檢查器使用與既有增量重算器**相同順序及序列化方式**算出指紋。

重要：**路網節點資料更新**與**幾何資料更新**是兩種不同事情。節點、來源覆寫、方向邊、來源修正或參考線形一旦改動，如果地形執行期資料指紋不匹配，必須先重算才能表示「同步完成」。

## 未來更新座標的標準流程

1. **先修改經人工確認的座標來源**；TWD97 須先正確轉成 WGS84 `[longitude, latitude]`，保留 Node ID、來源、覆寫依據，不因名稱相同合併節點。
2. **資料驗證（唯讀）**：
   ```bash
   python3 tools/sync_coordinate_geometry.py --check
   ```
   不一致時會直接報錯，不把過期的幾何資料假裝成最新版本。
3. **若既有正式幾何資料已透過工具完整重算，僅需同步 Preview**：
   ```bash
   python3 tools/sync_coordinate_geometry.py --sync-preview
   ```
   此命令會先驗證指紋／人工覆寫，再以同一份檔案複製到 Preview，並更新 Preview 的幾何 URL 與編輯器快取版本，不更動正式版入口。
4. **若幾何資料尚未重算，從原始步道路網＋DEM直接更新 Preview**：
   ```bash
   python3 tools/sync_coordinate_geometry.py --build-preview /path/to/walking-network-roads.json.gz /path/to/hgtmix.zip
   ```
   這是對既有 `tools/update_planner_terrain.py` 的封裝，先在暫存目錄計算受影響路段及高程，再完成檢查，最後才寫入 `preview/data/geometry/planner-terrain-v1.json`。不會只修改 SVG 的點位而留下舊 GPX；**必要 OSM／DEM 來源必須由執行環境提供，GitHub 上沒有保證可直接取得這兩個大型原始資料檔**。
5. 執行所需測試，再用瀏覽器實機驗收：
   ```bash
   python3 -m unittest discover -s tests -p 'test_sync_coordinate_geometry.py'
   node --experimental-default-type=module --test preview/tests/quick-topology.test.mjs
   node --experimental-default-type=module --test tests/coordinate-update.test.mjs tests/full-terrain.test.mjs tests/itinerary-geometry.test.mjs
   ```
   完整地形重算另參照 `docs/COORDINATE_UPDATE_WORKFLOW.md` 的既有 Python／JS 測試。
6. **使用者確認 Preview 後才更新正式版**，在得到明確發布授權且備份已核對的環境：
   ```bash
   python3 tools/sync_coordinate_geometry.py --promote-production --approve-production
   ```
   此命令會將已驗證的 Preview 幾何資料推到 `data/geometry/planner-terrain-v1.json`，更新正式版的 JS 幾何快取參數及 `index.html` JS 引用參數。**本次沒有執行此命令**。正式版的快速加入小地圖本身仍須另行驗收及發布 Preview 功能碼，單純資料推送不會讓正式版突然出現新小地圖。

### 自動檢查的能力與限制

- 新工作流程會在相關 **Pull Request** 變更及手動工作流程啟動時，執行唯讀同步檢查及離線單元測試。
- `--check` **不自動重建 OSM 路徑與 DEM**。若沒有原始 `json.gz` / `zip` 來源，應報錯及等待可用的建置環境，不得造出直線 GPX、沿用舊高程或聲稱同步完成。
- `--build-preview` 對幾何使用暫存執行期資料，不直接改寫正式版 `data/geometry/planner-terrain-v1.json`；但既有更新器若產生新 OSM way 來源證據，可能同時更新 `data/geometry/sources/owner-update-osm-ways.json`，**必須把此來源檔 diff 一起審核**。
- Preview 現在對幾何載入使用 `cache:'no-store'`；發布工具再用幾何檔 SHA256 更新 URL 參數與 Preview JS 引用，以避免使用者刷新時讀到舊快取。
- 若人工編修僅發生在**另一個工作分支**或尚未合併到目前 GitHub Pages 所用資料，重新整理已發布 Preview 當然也不會看到那個未發布的變更。
- 原本的 `data/geometry/planner-terrain-v1.json` 是正式執行期資料，不要在未取得正式發布授權時直接用舊的更新腳本以預設路徑覆寫它。

## 本次程式改動（交接用）

|位置|修改|
|---|---|
|`preview/js/quick-topology.js`|標籤只能貼近節點、以地理外側為優先；密集時隱藏次要標籤，仍保留 Node ID 與圓點及 tooltip；不移動節點／圖上距離比例|
|`preview/js/unified-editor.js`|改用新小地圖標籤版本；幾何讀取為 `cache:'no-store'`，正式版沒有修改|
|`preview/unified-editor.html`|刷新 Preview JS 快取引用|
|`tools/sync_coordinate_geometry.py`|用指紋／資料完整性守門；支援 `--check`、`--sync-preview`、`--build-preview`、明示核准的 `--promote-production`|
|`.github/workflows/coordinate-geometry-gate.yml`|PR 來源檢查、離線測試與錯誤提示|
|`tests/test_sync_coordinate_geometry.py`|資料指紋、覆寫、快取與冪等拷貝測試|

**尚待驗證與限制**：

- 尚未在本次工作中取得 OSM/DEM 原始來源執行完整重建，因此**沒有改寫任何節點的真實座標、GPX 或 DEM 數值**；目前資料仍以最後已審核的幾何檔為準。
- 已完成 GitHub 原始碼更新，但 GitHub Actions 完整執行結果與使用者實機標籤視覺驗收，應以後續驗證紀錄為準。
- 密集節點若被隱藏文字仍可從快速加入按鈕選擇；若使用者希望一律顯示所有名稱，後續可改做「點節點展開名稱」，不要恢復遠距離飄移標籤。
- 如後續要把快速加入路網圖與原版上河圖整合，請先處理上河圖片再利用與公開嵌入授權。
- 不更動已核實路段的分鐘數、行程狀態、Node ID，也不以同名自動合併。

## 給下一個 ChatGPT／Codex 的起手提示

> 延續 Mountain Planner `docs/QUICK_MAP_COORDINATE_SYNC_20261105.md`。先讀本文件、`docs/COORDINATE_UPDATE_WORKFLOW.md`，再檢查 `preview/js/quick-topology.js` 和 `tools/sync_coordinate_geometry.py` 最新內容與 GitHub diff。正式版 v0.8.8 不改動，先執行 `python3 tools/sync_coordinate_geometry.py --check`；需要更新點位時，確認可用的 OSM/DEM 檔案，再由 `--build-preview` 完整重建 Preview 圖資與快取。勿直接修改 SVG 點位或沿用舊 GPX 假裝已更新。以鞍部叉路、太平谷南口及 G04 密集岔路測試標籤近距離／不擋其他點，以及連續快速加入地圖保持展開的行為；回報 CI 與真實瀏覽器驗收狀態，取得使用者同意才發布正式版。
