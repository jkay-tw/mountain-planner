# 批次步程資料稽核與發佈管理 (v0.7.9)

## 現況及目標

來源：使用者提供的 869 筆、24 圖組 hiking-segments JSON。原始檔及所有候選路網**不提交公開 GitHub**，因來源授權尚需確認。

本階段程式支援**離線批次核對、可重複驗證、差異清單、來源審核門檻**，但不聲稱所有上河原圖內容已通過獨立驗證。既有 G17/G18 Preview 仍為小範圍測試路網。

完整上河來源清單：https://www.sunriver.com.tw/step2020.htm

### 869 筆初始稽核

- 原始資料 SHA256：`15f39d17615efcfcdb2e08fa0deee7e714c80fe5e97dd7e636023382a167e595`
- 24 組、869 筆均可解析且去回時間為正。
- 展開方向後有 1,718 個不同的 `(group,from,to)` key；20 個重複的方向 key，當中 10 個 key 分鐘數互相矛盾。
- 以**使用者已確認的兩端物理共用節點**為前提，157 個跨圖同方向比較中發現 5 個分鐘數不一致。
- 以先前整理的分段資料作初步對照，有 94 個方向紀錄的分鐘數一致。此類`staging_match`不是與官方原圖的獨立驗證；仍屬來源驗證待完成。
- 結構異常：0。已批准發布的新候選步程：0。

詳細狀態請見 `data/audits/batch_quality_baseline_869.json` 及使用者回傳的本機稽核包。

## 本地批次操作

先將使用者提供的 JSON 放在非公開的工作目錄，例如 `private/hiking-segments.json`：

```bash
python3 tools/batch_hiking_pipeline.py "private/hiking-segments.json" \
  --crosswalk data/crosswalk-reviewed.json \
  --staging data/staging \
  --out audit/local/2026-10-27
```

產出：
- `summary.json`：數量、衝突、群組、來源檔 SHA256
- `directed_candidates.csv`：每個方向的實際審核狀態
- `duplicate_directed.csv`：重複及同組差異
- `crossgroup_confirmed_nodes.csv`：**只有兩端都經 Node ID 人工確認**的跨圖時間比對
- `structural_issues.csv`：格式／時間不合法
- `candidate_groups/*.json`：24 組候選資料，全部設定 `routingEnabled:false`、`verificationStatus:candidate_unverified`、`travelMode:unknown`
- `approval_template.json`：逐方向經人工核對上河來源後才能建立的簽核名單

重新匯入更新版後，比較兩次稽核產物：

```bash
python3 tools/diff_hiking_audits.py \
  audit/local/old/directed_candidates.csv \
  audit/local/new/directed_candidates.csv \
  --json audit/local/diff.json --csv audit/local/diff.csv
```

結果區分「新增」、「刪除」、「分鐘數變更」、「證據狀態改變」，並保留修改前後資料以供追溯。

## 分級判定，不得跳級

1. **結構有效**：欄位、數值、方向、ID 合法。只代表 JSON 有效。
2. **內部一致**：相同方向多份資料相同；不得忽略重複時間衝突。
3. **跨圖一致**：僅對兩端都已確認同一物理節點的路段比對。即使時間相同，也不能視為上河原圖已確認。
4. **已核對暫存**：和先前暫存路段一致，仍應保留官方來源／審核證據。不把自己的暫存表當成獨立來源。
5. **官方來源逐方向核對**：建立 `approval ledger`，包含 group、from、to、minutes、travelMode=walking、官方 sourceURL、reviewedBy、reviewedAt、evidenceNote；遇到岔路、同名不同處、車行、反向時間缺失則維持待查。
6. **發佈審核**：完成來源使用權／授權評估；編譯器、QA、自動尋路及匯入匯出回歸測試通過。**只有這一步可修改正式發布用路網。**

目前 `batch_hiking_pipeline.py` **故意不會更新** `data/manifest.json`、`data/routes/` 或 `preview/`，即使所有候選資料數值一致也不會自動發布。正式或公開版由獨立受控流程管理。

## 異常優先順序

優先核對：同組方向矛盾 10 條，跨圖經兩端 Node ID 確認後的時間矛盾 5 條，其次是車行、具高度重名風險的節點、與已審來源數值不同的路段。所有其餘候選可批次處理，但不得推定正確。審核紀錄至少包含：原始行號、資料來源 SHA256、方向及分鐘、來源 URL、檢查者、日期、修正原因、舊值、新值與影響圖組。

## 來源授權與正確性

上河文化的官方下載頁公告行進時間僅供參考。其著作權聲明說明圖資及網站內容受著作權保護，超過合理使用範圍的重製、公開傳輸或商業使用需取得授權。官方原圖只提供外部連結，不隨專案保存或公開批次複製；**公開發佈來源衍生的全量資料前，先完成授權評估**。

- https://www.sunriver.com.tw/step2020.htm
- https://www.sunriver.com.tw/copyrights.htm

## CI

`.github/workflows/test.yml` 會在 PR 上執行 JS 行程測試及 Python 批次驗證／版本差異測試。因候選原始檔不在公開倉庫，CI 使用合成案例驗證邏輯；869 筆的全量掃描及結果 checksum 已由本地資料檔執行並留作基準。下次替換私有來源檔時需重新執行完整稽核。
