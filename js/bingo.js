// 賓果規則與卡面邏輯（賓客、後台、大螢幕共用）
export const MAX = 50, TABLES = 20, SEATS = 10, NEED = 3, FREE = 12, NUDGE_MS = 15000;

export const LINES = (() => {
  const r = [0, 1, 2, 3, 4], L = [];
  r.forEach(a => { L.push(r.map(b => a * 5 + b)); L.push(r.map(b => b * 5 + a)); });
  L.push([0, 6, 12, 18, 24], [4, 8, 12, 16, 20]);
  return L;
})();

const cardCache = new Map();

/** 以座位代碼加遊戲鹽值產生固定卡面，中心 0 為免費格 */
export function cardOf(key, salt) {
  const id = salt + '|' + key;
  if (cardCache.has(id)) return cardCache.get(id);
  let h = 2166136261;
  for (const ch of id) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  let a = h >>> 0;
  const rnd = () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const nums = Array.from({ length: MAX }, (_, i) => i + 1);
  for (let i = nums.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [nums[i], nums[j]] = [nums[j], nums[i]]; }
  const card = nums.slice(0, 24);
  card.splice(FREE, 0, 0);
  cardCache.set(id, card);
  return card;
}

/** 回傳已完成的線（格子索引陣列） */
export function doneLines(card, has) {
  return LINES.filter(l => l.every(i => i === FREE || has(card[i])));
}

/** 依開號順序算出第幾號達成指定線數，未達成回傳 0 */
export function completeAt(card, drawn) {
  const at = new Map(drawn.map((n, i) => [n, i + 1]));
  const ends = LINES.map(l => Math.max(...l.map(i => i === FREE ? 0 : (at.get(card[i]) ?? Infinity)))).sort((x, y) => x - y);
  return Number.isFinite(ends[NEED - 1]) ? ends[NEED - 1] : 0;
}

/** 是否只差一個號碼就達成（聽牌） */
export function isReach(card, set) {
  if (doneLines(card, n => set.has(n)).length >= NEED) return false;
  return card.some((n, i) => i !== FREE && !set.has(n) && doneLines(card, m => m === n || set.has(m)).length >= NEED);
}

/** 彙整所有座位的狀態：joined / reach / unclaimed / won / unbound */
export function seatStats(seats, winners, game) {
  const set = new Set(game?.drawn || []);
  const r = { joined: 0, reach: 0, unclaimed: 0, won: winners.size, byKey: {} };
  for (const [key, seat] of seats) {
    const card = cardOf(key, game?.salt || '');
    let st = 'joined';
    if (winners.has(key)) st = 'won';
    else if (doneLines(card, n => set.has(n)).length >= NEED) { st = 'unclaimed'; r.unclaimed++; }
    else if (isReach(card, set)) { st = 'reach'; r.reach++; }
    if (!seat.uid) st = 'unbound';
    r.joined++;
    r.byKey[key] = st;
  }
  return r;
}

/** 依完成號次分組得獎者 */
export function groupWinners(winners) {
  const g = new Map();
  [...winners].sort(([, a], [, b]) => a.at - b.at || tsOf(a) - tsOf(b)).forEach(([key, w]) => {
    if (!g.has(w.at)) g.set(w.at, []);
    g.get(w.at).push({ key, ...w });
  });
  return [...g];
}

/** Firestore 時間戳轉毫秒，尚未寫入伺服器時視為現在 */
export const tsOf = w => w.ts?.toMillis?.() ?? Date.now();

/** 座位代碼 */
export const seatKey = (t, s) => `${t}-${s}`;

/** 座位代碼轉顯示文字 */
export const label = k => { const [t, n] = k.split('-'); return `${t} 桌 ${n} 號`; };

/** 名單顯示，過長時截斷 */
export const names = (ks, max = 24) => ks.length ? ks.slice(0, max).map(label).join('、') + (ks.length > max ? ` 等 ${ks.length} 人` : '') : '—';

/** 產生隨機代碼（遊戲鹽值、桌號 token） */
export function randomId(len = 8) {
  const abc = 'abcdefghjkmnpqrstuvwxyz23456789', a = crypto.getRandomValues(new Uint8Array(len));
  return [...a].map(x => abc[x % abc.length]).join('');
}
