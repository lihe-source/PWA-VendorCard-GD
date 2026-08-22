# Google Drive API 設定指南

## 1. 建立或選擇 Google Cloud 專案

前往 [Google Cloud Console](https://console.cloud.google.com/)，建立新專案或選擇既有專案。

## 2. 啟用 Google Drive API

1. 開啟「API 和服務 → 程式庫」。
2. 搜尋 `Google Drive API`。
3. 進入後按「啟用」。

## 3. 設定 OAuth 同意畫面

1. 開啟「Google Auth Platform」。
2. 填寫應用程式名稱、支援電子郵件與開發人員聯絡信箱。
3. 使用對象若選「外部」，在測試階段將實際使用的 Google 帳號加入測試使用者。
4. 在「資料存取／Data Access」加入 `https://www.googleapis.com/auth/drive`。

此版本允許直接貼入既有 Google Drive 資料夾網址。Google 的 `drive.file` 只能處理由程式建立，或透過 Google Picker 明確分享給程式的檔案，無法只靠貼入網址寫入既有資料夾，因此必須使用完整 Drive 權限。程式本身仍只會操作設定頁指定的資料夾。

`drive` 屬於 Google Restricted Scope。個人使用或開發測試時，請保持 OAuth 應用程式為測試狀態，並將實際登入帳號加入測試使用者；若要公開發布給大量使用者，必須依 Google 規定申請 OAuth 驗證。

## 4. 建立 OAuth 用戶端

1. 開啟「用戶端／Clients → 建立用戶端」。
2. 應用程式類型選「網頁應用程式」。
3. 在「已授權的 JavaScript 來源」加入 GitHub Pages 的來源；只填來源，不要加路徑：

   ```text
   https://你的GitHub帳號.github.io
   ```

4. 若使用自訂網域，也加入完整 HTTPS 來源，例如：

   ```text
   https://cards.example.com
   ```

5. 建立後複製以 `.apps.googleusercontent.com` 結尾的 Client ID。

「已授權的重新導向 URI」不需填 GitHub Pages 路徑；本程式使用 Google Identity Services 的瀏覽器 Token Model 彈出式授權流程。

## 5. 填入 PWA

1. 開啟已部署的 PWA。
2. 進入「設定」。
3. 貼上 Client ID。
4. 確認「Google Drive 雲端空間位置」。預設為：

   ```text
   https://drive.google.com/drive/folders/1PqDRkf6ip0kp60i1BRgsMTMt2aCmvLum
   ```

5. 按「儲存連線設定」。
6. 按「連接 Google Drive」，選擇對該資料夾具有編輯權限的帳號並同意權限。

程式會解析網址中的 Folder ID，驗證該項目確實是資料夾且目前帳號可新增內容，再讀寫 `vendors-index.json` 及各廠商子資料夾。

## 常見錯誤

| 畫面或錯誤 | 檢查方式 |
|---|---|
| `origin_mismatch` | 已授權 JavaScript 來源必須與瀏覽器網址的 `https://網域` 完全相同，來源欄位不能包含儲存庫路徑。 |
| `access_denied` | OAuth 測試模式下，確認登入帳號已加入測試使用者。 |
| `403` 或 Drive API 未使用 | 確認同一個 Cloud 專案已啟用 Google Drive API。 |
| 無法存取指定資料夾 | 確認登入帳號對該資料夾具有編輯權限，並重新同意完整 Drive 權限。 |
| 資料夾網址格式不正確 | 請貼入 `https://drive.google.com/drive/folders/資料夾ID`，也可直接填 Folder ID。 |
| 登入視窗未開啟 | 請直接按「連接 Google Drive」；瀏覽器 OAuth 需要由使用者點擊觸發。 |
| 重新開啟後要求連接 | 瀏覽器 Token Model 不提供背景永久刷新權杖，屬正常安全機制。 |
| 已啟用自動連線但仍出現帳號確認 | Google OAuth 與 iOS 防止未經操作開啟授權視窗；程式會先靜默恢復，失敗時改在第一次點擊程式時自動觸發。 |
| OCR 第一次較久 | 第一次需下載繁中與英文辨識模型；之後瀏覽器快取可加速。 |

## 官方技術文件

- [Google Identity Services：Token Model](https://developers.google.com/identity/oauth2/web/guides/use-token-model)
- [Google Drive API：OAuth 範圍](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)
- [Google Drive API：檔案上傳](https://developers.google.com/workspace/drive/api/guides/manage-uploads)
- [GitHub Pages：從分支發布](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)
