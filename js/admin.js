import {
  connect, isLocal, onAuthStateChanged, signInWithEmailAndPassword, signOut,
  doc, collection, query, where, getDoc, getDocs, setDoc, onSnapshot, writeBatch, runTransaction,
  arrayRemove, serverTimestamp
} from './firebase.js';
import {
  MAX, TABLES, SEATS, NEED, cardOf, doneLines, completeAt, seatStats, groupWinners, seatKey, label, names, randomId
} from './bingo.js';
import { toast, ask, renderKeepingInput } from './ui.js';

const { auth, db } = connect('admin');
const app = document.getElementById('app');

let game, seats = new Map(), winners = new Map(), claims = new Map();
let unsubs = [], autoTimer = null, seenCount = -1, drawing = false;
const processing = new Set();

onAuthStateChanged(auth, async user => {
  stop();
  if (!user) return renderLogin();
  try {
    const a = await getDoc(doc(db, 'admins', user.uid));
    if (!a.exists()) return renderLogin('這個帳號沒有管理權限');
    start();
  } catch (e) {
    console.error(e);
    renderLogin('無法確認權限，請稍後再試');
  }
});

/** 取消所有即時監聽 */
function stop() {
  unsubs.forEach(f => f());
  unsubs = [];
  setAuto(false);
}

/** 渲染登入畫面 */
function renderLogin(err = '') {
  app.innerHTML = `<form class="login panel" id="loginForm">
    <h1>賓果後台</h1>
    <input id="email" type="email" autocomplete="username" placeholder="管理員 Email" required>
    <input id="password" type="password" autocomplete="current-password" placeholder="密碼" required>
    <p class="err">${err}</p>
    <button class="btn primary">登入</button>
    ${isLocal ? '<p class="muted" style="font-size:12px;margin:0">本機模擬器模式：測試帳號見 tools/seed-emulator.mjs</p>' : ''}
  </form>`;
}

/** 開始監聽遊戲資料 */
function start() {
  const listen = (ref, fn) => unsubs.push(onSnapshot(ref, fn, e => { console.error(e); toast('連線中斷，正在重新連線…'); }));
  const toMap = s => new Map(s.docs.map(d => [d.id, d.data()]));
  listen(doc(db, 'game', 'state'), s => { game = s.exists() ? s.data() : null; render(); processClaims(); });
  listen(collection(db, 'seats'), s => { seats = toMap(s); render(); });
  listen(collection(db, 'winners'), s => { winners = toMap(s); render(); });
  listen(collection(db, 'claims'), s => { claims = toMap(s); processClaims(); });
}

/** 驗證賓客送出的 BINGO：標記需成線，得獎號次依開號順序計算 */
async function processClaims() {
  if (!game) return;
  for (const [k, c] of claims) {
    if (processing.has(k)) continue;
    processing.add(k);
    try {
      const s = await getDoc(doc(db, 'seats', k));
      const card = cardOf(k, game.salt), drawn = new Set(game.drawn);
      const marks = new Set((s.data()?.marks || []).filter(n => drawn.has(n)));
      const at = doneLines(card, n => marks.has(n)).length >= NEED ? completeAt(card, game.drawn) : 0;
      const b = writeBatch(db);
      if (at && !winners.has(k)) b.set(doc(db, 'winners', k), { at, ts: c.ts || serverTimestamp() });
      b.delete(doc(db, 'claims', k));
      await b.commit();
    } catch (e) {
      console.error(e);
    } finally {
      processing.delete(k);
    }
  }
}

/** 分批提交（單一 batch 上限 500 筆） */
async function commitInChunks(ops) {
  for (let i = 0; i < ops.length; i += 400) {
    const b = writeBatch(db);
    ops.slice(i, i + 400).forEach(op => op(b));
    await b.commit();
  }
}

// ---------- 開號 ----------
/** 開出號碼（未指定則隨機），模擬賓客同步自動得獎；進行中忽略重複點擊 */
async function draw(pick) {
  if (drawing) return false;
  drawing = true;
  try {
    await runTransaction(db, async tx => {
      const ref = doc(db, 'game', 'state'), g = (await tx.get(ref)).data();
      const left = Array.from({ length: MAX }, (_, i) => i + 1).filter(n => !g.drawn.includes(n));
      const n = pick ?? left[Math.floor(Math.random() * left.length)];
      if (!left.length) throw new Error('號碼已全部開完');
      if (!left.includes(n)) throw new Error('號碼無效或已開出');
      const drawn = [...g.drawn, n];
      tx.update(ref, { drawn });
      for (const [k, s] of seats) {
        if (!s.bot || winners.has(k)) continue;
        const at = completeAt(cardOf(k, g.salt), drawn);
        if (at) tx.set(doc(db, 'winners', k), { at, ts: serverTimestamp(), bot: true });
      }
    });
    return true;
  } catch (e) {
    toast(e.message);
    return false;
  } finally {
    drawing = false;
  }
}

/** 撤銷最後一號，連帶移除該號的標記與因此成立的得獎 */
async function undo() {
  if (!game?.drawn.length || !await ask('確定撤銷上一個號碼？')) return;
  const n = game.drawn.at(-1), len = game.drawn.length - 1;
  const marked = await getDocs(query(collection(db, 'seats'), where('marks', 'array-contains', n)));
  const ops = [b => b.update(doc(db, 'game', 'state'), { drawn: game.drawn.slice(0, -1) })];
  marked.forEach(d => ops.push(b => b.update(d.ref, { marks: arrayRemove(n) })));
  winners.forEach((w, k) => { if (w.at > len) ops.push(b => b.delete(doc(db, 'winners', k))); });
  await commitInChunks(ops);
  toast(`已撤銷 ${n} 號`);
}

/** 切換自動開號 */
function setAuto(on) {
  clearInterval(autoTimer);
  autoTimer = on ? setInterval(async () => { if (!await draw()) setAuto(false); }, 3000) : null;
}

// ---------- 座位與遊戲控制 ----------
/** 解除座位的手機綁定，卡面與標記保留 */
async function unbind(k) {
  const s = seats.get(k);
  if (!s) return toast(`${label(k)} 尚未入座`);
  if (!s.uid) return toast(`${label(k)} 已解除綁定，等待重新入座`);
  if (!await ask(`解除「${label(k)}」的手機綁定？\n賓客可用新手機重新選此座位，卡面與標記會保留。`)) return;
  const b = writeBatch(db);
  if (s.bot) b.delete(doc(db, 'seats', k));
  else {
    b.update(doc(db, 'seats', k), { uid: null });
    b.delete(doc(db, 'users', s.uid));
  }
  await b.commit();
}

/** 加入模擬賓客到空位（彩排與壓力測試用） */
async function addBots(count) {
  const free = [];
  for (let t = 1; t <= TABLES; t++) for (let i = 1; i <= SEATS; i++) if (!seats.has(seatKey(t, i))) free.push([t, i]);
  free.sort(() => Math.random() - .5);
  const picked = free.slice(0, count);
  await commitInChunks(picked.map(([t, i]) => b => {
    const k = seatKey(t, i);
    b.set(doc(db, 'seats', k), { table: t, seat: i, uid: 'bot', token: '', marks: [], bot: true });
    const at = game ? completeAt(cardOf(k, game.salt), game.drawn) : 0;
    if (at) b.set(doc(db, 'winners', k), { at, ts: serverTimestamp(), bot: true });
  }));
  toast(`已加入 ${picked.length} 位模擬賓客`);
}

/** 移除所有模擬賓客 */
async function clearBots() {
  const ops = [];
  seats.forEach((s, k) => {
    if (!s.bot) return;
    ops.push(b => b.delete(doc(db, 'seats', k)));
    if (winners.has(k)) ops.push(b => b.delete(doc(db, 'winners', k)));
  });
  await commitInChunks(ops);
}

/** 開新一局：換新卡面，清空開號、標記與得獎，保留座位綁定 */
async function newRound() {
  if (!await ask('開新一局？開號與得獎會清空，所有人換新卡面，座位綁定保留。')) return;
  setAuto(false);
  const ops = [b => b.set(doc(db, 'game', 'state'), { salt: randomId(), drawn: [] })];
  seats.forEach((s, k) => ops.push(b => b.update(doc(db, 'seats', k), { marks: [] })));
  winners.forEach((w, k) => ops.push(b => b.delete(doc(db, 'winners', k))));
  claims.forEach((c, k) => ops.push(b => b.delete(doc(db, 'claims', k))));
  await commitInChunks(ops);
}

/** 全部清空，包含座位綁定 */
async function wipe() {
  if (!await ask('全部清空？包含所有座位綁定，賓客需要重新選座位。')) return;
  setAuto(false);
  const users = await getDocs(collection(db, 'users'));
  const ops = [b => b.set(doc(db, 'game', 'state'), { salt: randomId(), drawn: [] })];
  seats.forEach((s, k) => ops.push(b => b.delete(doc(db, 'seats', k))));
  users.forEach(d => ops.push(b => b.delete(d.ref)));
  winners.forEach((w, k) => ops.push(b => b.delete(doc(db, 'winners', k))));
  claims.forEach((c, k) => ops.push(b => b.delete(doc(db, 'claims', k))));
  await commitInChunks(ops);
}

// ---------- 畫面 ----------
/** 渲染後台 */
function render() {
  if (game === undefined) return;
  if (game === null) {
    app.innerHTML = `<div class="notice"><h1>尚未建立遊戲</h1><p>第一次使用請先建立遊戲資料。</p>
      <button class="btn primary" data-act="init">建立遊戲</button></div>`;
    return;
  }
  const st = seatStats(seats, winners, game), last = game.drawn.at(-1), set = new Set(game.drawn);
  const pop = seenCount >= 0 && game.drawn.length > seenCount ? ' pop' : '';
  seenCount = game.drawn.length;
  const board = Array.from({ length: MAX }, (_, i) => `<div class="${i + 1 === last ? 'last' : set.has(i + 1) ? 'on' : ''}">${i + 1}</div>`).join('');
  const groups = groupWinners(winners);
  const winnerList = groups.length ? groups.map(([at, ws], gi) => `<li><span class="rank">${gi + 1}</span><div>
      <b>第 ${at} 號完成</b>${ws.length > 1 ? `<span class="pill warn">同時 ${ws.length} 人</span>` : ''}
      <div class="names">${ws.map(w => label(w.key) + (w.bot ? '<small>（模擬）</small>' : '')).join('、')}</div></div></li>`).join('')
    : '<li class="empty">尚無得獎者</li>';
  const listOf = s => Object.keys(st.byKey).filter(k => st.byKey[k] === s);
  const seatmap = Array.from({ length: TABLES }, (_, ti) => {
    const cells = Array.from({ length: SEATS }, (_, si) => {
      const k = seatKey(ti + 1, si + 1), s = seats.get(k);
      return `<button class="sq ${s ? st.byKey[k] : ''}" data-act="seat" data-k="${k}" title="${label(k)}${s?.bot ? '（模擬）' : ''}">${si + 1}</button>`;
    }).join('');
    return `<div class="trow"><span>${ti + 1} 桌</span>${cells}</div>`;
  }).join('');

  renderKeepingInput(app, `<section class="admin">
    <header class="admin-head"><h1>賓果後台</h1>
      <nav class="admin-nav"><a href="screen.html" target="_blank">大螢幕 ↗</a><a href="qr.html" target="_blank">桌號 QR ↗</a><button data-act="logout">登出</button></nav>
    </header>

    <div class="panel s5">
      <h2>開號</h2>
      <div class="draw-top">
        <div class="ball${last ? '' : ' empty'}${pop}">${last ?? '–'}</div>
        <div><div class="big">已開出 ${game.drawn.length} / ${MAX}</div><div class="muted">規則：連滿 ${NEED} 條線</div></div>
      </div>
      <div class="draw-actions">
        <button class="btn primary" data-act="draw" ${game.drawn.length >= MAX ? 'disabled' : ''}>🎲 抽下一號</button>
        <form class="manual" id="manualForm"><input id="manualN" type="number" min="1" max="${MAX}" inputmode="numeric" placeholder="手動輸入號碼（實體搖號用）"><button class="btn">開出</button></form>
        <button class="btn" data-act="undo" ${game.drawn.length ? '' : 'disabled'}>↶ 撤銷上一號</button>
        <label class="check"><input type="checkbox" id="autoDraw" data-act="auto" ${autoTimer ? 'checked' : ''}> 自動開號（每 3 秒，彩排用）</label>
      </div>
    </div>

    <div class="panel s7">
      <h2>即時狀態</h2>
      <div class="tiles">
        <div class="tile"><span>已入座</span><b>${st.joined}</b><small>/ ${TABLES * SEATS}</small></div>
        <div class="tile warn"><span>聽牌（差 1 號）</span><b>${st.reach}</b></div>
        <div class="tile accent"><span>已連線未按</span><b>${st.unclaimed}</b></div>
        <div class="tile gold"><span>得獎</span><b>${st.won}</b></div>
      </div>
      <dl class="namelist">
        <dt>已連線但還沒按 BINGO（主持人可提醒）</dt><dd>${names(listOf('unclaimed'))}</dd>
        <dt>聽牌中</dt><dd>${names(listOf('reach'))}</dd>
      </dl>
    </div>

    <div class="panel s5"><h2>得獎名單（依完成號次，同號視為並列）</h2><ul class="winners">${winnerList}</ul></div>
    <div class="panel s7"><h2>號碼盤</h2><div class="board">${board}</div></div>

    <div class="panel s8">
      <h2>座位總覽（點已入座的座位可解除綁定）</h2>
      <div class="legend">
        <span><i style="background:var(--surface-2);border:1px solid var(--line)"></i>空位</span>
        <span><i style="background:var(--info-soft)"></i>已入座</span>
        <span><i style="background:var(--warn-soft);border:1px solid var(--warn)"></i>聽牌</span>
        <span><i style="background:var(--accent)"></i>已連線未按</span>
        <span><i style="background:var(--gold)"></i>得獎</span>
        <span><i style="border:1px dashed var(--muted)"></i>已解除綁定</span>
      </div>
      <div class="seatmap">${seatmap}</div>
    </div>

    <div class="panel s4">
      <h2>彩排與遊戲控制</h2>
      <div class="tools">
        <form class="manual" id="botForm"><input id="botN" type="number" min="1" max="${TABLES * SEATS}" value="150"><button class="btn">加入模擬賓客</button></form>
        <button class="btn" data-act="clearBots">移除模擬賓客</button>
        <hr>
        <button class="btn" data-act="newRound">開新一局（保留座位，換新卡面）</button>
        <button class="btn danger" data-act="wipe">全部清空</button>
      </div>
    </div>
  </section>`);
}

const actions = {
  init: () => setDoc(doc(db, 'game', 'state'), { salt: randomId(), drawn: [] }),
  draw: () => draw(),
  undo,
  auto: b => setAuto(b.checked),
  seat: b => unbind(b.dataset.k),
  clearBots,
  newRound,
  wipe,
  logout: () => signOut(auth)
};

app.addEventListener('click', e => {
  const b = e.target.closest('[data-act]');
  if (b && actions[b.dataset.act]) Promise.resolve(actions[b.dataset.act](b)).catch(err => { console.error(err); toast('操作失敗：' + err.message); });
});
app.addEventListener('submit', async e => {
  e.preventDefault();
  if (e.target.id === 'loginForm') {
    const err = e.target.querySelector('.err');
    err.textContent = '';
    try {
      await signInWithEmailAndPassword(auth, e.target.email.value, e.target.password.value);
    } catch (x) {
      err.textContent = 'Email 或密碼錯誤';
    }
  } else if (e.target.id === 'manualForm') {
    const input = document.getElementById('manualN');
    if (await draw(+input.value)) input.value = '';
  } else if (e.target.id === 'botForm') {
    addBots(Math.max(1, +document.getElementById('botN').value || 0)).catch(err => toast('操作失敗：' + err.message));
  }
});
