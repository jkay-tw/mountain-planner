# 專案導覽

本文件只記錄常用入口與定位方式；細節以程式、資料 schema 與驗證文件為準。

## 主要入口與目錄

- `unified-editor.html`：目前統一編輯器 Preview 頁面入口，載入 `js/unified-editor.js`。
- `index.html`：正式版入口，載入 `js/unified-editor.js`；`js/app.js` 是舊版編輯器入口，仍需保留相容與歷史用途。
- `js/`：規劃、全域路網、Node ID、驗證、匯入匯出與 UI 模組。
- `css/`：正式版樣式；Preview 相關樣式另在 `preview/css/`。
- `data/manifest.json`、`data/unified-editor-manifest.json`：資料集清單及統一編輯器載入設定。
- `data/routes/`：路線節點與有方向路段資料。`data/routes/owner-reviewed/` 是目前正式版與統一編輯器使用的人工核對資料；舊版 `.preview.json` 可能仍用於舊行程匯入，依 manifest 與來源紀錄確認用途。
- `data/staging/`、`data/audits/`：待整合路網及來源、差異、人工審核紀錄；不是可直接發布的路網。
- `tools/`：候選資料稽核、正規化、審核套用及核准路段編譯工具。
- `tests/`：JavaScript 規劃邏輯測試與 Python 資料工具測試。
- `.github/workflows/test.yml`：Pull Request／開發分支的 CI 驗證流程。

## 路線與時間資料

路線 JSON 的 `segments` 以每個方向各一筆保存，`minutes` 是來源基準時間；方向不可互相推算。使用者計畫另存 `actualMinutes` 等規劃狀態，資料模型摘要見 [`data-format.md`](data-format.md)。全域節點身分與跨圖對應見 `data/crosswalk-reviewed.json`、`js/node-identity.js` 及 `js/crossmap-routing.js`。

候選匯入與原圖核對資料不得因格式一致或測試通過而標記為官方已核實；核實流程見 [`verification.md`](verification.md)。

## 主要計算位置

- `js/planner.js`：路徑搜尋、路段時間、每日時間軸與行程統計。
- `js/crossmap-routing.js`、`js/global-route.js`：跨資料集已核實步行圖與全域路網操作。
- `js/unified-editor.js`：統一編輯器初始化、事件及畫面更新；通常先讀取其呼叫的計算模組，再判斷是否需要改 UI。
- `js/tab-autosave.js`：每分頁暫存與最後修改的共用備份；正式版與 Preview 的儲存鍵分開。
- `js/validation.js`、`js/legacy-plan-migration.js`、`js/exporter.js`：計畫驗證、舊行程遷移及匯出。

## 測試分層

在專案根目錄執行：

- 局部 JavaScript 邏輯：`node --experimental-default-type=module --test tests/planner.test.mjs`；依改動模組再搭配 `tests/route-coverage.test.mjs` 或其他必要測試。
- 局部 Python 工具：`python3 -m unittest discover -s tests -p 'test_reviewed_topology.py'`（將檔名換成對應 `tests/test_*.py` 檔案）。
- 完整 CI 等效測試：
  - `node --check js/app.js && node --check js/planner.js && node --check js/node-identity.js`
  - `node --experimental-default-type=module --test tests/*.test.mjs`
  - `python3 -m unittest discover -s tests -p 'test_*.py'`

資料工具、schema、跨圖身分、路徑或時間計算的變更，依影響範圍執行相關測試；發布或跨模組變更前執行完整 CI。CI 通過不等於瀏覽器視覺或操作驗收。
