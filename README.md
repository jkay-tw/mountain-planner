# Mountain Planner｜登山行程快速規劃器

靜態網頁版登山行程規劃工具。以官方上河步程資料為基準，套用個人上河係數與休息時間，自動生成行程表並匯出 Excel。

## Prototype 功能
- 路線資料與 UI/計算程式分離
- 有方向性的上河步程（A→B / B→A 可不同）
- 上河係數
- 休息時間
- 指定出發時間後自動計算抵達 / 離開時間
- 每筆顯示官方資料來源
- 美化 `.xlsx` 匯出
- route 資料版本與驗證狀態

## 專案結構

```text
mountain-planner/
├─ index.html
├─ css/                 # UI 樣式
├─ js/                  # 載入、計算、匯出與畫面邏輯
├─ data/
│  ├─ manifest.json     # 資料集索引與版本
│  └─ routes/           # 一張上河步程圖一份 JSON
├─ docs/                # 資料格式、驗證規則
└─ README.md
```

這個 repository 僅管理 Mountain Planner。未來其他 GitHub 專案建議各自建立獨立 repository，不要在帳號根層級建立一個混合所有專案的大 repo。

## 本機預覽
因瀏覽器限制，直接雙擊 `index.html` (`file://`) 無法 fetch JSON。請用簡單 HTTP server：

```bash
python -m http.server 8000
```

再開啟 `http://localhost:8000`。

GitHub Pages 則可直接使用。

## 上河資料
Prototype 目前只放 `G06 白姑大山` 的步行段，來源為上河文化官方步程示意圖：
- https://www.sunriver.com.tw/step2020.htm
- https://www.sunriver.com.tw/images/hiking/G06_hiking.jpg

資料狀態目前標為 `checked`，尚未宣告為完整 `verified` master dataset。

## 新增路線
1. 在 `data/routes/` 新增 `Gxx.json`
2. 在 `data/manifest.json` 登記
3. 依 `docs/verification.md` 完成驗證
4. 不需修改核心 JavaScript

## 版權與來源
本工具不收錄或重新發布上河原始步程圖檔；資料列提供官方來源連結。上河資料之權利與原始內容仍屬原權利人。
