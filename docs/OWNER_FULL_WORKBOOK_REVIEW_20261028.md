# 全圖人工核對匯入

使用者已完成回傳工作簿「全部路段」分頁的 863 列核對。本次核對狀態是**使用者已核對**，不再要求相同資料重做核對；這不表示 AI 獨立重新核對全部圖面，也不保證候選表涵蓋所有圖上路段。

- 843 列確認、17 列修正、3 列排除；保留 860 列（795 列步行、65 列車行）。包含重複紀錄與條件式時間，並非 860 組獨立實體路段。
- 新增「修正群組名稱」欄按標題解析；六個群組改名保留原群組歷史。八通關越嶺 19 列明確對應 G02。
- 空白交通方式依使用者說明為步行；「車」為車行，不得編入步行尋路或乘以上河係數。
- 修正欄只覆寫已填欄位；「確認」列仍可能填有節點名稱修正，必須採用。排除列保留來源與備註。
- 原模板有 10 個重複 Row ID；匯入鍵使用 Row ID 加出現序次，另保存分頁列號，防止覆蓋。九組有條件式備註的時間版本完整保留，待編譯為標準／條件式時間。
- G17 原 Row ID `R86DBBF2EA4`（Excel 第 712、757 列）皆為「秀姑巒山南登山口 → 秀姑巒山」，50/30 與 50/60 未填條件；後續使用者已確認與 G16 第 634、684 列相同：標準 50/30，回程重裝 60。
- 完整逐列內容、原始工作簿保留在私人核對資料包；Git 僅存摘要、解析工具及合成資料測試。來源 SHA256 記在 `data/audits/owner_full_workbook_review_20261028.json`。

解析：`python3 tools/import_owner_review_workbook.py OWNER.xlsx --out PRIVATE_OUTPUT_DIR`

局部測試：`python3 -m unittest discover -s tests -p 'test_owner_review_workbook.py'`

Node ID 後續依各圖內具體位置、相鄰路段及既有核准 crosswalk 編譯。不得依相同顯示名稱或重複 Row ID 自動合併實體地點；G15 多個岔路的逐列新名稱及 G18 指定同點備註需要保留。此次僅建立完整核對輸入層，未替換 Preview 或正式版路網。

## Node ID 編譯進度

`tools/build_owner_reviewed_graph.py` 已建立私人節點身分表初稿：740 個節點識別、1,434 個去重步行方向、130 個車行方向（車行另存）。860 列合併同 Row ID 的條件式時間後為 850 組來源記錄，不等同獨立實體路段數。

沿用原有已核對路段的節點 ID；只透過已核對相鄰路段、既有核准 crosswalk 或圖組內的地點上下文建立身分。相同圖號下的不同 JSON 群組也不能靠同名合併。新建 ID 與原始列、別名、條件式時間、來源圖及工作簿 checksum 一起保留。這是待整合的 registry，不代表所有別名已合併或所有跨圖連線已完成。

目前有一個跨圖方向衝突：G02（原八通關越嶺，Excel 第 39 列）觀高坪 → 對觀 110 分，G16 第 619 列相同方向 100 分；兩者反方向都是 150 分。保留兩份來源並停用該方向，整份新圖仍未啟用，待使用者確認如何取值。Preview v0.7.23 的原路網與所有使用者行程不變。

編譯：`python3 tools/build_owner_reviewed_graph.py PRIVATE_REVIEW/reviewed_rows.private.json --out PRIVATE_GRAPH`

測試：`python3 -m unittest discover -s tests -p 'test_owner_graph.py'`。完整 Python 與 JavaScript 測試另依 CI 執行。
