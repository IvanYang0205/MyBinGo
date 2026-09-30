# 婚禮數位賓果

賓客掃描桌上的 QR Code、選擇座位號碼後參加賓果；主持人在後台開號，大螢幕即時顯示號碼與得獎者。

- 5×5 卡面，號碼 1–50，中心為免費格，連滿 3 條線即可喊 BINGO
- 每位賓客的卡面由座位號碼決定，換手機或重新整理後不變
- 賓客自己點選標記（只能點已開出的號碼，漏點會閃爍提醒），按下 BINGO 後由後台自動驗證
- 得獎依「第幾號完成」判定，同一號完成的人並列

## 頁面

| 頁面 | 用途 |
|---|---|
| `index.html?t=<桌號 token>` | 賓客頁，由桌號 QR Code 進入 |
| `admin.html` | 後台：開號、撤銷、得獎名單、聽牌名單、座位管理、彩排工具（需管理員登入） |
| `screen.html` | 大螢幕投影頁 |
| `qr.html` | 產生並列印各桌 QR Code（需管理員登入） |

## 架構

純靜態網頁（GitHub Pages）+ Firebase（Firestore 即時資料庫、Authentication）。沒有自己的伺服器：
BINGO 的驗證由開著的後台頁面負責，作弊防護由 [`firestore.rules`](firestore.rules) 負責。

| 集合 | 內容 |
|---|---|
| `game/state` | 遊戲鹽值 `salt`（決定卡面）、已開號碼 `drawn` |
| `tables/{token}` | 桌號 token 對應的桌號 |
| `seats/{桌-座}` | 綁定的使用者、標記的號碼 |
| `users/{uid}` | 使用者綁定的座位（一支手機只能綁一個座位） |
| `claims/{桌-座}` | 賓客送出的 BINGO，待後台驗證 |
| `winners/{桌-座}` | 得獎紀錄與完成號次 |
| `admins/{uid}` | 管理員名單（只能在 Firebase console 新增） |

## 本機開發與測試

在 `localhost` 開啟時會自動連到 Firebase 本機模擬器，不會碰到正式資料。
本機模式下每個瀏覽器分頁都是獨立的賓客，可以多開分頁模擬多支手機。

需要 Node.js、Python 與 Java 21 以上。

```bash
npm install
npm run emulators      # 啟動 Auth 與 Firestore 模擬器（模擬器 UI：http://127.0.0.1:4000）
npm run seed           # 另開終端機：建立測試管理員帳號（帳密見 tools/seed-emulator.mjs）
npm run serve          # 另開終端機：http://localhost:5500/admin.html
```

測試流程：後台登入 → 建立遊戲 → 桌號 QR 頁產生 QR → 點 QR 下方網址進入賓客頁 → 後台「加入模擬賓客」與開號。

> Windows 若模擬器啟動時出現 `UnixDomainSockets` 相關錯誤，先設定
> `JAVA_TOOL_OPTIONS=-Djdk.net.unixdomain.tmpdir=C:/temp`（任一路徑短的資料夾）再啟動。

## 上線設定

### 1. 建立 Firebase 專案（免費 Spark 方案即可）
1. 到 [Firebase console](https://console.firebase.google.com/) 建立專案，不需要 Google Analytics。
2. 專案設定 → 一般 → 新增網頁應用程式，把設定值填到 [`js/firebase-config.js`](js/firebase-config.js)。
3. Build → Authentication → 開始使用 → 登入方式：啟用「匿名」與「電子郵件/密碼」。
4. Authentication → 使用者 → 新增使用者，建立後台管理員帳號，複製它的「使用者 UID」。
5. Authentication → 設定 → 授權網域：加入 `ivanyang0205.github.io`。
6. Build → Firestore Database → 建立資料庫，位置選 `asia-east1`（台灣），以正式版模式啟動。
7. Firestore → 規則：貼上 [`firestore.rules`](firestore.rules) 的內容並發布。
8. Firestore → 資料：新增集合 `admins`，文件 ID 填上第 4 步的 UID（欄位隨意加一個，例如 `name`）。

### 2. 開啟 GitHub Pages
Repo → Settings → Pages → Source 選「Deploy from a branch」，Branch 選 `main`、資料夾 `/ (root)`。
網址會是 `https://ivanyang0205.github.io/MyBinGo/`。

### 3. 準備遊戲
1. 開 `admin.html` 登入 → 建立遊戲。
2. 開 `qr.html` → 產生缺少的桌號 → 列印，放到各桌。

## 婚禮當天檢查清單

- [ ] 事先彩排：多支手機實際掃 QR、鎖螢幕再回來、開關飛航模式
- [ ] 彩排完按「移除模擬賓客」，開始前按「開新一局」
- [ ] 當天不要大量測試：免費方案每日約 5 萬次讀取、2 萬次寫入，用完當天會停止服務
- [ ] 後台與大螢幕保持開啟（BINGO 驗證由後台頁面負責）
- [ ] 賓客換手機時，在後台座位總覽點該座位「解除綁定」，賓客重新掃 QR 選同一個座位即可

## 其他

- [`mockup/bingo-mockup.html`](mockup/bingo-mockup.html)：早期單檔 mockup，不需要 Firebase
- [`tools/sim.py`](tools/sim.py)：遊戲節奏模擬（不同號碼範圍與線數下，第幾號出現得獎者）
