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
4. 本程式執行時只要求 `https://www.googleapis.com/auth/drive.file`。這是 Google 建議的單檔／應用程式建立檔案範圍，屬於比完整 Drive 權限更低的權限。

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
3. 貼上 Client ID，按「儲存設定」。
4. 按「連接 Google Drive」，選擇帳號並同意權限。

## 常見錯誤

| 畫面或錯誤 | 檢查方式 |
|---|---|
| `origin_mismatch` | 已授權 JavaScript 來源必須與瀏覽器網址的 `https://網域` 完全相同，來源欄位不能包含儲存庫路徑。 |
| `access_denied` | OAuth 測試模式下，確認登入帳號已加入測試使用者。 |
| `403` 或 Drive API 未使用 | 確認同一個 Cloud 專案已啟用 Google Drive API。 |
| 登入視窗未開啟 | 請直接按「連接 Google Drive」；瀏覽器 OAuth 需要由使用者點擊觸發。 |
| 重新開啟後要求連接 | 瀏覽器 Token Model 不提供背景永久刷新權杖，屬正常安全機制。 |
| OCR 第一次較久 | 第一次需下載繁中與英文辨識模型；之後瀏覽器快取可加速。 |

## 官方技術文件

- [Google Identity Services：Token Model](https://developers.google.com/identity/oauth2/web/guides/use-token-model)
- [Google Drive API：OAuth 範圍](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)
- [Google Drive API：檔案上傳](https://developers.google.com/workspace/drive/api/guides/manage-uploads)
- [GitHub Pages：從分支發布](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)
