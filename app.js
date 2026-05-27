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

// 輔助函式
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

// 登入登出事件
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
        const tabP = document.getElementById('tabPersonal');
        if(tabP) tabP.classList.add('active');
        setElStyle('groupCodeArea', 'display', 'none');
        setElStyle('payerArea', 'display', 'none');
        setElText('currentModeTitle', "新增個人消費");
        // 💡 修正：對應正確的函式名稱 startListenPersonal
        if (typeof startListenPersonal === "function") startListenPersonal();
    } else {
        const tabG = document.getElementById('tabGroup');
        if(tabG) tabG.classList.add('active');
        setElStyle('groupCodeArea', 'display', 'block');
        setElStyle('payerArea', 'display', 'block');
        const pInput = document.getElementById('payerInput');
        if(pInput) pInput.placeholder = `留空預設為你自己 (${currentUserName})`;
        setElText('currentModeTitle', "新增多人群組消費");
        updateGroupUIState();
    }
}

const tabPersonal = document.getElementById('tabPersonal');
if(tabPersonal) tabPersonal.addEventListener('click', () => switchMode('personal'));

const tabGroup = document.getElementById('tabGroup');
if(tabGroup) tabGroup.addEventListener('click', () => switchMode('group'));

// === 個人監聽邏輯 ===
function startListenPersonal() {
    setElHtml('historyCollapseContainer', '<p style="text-align: center; color: #8e8e93; margin-top: 20px;">載入個人明細中...</p>');
    const q = query(collection(db, "all_ledgers"), where("uid", "==", currentUserUid), where("mode", "==", "personal"));
    unsubscribe = onSnapshot(q, (snapshot) => {
        currentLoadedRecords = [];
        snapshot.forEach(doc => {
            currentLoadedRecords.push({ id: doc.id, ...doc.data() });
        });
        currentLoadedRecords.sort((a, b) => b.date.localeCompare(a.date) || b.timestamp - a.timestamp);
        renderHistoryAndReport();
    }, (error) => {
        console.error("監聽個人帳本失敗:", error);
    });
}

// === 群組監聽邏輯 ===
function startListenGroup() {
    if (!activeGroupCode) {
        setElHtml('historyCollapseContainer', '<p style="text-align: center; color: #8e8e93; margin-top: 20px;">請先加入或建立群組房間</p>');
        setElHtml('reportCard', '<p>尚未加入群組房間</p>');
        return;
    }
    setElHtml('historyCollapseContainer', '<p style="text-align: center; color: #8e8e93; margin-top: 20px;">載入群組明細中...</p>');
    const q = query(collection(db, "all_ledgers"), where("groupCode", "==", activeGroupCode), where("mode", "==", "group"));
    unsubscribe = onSnapshot(q, (snapshot) => {
        currentLoadedRecords = [];
        snapshot.forEach(doc => {
            currentLoadedRecords.push({ id: doc.id, ...doc.data() });
        });
        currentLoadedRecords.sort((a, b) => b.date.localeCompare(a.date) || b.timestamp - a.timestamp);
        renderHistoryAndReport();
    }, (error) => {
        console.error("監聽群組失敗:", error);
    });
}

// === 更新群組 UI 狀態 ===
function updateGroupUIState() {
    if (activeGroupCode) {
        setElText('currentGroupStatus', `當前房間代號：【${activeGroupCode}】`);
        setElStyle('leaveGroupBtn', 'display', 'block');
        const gIn = document.getElementById('groupCode');
        if(gIn) gIn.disabled = true;
        // 💡 修正：對應正確的函式名稱 startListenGroup
        if (typeof startListenGroup === "function") startListenGroup();
    } else {
        setElText('currentGroupStatus', "當前狀態：尚未進入任何群組房間");
        setElStyle('leaveGroupBtn', 'display', 'none');
        const gIn = document.getElementById('groupCode');
        if(gIn) { gIn.disabled = false; gIn.value = ""; }
        if (currentMode === 'group') {
            // 💡 修正：對應正確的函式名稱 startListenGroup
            if (typeof startListenGroup === "function") startListenGroup();
        }
    }
}

// 加入與建立群組房間事件
const joinGroupBtn = document.getElementById('joinGroupBtn');
if(joinGroupBtn) {
    joinGroupBtn.addEventListener('click', () => {
        const code = document.getElementById('groupCode').value.trim().toUpperCase();
        if (code.length !== 4) { alert('請輸入完整的 4 碼房間代碼！'); return; }
        activeGroupCode = code;
        updateGroupUIState();
    });
}

const createGroupBtn = document.getElementById('createGroupBtn');
if(createGroupBtn) {
    createGroupBtn.addEventListener('click', () => {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        let code = '';
        for (let i = 0; i < 4; i++) {
            code += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        activeGroupCode = code;
        const gCodeIn = document.getElementById('groupCode');
        if(gCodeIn) gCodeIn.value = code;
        alert(`🎉 成功建立群組房間！房間代號為：【${code}】\n請將代號分享給朋友，即可同步記帳！`);
        updateGroupUIState();
    });
}

const leaveGroupBtn = document.getElementById('leaveGroupBtn');
if(leaveGroupBtn) {
    leaveGroupBtn.addEventListener('click', () => {
        if (confirm('🚪 確定要退出當前群組房間嗎？')) {
            activeGroupCode = null;
            const gCodeIn = document.getElementById('groupCode');
            if(gCodeIn) gCodeIn.value = "";
            updateGroupUIState();
        }
    });
}

// === 儲存資料 ===
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
            await addDoc(collection(db, \"all_ledgers\"), newRecord);
            document.getElementById('itemInput').value = '';
            document.getElementById('amountInput').value = '';
        } catch (error) {
            console.error("儲存失敗:", error);
            alert("儲存失敗，請檢查網路連線或 Firebase 權限！");
        } finally {
            setElText('saveBtn', "儲存至雲端");
            saveBtn.disabled = false;
        }
    });
}

// === 歷史與統計渲染 ===
function renderHistoryAndReport() {
    if (currentLoadedRecords.length === 0) {
        setElHtml('historyCollapseContainer', '<p style="text-align: center; color: #8e8e93; margin-top: 20px;">目前尚無消費紀錄</p>');
        setElHtml('reportCard', '<p>💰 目前無任何消費，總金額為 $0 元。</p>');
        return;
    }

    // 統計計算
    let totalSum = 0;
    let memberMap = {};
    let groupsByDate = {};

    currentLoadedRecords.forEach(r => {
        totalSum += r.amount;
        if (currentMode === 'group') {
            let pName = r.payer || r.payerName || "未知使用者";
            memberMap[pName] = (memberMap[pName] || 0) + r.amount;
        }
        if (!groupsByDate[r.date]) groupsByDate[r.date] = [];
        groupsByDate[r.date].push(r);
    });

    // 渲染統計區
    if (currentMode === 'personal') {
        setElHtml('reportCard', `<p style="font-size: 16px; margin: 5px 0;">個人私帳總消費：<strong style="color:#007aff; font-size:20px;">$${totalSum}</strong> 元</p>`);
    } else {
        let members = Object.keys(memberMap);
        let count = members.length;
        let avg = count > 0 ? Math.round(totalSum / count) : 0;
        let reportHtml = `<p style="font-size: 15px; margin-bottom: 10px;">👥 群組總消費：<strong style="color:#5856d6; font-size:18px;">$${totalSum}</strong> 元（平分人數：${count} 人，人均：$${avg} 元）</p><hr style="border:0; border-top:1px solid #e5e5ea; margin: 10px 0;">`;
        members.forEach(m => {
            let diff = memberMap[m] - avg;
            let statusStr = diff >= 0 ? `<span style="color:#34c759;">應拿回 $${Math.abs(diff)}</span>` : `<span style="color:#ff3b30;">應補分 $${Math.abs(diff)}</span>`;
            reportHtml += `<p style="font-size: 14px; margin: 6px 0;">🔹 <strong>${m}</strong>：共墊了 $${memberMap[m]} 元 (${statusStr})</p>`;
        });
        setElHtml('reportCard', reportHtml);
    }

    // 渲染歷史列表（折疊面板）
    let html = '';
    Object.keys(groupsByDate).forEach(date => {
        let records = groupsByDate[date];
        let dayTotal = records.reduce((sum, r) => sum + r.amount, 0);
        let isExpanded = expandedDates.includes(date);
        let arrow = isExpanded ? '▼' : '▶';
        let displayStyle = isExpanded ? 'block' : 'none';

        html += `
        <div class="date-group">
            <div class="date-header" onclick="toggleDateGroup('${date}')">
                <div class="date-title-left">
                    <input type="checkbox" class="date-group-chk" data-date="${date}" onclick="event.stopPropagation(); toggleSelectDateGroup('${date}', this.checked)">
                    <span>${arrow} ${date}</span>
                </div>
                <div class="date-total-right">當日總計: $${dayTotal}</div>
            </div>
            <ul class="item-list" id="list-${date}" style="display: ${displayStyle};">
        `;

        records.forEach(r => {
            let detailStr = currentMode === 'group' ? `<span class="item-payer">${r.payer || r.payerName || "未知"} 墊</span>` : '';
            html += `
                <li>
                    <div class="item-left-content">
                        <input type="checkbox" class="item-single-chk" data-id="${r.id}" data-date="${date}" onclick="event.stopPropagation(); checkSingleStatus('${date}')">
                        <span class="item-name">${r.item}</span>
                        ${detailStr}
                    </div>
                    <span class="item-amount">$${r.amount}</span>
                </li>
            `;
        });

        html += `</ul></div>`;
    });

    setElHtml('historyCollapseContainer', html);
}

// 掛載全域折疊控制
window.toggleDateGroup = function(date) {
    const idx = expandedDates.indexOf(date);
    if (idx > -1) expandedDates.splice(idx, 1);
    else expandedDates.push(date);
    renderHistoryAndReport();
}

window.toggleSelectDateGroup = function(date, isChecked) {
    document.querySelectorAll(`.item-single-chk[data-date="\${date}"]`).forEach(chk => chk.checked = isChecked);
}

window.checkSingleStatus = function(date) {
    const totalCount = document.querySelectorAll(`.item-single-chk[data-date="\${date}"]`).length;
    const checkedCount = document.querySelectorAll(`.item-single-chk[data-date="\${date}"]:checked`).length;
    const groupChk = document.querySelector(`.date-group-chk[data-date="\${date}"]`);
    if (groupChk) groupChk.checked = (totalCount === checkedCount);
}

// 刪除選中
document.getElementById('deleteSelectedBtn').addEventListener('click', async () => {
    const checkedBoxes = document.querySelectorAll('.item-single-chk:checked');
    if (checkedBoxes.length === 0) { alert('請先勾選項目！'); return; }
    if (!confirm(`⚠️ 確定要刪除這 \${checkedBoxes.length} 筆消費紀錄嗎？`)) return;
    for (let chk of checkedBoxes) {
        try { await deleteDoc(doc(db, "all_ledgers", chk.getAttribute('data-id'))); }
        catch (err) { console.error(err); }
    }
    alert('🎉 選擇的項目已成功從雲端刪除！');
});

// 清空全部
document.getElementById('deleteAllBtn').addEventListener('click', async () => {
    if (currentLoadedRecords.length === 0) { alert('目前沒有紀錄。'); return; }
    if (!confirm(`🚨 警告！你正在執行【全部清空】功能！\n這將會把你畫面上看得到的這 \${currentLoadedRecords.length} 筆明細，通通從雲端資料庫徹底刪除！\n\n確定要繼續嗎？`)) return;
    const secondaryConfirm = confirm(`🔥 最後確認：真的要全部清空雲端帳本資料嗎？此動作無法復原！`);
    if (!secondaryConfirm) return;

    for (let r of currentLoadedRecords) {
        try { await deleteDoc(doc(db, "all_ledgers", r.id)); }
        catch (err) { console.error("刪除失敗 ID: " + r.id, err); }
    }
    alert('🎉 雲端帳本已全部清空！');
});

// === 📷 掃描發票 QR Code ===
let isScanning = false;
const scanInvoiceBtn = document.getElementById('scanInvoiceBtn');
if (scanInvoiceBtn) {
    scanInvoiceBtn.addEventListener('click', () => {
        if (!isScanning) {
            setElStyle('reader', 'display', 'block');
            setElText('scanInvoiceBtn', '❌ 關閉相機');
            isScanning = true;
            
            html5QrcodeScanner = new Html5QrcodeScanner("reader", { fps: 10, qrbox: 250 }, false);
            html5QrcodeScanner.render((decodedText) => {
                console.log("掃描成功文字:", decodedText);
                parseInvoiceQRCode(decodedText);
                stopScan();
            }, (err) => { /* 忽略高頻偵測錯誤 */ });
        } else {
            stopScan();
        }
    });
}

function stopScan() {
    if (html5QrcodeScanner) {
        html5QrcodeScanner.clear().then(() => {
            setElStyle('reader', 'display', 'none');
            setElText('scanInvoiceBtn', '📷 掃描發票 QR Code 記帳');
            isScanning = false;
        }).catch(err => console.error("關閉相機失敗", err));
    }
}

function parseInvoiceQRCode(text) {
    try {
        if (text.length >= 77) {
            const dateYear = text.substring(10, 13);
            const dateMonth = text.substring(13, 15);
            const dateDay = text.substring(15, 17);
            const fullYear = parseInt(dateYear) + 1911;
            const formattedDate = `\${fullYear}-\${dateMonth}-\${dateDay}`;
            
            const hexAmount = text.substring(29, 37);
            const amount = parseInt(hexAmount, 16);
            
            if (formattedDate && !isNaN(amount)) {
                const dateInputEl = document.getElementById('dateInput');
                if(dateInputEl) dateInputEl.value = formattedDate;
                const amountInputEl = document.getElementById('amountInput');
                if(amountInputEl) amountInputEl.value = amount;
                const itemInputEl = document.getElementById('itemInput');
                if(itemInputEl) itemInputEl.value = "發票 QR 掃描入帳";
                alert(`🎉 成功解析電子發票！\n日期：\${formattedDate}\n金額：$\${amount} 元\n請記得確認品名後點擊儲存！`);
            } else {
                alert("⚠️ 雖然符合電子發票長度，但無法正確解析出日期與金額。");
            }
        } else {
            alert("⚠️ 此條碼不符合台灣標準電子發票左側 QR Code 的格式或長度！");
        }
    } catch (e) {
        alert("❌ 解析發票發生未知錯誤：" + e.message);
    }
}