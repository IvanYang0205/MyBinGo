// 在本機模擬器建立測試用管理員帳號（只作用於模擬器，不會碰到正式專案）
const PROJECT = 'demo-bingo';
const ADMIN = { email: 'admin@bingo.test', password: 'bingo-local-test' };

/** 呼叫模擬器 REST API */
async function call(url, method, body, headers = {}) {
  const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  const json = await r.json();
  if (!r.ok) throw new Error(JSON.stringify(json));
  return json;
}

const authUrl = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts';
let uid;
try {
  uid = (await call(`${authUrl}:signUp?key=demo-key`, 'POST', { ...ADMIN, returnSecureToken: true })).localId;
} catch {
  uid = (await call(`${authUrl}:signInWithPassword?key=demo-key`, 'POST', { ...ADMIN, returnSecureToken: true })).localId;
}
// Bearer owner 可略過安全規則，僅模擬器支援
await call(`http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents/admins/${uid}`, 'PATCH', { fields: {} }, { Authorization: 'Bearer owner' });
console.log(`模擬器管理員已建立：${ADMIN.email}（uid ${uid}）`);
