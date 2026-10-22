# 資料與行程模型

## 官方 dataset
每張上河步程示意圖對應一個 `data/routes/Gxx.json`。

### 原則
1. A→B 與 B→A 分開存。
2. `minutes` 永遠代表官方上河原始分鐘數。
3. 使用者修改的是規劃時間，不覆寫 dataset。
4. route 保留官方來源與 revision。
5. `status`：`draft` / `checked` / `verified`。

## 行程事件
介面層使用三種事件：

- `location`：官方上河節點
- `manual-location`：使用者自行新增的位置
- `rest`：休息事件

官方段具有：
- officialMinutes
- actualMinutes（可覆寫；null 時套用預設上河係數）
- 有效係數 = actualMinutes / officialMinutes

手動段只有：
- actualMinutes
- 不顯示上河時間
- 不納入每日上河係數

## 手動節點恢復規則
若官方 A→B 被手動 D 切成 A→D→B，A→B 原始資料保持不變但暫停計算。
當 D 被移走，使 A 與 B 再次相鄰時，程式重新查詢官方 graph：
- 若存在官方 A→B edge，自動恢復官方分鐘、來源與係數顯示。
- 若不存在，改為需自行輸入的手動段。

## 每日上河係數
每日係數採時間加權：

`官方段規劃時間總和 ÷ 官方上河時間總和`

手動路段與休息不納入分子／分母。
