# 資料與行程模型

## 官方 dataset
每張上河步程示意圖對應一個 `data/routes/Gxx.json`。

### 原則
1. A→B 與 B→A 分開存。
2. `minutes` 永遠代表官方上河原始分鐘數。
3. 使用者修改的是規劃時間，不覆寫 dataset。
4. route 保留官方來源與 revision。
5. `status`：`draft` / `checked` / `verified`。

## Day
每一天各自保存：
- `startTime`
- `coefficient`
- `linkedStart`
- `note`
- `items`

每日預設係數只套用在尚未個別覆寫 `actualMinutes` 的官方段。

## 行程事件
- `location`：官方上河節點
- `manual-location`：使用者自行新增的位置
- `rest`：休息事件

location / manual-location 可保存：
- `note`
- `isPeak`
- `hasWater`

## 手動節點恢復規則
若官方 A→B 被手動 D 切成 A→D→B，A→B 原始資料保持不變但暫停計算。
當 D 被移走，使 A 與 B 再次相鄰時：
- 若存在官方 A→B edge，自動恢復官方分鐘、來源與係數顯示。
- 若不存在，改為需自行輸入的手動段。

## 每日上河係數
`官方段規劃時間總和 ÷ 官方上河時間總和`

手動路段與休息不納入分子／分母。

## 顯示時間
內部運算仍以分鐘保存；UI 與 Excel 顯示轉成：
- 48 分 → `48m`
- 75 分 → `1hr 15m`
- 180 分 → `3hr`

## 純文字分享
僅輸出所有地理節點與抵達時間；休息不獨立列出，但會影響後續節點時間。山頭與水源 icon 會保留。
