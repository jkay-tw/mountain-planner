# 節點座標審查橋樑／接手索引

## 目前入口（2026-11-10）

**最新進度：2026-11-11 已依決策更新功能分支與 Preview。** 工作 runtime 為 `preview/data/geometry/planner-terrain-v1.json`；正式 runtime 未推送、未合併發布。下方歷史數字保留，現況見本文件第三批紀錄。

- [Google Sheet：節點座標審查與更新橋樑](https://docs.google.com/spreadsheets/d/1qj9As7i-02V3MxdN1KuCtN_OkQAYYRHrimbxq6Jf5jk/edit)
- 資料基底：`dda008391e6d9118409fcca2095a7a40fd1d1250`，應用程式 v0.9.0、資料補丁 data-coordinates-20261107。
- 功能分支：`codex/node-coordinate-review-bridge`；未合併／發布。
- 產生器：`tools/node_coordinate_review.py`（Python 標準函式庫，無地形運算依賴）。
- 測試：`tests/test_node_coordinate_review.py`。
- Sheet ID、分頁 ID、來源範圍與基準數量：`data/audits/node-coordinate-review-bridge.json`。

## 給使用者

2026-11-10 已完成全節點空間篩檢：先看「檢閱總覽」，點節點名可跳到人工填寫區；「疑點明細」保留逐項證據，「檢查規則」列出門檻。技術 ID／原始 JSON 預設隱藏但未刪除。結果見下方第二批紀錄。

在「審查與決策」黃色 H:M 欄填問題、決策、採用 TWD97 X/Y、補充來源與人工備註。
可說「處理審查 ID R-…」或指定 Node ID／群組；不必貼整張表。
空白代表沒有新指示。填數值不會自動變更 GitHub；採用前仍核對來源與明確決策。
TWD97 為 TM2 121 分帶 EPSG:3826；總表為換算值，不是新增獨立來源。
相鄰表按來源方向保存，含車行與無來源時間的手動連接；總表只顯示相鄰摘要。
不要以名稱相同合併節點。留言可補充討論，正式決策請填欄位。

## 最小閱讀範圍／節省 token

1. 先看本索引、`git status`、本次指定審查列；首次或規範變動才讀 AGENTS.md。
2. 查指定 Node ID 的 runtime、來源與方向邊；讀 JSON 用程式選鍵，不整份輸出單行大型 JSON。
3. Sheet 用 ID 搜尋及限定範圍；只在首次建立或完整一致性驗證讀全量，工具內比較後只回報摘要。
4. 不閱讀全部 JS 或歷史文件；只有修改其行為時再定位相關模組。
5. 已有來源與未核實候選分開；不因來源筆數、內部一致或測試通過提升核實狀態。

## 匯出與同步

```powershell
# 使用可用的 Python 3.11+；本機 python 別名可能無法執行。
$taskPython = 'C:/Users/jeter_lin/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe'
$env:PYTHONDONTWRITEBYTECODE = '1'
$env:PYTHONUTF8 = '1'
& $taskPython tools/node_coordinate_review.py --output <工作目錄外的產出資料夾>
& $taskPython -m unittest discover -s tests -p test_node_coordinate_review.py
```

輸出 bridge.json（完整表格、基底 commit、正規化 LF 輸入雜湊）及八份 UTF-8 CSV。
CSV 對試算表公式前綴加引號；native Sheets 寫入使用 `stringValue`，不把來源文字當公式。
輸出不寫入執行期資料，不自動套用任何座標，也不需要下載 OSM／DEM。

後續同步流程：

1. 透過 Google Drive 連接器讀取目前「審查與決策」A:P 的有效列，含 H:M，保存為本機 JSON 二維陣列（不含標題）。保留數值型別、空白與所有列位置，不只讀篩選後可見列。
2. 用 `--previous-decisions <live.json> --decision-sheet-id 105` 再匯出；生成 `decision-update-requests.json`。
3. 該請求只更新既有列 A:G、N:P，按現有審查 ID 定位；永不寫 H:M。新節點附加到末尾。基底變更保留舊指紋與人工決策，標記衝突；消失節點保留歷史，不自動套用。
4. 審查／路線人工區不得全表清空、重新匯入 CSV 或重建分頁。其餘產生表可依差異更新；清除縮短後的尾列前先確認不是人工區。
5. 寫入前再次核對審查 ID 列順序；若使用者插列、排序或刪列，重新讀取與產生請求。避免與使用者同時做結構修改；目前不是具鎖定或條件寫入的即時同步服務。
6. 讀回本次異動列，工具內比較，僅輸出數量與差異摘要。分頁保護為警告提示，不是權限隔離。
7. 大量資料必須分小批傳輸；任何工具輸出含截斷標記都不得解析後寫入。JSON 能解析不代表資料完整，仍須驗證預期筆數、ID 與逐欄值。

## 來源範圍與限制

現行 manifest、runtime、既有 all-route-coordinates 的 Node ID 關聯來源／候選、人工覆寫、兩份角色修正、退休紀錄。
來源明細保留原紀錄 JSON 與專案檔案位置；歷史候選不等於目前採用，也不代表獨立交叉驗證。
尚未對所有外部網址重新取證，也未以同名方式納入未關聯參考點；無法解析引用時明確列出 missingReference。
方向邊原始 JSON 包含來源列、條件時間、車行／手動屬性；不推算反向分鐘。

本批完成清冊與溝通橋樑，未進行全節點空間合理性評分、路線自動分類、人工決策套用或地形重算。

上述為第一批範圍；第二批已補空間篩檢，仍未套用任何座標／時間修改。
路線草案只建立欄位，等待路線定義。後續資料修改仍在功能分支，必要局部重算與測試後建立 PR；合併與發布需明確授權。

## 本批驗證紀錄

- 724 現行節點、3 退休節點、3,288 來源紀錄、1,550 來源方向關係（含跨圖重複來源邊，不能當成唯一可尋路步行邊數）。
- 測試涵蓋 Node ID 全集、來源引用、逐方向時間保留、TWD97 已知點、人工欄位保留、排序、基底衝突、退休與重複 ID 拒絕，以及線上請求不寫 H:M。
- 實跑 5 項工具測試與座標同步守門通過；線上讀回逐筆核對 724 節點 ID、3,288 來源 ID、1,550 方向關係 ID、724 審查 ID／Node ID／指紋，全部一致。另抽查 3 列完整座標與來源欄位一致（null 視為空白）；未在人工區寫測試資料。
- 既有環境限制見本次接手紀錄：缺 SciPy；歷史 OSM 測試來源 CRLF/LF 雜湊差異。本批工具不依賴 SciPy，未處理這些環境問題。

## 第二批：全節點合理性篩檢（2026-11-10）

- 產生器：`tools/audit_node_coordinates.py --output <產出資料夾>`；標準函式庫，沿用現存 OSM 錨點／DEM 與來源紀錄，不下載、完整重算或新增核實。
- 可重現報告：`data/audits/node-coordinate-spatial-audit-20261110.json`，含輸入摘要、規則門檻、724 個節點結果、138 筆疑點及關聯 Node ID。
- 分類互斥：優先確認 3、建議複核 15、待補座標 42、參考提醒 53、未發現規則異常 565、依政策不定位 46。
- 優先討論 G05 帆布獵寮、G12 大崩壁、G17 黑水塘：兩側鄰點均距離 >15km，且方位／二跳幾何同時命中離群條件。需要對照本點與鄰點來源，不推定正確位置或自動移點。
- 歷史候選距離差、不同 ID 同座標、小於100m的既有線形端點投影差列為參考提醒；不得直接當成錯誤。車行與手動邊不進入步行距離／方向時間提示。
- 565 個未命中規則不表示現地或外部來源已核實；42 個缺座標無法做位置判斷；46 個政策排除不是待補錯誤。
- 分頁 ID：檢閱總覽109、疑點明細110、檢查規則111；原審查與決策105的 H:M 不變，F:G 整合本次結果。
- 來源明細 H:P 為可讀來源名稱、群組、座標與網址；A:G 原證據仍保留。節點總表 Q:S 附分類／發現／下一步。
- 重新同步時先重算報告，再對橋樑工具加 `--spatial-audit <spatial-audit.json>`。若輸入摘要不符，工具拒絕套用過期報告；人工欄位仍依既有讀回／合併流程保留。
- 7 項合理性檢查測試、5 項橋樑測試及座標同步守門通過。包含排除車行／手動邊、全ID覆蓋、資料不變、過期報告拒絕、來源連結與人工欄位保留。
- Google Sheet 讀回核對：724 節點分類／導向連結、138 筆證據、3,288 筆來源可讀欄與網址、1,550 筆方向關係可讀類型／網址；人工 H:M 與審查 ID 保持不變。大量傳輸曾截斷來源／關係欄位，已分批校正並逐列比對；執行期原始資料未改。

## 第三批：決策套用與四份 GPX 討論（2026-11-11）

> 下列為第一輪歷史狀態；目前以文末第四批及 `OWNER_COORDINATE_REVIEW_20261111.md` 為準。

- 讀取「審查與決策」77列有填內容，原始列與基底指紋封存在 `data/geometry/sources/node-review-decisions-20261111.json`。
- 使用者於對話更正17K水泥橋為TWD97 275885/2590697，並明確確認G16杜鵑營地合併到G17指定ID；G15同名營地獨立保留。原錯填Y仍保留在快照，更正另記 ownerAmendments。
- 套用19筆座標、3組明確ID合併、2筆改名；其餘記錄確認保留。工具 `tools/apply_node_review_decisions.py` 為本批一次性匯入器，先核對舊基底，已套用後不應重跑；後續新決策需另存新快照。
- 合併對應、原節點／座標來源、原受影響方向邊、改名別名、前後時間摘要在 `data/geometry/sources/node-review-application-20261111.json`；舊ID與名稱的遷移在 `js/node-identity.js`／Preview對應模組，保留舊行程分鐘與備註。
- Source重算只更新Preview；用terrain-sources-20261106大小／SHA256核驗後的OSM與DEM，獨立安裝SciPy1.17.0。封存與依賴位於本次視覺化工作目錄 `terrain-sources-range/`、`terrain-python/`，未改全域Python。下載曾停滯，已用有Content-Range核對的分段續傳完成，最後整檔SHA一致。
- 工作資料：721現行節點、645定位、30步行待補、46政策不定位、671線形。來源重算保留640組、產生31組；對原始檔逐筆比較另確認642組span內容相同（包含重套來源後仍相同的參考線形）。
- 重算報告 `data/geometry/sources/node-review-terrain-report-20261111.json`：6組未表示缺口，其中2組荖濃溪相鄰 OSM-route-detour-needs-review 是本批新增；不改手填位置、不畫直線、不偽造GPX。Sheet「重算缺口待討論」gid116。
- 合理性重檢：585未命中規則、8建議複核、52提醒、30待補、46政策不定位，沒有優先確認類；完整結果 `data/audits/node-coordinate-spatial-audit-20261111.json`。歷史20261110報告不覆寫。
- GPX工具 `tools/review_g14_g15_gpx.py` 只產生候選，不套用或平均座標。四檔172個航點出現次數、14,848個軌跡點；103個G14/G15現行節點，67點有具名候選、108筆去除同檔相同點重複後的候選紀錄、38未對應航點出現次數。
- 檔名、大小、原檔SHA與航點原值在 `data/geometry/sources/user-gpx-waypoints-20261111.json`；完整討論報告 `data/audits/g14-g15-gpx-review-20261111.json`。原始GPX／完整軌跡不複製進Git；航點序號與最近軌跡採樣索引可回查原檔。不同檔案可能同源，不當作獨立核實。
- Sheet：G14-G15座標討論gid112、GPX候選明細113、GPX來源檔案114、GPX未對應航點115。4個已有人工座標的點均無具名GPX對應，M欄依明確要求追加說明；未抓附近軌跡點冒充。其他人工欄保留。原審查頁724列保留3列合併歷史；現行總表721點。
- 匯出器依 `data/audits/node-coordinate-review-bridge.json` 的 workingRuntimePath 選擇工作runtime，可用 `--runtime` 明確指定。不能將舊正式地形當目前工作資料。審查頁寫入只改程式欄，M欄本批4列為使用者明確要求的例外，K575為對話更正。
- 表中節點名／決策入口用 MATCH 精確查找審查頁隱藏B欄的Node ID，不綁死列號；審查頁排序後仍可定位。查找範圍到第1000列，日後擴大表格須一併擴大此界線。
- GPX備註逐筆附距現值差；台電高登連絡站約5.81km、太平溪源營地最大約1.95km，列為優先核對候選，未判定哪份來源正確，也不自動替換。
- 線上讀回逐欄比對721節點、3294來源、1550方向關係、92檢查證據、6重算缺口、103GPX討論列、108候選、4來源檔及38未對應航點；所有公式無錯誤。724列原審查ID與H:M均保留，僅K575與明確授權的4列M註記有變更。
- 驗證：137項JS、113項Python、14項小地圖、Preview同步守門通過；正式地形SHA不變、19筆座標與DEM、未影響span、原方向時間與舊ID匯入皆驗證。Windows原有未修改OSM樣本僅恢復Git內LF位元組，消除歷史CRLF雜湊差異，Git內容沒有變更。
- 發布尚未授權：**不能只合併目前路網與JS卻保留舊正式地形。** 需另經明確授權整批promote正式圖資／必要快取、更新正式版驗收基準後，再合併發布。現在所有新增／修改檔仍在功能分支、未提交／推送。

## 第四批：G14/G15使用者確認座標與發布（2026-11-11）

- 使用者授權在檢查無新增未解釋座標疑慮後完成資料庫、運算、main合併及發行。讀回討論頁F:G，56筆完整TWD97依Node ID同步審查頁I:K，決策採用填入座標；其餘H:M保留。馬路巴拉讓山依後續對話保留268658/2608675，執行中使用者清空單獨F值亦保留。
- 工具 `tools/apply_owner_coordinate_round2.py` 預設唯讀dry-run；本次已apply，重跑apply會拒絕重複寫入歷史。56筆覆寫保留之前決策；2筆改名保留舊別名／Node ID；關門大營地為指定別名。不可再用第一輪一次性匯入器重跑舊快照。
- 原始／同步快照、套用紀錄見 `g14-g15-owner-review-round2-20261111.json`、`g14-g15-decisions-synced-round2-20261111.json`、`owner-coordinate-round2-application-20261111.json`。資料版本與回復點見 `docs/OWNER_COORDINATE_REVIEW_20261111.md`。
- 721節點、675步行定位點均有DEM；20忽略＋26車行點不顯示座標；694線形、4既有缺口。固定封存OSM/DEM局部重算，第二輪616線形與先前完全相同；原方向分鐘及來源簽章未變，正式與Preview圖資一致。
- 全節點重檢616未命中、51參考提醒、8既有複核、0缺座標；8點已有明確保留／指定決策，無新增未解釋座標警示。4缺線仍不產生假GPX。17組50m內近點，沒有僅大小寫或空白不同的名稱；因此本輪未新增合併。近點核對gid117供指定ID後續討論。
- 線上逐值讀回核對721節點、3318來源、1550方向紀錄、721總覽、61疑點、4缺口、17近點；724審查ID與H:M保留，103原GPX備註／ID保留，唯一並行人工清空F值已記錄。沒有公式錯誤。證據 `data/audits/owner-coordinate-round2-verification-20261111.json`。
- 139項JS、113項Python、14項小地圖測試與同步／語法守門通過；資料版tag `data-coordinates-20261111`，應用程式維持v0.9.0。正式／Preview入口、身分遷移模組及6個修改路線的快取版號一併更新。

### 發行指紋補正

第一個main提交25f11eb的額外G04發布守門抓到換行差異：Windows工作檔的CRLF雜湊不能當作Git上LF檔案的雜湊。`sync_coordinate_geometry.py`改以Git LF正規化位元組計算資料／JS版本，並在check驗證HTML與資料引用；同步刷新兩個入口。座標、方向時間、OSM／DEM與線形均不變。修正版tag `data-coordinates-20261111-r1`，115項Python含2項新回歸測試；不覆寫初版tag。後續以修正版及最新main為準。
