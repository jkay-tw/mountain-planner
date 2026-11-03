# 補座標的局部更新流程

## 日常任務只讀這份入口

目標分支 `feature/v0.7-node-identity`。先確認分支與乾淨工作目錄；正式站根目錄及main/preview不在一般資料更新授權內。既有車行邊不參與步行線形。

1. 取得使用者最新核對表，先核對檔案修改時間。XLSX/XLSM只讀XML，不執行巨集。使用「待查填選」的Node ID，禁止以同名合併。
2. 匯入座標覆寫表：

   ```sh
   python3 tools/import_coordinate_review.py /path/to/review.xlsm
   ```

   檢查 `data/geometry/sources/owner-coordinate-overrides.json` 的diff即可，不需重讀原始全圖稽核或程式。這是完整核對表快照；日後若只提供少量新點，先合併到既有覆寫表，保留其他紀錄。格式為 `coordinate: [經度, 緯度]`；原TWD97數值另存，不能顛倒X/Y。忽略／忽視都映射到ignore。Q013「全部不符但填完整座標」已由使用者確認採補填值。

3. 若沒有刪點或改名，直接局部更新：

   ```sh
   python3 tools/update_planner_terrain.py /path/to/walking-network-roads.json.gz /path/to/hgtmix.zip
   ```

   缺原始網路或DEM時，依runtime中routingSource、terrainSource雜湊準備相同版本；不要為單點修改重新抓全臺。座標未變、無新增資料時會在載入原始網路前回傳noChanges。

4. 查看 `owner-coordinate-update-report.json`、runtime的 `spanDependencies`、`coverage.unrepresentedPairs`。只需檢查changedNodeIds影響的結果，並跑以下驗證：

   ```sh
   node --test tests/coordinate-update.test.mjs tests/full-terrain.test.mjs tests/itinerary-geometry.test.mjs tests/terrain.test.mjs
   python3 -m unittest discover -s tests -p 'test_coordinate_update.py'
   ```

   發布或跨模組修改才執行完整CI（`node --test tests/*.test.mjs` 與 `python3 -m unittest discover -s tests -p 'test_*.py'`）。檢查快取版本：runtime fetch在unified-editor與itinerary-map，變更路線JSON需更新manifest該檔案的查詢版本。不要改動正式版入口。

## 更新邏輯

- 同座標不重取高，不重建未受影響的線形與歷史GPX。
- 座標變動會使包含該Node ID的端點／viaNodeIds線形失效；只為受影響配對重找步道及取DEM。
- 新增中間座標後，原跨點線形拆為有錨點的路段；中間點位置仍未知時，不產生假座標、假精確分段數值。
- 沒有座標的中間節點依原步行拓樸枚舉到前後已知錨點，保留完整viaNodeIds順序，遇到已知錨點即停止，不跨手動或車行邊，不穿過其他已知節點。
- 路徑只沿來源既有拓樸走，不在空白處畫直線。多條支線的中間位置尚未定位時，線形仍屬規劃參考，不能宣稱已證明實際經過每一個未知點。
- 起終端皆缺錨點、整串缺點只有一個已知端點，或來源缺少步道時，列入unrepresentedPairs；不得把空白當0或聲稱資料完整。
- `--retry-missing` 用於來源補充後重試尚缺路段。座標更新通常不需要它。固定來源／DEM版本變更不是一般單點更新，需另做資料遷移與完整驗證。

## 拓樸變更另外處理

刪除節點或方向時間不能只靠座標表自動重接。先修改manifest使用的owner-reviewed路線，保存退休節點與原方向邊，維持舊行程快照可讀；有替代連接需求時另取來源證據，不自動推算原圖時間。本次G17三個刪點都是移除支線，沒有新增替代時間。

## 常用資料位置

|用途|位置|
|---|---|
|使用者覆寫|`data/geometry/sources/owner-coordinate-overrides.json`|
|額外來源角色修正|`data/geometry/sources/owner-update-source-corrections.json`|
|歷史補線與片段證據|`data/geometry/sources/owner-update-reference-clips.json`|
|本次新增OSM way版本與標籤|`data/geometry/sources/owner-update-osm-ways.json`|
|現行節點／線形／依賴索引|`data/geometry/planner-terrain-v1.json`|
|已退休節點及方向邊|`data/geometry/sources/owner-topology-retirements-20261104.json`|
|顯示、GPX、每日統計純函式|`js/itinerary-geometry.js`|
|剖面PNG、剪貼簿UI|`js/profile-export.js`|

普通補座標任務不需要重讀後兩個JS檔，只有功能缺陷或需求改變才查看。
