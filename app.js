import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getFirestore, collection, addDoc, onSnapshot, query, where, doc, deleteDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { getAuth, signInWithRedirect, GoogleAuthProvider, signOut, onAuthStateChanged, getRedirectResult, setPersistence, browserLocalPersistence } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

// ... 你的 firebaseConfig 保持原樣 ...

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const provider = new GoogleAuthProvider();

// 💡 提示：讓每一次點擊登入都強制跳出帳號選擇，避免憑證在手機上亂塞
provider.setCustomParameters({ prompt: 'select_account' });

// ----------------------------------------------------
// 🔥 核心重構：處理手機跳轉的初始化流水線
// ----------------------------------------------------
async function initializeAuth() {
    try {
        // 1. 強制設定持久化機制
        await setPersistence(auth, browserLocalPersistence);
        
        // 2. 主動撈取手機跳轉（Redirect）回來的憑證結果
        const result = await getRedirectResult(auth);
        if (result && result.user) {
            console.log("成功捕捉到跳轉登入的用戶:", result.user.displayName);
            handleUserLogin(result.user);
            return; // 捕捉成功就交給處理常式，不重複往下走
        }
    } catch (error) {
        console.error("處理跳轉憑證時發生錯誤 (可能是 403 封鎖返回):", error);
    }

    // 3. 一般載入或狀態變更時的即時監聽
    onAuthStateChanged(auth, (user) => {
        if (user) {
            handleUserLogin(user);
        } else {
            handleUserLogout();
        }
    });
}

// 抽取出來的登入解鎖邏輯
function handleUserLogin(user) {
    currentUserUid = user.uid;
    currentUserName = user.displayName || "使用者";
    document.getElementById('welcomeMsg').innerText = `👋 嗨，${currentUserName}！已透過 Google 連線雲端。`;
    document.getElementById('loginBtn').style.display = "none";
    document.getElementById('logoutBtn').style.display = "block";
    document.getElementById('mainApp').style.opacity = "1";
    document.getElementById('mainApp').style.pointerEvents = "auto";
    switchMode(currentMode);
}

// 抽取出來的登出鎖定邏輯
function handleUserLogout() {
    currentUserUid = null;
    currentUserName = "";
    document.getElementById('welcomeMsg').innerText = "請先登入以同步您的雲端帳本";
    document.getElementById('loginBtn').style.display = "block";
    document.getElementById('logoutBtn').style.display = "none";
    document.getElementById('mainApp').style.opacity = "0.3";
    document.getElementById('mainApp').style.pointerEvents = "none";
    if (unsubscribe) unsubscribe();
}

// 🚀 執行初始化
initializeAuth();

// 登入按鈕事件
document.getElementById('loginBtn').addEventListener('click', async () => {
    try {
        await setPersistence(auth, browserLocalPersistence);
        signInWithRedirect(auth, provider);
    } catch (e) {
        signInWithRedirect(auth, provider);
    }
});

// 登出按鈕事件處理（建議登出後重新導向，清空乾淨）
document.getElementById('logoutBtn').addEventListener('click', () => {
    signOut(auth).then(() => {
        window.location.reload();
    });
});

// ... 後續的頁籤切換、發票掃描及資料庫增刪邏輯完全維持原樣不變 ...