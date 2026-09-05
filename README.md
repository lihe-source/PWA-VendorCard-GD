# 廠商名片管家 PWA V1.3.0

可直接放在 GitHub Pages 根目錄的扁平化 PWA，無需安裝 npm、編譯或後端。Google Drive 保存正式資料；IndexedDB 保存依帳號與資料夾隔離的離線副本、草稿及待同步工作。

## 下載後部署

1. 解壓縮 `Vendor-Card-PWA-V1_3_0.zip`。
2. 將 `Vendor-Card-PWA-V1_3_0` 資料夾**裡面的全部檔案**放到 GitHub 儲存庫根目錄，不要連同外層資料夾一起上傳。
3. 在儲存庫 `Settings → Pages` 選 `Deploy from a branch`、`main`、`/(root)`。
4. 依 `GOOGLE_DRIVE_SETUP.md` 設定 Google Cloud。填入完整 Client ID，按「儲存連線設定」，再按「登入／恢復 Google Drive」。
5. iPhone / iPad 以 Safari 開啟正式 HTTPS 網址，再選「分享 → 加入主畫面」。不要直接雙擊 HTML 測試登入或 PWA。

預設位置（可在設定修改）：

https://drive.google.com/drive/folders/1PqDRkf6ip0kp60i1BRgsMTMt2aCmvLum

網址不會自動授予權限；登入帳號必須能在資料夾內新增檔案。Client ID 必須由你的 Google Cloud 專案建立，不可從截圖補猜。不要填入 Client Secret。

## 已實作功能

- 相機拍照、相簿上傳分析；瀏覽器端繁中＋英文 OCR，輔助填入廠商、姓名、電話、信箱與職稱。
- 名片欄位包含廠商、姓名、電話、信箱、分類、職稱、備註與收藏；支援文字搜尋、分類篩選與排序。
- 保留「名片資訊／名片記錄／設定」三個底部分頁；中央為較大的圓形相機按鈕。
- 名片資訊右下角回頂端；精簡底部留白、iOS 安全區、固定縮放及鍵盤顯示時的分類選單位置。
- 設定可增刪分類；表單有可搜尋選單及底部「新增」，分類空白字元一致化。
- 每個廠商獨立 Drive 資料夾，照片與名片修訂放在對應廠商資料夾。
- 新增、編輯、收藏、封存、分類變更皆先完成本機交易，再嘗試上傳；斷線保留待同步資料。
- 設定提供待同步清單、重試、衝突處理、封存復原及資料備份匯出。
- 表單文字與照片自動保存草稿，重開頁面可復原。
- Google 帳號＋指定資料夾分別隔離；未登入的新資料須登入後確認匯入目的地。
- 有效的同分頁授權可自動恢復並同步；過期需點一下登入。程式不攔截拍照按鈕來開 OAuth 視窗。
- 啟動、回到前景與設定手動檢查版本；工作完成、各分頁保留草稿後才套用更新。

## Drive 資料配置

| 位置 | 檔案 | 用途 |
|---|---|---|
| 指定根資料夾 | `category-change-操作ID.json` | 獨立分類新增／移除操作 |
| 根資料夾內的 A 廠商 | `entry-操作ID.json` | A 廠商名片的新增、修改、封存或復原修訂 |
| 根資料夾內的 A 廠商 | `card-操作ID.jpg` | 對應名片照片 |
| 根資料夾內的 B 廠商 | 同上命名規則 | B 廠商資料 |
| 舊版既有位置 | `vendors-index.json`、`contact-*.json`、`vendor.json` | 保留原檔；讀取索引與 contact 作為升級基礎，不再覆寫 |

V1.3.0 使用不可變修訂檔，避免整份索引覆寫。跨裝置同時修改同一張名片時保留不同分支並提示確認。寫入前先保留 Drive 預產生檔案 ID，讓「伺服器寫入成功、回應卻斷線」能用相同 ID 重試。

「封存」會隱藏名片並可在設定復原，**不會刪除 Drive 歷史檔案或搬到垃圾桶**。歷史版本持續占用 Drive 空間。

## 舊版升級

先閱讀 `UPGRADE_V1_3_0.md`。所有使用同一份資料的裝置都應更新，V1.2.0 無法顯示新版新增的修訂。請勿清除 Safari 網站資料或 IndexedDB；那會移除未上傳名片與草稿。

## 主要檔案

| 檔案 | 用途 |
|---|---|
| `index.html`、`styles.css`、`ui.js` | 頁面、樣式與顯示函式 |
| `app.js` | 登入、草稿、互動、同步協調與 OCR |
| `data-core.js` | 修訂合併、分類正規化、文字欄位解析 |
| `storage.js` | IndexedDB 交易與隔離儲存 |
| `drive-store.js` | Drive API、分頁、驗證、重試與檔案讀寫 |
| `sw.js`、`manifest.webmanifest`、`version.json` | PWA 與更新 |
| `icon.svg`、`icon-192.png`、`icon-512.png` | 安裝與介面圖示 |
| `regression-tests.cjs` | 不連接實際帳號的 Node 回歸測試 |
| `ARCHITECTURE.md`、`UPGRADE_V1_3_0.md`、`GOOGLE_DRIVE_SETUP.md` | 架構、升級與設定說明 |

Node.js 22 以上可執行：

```sh
node --test regression-tests.cjs
```

開發可用 `python3 -m http.server 8080` 開啟 http://localhost:8080，並將此來源加入 Google OAuth 用戶端。

## 使用限制

- 純 GitHub Pages 前端沒有 Refresh Token 後端，無法保證跨瀏覽器重啟或授權過期後完全免點擊登入。
- OCR 使用 Tesseract.js 5.1.1。照片在裝置處理；首次需網路下載程式與模型。公司、姓名等欄位採規則推測，儲存前請人工核對。
- 本機資料未加密，帳號隔離用於避免誤顯示與誤上傳，不等同裝置存取控制。權杖僅放在分頁 sessionStorage，登出時清除。
- 瀏覽器可能回收網站空間；重要資料應同步到 Drive。匯出備份包含文字、待同步照片與草稿；已同步照片需另行備份 Drive 廠商資料夾。本版未提供備份檔自動還原介面。
- Drive 不強制同名資料夾唯一，兩個裝置同時首次建立同一廠商可能出現同名資料夾；程式會讀取兩者並合併顯示，不自動搬移或刪除。
- 本包執行模擬回歸與靜態檢查；真實 Google 登入、Drive 寫入與 iOS 操作須使用你的 OAuth 專案於部署後驗收。
