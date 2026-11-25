# 路線整合與圖組快速起點 Preview

> 後續已依使用者確認單獨修正 R026：步行起終點改為神木區登山口，共 33 次經過；最新總數為 1,469 次有效經過、26 筆排除歷史。詳見 [R026 定點修正與驗收](R026_WALKING_PREVIEW_20261125.md)。以下保留首次整合紀錄。

2026-11-25，本機 Preview 已整合、驗收；尚未提交、合併或發布正式版。

## 簡單使用

開啟 http://127.0.0.1:56333/preview/unified-editor.html 。若本機伺服器未啟動，在專案目錄執行 `node tools/serve_preview.mjs 56333`。

1. 選「上河圖組」，再選圖組。
2. 空白 DAY 的「快速加入起點」會列出該圖涵蓋路線的起終點。玉山群峰包含「上東埔停車場、東埔溫泉」。
3. 點一次加入一個起點；接著沿用既有的相鄰路段快速加入。也可使用節點選單選擇其他起點。

若要整條加入，選「路線」，選擇路線及適用的順／逆行，再按套用。已有行程時會確認是否取代全部 DAY，可復原。

## 整合範圍

- 使用兩份順序校核分頁完成寫回、回讀的快照 `data/route-validator/snapshots/sheet-20261125-order-complete.json`，SHA256 `0898036b742fde95d0da9fba762b6fda4c35e25a5e6a4902451b233cff1226e4`。
- 60 條路線、1,471 次有效經過；保留 Sheet 的 Node ID、完整順序、重要標記及合法重複。24 筆 position 空白歷史紀錄保留於快照，不恢復到有效序列。26 條未展開路線不生成走法。
- R031 志雪劍納入選單。編譯不再套用舊版重排／最短路徑展開覆蓋最新 Sheet。
- 23 條環狀／縱走有方向選擇，共 83 個 UI 套用組合；資料測試另外核對全部 120 個正反向序列。
- 圖組涵蓋範圍依 manifest 相同原始上河圖來源合併分拆資料集，再篩選各有效路線真正第一／最後節點。依 Node ID 去重，往返的山頂折返點不列為起終點。不依名稱推定同一地點，也不只依 Routes 的所屬圖組判定。
- R057 北稜既有 OSM 線形擷取至 3241 稜線；之後沿用既有 25／30 分鐘稜線至屏風山路段。北峰至稜線時間維持待填，未用差額估算。
- R069 林道玉林橋下切點至下切溪床點，從既有線形 `owner-update-69f7ccc2fb31ed7c` 擷取約 949m，保留頂點、高程與來源雜湊；85／120 分鐘依既存 G16 原圖箭頭轉錄紀錄。補充僅供候選路線套用，不寫入全域或正式路網。
- 車行模式及既有手填時間政策保留；R052 車行、R057 部分步行、R081 神池營地至小關山的未知分鐘不補猜值。

## 驗收與重跑

```powershell
node tools/compile_classic_routes.mjs --check
node tools/route-validator.mjs order-check
node --test tests/classic-route.test.mjs tests/classic-route-apply.test.mjs tests/chart-starts.test.mjs tests/quick-add.test.mjs tests/day-display.test.mjs
```

重新編譯使用 `node tools/compile_classic_routes.mjs --write`。來源為明確的最新已核對快照與目前 Preview 資料；輸出鎖定整體路網及每個使用線形的 SHA256。資料變更時，不把舊版雜湊或歷史審核當作目前已通過。

瀏覽器驗收（需 Playwright 與 Edge，環境變數可指向已安裝位置）：

```powershell
node tools/verify_route_integration_preview.mjs
node tools/verify_classic_preview.mjs
```

- 新驗收：60 條／83 個方向全部實際套用、24 個圖組、起點只加入一次、跨圖起點、復原／重做、切換保留行程、備註、JSON 下載／匯入、重新載入；pageerror 為 0。結果見 `docs/assets/idea002-integration-20261125/acceptance.json`。
- 本次相關的 10 份 Node 測試共 84 項通過；含候選編譯、全部 120 個正反序列、起點篩選、既有快速加入、顯示模式、順序核對及 Route Validator。無工作目錄快照時，Validator 現在也使用最新 1,471 次經過快照，並能讀取 R069 的候選補充接線。
- 既有流程回歸：顯示模式、方向時間係數、手填分鐘、分天、取代確認與取消、GPX 匯入、Excel／JSON 匯出入、地圖圖層／路段選取／拖曳均通過。
- 320、390、768、1280px 無水平溢出；已有桌面及手機尺寸截圖。這是 Edge 模擬尺寸，未執行手機實機觸控測試。

本次驗收證明指定路線序列正確整合及操作流程可用；沿用既有座標、線形及時間來源，未重新宣稱全部幾何精度、所有分鐘或即時通行狀態已完成現地驗證。原始 Sheet 分頁及正式入口不在本次修改範圍。

## 主要檔案

- `preview/js/chart-starts.js`、`preview/js/unified-editor.js`、`preview/js/classic-route-ui.js`：起點篩選與畫面整合。
- `preview/js/classic-route-source.js`、`tools/classic_route_bindings.mjs`：有來源的候選路段及線形擷取。
- `tools/compile_classic_routes.mjs`、`data/staging/idea002/classic-sources-20261125.json`、`classic-routes.candidate.json`：可重現編譯及候選資料。
- `tests/chart-starts.test.mjs`、既有 classic route 測試與兩個瀏覽器驗收工具：資料、套用及操作回歸。
- 歷史核對測試改以當時候選雜湊重現，仍驗證目前候選變更會拒絕沿用舊報告；沒有修改歷史審核結果。
