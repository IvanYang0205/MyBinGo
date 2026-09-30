import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import {
  getAuth, connectAuthEmulator, onAuthStateChanged, signInAnonymously,
  setPersistence, browserSessionPersistence
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import { getFirestore, connectFirestoreEmulator } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';

export {
  signInWithEmailAndPassword, signOut, onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
export {
  doc, collection, query, where, getDoc, getDocs, setDoc, updateDoc, deleteDoc, onSnapshot,
  writeBatch, runTransaction, arrayUnion, arrayRemove, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';

// 在本機開啟時連到 Firebase 模擬器，不會動到正式資料
export const isLocal = ['localhost', '127.0.0.1'].includes(location.hostname);
const config = isLocal ? { apiKey: 'demo-key', authDomain: 'demo-bingo.firebaseapp.com', projectId: 'demo-bingo' } : firebaseConfig;

if (!config.projectId) {
  document.body.innerHTML = '<p style="padding:24px;font-family:sans-serif">尚未設定 Firebase：請填寫 js/firebase-config.js。</p>';
  throw new Error('firebase-config.js 未設定');
}

/** 建立 Firebase 連線；後台用獨立名稱，避免與同瀏覽器的賓客匿名登入互相覆蓋 */
export function connect(name) {
  const app = initializeApp(config, name);
  const auth = getAuth(app), db = getFirestore(app);
  if (isLocal) {
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    connectFirestoreEmulator(db, '127.0.0.1', 8080);
  }
  return { auth, db };
}

/** 等待登入狀態確定後回傳使用者（可能為 null） */
export function currentUser(auth) {
  return new Promise(res => { const off = onAuthStateChanged(auth, u => { off(); res(u); }); });
}

/** 確保已登入，沒有就匿名登入；本機測試時每個分頁視為一支手機 */
export async function ensureUser(auth) {
  if (isLocal) await setPersistence(auth, browserSessionPersistence);
  return (await currentUser(auth)) || (await signInAnonymously(auth)).user;
}
