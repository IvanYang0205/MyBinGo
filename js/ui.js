// 共用的提示與確認視窗
let toastTimer;

/** 顯示短暫提示 */
export function toast(msg) {
  let t = document.getElementById('toast');
  if (!t) {
    t = Object.assign(document.createElement('div'), { id: 'toast', className: 'toast' });
    t.setAttribute('role', 'status');
    document.body.append(t);
  }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2400);
}

/** 頁內確認視窗（部分 App 內建瀏覽器會擋 confirm），回傳是否確定 */
export function ask(msg) {
  let m = document.getElementById('modal');
  if (!m) {
    m = Object.assign(document.createElement('div'), { id: 'modal', className: 'modal' });
    m.innerHTML = `<div class="dlg" role="dialog" aria-modal="true" aria-labelledby="modalMsg"><p id="modalMsg"></p>
      <div class="dlg-actions"><button class="btn" id="modalNo">取消</button><button class="btn primary" id="modalYes">確定</button></div></div>`;
    document.body.append(m);
  }
  m.querySelector('#modalMsg').textContent = msg;
  m.hidden = false;
  m.querySelector('#modalYes').focus();
  return new Promise(res => {
    const done = ok => { m.hidden = true; m.onclick = null; res(ok); };
    m.onclick = e => {
      if (e.target.id === 'modalYes') done(true);
      else if (e.target.id === 'modalNo' || e.target === m) done(false);
    };
  });
}

/** 渲染時保留正在輸入的欄位值與焦點 */
export function renderKeepingInput(el, html) {
  const f = document.activeElement, keep = f?.id && f.tagName === 'INPUT' ? { id: f.id, v: f.value } : null;
  el.innerHTML = html;
  if (keep) { const i = document.getElementById(keep.id); if (i) { i.value = keep.v; i.focus(); } }
}
