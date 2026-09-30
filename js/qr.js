import { connect, onAuthStateChanged, doc, collection, getDoc, getDocs, writeBatch } from './firebase.js';
import { TABLES, randomId } from './bingo.js';
import { toast } from './ui.js';

// 與後台共用登入狀態
const { auth, db } = connect('admin');
const app = document.getElementById('app');
let tokens = new Map();

onAuthStateChanged(auth, async user => {
  const ok = user && (await getDoc(doc(db, 'admins', user.uid)).catch(() => null))?.exists();
  if (!ok) {
    app.innerHTML = '<div class="notice"><h1>需要管理員登入</h1><p>請先到 <a href="admin.html">後台</a> 登入後再回到這頁。</p></div>';
    return;
  }
  await load();
});

/** 讀取各桌的 token */
async function load() {
  const snap = await getDocs(collection(db, 'tables'));
  tokens = new Map(snap.docs.map(d => [d.data().table, d.id]));
  render();
}

/** 替還沒有 token 的桌次產生 token */
async function generate() {
  const b = writeBatch(db);
  let count = 0;
  for (let t = 1; t <= TABLES; t++) {
    if (tokens.has(t)) continue;
    b.set(doc(db, 'tables', randomId(10)), { table: t });
    count++;
  }
  await b.commit();
  toast(`已產生 ${count} 桌的 QR Code`);
  await load();
}

/** 渲染 QR Code 卡片 */
function render() {
  const cards = [...tokens].sort(([a], [b]) => a - b).map(([t, token]) => {
    const url = new URL(`index.html?t=${token}`, location.href).href;
    return `<div class="qr-card"><h2>第 ${t} 桌</h2><p>掃描加入婚禮賓果</p><div class="qr" data-url="${url}"></div><small>${url}</small></div>`;
  }).join('');
  app.innerHTML = `<section class="qr-page">
    <div class="qr-bar"><h1>桌號 QR Code</h1>
      <button class="btn" data-act="gen" ${tokens.size >= TABLES ? 'disabled' : ''}>產生缺少的桌號（共 ${TABLES} 桌）</button>
      <button class="btn primary" data-act="print" ${tokens.size ? '' : 'disabled'}>列印</button></div>
    ${tokens.size ? `<div class="qr-grid">${cards}</div>` : '<p class="muted">還沒有桌號 QR Code，請按「產生缺少的桌號」。</p>'}
  </section>`;
  document.querySelectorAll('.qr[data-url]').forEach(el =>
    new QRCode(el, { text: el.dataset.url, width: 180, height: 180, correctLevel: QRCode.CorrectLevel.M }));
}

app.addEventListener('click', e => {
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (act === 'gen') generate().catch(err => toast('產生失敗：' + err.message));
  else if (act === 'print') window.print();
});
