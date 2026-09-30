import {
  connect, ensureUser, doc, collection, query, where, getDoc, setDoc, updateDoc, onSnapshot,
  writeBatch, arrayUnion, arrayRemove, serverTimestamp
} from './firebase.js';
import { MAX, SEATS, NEED, FREE, NUDGE_MS, cardOf, doneLines, seatKey, label } from './bingo.js';
import { toast, ask } from './ui.js';

const { auth, db } = connect();
const app = document.getElementById('app');
const token = new URLSearchParams(location.search).get('t');

let uid, table, mySeat = null, unsubs = [];
let pickerSeats = new Map();
// undefined 表示尚未載入、null 表示文件不存在
let game, seat, winner, claim;
let seenAt = new Map(), seenCount = -1, lastSalt = null, claimTimer = null;

main();

/** 進入點：登入、解析桌號，決定顯示選座位或賓果卡 */
async function main() {
  if (!token) return notice('歡迎參加婚禮賓果', '請掃描桌上的 QR Code 進入遊戲。');
  try {
    uid = (await ensureUser(auth)).uid;
    const t = await getDoc(doc(db, 'tables', token));
    if (!t.exists()) return notice('QR Code 無效', '請洽詢婚禮工作人員。');
    table = t.data().table;
    const u = await getDoc(doc(db, 'users', uid));
    u.exists() ? showCard(u.data().seat) : showPicker();
  } catch (e) {
    console.error(e);
    notice('連線失敗', '請確認網路後重新整理頁面。');
  }
}

/** 顯示單純的訊息畫面 */
function notice(title, text) {
  app.innerHTML = `<div class="notice"><p class="eyebrow">Wedding Bingo</p><h1>${title}</h1><p>${text}</p></div>`;
}

/** 取消所有即時監聽 */
function stop() {
  unsubs.forEach(f => f());
  unsubs = [];
}

/** 監聽失敗時提示 */
function onErr(e) {
  console.error(e);
  toast('連線中斷，正在重新連線…');
}

// ---------- 選座位 ----------
/** 監聽本桌座位並顯示選座位畫面 */
function showPicker() {
  stop();
  mySeat = null;
  unsubs.push(onSnapshot(query(collection(db, 'seats'), where('table', '==', table)), snap => {
    pickerSeats = new Map(snap.docs.map(d => [d.id, d.data()]));
    renderPicker();
  }, onErr));
}

/** 渲染選座位畫面 */
function renderPicker() {
  const seats = Array.from({ length: SEATS }, (_, i) => {
    const k = seatKey(table, i + 1), taken = pickerSeats.get(k)?.uid;
    return `<button class="seat" data-act="bind" data-k="${k}" data-n="${i + 1}" ${taken ? 'disabled' : ''}>
      <b>${i + 1}</b><small>${taken ? '已入座' : '選擇'}</small></button>`;
  }).join('');
  app.innerHTML = `<section class="guest">
    <header class="g-head"><p class="eyebrow">Wedding Bingo</p><h1>一起來玩賓果吧</h1><p class="muted">請選擇你的座位號碼</p></header>
    <div class="table-name">第 ${table} 桌</div>
    <div class="seats">${seats}</div>
    <p class="hint">選定後這支手機會綁定該座位，<br>換手機請找婚禮工作人員協助。</p>
  </section>`;
}

/** 綁定座位：同時寫入座位與使用者對應，規則會檢查桌號與一人一位 */
async function bind(k, n) {
  if (!await ask(`確認你是「${label(k)}」嗎？\n綁定後無法自行更換。`)) return;
  const b = writeBatch(db), ref = doc(db, 'seats', k);
  if (pickerSeats.has(k)) b.update(ref, { uid, token });
  else b.set(ref, { table, seat: n, uid, token, marks: [] });
  b.set(doc(db, 'users', uid), { seat: k });
  try {
    await b.commit();
    showCard(k);
  } catch (e) {
    console.error(e);
    toast('這個座位剛被選走了，請重新選擇');
  }
}

// ---------- 賓果卡 ----------
/** 監聽遊戲、座位、得獎與喊賓果狀態並顯示賓果卡 */
function showCard(k) {
  stop();
  mySeat = k;
  game = seat = winner = claim = undefined;
  seenCount = -1;
  const watch = (ref, set) => unsubs.push(onSnapshot(ref, s => { set(s.exists() ? s.data() : null); renderCard(); }, onErr));
  watch(doc(db, 'game', 'state'), v => { game = v; });
  watch(doc(db, 'seats', k), v => { seat = v; });
  watch(doc(db, 'winners', k), v => { winner = v; });
  watch(doc(db, 'claims', k), v => { if (claim && !v) checkRejected(); claim = v; });
}

/** 喊賓果的紀錄被移除卻沒有得獎時，代表驗證未通過 */
function checkRejected() {
  clearTimeout(claimTimer);
  claimTimer = setTimeout(() => { if (!winner) toast('驗證未通過，請確認標記的號碼'); }, 2000);
}

/** 渲染賓果卡 */
function renderCard() {
  if (game === undefined || seat === undefined || winner === undefined || claim === undefined) return;
  if (!seat || seat.uid !== uid) {
    toast('這個座位已解除綁定，請重新選擇');
    return showPicker();
  }
  if (!game) return notice(label(mySeat), '遊戲即將開始，請稍候。');

  if (game.salt !== lastSalt) { seenAt = new Map(); lastSalt = game.salt; }
  const now = Date.now();
  game.drawn.forEach(n => { if (!seenAt.has(n)) seenAt.set(n, now); });
  const pop = seenCount >= 0 && game.drawn.length > seenCount;
  if (pop && navigator.userActivation?.hasBeenActive) try { navigator.vibrate?.(60); } catch (e) {}
  seenCount = game.drawn.length;

  const drawn = new Set(game.drawn);
  const card = cardOf(mySeat, game.salt), marks = new Set(seat.marks.filter(n => drawn.has(n)));
  const lines = doneLines(card, n => marks.has(n));
  const inLine = new Set(lines.flat());
  const last = game.drawn.at(-1);
  const cells = card.map((n, i) => {
    if (i === FREE) return `<div class="cell free${inLine.has(i) ? ' in-line' : ''}" aria-label="免費格">♥</div>`;
    const on = marks.has(n), t = !on && drawn.has(n) ? seenAt.get(n) : '';
    return `<button class="cell${on ? ' on' : ''}${inLine.has(i) ? ' in-line' : ''}" data-act="mark" data-n="${n}" data-t="${t}">${n}</button>`;
  }).join('');
  const dots = Array.from({ length: NEED }, (_, i) => `<i class="${i < lines.length ? 'on' : ''}"></i>`).join('');
  const action = winner
    ? `<div class="won"><b>🎉 恭喜賓果！</b>已登記得獎（第 ${winner.at} 號完成），請聽主持人指示</div>`
    : claim
      ? `<div class="pending">已送出 BINGO，驗證中…</div>`
      : `<button class="bingo" data-act="bingo" ${lines.length >= NEED ? '' : 'disabled'}>BINGO!</button>`;

  app.innerHTML = `<section class="guest">
    <header class="g-head"><p class="eyebrow">Wedding Bingo</p><h1>${label(mySeat)}</h1></header>
    <div class="latest">
      <div class="ball${last ? '' : ' empty'}${pop ? ' pop' : ''}">${last ?? '–'}</div>
      <div><div class="t">最新號碼</div><div class="v">已開出 ${game.drawn.length} / ${MAX}</div></div>
      <div class="progress"><div class="t">連線 ${lines.length} / ${NEED}</div><div class="dots">${dots}</div></div>
    </div>
    <div class="card">${[...'BINGO'].map(c => `<div class="hd">${c}</div>`).join('')}${cells}</div>
    ${action}
    <p class="hint">只能點選已開出的號碼；開出 15 秒還沒點的號碼會閃爍提醒。<br>連滿 ${NEED} 條線後按下 BINGO，系統會自動驗證。</p>
    <details class="history"><summary>已開出號碼（${game.drawn.length}）</summary>
      <div class="chips">${[...game.drawn].reverse().map(n => `<span>${n}</span>`).join('') || '<em class="muted">尚未開號</em>'}</div></details>
  </section>`;
  updateNudge();
}

/** 更新未標記號碼的閃爍提醒 */
function updateNudge() {
  const now = Date.now();
  document.querySelectorAll('.cell[data-t]').forEach(c => {
    const t = +c.dataset.t;
    c.classList.toggle('nudge', t > 0 && now - t > NUDGE_MS);
  });
}

/** 標記或取消標記號碼 */
async function mark(b) {
  const n = +b.dataset.n;
  if (winner) return toast('已登記得獎，卡面已鎖定');
  if (!game.drawn.includes(n)) {
    b.classList.remove('shake'); void b.offsetWidth; b.classList.add('shake');
    return toast(`${n} 號還沒開出喔`);
  }
  try {
    await updateDoc(doc(db, 'seats', mySeat), { marks: seat.marks.includes(n) ? arrayRemove(n) : arrayUnion(n) });
  } catch (e) {
    console.error(e);
    toast('標記失敗，請再試一次');
  }
}

/** 送出 BINGO，由後台驗證 */
async function bingo() {
  try {
    await setDoc(doc(db, 'claims', mySeat), { uid, ts: serverTimestamp() });
  } catch (e) {
    console.error(e);
    toast('送出失敗，請再試一次');
  }
}

app.addEventListener('click', e => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  if (b.dataset.act === 'bind') bind(b.dataset.k, +b.dataset.n);
  else if (b.dataset.act === 'mark') mark(b);
  else if (b.dataset.act === 'bingo') bingo();
});
setInterval(() => { if (mySeat) updateNudge(); }, 1000);
