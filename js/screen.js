import { connect, ensureUser, doc, collection, onSnapshot } from './firebase.js';
import { MAX, NEED, seatStats, groupWinners, label } from './bingo.js';

const { auth, db } = connect();
const app = document.getElementById('app');
const overlay = document.getElementById('overlay');

let game, seats = new Map(), winners = new Map();
let seenCount = -1, seenWinners = null, ovTimer;

await ensureUser(auth);
const toMap = s => new Map(s.docs.map(d => [d.id, d.data()]));
onSnapshot(doc(db, 'game', 'state'), s => { game = s.exists() ? s.data() : null; render(); });
onSnapshot(collection(db, 'seats'), s => { seats = toMap(s); render(); });
onSnapshot(collection(db, 'winners'), s => { winners = toMap(s); render(); announce(); });

/** 渲染大螢幕 */
function render() {
  if (game === undefined) return;
  const drawn = game?.drawn || [];
  const st = seatStats(seats, winners, game), last = drawn.at(-1), set = new Set(drawn);
  const pop = seenCount >= 0 && drawn.length > seenCount ? ' pop' : '';
  seenCount = drawn.length;
  const recent = drawn.slice(-6, -1).reverse();
  const board = Array.from({ length: MAX }, (_, i) => `<div class="${i + 1 === last ? 'last' : set.has(i + 1) ? 'on' : ''}">${i + 1}</div>`).join('');
  const list = groupWinners(winners).flatMap(([, ws]) => ws).map(w => `<span class="sc-chip">${label(w.key)}</span>`).join('')
    || '<span class="sc-dim">等待第一位賓果得主…</span>';
  app.innerHTML = `<section class="screen">
    <header class="sc-title"><h1>WEDDING BINGO</h1><span>連滿 ${NEED} 條線即可喊 BINGO</span></header>
    <div class="sc-left">
      <div class="sc-label">最新號碼</div>
      <div class="sc-ball${last ? '' : ' empty'}${pop}">${last ?? '–'}</div>
      <div class="sc-count">${drawn.length ? `第 ${drawn.length} 顆` : '即將開始'}</div>
      <div class="sc-recent">${recent.map(n => `<span>${n}</span>`).join('')}</div>
    </div>
    <div class="sc-board">${board}</div>
    <footer class="sc-foot">
      <div class="sc-stats"><div><small>參加</small><b>${st.joined}</b></div><div><small>聽牌</small><b>${st.reach}</b></div><div><small>得獎</small><b>${st.won}</b></div></div>
      <div class="sc-winners">${list}</div>
    </footer>
  </section>`;
}

/** 出現新得獎者時跳出全螢幕公告 */
function announce() {
  const fresh = seenWinners ? [...winners.keys()].filter(k => !seenWinners.has(k)) : [];
  seenWinners = new Set(winners.keys());
  if (!fresh.length) return;
  const ks = fresh.map(label);
  overlay.querySelector('p').textContent = ks.slice(0, 6).join('、') + (ks.length > 6 ? ` 等 ${ks.length} 人` : '');
  overlay.classList.add('show');
  clearTimeout(ovTimer);
  ovTimer = setTimeout(() => overlay.classList.remove('show'), 5000);
}

overlay.addEventListener('click', () => overlay.classList.remove('show'));
