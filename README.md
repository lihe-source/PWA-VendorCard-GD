# 廠商名片管家 PWA V1.2.0

這是一套可直接部署於 GitHub Pages 的扁平化 PWA。使用者可拍攝名片，在裝置端以 OCR 擷取廠商、聯繫人、電話與信箱，確認後將照片及 JSON 資料存入自己的 Google Drive。

## 主要功能

- 相機拍照或選取既有名片照片
- 獨立「上傳照片分析」功能，不使用相機也能匯入圖片並執行 OCR
- 繁體中文＋英文 OCR，欄位自動解析後可人工修正
- 廠商名稱、聯繫人、電話、電子信箱、分類、職稱、備註與收藏
- 依廠商建立獨立 Google Drive 資料夾
- 廠商／聯繫人／電話／信箱全文搜尋、分類篩選、收藏與排序
- 設定頁分類管理：新增、刪除並透過 Google Drive 跨裝置同步
- 新增名片時使用可搜尋分類選單，選單底部可快速新增分類
- 名片資訊頁右下角一鍵回到最頂端
- 開啟後自動嘗試恢復 Google Drive 授權與同步；若瀏覽器阻擋靜默授權，會利用第一次使用者操作完成恢復
- 無網路時可暫存新名片，重新連線後自動上傳
- 設定頁可填入 Google Drive 資料夾網址或 Folder ID
- 預設雲端位置：`https://drive.google.com/drive/folders/1PqDRkf6ip0kp60i1BRgsMTMt2aCmvLum`
- 連線時自動驗證資料夾類型、存取權與新增內容權限
- PWA 安裝、快取、深色模式與版本自動檢查更新
- iPhone／iPad 安全區、固定底部導覽、44px 以上觸控區
- 手機版固定縮放，停用雙擊放大並縮減底部導覽空白

## Google Drive 資料結構

```text
我的雲端硬碟
└─ 使用者在設定頁指定的資料夾
   ├─ vendors-index.json                 # 快速搜尋索引
   ├─ A 廠商
   │  ├─ vendor.json                     # 廠商與所有聯繫人摘要
   │  ├─ contact-聯繫人ID.json           # 單張名片結構化資料
   │  └─ card-聯繫人ID.jpg               # 名片照片
   └─ B 廠商
      └─ ...
```

Google Drive 是正式資料來源；瀏覽器 IndexedDB 只保存加速讀取的索引快取與尚未同步的新名片。

## 開始使用

1. 依 `GOOGLE_DRIVE_SETUP.md` 建立 Google OAuth Client ID。
2. 將本資料夾內的所有檔案放在 GitHub 儲存庫根目錄，不要再包一層資料夾。
3. 到 GitHub 儲存庫的 `Settings → Pages`，選擇 `Deploy from a branch`、`main`、`/(root)` 後儲存。
4. 開啟 GitHub Pages 網址，進入「設定」，確認雲端空間位置、貼上 Client ID 並按「連接 Google Drive」。
5. iPhone／iPad 可用 Safari 的「分享 → 加入主畫面」安裝 PWA。

## 版本更新規則

- 更新程式時，同步修改 `app.js` 的 `APP_VERSION`、`version.json` 與 `sw.js` 的快取名稱。
- 程式啟動時會以不使用快取的方式讀取 `version.json`。
- 發現新版本後，Service Worker 會下載新檔、接管頁面並自動重新載入。

## 隱私與安全

- Google OAuth Client ID 是公開識別碼，可以放在前端；不要將 Client Secret、Access Token 或任何私鑰放入程式碼或 GitHub。
- 使用者可填入既有 Drive 資料夾網址。Google 的 `drive.file` 權限無法只靠貼入網址取得既有資料夾寫入權，因此此版本要求完整 Drive 權限；程式邏輯仍只會在設定頁指定的資料夾讀寫索引、廠商子資料夾、JSON 與名片照片。
- 完整 Drive 權限屬 Google Restricted Scope。個人使用請將自己的帳號加入 OAuth 測試使用者；若公開提供大量使用者使用，需要依 Google 規定完成驗證。
- OCR 在瀏覽器中執行。首次使用需下載 OCR 程式與繁中／英文模型；辨識影像不會因 OCR 傳送到第三方辨識伺服器。
- Google Identity Services 的存取權杖是短效權杖，程式不會把權杖長期存入瀏覽器。程式會在開啟後先嘗試靜默恢復；若 Google 或瀏覽器要求使用者手勢，第一次點擊程式時會自動觸發帳號確認。完全無互動的永久登入需要安全的後端 Refresh Token 儲存，不適合純 GitHub Pages 前端。
