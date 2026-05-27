import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getFirestore, collection, addDoc, onSnapshot, query, where, doc, deleteDoc, getDocs } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js";

const firebaseConfig = {
    apiKey: "AIzaSyBMYdklxkNrpAiBCQsk6qvRZZ4A2fOcRVw",
    authDomain: "my-ledger-app-99f5e.firebaseapp.com",
    projectId: "my-ledger-app-99f5e",
    storageBucket: "my-ledger-app-99f5e.firebasestorage.app",
    messagingSenderId: "529103980359",
    appId: "1:529103980359:web:8907d4d53012f9a6616e62"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const storage = getStorage(app);
const provider = new GoogleAuthProvider();

let currentUserUid = null;
let currentUserName = "";
let currentMode = "personal";
let unsubscribe = null;
let html5QrcodeScanner = null;
let currentLoadedRecords = [];
let expandedDates = [];

let activeGroupCode = null;
let activeGroupName = "";

// 輔助函式：安全設置元素屬性，防止 null 崩潰
function setElStyle(id, prop, val) { const el = document.getElementById(id); if(el) el.style[prop] = val; }
function setElText(id, text) { const el = document.getElementById(id); if(el) el.innerText = text; }
function setElHtml(id, html) { const el = document.getElementById(id); if(el) el.innerHTML = html; }

// 初始化日期
const dateInput = document.getElementById('dateInput');
if(dateInput) dateInput.value = new Date().toISOString().split('T')[0];

// 監聽登入狀態
onAuthStateChanged(auth, (user) => {
    if (user) {
        currentUserUid = user.uid;
        currentUserName = user.displayName || "匿名使用者";
        setElText('welcomeMsg', `👋 嗨，${currentUserName}！歡迎回來。`);
        setElStyle('loginBtn', 'display', 'none');
        setElStyle('logoutBtn', 'display', 'block');
        setElStyle('mainApp', 'opacity', '1');
        setElStyle('mainApp', 'pointerEvents', 'auto');
        switchMode('personal');
    } else {
        currentUserUid = null;
        currentUserName = "";
        setElText('welcomeMsg', "請先登入以同步您的雲端帳本");
        setElStyle('loginBtn', 'display', 'block');
        setElStyle('logoutBtn', 'display', 'none');
        setElStyle('mainApp', 'opacity', '0.3');
        setElStyle('mainApp', 'pointerEvents', 'none');
        if (unsubscribe) unsubscribe();
    }
});

// Google 彈出視窗登入
const loginBtn = document.getElementById('loginBtn');
if(loginBtn) {
    loginBtn.addEventListener('click', () => {
        signInWithPopup(auth, provider)
            .then((result) => console.log("登入成功:", result.user))
            .catch((err) => alert("登入失敗：" + err.message));
    });
}

const logoutBtn = document.getElementById('logoutBtn');
if(logoutBtn) {
    logoutBtn.addEventListener('click', () => {
        signOut(auth).then(() => window.location.reload());
    });
}

// === 切換頁籤模式 ===
function switchMode(mode) {
    currentMode = mode;
    if (unsubscribe) unsubscribe();
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    
    if (mode === 'personal') {
        const tabP = document.getElementById('tabPersonal'); if(tabP) tabP.classList.add('active');
        setElStyle('groupCodeArea', 'display', 'none');
        setElStyle('payerArea', 'display', 'none');
        setElText('currentModeTitle', "新增個人消費");
        if (typeof startListeningPersonal === "function") startListeningPersonal();
    } else {
        const tabG = document.getElementById('tabGroup'); if(tabG) tabG.classList.add('active');
        setElStyle('groupCodeArea', 'display', 'block');
        setElStyle('payerArea', 'display', 'block');
        const pInput = document.getElementById('payerInput');
        if(pInput) pInput.placeholder = `留空預設為你自己 (${currentUserName})`;
        setElText('currentModeTitle', "新增多人群組消費");
        updateGroupUIState();
    }
}

const tabPersonal = document.getElementById('tabPersonal');
if(tabPersonal) tabPersonal.addEventListener('click', () => { expandedDates = []; switchMode('personal'); });

const tabGroup = document.getElementById('tabGroup');
if(tabGroup) tabGroup.addEventListener('click', () => { expandedDates = []; switchMode('group'); });

// === 房間連線 UI 狀態 ===
function updateGroupUIState() {
    if (unsubscribe) unsubscribe();
    if (activeGroupCode) {
        setElHtml('currentGroupStatus', `🟢 目前所在群組：<b style="color:#34c759;">${activeGroupName}</b> (代號:${activeGroupCode})`);
        setElStyle('leaveGroupBtn', 'display', 'block');
        if (typeof startListeningGroup === "function") startListeningGroup(activeGroupCode, activeGroupName);
    } else {
        setElText('currentGroupStatus', "❌ 當前狀態：尚未進入任何群組房間");
        setElStyle('leaveGroupBtn', 'display', 'none');
        setElHtml('reportCard', "<p style='color:#8e8e93;'>🔑 請在上方「輸入4碼代號」加入房間，或點擊「建立新群組」以啟動多人群組分帳。</p>");
        setElHtml('historyCollapseContainer', "<p style='text-align:center;color:#8e8e93;margin-top:20px;'>等待連線房間中...</p>");
    }
}

// 建立群組
const createGroupBtn = document.getElementById('createGroupBtn');
if(createGroupBtn) {
    createGroupBtn.addEventListener('click', async () => {
        const gName = prompt("請輸入你要建立的「群組名稱」：");
        if (!gName || !gName.trim()) return;
        setElText('createGroupBtn', "建立中...");
        createGroupBtn.disabled = true;
        try {
            let code = ""; let isUnique = false; let attempts = 0;
            while (!isUnique && attempts < 10) {
                code = Math.floor(1000 + Math.random() * 9000).toString();
                const q = query(collection(db, "group_rooms"), where("groupCode", "==", code));
                const snap = await getDocs(q);
                if (snap.empty) isUnique = true;
                attempts++;
            }
            await addDoc(collection(db, "group_rooms"), {
                groupCode: code, groupName: gName.trim(), creatorUid: currentUserUid, createdAt: new Date().getTime()
            });
            alert(`🎉 群組建立成功！\n群組名稱：${gName}\n群組代號：【 ${code} 】`);
            activeGroupCode = code; activeGroupName = gName.trim();
            const gCodeIn = document.getElementById('groupCode'); if(gCodeIn) gCodeIn.value = code;
            updateGroupUIState();
        } catch (err) { alert("建立群組失敗！"); }
        finally { setElText('createGroupBtn', "➕ 建立新群組房間"); createGroupBtn.disabled = false; }
    });
}

// 加入群組
const joinGroupBtn = document.getElementById('joinGroupBtn');
if(joinGroupBtn) {
    joinGroupBtn.addEventListener('click', async () => {
        const gCodeIn = document.getElementById('groupCode');
        const codeInput = gCodeIn ? gCodeIn.value.trim() : "";
        if (codeInput.length !== 4 || isNaN(codeInput)) { alert("請輸入正確的 4 碼數字群組代號！"); return; }
        setElText('joinGroupBtn', "連線中..");
        try {
            const q = query(collection(db, "group_rooms"), where("groupCode", "==", codeInput));
            const snap = await getDocs(q);
            if (snap.empty) { alert("❌ 找不到此群組代號！"); return; }
            let targetRoom = snap.docs[0].data();
            activeGroupCode = codeInput; activeGroupName = targetRoom.groupName;
            alert(`成功進入群組房間：${activeGroupName}`);
            updateGroupUIState();
        } catch (err) { alert("連線失敗！"); }
        finally { setElText('joinGroupBtn', "加入房間"); }
    });
}

// 離開群組
const leaveGroupBtn = document.getElementById('leaveGroupBtn');
if(leaveGroupBtn) {
    leaveGroupBtn.addEventListener('click', () => {
        if (!activeGroupCode) return;
        if (confirm(`確定要退出當前群組房間 【${activeGroupName}】 嗎？`)) {
            activeGroupCode = null; activeGroupName = "";
            const gCodeIn = document.getElementById('groupCode'); if(gCodeIn) gCodeIn.value = "";
            updateGroupUIState();
        }
    });
}

// 儲存資料
const saveBtn = document.getElementById('saveBtn');
if(saveBtn) {
    saveBtn.addEventListener('click', async () => {
        const date = document.getElementById('dateInput').value;
        const item = document.getElementById('itemInput').value.trim();
        const amount = parseFloat(document.getElementById('amountInput').value);
        if (!item || !amount || !date) { alert('請填寫完整的日期、品名與金額！'); return; }
        if (currentMode === 'group' && !activeGroupCode) { alert('請先加入群組房間！'); return; }
        
        setElText('saveBtn', "上傳中...");
        saveBtn.disabled = true;
        let newRecord = { mode: currentMode, date: date, item: item, amount: amount, uid: currentUserUid, payerName: currentUserName, timestamp: new Date().getTime() };
        if (currentMode === 'group') {
            newRecord.groupCode = activeGroupCode;
            let customPayer = document.getElementById('payerInput').value.trim();
            newRecord.payer = customPayer ? customPayer : currentUserName;
        }
        try {
            await addDoc(collection(db, "all_ledgers"), newRecord);
            document.getElementById('itemInput').value = '';
            document.getElementById('amountInput').value = '';
        } catch (e) { alert("儲存失敗！"); }
        finally { setElText('saveBtn', "儲存至雲端"); saveBtn.disabled = false; }
    });
}

