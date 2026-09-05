# V1.3.0 交付檢查

2026-09-05：24 項 Node 回歸測試全數通過，JavaScript 語法、HTML 本機資源引用、DOM ID 與 manifest／版本 JSON 已檢查。

涵蓋：不同名片的並行修訂、同名片衝突與合併、封存復原、舊格式讀取、分類正規化、TEL／FAX 與姓名職稱解析、Drive 分頁、預產生 ID 重試、權杖過期、SW 快取隔離、多分頁更新確認、先本機後上傳、失敗留存、已提交操作去重、過時版本阻擋、帳號與資料夾隔離、草稿照片、OCR 過時結果、手動輸入保護、IndexedDB 交易失敗與手機登入手勢。

執行方式：`node --test regression-tests.cjs`，需要 Node.js 22 以上，不需安裝測試套件。

測試使用 VM、模擬 Drive 回應與隔離資料，不會存取真實帳號。未完成真實 OAuth、Drive 寫入、PWA 安裝或 iPhone／iPad 實機驗收；請依 `UPGRADE_V1_3_0.md` 的驗收步驟，在自己的測試資料夾確認後使用。
