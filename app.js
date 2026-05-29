import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getFirestore, collection, addDoc, onSnapshot, query, where, doc, deleteDoc, getDocs } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

// Firebase 配置
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
const provider = new GoogleAuthProvider();

// 全域狀態變數
let currentUserUid = null;
let currentUserName = "";
let currentMode = "personal"; // personal 或 group
let activeGroupCode = null;
let currentLoadedRecords = []; // 儲存目前畫面上載入的資料，供刪除與清空使用
let unsubscribe = null;

// 輔助工具：設定元件文字與顯示
const setElText = (id, text) => { const el = document.getElementById(id); if(el) el.innerText = text; };
const showEl = (id, block = true) => { const el = document.getElementById(id); if(el) el.style.display = block ? 'block' : 'none'; };

// 初始化：監聽登入狀態
onAuthStateChanged(auth, (user) => {
    const mainApp = document.getElementById('mainApp');
    if (user) {
        currentUserUid = user.uid;
        currentUserName = user.displayName || "未知使用者";
        setElText('welcomeMsg', `👋 歡迎回來，${currentUserName}！`);
        showEl('loginBtn', false);
        showEl('logoutBtn', true);
        if(mainApp) { mainApp.style.opacity = "1"; mainApp.style.pointerEvents = "auto"; }
        
        // 預設帶入今天日期
        const today = new Date().toISOString().split('T')[0];
        const dateIn = document.getElementById('dateInput');
        if(dateIn && !dateIn.value) dateIn.value = today;

        setupRealtimeListener();
    } else {
        currentUserUid = null;
        currentUserName = "";
        setElText('welcomeMsg', "請先登入以同步您的雲端帳本");
        showEl('loginBtn', true);
        showEl('logoutBtn', false);
        if(mainApp) { mainApp.style.opacity = "0.3"; mainApp.style.pointerEvents = "none"; }
        if(unsubscribe) { unsubscribe(); unsubscribe = null; }
        document.getElementById('historyCollapseContainer').innerHTML = '<p style="text-align:center;color:#8e8e93;">請先登入帳號</p>';
    }
});

// 登入與登出事件
document.getElementById('loginBtn')?.addEventListener('click', () => signInWithPopup(auth, provider).catch(err => alert("登入失敗: " + err.message)));
document.getElementById('logoutBtn')?.addEventListener('click', () => signOut(auth).catch(err => alert("登出失敗: " + err.message)));

// 頁籤切換邏輯
const tabPersonal = document.getElementById('tabPersonal');
const tabGroup = document.getElementById('tabGroup');

tabPersonal?.addEventListener('click', () => {
    currentMode = "personal";
    tabPersonal.classList.add('active');
    tabGroup?.classList.remove('active');
    setElText('currentModeTitle', "新增個人私帳");
    showEl('payerArea', false);
    showEl('groupCodeArea', false);
    setupRealtimeListener();
});

tabGroup?.addEventListener('click', () => {
    currentMode = "group";
    tabGroup.classList.add('active');
    tabPersonal.classList.remove('active');
    setElText('currentModeTitle', "新增群組分帳");
    showEl('payerArea', true);
    showEl('groupCodeArea', true);
    updateGroupUIState();
    setupRealtimeListener();
});

// 群組功能：加入與退出房間
document.getElementById('joinGroupBtn')?.addEventListener('click', () => {
    const code = document.getElementById('groupCodeInput').value.trim().toUpperCase();
    if (!code) { alert('請輸入房號！'); return; }
    activeGroupCode = code;
    localStorage.setItem('activeGroupCode', code);
    updateGroupUIState();
    setupRealtimeListener();
});

document.getElementById('leaveGroupBtn')?.addEventListener('click', () => {
    activeGroupCode = null;
    localStorage.removeItem('activeGroupCode');
    updateGroupUIState();
    setupRealtimeListener();
});

function updateGroupUIState() {
    if (activeGroupCode) {
        setElText('currentGroupTitle', `🏠 目前連線群組房號：${activeGroupCode}`);
        showEl('currentGroupTitle', true);
        showEl('leaveGroupBtn', true);
    } else {
        setElText('currentGroupTitle', "❌ 尚未加入任何群組房間");
        showEl('currentGroupTitle', true);
        showEl('leaveGroupBtn', false);
    }
}

// 核心：儲存資料至 Firebase
const saveBtn = document.getElementById('saveBtn');
if(saveBtn) {
    saveBtn.addEventListener('click', async () => {
        const date = document.getElementById('dateInput').value;
        const item = document.getElementById('itemInput').value.trim();
        const amount = parseFloat(document.getElementById('amountInput').value);
        if (!item || !amount || !date) { alert('請填寫完整的日期、品名與金額！'); return; }
        if (currentMode === 'group' && !activeGroupCode) { alert('請先加入群組房間！'); return; }
        
        saveBtn.innerText = "上傳中...";
        saveBtn.disabled = true;
        
        let newRecord = {
            mode: currentMode,
            date: date,
            item: item,
            amount: amount,
            uid: currentUserUid,
            payerName: currentUserName,
            timestamp: new Date().getTime()
        };
        
        if (currentMode === 'group') {
            newRecord.groupCode = activeGroupCode;
            let customPayer = document.getElementById('payerInput').value.trim();
            newRecord.payer = customPayer ? customPayer : currentUserName;
        }
        
        try {
            await addDoc(collection(db, \"all_ledgers\"), newRecord);
            document.getElementById('itemInput').value = '';
            document.getElementById('amountInput').value = '';
        } catch (err) {
            alert("同步失敗: " + err.message);
        } finally {
            saveBtn.innerText = "儲存至雲端";
            saveBtn.disabled = false;
        }
    });
}

// 核心：即時監聽與三層巢狀表格化渲染
function setupRealtimeListener() {
    if (unsubscribe) { unsubscribe(); unsubscribe = null; }
    if (!currentUserUid) return;

    let q;
    if (currentMode === 'personal') {
        q = query(collection(db, "all_ledgers"), where("uid", "==", currentUserUid), where("mode", "==", "personal"));
    } else {
        if (!activeGroupCode) {
            document.getElementById('historyCollapseContainer').innerHTML = '<p style="text-align:center;color:#8e8e93;">請先輸入群組房號以載入明細</p>';
            setElText('reportCard', "請先加入群組房間。");
            currentLoadedRecords = [];
            return;
        }
        q = query(collection(db, "all_ledgers"), where("groupCode", "==", activeGroupCode), where("mode", "==", "group"));
    }

    unsubscribe = onSnapshot(q, (snapshot) => {
        const records = [];
        let totalSum = 0;
        const payerMap = {};

        snapshot.forEach((doc) => {
            const data = doc.data();
            data.docId = doc.id;
            records.push(data);
            totalSum += data.amount;

            if (currentMode === 'group') {
                const pName = data.payer || data.payerName || "未知";
                payerMap[pName] = (payerMap[pName] || 0) + data.amount;
            }
        });

        currentLoadedRecords = records;

        // 1. 更新統計報告板
        let reportHtml = `<p style="font-size:18px;margin:5px 0;">💰 總計花費：<strong>$${totalSum.toLocaleString()}</strong></p>`;
        if (currentMode === 'group' && Object.keys(payerMap).length > 0) {
            reportHtml += `<hr style="border:0;border-top:1px dashed #c7c7cc;margin:10px 0;"><p style="font-size:13px;color:#666;margin-bottom:4px;">👤 墊款個人統計：</p><ul style="padding-left:18px;margin:0;font-size:14px;">`;
            for (let p in payerMap) {
                reportHtml += `<li>${p} 已先墊款: <strong>$${payerMap[p].toLocaleString()}</strong></li>`;
            }
            reportHtml += `</ul>`;
        }
        const reportCard = document.getElementById('reportCard');
        if(reportCard) reportCard.innerHTML = reportHtml;

        // 2. 建立三層（年->月->日）巢狀折疊明細
        renderNestedHistory(records);
    });
}

// 巢狀渲染核心
function renderNestedHistory(records) {
    const container = document.getElementById('historyCollapseContainer');
    if (!container) return;
    if (records.length === 0) {
        container.innerHTML = '<p style="text-align:center;color:#8e8e93;padding:20px 0;">📭 目前沒有任何消費紀錄</p>';
        return;
    }

    // 依時間由新到舊排序
    records.sort((a, b) => b.date.localeCompare(a.date) || b.timestamp - a.timestamp);

    // 建立群組結構物件
    const tree = {};
    records.forEach(r => {
        const [year, month, day] = r.date.split('-');
        if (!tree[year]) tree[year] = {};
        if (!tree[year][month]) tree[year][month] = {};
        if (!tree[year][month][day]) tree[year][month][day] = [];
        tree[year][month][day].push(r);
    });

    container.innerHTML = "";

    // 第一層：年
    Object.keys(tree).sort((a,b)=>b-a).forEach(year => {
        const yearGroup = document.createElement('div');
        yearGroup.className = 'nested-group';

        let yearTotal = 0;
        Object.keys(tree[year]).forEach(m => Object.keys(tree[year][m]).forEach(d => tree[year][m][d].forEach(r => yearTotal += r.amount)));

        const yearHeader = document.createElement('div');
        yearHeader.className = 'nested-header year-header';
        yearHeader.innerHTML = `<span>📅 ${year} 年</span><span class="nested-total">共 $${yearTotal.toLocaleString()}</span>`;
        
        const yearContent = document.createElement('div');
        yearContent.className = 'nested-content';

        // 第二層：月
        Object.keys(tree[year]).sort((a,b)=>b-a).forEach(month => {
            const monthGroup = document.createElement('div');
            monthGroup.className = 'nested-group';

            let monthTotal = 0;
            Object.keys(tree[year][month]).forEach(d => tree[year][month][d].forEach(r => monthTotal += r.amount));

            const monthHeader = document.createElement('div');
            monthHeader.className = 'nested-header month-header';
            monthHeader.innerHTML = `<span>🌙 ${month} 月</span><span class="nested-total">共 $${monthTotal.toLocaleString()}</span>`;

            const monthContent = document.createElement('div');
            monthContent.className = 'nested-content';

            // 第三層：日
            Object.keys(tree[year][month]).sort((a,b)=>b-a).forEach(day => {
                const dayGroup = document.createElement('div');
                dayGroup.className = 'nested-group';

                const dayRecords = tree[year][month][day];
                let dayTotal = dayRecords.reduce((sum, r) => sum + r.amount, 0);
                const fullDateStr = `${year}-${month}-${day}`;

                const dayHeader = document.createElement('div');
                dayHeader.className = 'nested-header day-header';
                dayHeader.innerHTML = `
                    <div class="date-title-left" onclick="event.stopPropagation();">
                        <input type="checkbox" class="date-group-chk" data-date="${fullDateStr}" onchange="toggleSelectDateGroup('${fullDateStr}', this.checked)">
                        <span>📍 ${day} 日</span>
                    </div>
                    <span class="nested-total">小計 $${dayTotal.toLocaleString()}</span>
                `;

                const dayContent = document.createElement('div');
                dayContent.className = 'nested-content';

                // 🏆 表格化明細清單外殼 🏆
                const ul = document.createElement('ul');
                ul.className = 'item-list';

                // 渲染單日所有消費項目
                dayRecords.forEach(record => {
                    const li = document.createElement('li');
                    li.className = 'item-row';
                    
                    // 💡 重點：將內容完美塞入擁有固定 CSS Flex 表格比例的 class 欄位中
                    li.innerHTML = `
                        <input type="checkbox" class="item-single-chk" data-id="${record.docId}" data-date="${fullDateStr}" onchange="checkSingleStatus('${fullDateStr}')">
                        <div class="col-name">${record.item}</div>
                        <div class="col-payer">
                            ${record.mode === 'group' ? `<span class="item-payer">${record.payer || record.payerName || '成員'}</span>` : ''}
                        </div>
                        <div class="col-amount">$${record.amount.toLocaleString()}</div>
                    `;
                    ul.appendChild(li);
                });

                dayContent.appendChild(ul);
                dayGroup.appendChild(dayHeader);
                dayGroup.appendChild(dayContent);

                // 日折疊事件
                dayHeader.addEventListener('click', () => {
                    const isDisp = dayContent.style.display !== 'none';
                    dayContent.style.display = isDisp ? 'none' : 'block';
                });

                monthContent.appendChild(dayGroup);
            });

            monthGroup.appendChild(monthHeader);
            monthGroup.appendChild(monthContent);

            // 月折疊事件
            monthHeader.addEventListener('click', () => {
                const isDisp = monthContent.style.display !== 'none';
                monthContent.style.display = isDisp ? 'none' : 'block';
            });

            yearContent.appendChild(monthGroup);
        });

        yearGroup.appendChild(yearHeader);
        yearGroup.appendChild(yearContent);

        // 年折疊事件
        yearHeader.addEventListener('click', () => {
            const isDisp = yearContent.style.display !== 'none';
            yearContent.style.display = isDisp ? 'none' : 'block';
        });

        container.appendChild(yearGroup);
    });
}

// 勾選框連動邏輯
window.toggleSelectDateGroup = function(date, isChecked) {
    document.querySelectorAll(`.item-single-chk[data-date="${date}"]`).forEach(chk => chk.checked = isChecked);
};

window.checkSingleStatus = function(date) {
    const totalCount = document.querySelectorAll(`.item-single-chk[data-date="${date}"]`).length;
    const checkedCount = document.querySelectorAll(`.item-single-chk[data-date="${date}"]:checked`).length;
    const groupChk = document.querySelector(`.date-group-chk[data-date="${date}"]`);
    if (groupChk) groupChk.checked = (totalCount === checkedCount);
};

// 批次刪除選中項目
document.getElementById('deleteSelectedBtn')?.addEventListener('click', async () => {
    const checkedBoxes = document.querySelectorAll('.item-single-chk:checked');
    if (checkedBoxes.length === 0) { alert('請先勾選你要刪除的明細項目！'); return; }

    const confirmDelete = confirm(`⚠️ 確定要刪除這 ${checkedBoxes.length} 筆消費紀錄嗎？\n刪除後雲端資料將無法復原！`);
    if (!confirmDelete) return;

    for (let chk of checkedBoxes) {
        const id = chk.getAttribute('data-id');
        try {
            await deleteDoc(doc(db, "all_ledgers", id));
        } catch (err) {
            console.error("刪除失敗 ID: " + id, err);
        }
    }
    alert('🎉 選擇的項目已成功從雲端刪除！');
});

// 清空全部項目
document.getElementById('deleteAllBtn')?.addEventListener('click', async () => {
    if (currentLoadedRecords.length === 0) { alert('目前畫面上沒有任何可以刪除的紀錄。'); return; }

    const firstConfirm = confirm(`🚨 警告！你正在執行【全部清空】功能！\n這將會把你畫面上看得到的這 ${currentLoadedRecords.length} 筆歷史紀錄全數刪除！`);
    if (!firstConfirm) return;

    const secondConfirm = confirm(`🔥 這是最後一次確認！\n你確定真的要把本房內所有雲端同步資料全部清空嗎？此操作不可逆！`);
    if (!secondConfirm) return;

    const btn = document.getElementById('deleteAllBtn');
    btn.innerText = "正在大量銷毀中...";
    btn.disabled = true;

    try {
        for (let record of currentLoadedRecords) {
            await deleteDoc(doc(db, "all_ledgers", record.docId));
        }
        alert('💥 雲端資料庫已全數清空完畢！');
    } catch (err) {
        alert("清空過程中發生錯誤: " + err.message);
    } finally {
        btn.innerText = "⚠️ 全部清空";
        btn.disabled = false;
    }
});