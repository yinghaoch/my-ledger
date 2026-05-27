import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getFirestore, collection, addDoc, onSnapshot, query, where, doc, deleteDoc, getDocs } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getStorage, ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js";

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
const storage = getStorage(app); // 補回您原本的 storage 宣告
const provider = new GoogleAuthProvider();

let currentUserUid = null;
let currentUserName = "";
let currentMode = "personal"; // "personal" 或 "group"
let unsubscribe = null; // 實時監聽取消器
let html5QrcodeScanner = null;
let currentLoadedRecords = [];
let expandedDates = [];

// 群組狀態管理變數
let activeGroupCode = null;
let activeGroupName = "";

document.getElementById('dateInput').value = new Date().toISOString().split('T')[0];

// 監聽登入狀態
onAuthStateChanged(auth, (user) => {
    if (user) {
        currentUserUid = user.uid;
        currentUserName = user.displayName || "匿名使用者";
        document.getElementById('welcomeMsg').innerText = `👋 嗨，${currentUserName}！歡迎回來。`;
        document.getElementById('loginBtn').style.display = "none";
        document.getElementById('logoutBtn').style.display = "block";
        document.getElementById('mainApp').style.opacity = "1";
        document.getElementById('mainApp').style.pointerEvents = "auto";
        switchMode('personal');
    } else {
        currentUserUid = null;
        currentUserName = "";
        document.getElementById('welcomeMsg').innerText = "請先登入以同步您的雲端帳本";
        document.getElementById('loginBtn').style.display = "block";
        document.getElementById('logoutBtn').style.display = "none";
        document.getElementById('mainApp').style.opacity = "0.3";
        document.getElementById('mainApp').style.pointerEvents = "none";
        if (unsubscribe) unsubscribe();
    }
});

// 修正：使用您原本最正常的彈出視窗登入 (signInWithPopup)
document.getElementById('loginBtn').addEventListener('click', () => {
    signInWithPopup(auth, provider)
        .then((result) => {
            console.log("登入成功:", result.user);
        })
        .catch((err) => {
            console.error("登入失敗:", err);
            alert("登入失敗，請稍後再試！原因：" + err.message);
        });
});

document.getElementById('logoutBtn').addEventListener('click', () => {
    signOut(auth).then(() => window.location.reload());
});

// === 📷 QR Code 掃描器 ===
document.getElementById('scanInvoiceBtn').addEventListener('click', () => {
    const readerDiv = document.getElementById('reader');
    if (html5QrcodeScanner && readerDiv.style.display === 'block') { cleanupScanner(); return; }
    readerDiv.style.display = 'block';
    document.getElementById('scanInvoiceBtn').innerText = "🛑 關閉發票掃描器";
    document.getElementById('scanInvoiceBtn').style.background = "#ff3b30";

    try {
        html5QrcodeScanner = new Html5QrcodeScanner("reader", { fps: 10, qrbox: { width: 250, height: 250 }, rememberLastUsedCamera: true }, false);
        html5QrcodeScanner.render((qrCodeMessage) => {
            if (qrCodeMessage.length >= 24) {
                const invNum = qrCodeMessage.substring(0, 10);
                const dateStr = qrCodeMessage.substring(10, 17);
                const hexAmount = qrCodeMessage.substring(21, 29);
                const amount = parseInt(hexAmount, 16);
                const twYear = parseInt(dateStr.substring(0, 3)) + 1911;
                document.getElementById('dateInput').value = `${twYear}-${dateStr.substring(3, 5)}-${dateStr.substring(5, 7)}`;
                document.getElementById('amountInput').value = amount;
                document.getElementById('itemInput').value = `發票：${invNum}`;
                alert(`發票掃描成功！金額：$${amount}`);
                cleanupScanner();
            }
        }, () => {});
    } catch (err) { console.error(err); }
});

function cleanupScanner() {
    const readerDiv = document.getElementById('reader');
    document.getElementById('scanInvoiceBtn').innerText = "📷 掃描發票 QR Code 記帳";
    document.getElementById('scanInvoiceBtn').style.background = "#5856d6";
    if (html5QrcodeScanner) { html5QrcodeScanner.clear().then(() => readerDiv.style.display = 'none').catch(() => readerDiv.style.display = 'none'); }
    else { readerDiv.style.display = 'none'; }
}

// === 🔄 模式與頁籤切換 ===
document.getElementById('tabPersonal').addEventListener('click', () => { expandedDates = []; switchMode('personal'); });
document.getElementById('tabGroup').addEventListener('click', () => { expandedDates = []; switchMode('group'); });

function switchMode(mode) {
    currentMode = mode;
    if (unsubscribe) unsubscribe();
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    
    if (mode === 'personal') {
        document.getElementById('tabPersonal').classList.add('active');
        document.getElementById('groupCodeArea').style.display = "none";
        document.getElementById('payerArea').style.display = "none";
        document.getElementById('currentModeTitle').innerText = "新增個人消費";
        startListeningPersonal();
    } else {
        document.getElementById('tabGroup').classList.add('active');
        document.getElementById('groupCodeArea').style.display = "block";
        document.getElementById('payerArea').style.display = "block";
        document.getElementById('payerInput').placeholder = `留空預設為你自己 (${currentUserName})`;
        document.getElementById('currentModeTitle').innerText = "新增多人群組消費";
        updateGroupUIState();
    }
}

// === 🏠 遊戲開房機制核心演算法 ===

// 1. 建立新群組功能
document.getElementById('createGroupBtn').addEventListener('click', async () => {
    const gName = prompt("請輸入你要建立的「群組名稱」：");
    if (!gName || !gName.trim()) return;

    document.getElementById('createGroupBtn').innerText = "建立中...";
    document.getElementById('createGroupBtn').disabled = true;

    try {
        let code = "";
        let isUnique = false;
        let attempts = 0;

        while (!isUnique && attempts < 10) {
            code = Math.floor(1000 + Math.random() * 9000).toString();
            const q = query(collection(db, "group_rooms"), where("groupCode", "==", code));
            const snap = await getDocs(q);
            if (snap.empty) { isUnique = true; }
            attempts++;
        }

        await addDoc(collection(db, "group_rooms"), {
            groupCode: code,
            groupName: gName.trim(),
            creatorUid: currentUserUid,
            createdAt: new Date().getTime()
        });

        alert(`🎉 群組建立成功！\n群組名稱：${gName}\n群組代號：【 ${code} 】\n快把代號複製分享給朋友吧！`);
        
        activeGroupCode = code;
        activeGroupName = gName.trim();
        document.getElementById('groupCode').value = code;
        updateGroupUIState();

    } catch (err) {
        console.error("建立房間失敗", err);
        alert("建立群組失敗，請重試！");
    } finally {
        document.getElementById('createGroupBtn').innerText = "➕ 建立新群組房間";
        document.getElementById('createGroupBtn').disabled = false;
    }
});

// 2. 輸入代號加入房間功能
document.getElementById('joinGroupBtn').addEventListener('click', async () => {
    const codeInput = document.getElementById('groupCode').value.trim();
    if (codeInput.length !== 4 || isNaN(codeInput)) { alert("請輸入正確的 4 碼數字群組代號！"); return; }

    document.getElementById('joinGroupBtn').innerText = "連線中..";
    
    try {
        const q = query(collection(db, "group_rooms"), where("groupCode", "==", codeInput));
        const snap = await getDocs(q);
        
        if (snap.empty) {
            alert("❌ 找不到此群組代號，請重新確認是否輸入錯誤！");
            document.getElementById('joinGroupBtn').innerText = "加入房間";
            return;
        }

        let targetRoom = snap.docs[0].data();
        activeGroupCode = codeInput;
        activeGroupName = targetRoom.groupName;
        
        alert(`成功進入群組房間：${activeGroupName} (${activeGroupCode})`);
        updateGroupUIState();

    } catch (err) {
        console.error("加入群組失敗", err);
        alert("連線失敗，請檢查網路！");
    } finally {
        document.getElementById('joinGroupBtn').innerText = "加入房間";
    }
});

// 3. 退出當前群組功能
document.getElementById('leaveGroupBtn').addEventListener('click', () => {
    if (!activeGroupCode) return;
    if (confirm(`確定要退出當前群組房間 【${activeGroupName}】 嗎？\n退出後將切斷此畫面與該群組的連線。`)) {
        activeGroupCode = null;
        activeGroupName = "";
        document.getElementById('groupCode').value = "";
        updateGroupUIState();
    }
});

// 4. 動態控制群組 UI 狀態與監聽流切換
function updateGroupUIState() {
    if (unsubscribe) unsubscribe();

    if (activeGroupCode) {
        document.getElementById('currentGroupStatus').innerHTML = `🟢 目前所在群組：<b style="color:#34c759;">${activeGroupName}</b> (代號:${activeGroupCode})`;
        document.getElementById('leaveGroupBtn').style.display = "block";
        startListeningGroup(activeGroupCode, activeGroupName);
    } else {
        document.getElementById('currentGroupStatus').innerText = "❌ 當前狀態：尚未進入任何群組房間";
        document.getElementById('leaveGroupBtn').style.display = "none";
        document.getElementById('reportCard').innerHTML = "<p style='color:#8e8e93;'>🔑 請在上方「輸入4碼代號」加入房間，或點擊「建立新群組」以啟動多人群組分帳。</p>";
        document.getElementById('historyCollapseContainer').innerHTML = "<p style='text-align:center;color:#8e8e93;margin-top:20px;'>等待連線房間中...</p>";
    }
}

// === 💾 資料儲存 (綁定 activeGroupCode 房間鎖) ===
document.getElementById('saveBtn').addEventListener('click', async () => {
    const date = document.getElementById('dateInput').value;
    const item = document.getElementById('itemInput').value.trim();
    const amount = parseFloat(document.getElementById('amountInput').value);

    if (!item || !amount || !date) { alert('請填寫完整的日期、品名與金額！'); return; }
    
    if (currentMode === 'group' && !activeGroupCode) { 
        alert('您尚未加入任何群組房間，請先在上方輸入代號加入或建立新房間！'); 
        return; 
    }

    document.getElementById('saveBtn').innerText = "上傳中...";
    document.getElementById('saveBtn').disabled = true;

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
        await addDoc(collection(db, "all_ledgers"), newRecord);
        document.getElementById('itemInput').value = '';
        document.getElementById('amountInput').value = '';
    } catch (e) {
        alert("儲存失敗！");
    } finally {
        document.getElementById('saveBtn').innerText = "儲存至雲端";
        document.getElementById('saveBtn').disabled = false;
    }
});

// === 📜 渲染歷史明細清單 ===
function renderCollapsedList(snapshot, isPersonal) {
    let totalSpent = 0;
    let records = [];
    let membersSet = new Set();

    snapshot.forEach((doc) => {
        let data = doc.data();
        data.id = doc.id;
        records.push(data);
    });

    records.sort((a, b) => b.timestamp - a.timestamp);
    currentLoadedRecords = records;

    let groupedByDate = {};
    records.forEach(r => {
        totalSpent += r.amount;
        if (!isPersonal) membersSet.add(r.payer || r.payerName);
        if (!groupedByDate[r.date]) groupedByDate[r.date] = { dayTotal: 0, items: [] };
        groupedByDate[r.date].dayTotal += r.amount;
        groupedByDate[r.date].items.push(r);
    });

    const sortedDates = Object.keys(groupedByDate).sort((a, b) => new Date(b) - new Date(a));
    let mainHTML = '';

    sortedDates.forEach((date) => {
        let group = groupedByDate[date];
        const isExpanded = expandedDates.includes(date);
        mainHTML += `
            <div class="date-group" id="group-${date}">
                <div class="date-header" onclick="toggleCollapseVisibility('${date}')">
                    <div class="date-title-left">
                        <input type="checkbox" class="date-group-chk" data-date="${date}" onclick="event.stopPropagation(); toggleSelectDateGroup('${date}', this.checked)">
                        <span>📅 ${date}</span>
                    </div>
                    <div class="date-total-right">
                        <span>當日總計: <b>$${group.dayTotal.toFixed(0)}</b> 元 
                            <span id="arrow-${date}" style="color: #5856d6; font-size:12px; margin-left: 5px;">${isExpanded ? '▲ 收折' : '▼ 展開'}</span>
                        </span>
                    </div>
                </div>
                <ul class="item-list" id="list-${date}" style="display: ${isExpanded ? 'block' : 'none'};">
                    ${group.items.map(item => `
                        <li>
                            <div class="history-item-content">
                                <div class="item-left">
                                    <input type="checkbox" class="item-single-chk" data-id="${item.id}" data-date="${date}" onclick="checkSingleStatus('${date}')">
                                    <div class="item-text-group">
                                        <div class="item-name">${item.item}</div>
                                        <div class="item-info">${isPersonal ? '' : '👤 付款人: ' + (item.payer || item.payerName)}</div>
                                    </div>
                                </div>
                                <div class="item-amount">$${item.amount}</div>
                            </div>
                        </li>
                    `).join('')}
                </ul>
            </div>`;
    });

    document.getElementById('historyCollapseContainer').innerHTML = mainHTML || '<p style="text-align:center;color:#8e8e93;margin-top:20px;">尚無任何記帳紀錄</p>';
    return { totalSpent, records, members: Array.from(membersSet) };
}

window.toggleCollapseVisibility = function(date) {
    const listEl = document.getElementById(`list-${date}`);
    const arrowEl = document.getElementById(`arrow-${date}`);
    if (listEl.style.display === 'none') {
        listEl.style.display = 'block';
        arrowEl.innerText = '▲ 收折';
        if (!expandedDates.includes(date)) expandedDates.push(date);
    } else {
        listEl.style.display = 'none';
        arrowEl.innerText = '▼ 展開';
        expandedDates = expandedDates.filter(d => d !== date);
    }
}

// === 🔄 實時監聽：個人私帳模式 ===
function startListeningPersonal() {
    const q = query(collection(db, "all_ledgers"), where("mode", "==", "personal"), where("uid", "==", currentUserUid));
    unsubscribe = onSnapshot(q, (snapshot) => {
        const { totalSpent } = renderCollapsedList(snapshot, true);
        document.getElementById('reportCard').innerHTML = `
            <p style="font-size:16px; font-weight:bold; color:#007aff; margin:0;">🔒 您個人的累積總消費：</p>
            <h2 style="text-align:left; color:#1c1c1e; margin:10px 0 0 0; font-size:28px;">$${totalSpent.toFixed(0)} <span style="font-size:16px; font-weight:normal; color:#8e8e93;">元</span></h2>
        `;
    });
}

// === 🔄 實時監聽：多人群組模式 ===
function startListeningGroup(targetCode, targetName) {
    const q = query(collection(db, "all_ledgers"), where("mode", "==", "group"), where("groupCode", "==", targetCode));
    unsubscribe = onSnapshot(q, (snapshot) => {
        const { totalSpent, records, members } = renderCollapsedList(snapshot, false);
        
        if (records.length === 0) {
            document.getElementById('reportCard').innerHTML = `
                <p><b>🏠 群組：${targetName} (${targetCode})</b></p>
                <p style="color:#8e8e93; font-size:14px; margin-top:5px;">🎉 連線成功！目前房間內尚無消費紀錄。快去記第一筆帳吧！</p>`;
            return;
        }
        if (members.length <= 1) {
            document.getElementById('reportCard').innerHTML = `
                <p><b>🏠 群組：${targetName} (${targetCode})</b></p>
                <p>當前累積總花費：<b>$${totalSpent.toFixed(0)}</b> 元</p>
                <hr style="border:none; border-top:1px solid #e5e5ea; margin:8px 0;">
                <p style='color:#8e8e93; font-size:13px;'>💡 需有兩位以上成員記帳，系統才會自動啟動精準分帳計算喔！</p>`;
            return;
        }

        let paidValues = {}; members.forEach(m => paidValues[m] = 0);
        records.forEach(r => paidValues[r.payer || r.payerName] += r.amount);
        let avgShare = totalSpent / members.length;
        let balances = members.map(m => ({ name: m, net: paidValues[m] - avgShare }));
        let creditors = balances.filter(b => b.net > 0).sort((a, b) => b.net - a.net);
        let debtors = balances.filter(b => b.net < 0).sort((a, b) => a.net - b.net);

        let reportHTML = `
            <p style="margin:0 0 6px 0;"><b>🏠 當前群組：</b> <span style="color:#5856d6;font-weight:bold;">${targetName} (${targetCode})</span></p>
            <p style="margin:0 0 6px 0;"><b>💰 總計消費：</b> <b>$${totalSpent.toFixed(0)}</b> 元</p>
            <p style="margin:0 0 10px 0;"><b>均分開銷：</b> 每人應分擔 <b>$${avgShare.toFixed(0)}</b> 元</p>
            <hr style="border:none; border-top:1px solid #e5e5ea; margin:10px 0;">
            <p style="font-weight:bold; margin:0 0 6px 0; color:#34c759;">📊 最佳化清算方案：</p>
        `;

        let settleLines = []; let i = 0, j = 0;
        while (i < debtors.length && j < creditors.length) {
            let debtor = debtors[i]; let creditor = creditors[j];
            let amountToPay = Math.min(Math.abs(debtor.net), creditor.net);
            if (amountToPay > 0.1) {
                settleLines.push(`<div style="margin-top:5px; font-size:14px;">❌ <b>${debtor.name}</b> 應給 <b>${creditor.name}</b>：<b style="color:#ff3b30;">$${amountToPay.toFixed(0)}</b> 元</div>`);
            }
            debtor.net += amountToPay; creditor.net -= amountToPay;
            if (Math.abs(debtor.net) < 0.1) i++; if (creditor.net < 0.1) j++;
        }
        document.getElementById('reportCard').innerHTML = reportHTML + (settleLines.length ? settleLines.join('') : "<div style='color:#34c759;font-weight:bold;'>🎉 帳目皆清，互相不欠錢！</div>");
    });
}

// === 複選框與項目刪除清空邏輯 ===
window.toggleSelectDateGroup = function(date, isChecked) { document.querySelectorAll(`.item-single-chk[data-date="${date}"]`).forEach(chk => chk.checked = isChecked); }
window.checkSingleStatus = function(date) {
    const totalCount = document.querySelectorAll(`.item-single-chk[data-date="${date}"]`).length;
    const checkedCount = document.querySelectorAll(`.item-single-chk[data-date="${date}"]:checked`).length;
    const groupChk = document.querySelector(`.date-group-chk[data-date="${date}"]`);
    if (groupChk) groupChk.checked = (totalCount === checkedCount);
}
document.getElementById('deleteSelectedBtn').addEventListener('click', async () => {
    const checkedBoxes = document.querySelectorAll('.item-single-chk:checked');
    if (checkedBoxes.length === 0) { alert('請先勾選項目！'); return; }
    if (!confirm(`⚠️ 確定要刪除這 ${checkedBoxes.length} 筆消費紀錄嗎？`)) return;
    for (let chk of checkedBoxes) { try { await deleteDoc(doc(db, "all_ledgers", chk.getAttribute('data-id'))); } catch (err) { console.error(err); } }
    alert('🎉 選擇的項目已成功從雲端刪除！');
});
document.getElementById('deleteAllBtn').addEventListener('click', async () => {
    if (currentLoadedRecords.length === 0) { alert('目前沒有紀錄。'); return; }
    if (!confirm(`🚨 警告！你正在執行【全部清空】功能！\n這將徹底清除目前畫面顯示的全部 ${currentLoadedRecords.length} 筆資料！`)) return;
    for (let record of currentLoadedRecords) { try { await deleteDoc(doc(db, "all_ledgers", record.id)); } catch (err) { console.error(err); } }
    alert('💥 所有顯示帳目已徹底清空！');
});