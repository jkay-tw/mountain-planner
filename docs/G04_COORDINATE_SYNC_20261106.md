# G04 岔路座標與地形資料更新（2026-11-06）

這次是 **v0.9.0 應用程式的資料更新**，不是新版 UI 或規劃邏輯。正式／Preview 由同一份新來源重算後的 `planner-terrain-v1.json` 載入，透過內容雜湊快取版本確保新圖資實際生效；保留正式版既有暫存格式與步程資料。

## 節點與路段

- Node ID：`g04-fork-daba`，名稱「岔路」。
- 指定座標：TWD97 TM2 X=276239、Y=2705568；WGS84 [經度,緯度]=[121.2588183,24.4561637]。
- 原先畫面定位為 [121.280197,24.430342]，本次依法定坐標值取代並重新尋找實際 OSM 步道路徑，不畫虛構直線。
- 來源：「I Love You平台」，使用者提供；**未主張由程式獨立查核平台原始頁面或現地點位**。核對識別碼 `USER-G04-20261105`。
- 保留 G04 既有六方向時間：岔路→小霸岔路登山口 15 分、反向 15 分；岔路→大霸尖山 70 分、反向 50 分；岔路→霸南山屋 70 分、反向 100 分。沒有修改 `data/routes/owner-reviewed/G04.json`。

## 來源與可重現性

- OSM／Geofabrik Taiwan **2026-11-01** 原始快照 SHA-256：`72e6ec59e0b015aa52fd26b0240dc4155beca04a3071b0d07878eef6f02ba2b6`。2026-11-02 快照雜湊不符，沒有使用。
- Rudy DEM `hgtmix.zip` SHA-256：`5965dab6fd19ca1b1ecb077b0219fe4e932b599dd985fa96266d383e166594a0`。
- 衍生步道路網 `walking-network-roads.json.gz`、原始 DEM、雜湊與來源 manifest 已封存於 [terrain-sources-20261106](https://github.com/jkay-tw/mountain-planner/releases/tag/terrain-sources-20261106)。OSM 擷取檔案為重新建立而非原始 gzip 的逐位元副本；原始 PBF 和 DEM 經雜湊確認。
- 使用既有 `tools/update_planner_terrain.py` 增量重算與 `tools/sync_coordinate_geometry.py` 同步，不手動修改 GPX、DEM 高度或路段走向。

## 實際結果與限制

- 首次重算時原有路段線形保留 651 組、針對 G04 重建 3 組步行參考線形，合計 654 組；後續使用同一座標重跑，報告會正確顯示保留 654 組、需新建 0 組。含未定位中間節點的 bridge spans 保留 42 組。
- G04 重建路徑的 OSM 來源 way、距離、沿線 DEM 高程與依賴索引均通過守門；G04 相關 `failedRoutes` 與 `unrepresentedPairs` 為空。
- 更新報告另列 5 個既有節點為 `changedNodeIds`。這五個點原屬非步行用途，重算前後的生效座標、海拔、座標政策相同；**沒有把它們當成新定位點**。
- 原有非 G04 缺線 `node:4833a5913699184b5b35` ↔ `node:7e834e3946d8006bb547` 仍為 `no-source-anchor-within-policy`，沒有推測連線或填入假數據。
- 來源資料不保證步道即時通行安全、現場封閉資訊或精準導航。

## 驗證與發布

- `python3 tools/sync_coordinate_geometry.py --check` 通過，正式與 Preview 地形 runtime 逐位元一致。
- G04 六方向步程的回歸測試通過；未受影響之原有路段幾何逐筆比對未改。
- 130 項 JavaScript、99 項 Python 測試通過；`git diff --check` 通過。
- 變更包含來源核對檔、已重算圖資、驗證報告、必要的 JS/HTML **快取 URL 字串**、來源封存／重算 workflow 和測試；**不改程式執行邏輯、不改 UI 外觀**。
- 正式站：<https://jkay-tw.github.io/mountain-planner/>；Preview：<https://jkay-tw.github.io/mountain-planner/preview/unified-editor.html>。
- 若要回復本次資料更新，參照本次資料 PR 合併前的 `main` commit `12d38d141e44855bf40630cd14a33d2f91a378d8`；勿只回退座標而留著新路徑。
