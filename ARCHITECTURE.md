# V1.3.0 架構與資料契約

GitHub Pages 提供同層靜態檔案。Google Identity Services 取得短效權杖，Drive API v3 保存名片；Tesseract.js 在裝置處理 OCR。沒有後端、額外資料庫或付費 OCR 金鑰。

## 儲存與同步流程

1. 取得權杖後，用 `about.user.permissionId` 驗證帳號，再驗證目標資料夾及 `canAddChildren`。
2. 本機 scope 是「permissionId｜根資料夾 ID」。草稿另加分頁 ID；登出切到獨立本機待認領區。
3. 提交先將完整操作與照片 Blob 寫入 outbox，等 IndexedDB transaction complete 才回報本機儲存完成。
4. 同步分頁讀取指定根資料夾與直屬廠商資料夾，重建修訂圖。用 Drive 檔案 ID＋modifiedTime 快取 JSON，照片按需讀取。
5. 待上傳修訂的 parents 必須與雲端末端修訂一致；不一致則保留本機修改並標示衝突。
6. 上傳前將 Drive 預產生檔案 ID 存入 outbox。重試沿用 ID；409 須核對操作 ID 與父資料夾。
7. 雲端確認後，在同一本機交易內更新副本並移除 outbox。中途停止時，重開會先確認雲端是否已有該操作。
8. 兩台裝置仍可能在步驟 5 之後同時提交；兩份不可變修訂皆保留，下一次同步提示衝突。選定版本後，新增以所有分支為 parents 的合併修訂。

同瀏覽器支援 Web Locks 時，以 scope 鎖避免同時執行同步。跨裝置不依賴此鎖，以修訂分支避免資料覆寫遺失。程式在啟動、回到前景、變更資料、網路恢復或手動同步時交換資料，不是即時協作資料庫。

## 名片修訂範例

```json
{
  "schemaVersion": 2,
  "kind": "record",
  "id": "操作UUID",
  "parents": ["上一修訂UUID"],
  "action": "upsert",
  "createdAt": "2026-09-05T00:00:00.000Z",
  "record": {
    "id": "名片UUID",
    "vendorName": "A 廠商",
    "contactName": "王小明",
    "phone": "0912-345-678",
    "email": "contact@example.com",
    "category": "設備商",
    "jobTitle": "業務經理",
    "notes": "",
    "favorite": false,
    "photoFileId": "Drive照片ID",
    "folderId": "廠商資料夾ID",
    "createdAt": "2026-09-05T00:00:00.000Z",
    "updatedAt": "2026-09-05T00:00:00.000Z"
  }
}
```

`action: delete` 表示封存，照片與 JSON 保留；復原為指向封存修訂的新 upsert。舊版名片以 `legacy:名片ID:updatedAt` 作為基礎修訂 ID。

分類另外存為 `{schemaVersion:2,kind:"category",id,name,action:"add"|"remove",createdAt}`，使用 NFKC、空白合併與大小寫正規化。同一分類同時增刪依時間與操作 ID 決定一致結果；既有名片分類文字不因選單刪除而消失。

## 草稿、OCR 與更新

照片壓縮後立即保存，表單 input 依序寫入草稿。OCR 填入結果前檢查照片世代與欄位手動修改次數，避免舊照片結果混入新照片，或覆蓋使用者正在修正的內容。重用 OCR Worker，閒置後釋放。

Service Worker 僅快取靜態檔案白名單，不攔截外部、OAuth、Drive 或 Authorization 請求。版本檔強制網路檢查；快取名稱含應用路徑，只清理同一路徑舊版快取。

新版 Worker 先下載整套檔案，再要求各分頁等待工作完成並保存草稿。全部回覆後才接管；逾時解除等待並保留舊版，之後重試。第一次由 V1.2.0 升級需關閉全部舊分頁。

## 邊界

不提供背景永久登入、即時多人鎖定、歷史檔案自動清理或端到端加密。修訂累積會增加首次讀取成本，以增量 JSON 快取與三個並行下載控制負載。未來可加入索引快照與修訂壓縮，但不得在沒有保留策略時直接刪除修訂。

不要手動改寫修訂、搬移廠商資料夾或刪除父修訂；管理 Drive 原始檔案前請備份完整資料夾。
