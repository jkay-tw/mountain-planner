# 資料格式

每張上河步程示意圖對應一個 `data/routes/Gxx.json`。

## 原則

1. `A → B` 與 `B → A` 分開存，禁止假設雙向時間相同。
2. `minutes` 僅存上河原始分鐘數，不存個人係數、休息或實走時間。
3. 每份 route 保留官方來源與 revision。
4. 車行、距離、接駁等非步程資訊不可混入 `segments`；未來若需要，使用獨立的 `transfers` 類型。
5. `status`：`draft` / `checked` / `verified`。
6. 正式版預設只應啟用 `verified` 資料。

## Segment Schema

```json
{
  "from": "A",
  "to": "B",
  "minutes": 60,
  "status": "verified"
}
```
