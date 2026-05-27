import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getFirestore, collection, addDoc, onSnapshot, query, where, doc, deleteDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { getAuth, signInWithRedirect, GoogleAuthProvider, signOut, onAuthStateChanged, getRedirectResult } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

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

// 解決跨網域跳轉的關鍵：設定 Custom Parameters
provider.setCustomParameters({ prompt: 'select_account' });

let currentUserUid = null;
let currentUserName = "";
let currentMode = "personal";
let unsubscribe = null;
let html5QrcodeScanner = null;
let currentLoadedRecords = [];
let expandedDates = [];

// 初始化填入今日日期
document.getElementById('dateInput').value = new Date().toISOString().split('T')[0];

// === 修正：主動且非阻塞地捕捉手機/電腦 Redirect 跳轉結果 ===
getRedirectResult(auth)
    .then((result) => {
        if (result && result.user) {
            console.log("跳轉登入成功:", result.user.displayName);
        }
    })
    .catch((error) => {
        console.error("跳轉認證發生錯誤:", error);
    });

// === 核心監聽：只要這個沒被阻塞，電腦與手機就絕對能正常顯示登入狀態 ===
onAuthStateChanged(auth, (user) => {
    if (user) {
        currentUserUid = user.uid;
        currentUserName = user.displayName || "使用者";
        document.getElementById('welcomeMsg').innerText = `👋 嗨，${currentUserName}！已連線雲端。`;
        document.getElementById('loginBtn').style.display = "none";
        document.getElementById('logoutBtn').style.display = "block";
        document.getElementById('mainApp').style.opacity = "1";
        document.getElementById('mainApp').style.pointerEvents = "auto";
        switchMode(currentMode);
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

// 點擊登入：回歸最純粹的官方跳轉，不再預先執行可能死鎖的 Persistence
document.getElementById('loginBtn').addEventListener('click', () => {
    signInWithRedirect(auth, provider);
});

document.getElementById('logoutBtn').addEventListener('click', () => {
    signOut(auth).then(() => {
        window.location.reload(); // 登出後強制刷新，乾淨清空暫存
    });
});

// 頁籤切換
document.getElementById('tabPersonal').addEventListener('click', () => { expandedDates = []; switchMode('personal'); });
document.getElementById('tabGroup').addEventListener('click', () => { expandedDates = []; switchMode('group'); });

document.getElementById('groupCode').addEventListener('input', () => { if (currentMode === 'group') triggerGroupSync(); });
document.getElementById('groupPassword').addEventListener('input', () => { if (currentMode === 'group') triggerGroupSync(); });

function switchMode(mode) {
    currentMode = mode;
    if (unsubscribe) unsubscribe();
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    
    if (mode === 'personal') {
        document.getElementById('tabPersonal').classList.add('active');
        document.getElementById('groupCodeArea').style.display = "none";
        document.getElementById('payerArea').style.display = "none";
        document.getElementById('currentModeTitle').innerText = "新增個人消費 (私帳)";
        startListeningPersonal();
    } else {
        document.getElementById('tabGroup').classList.add('active');
        document.getElementById('groupCodeArea').style.display = "block";
        document.getElementById('payerArea').style.display = "block";
        document.getElementById('payerInput').placeholder = `預設由你 (${currentUserName}) 付款`;
        document.getElementById('currentModeTitle').innerText = "新增群組消費 (公帳)";
        triggerGroupSync();
    }
}

function triggerGroupSync() {
    if (unsubscribe) unsubscribe();
    const targetGroup = document.getElementById('groupCode').value.trim();
    const targetPassword = document.getElementById('groupPassword').value.trim();
    
    if (!targetGroup || !targetPassword) {
        document.getElementById('reportCard').innerHTML = "<p style='color:#8e8e93;'>🔑 請輸入「群組代號」與「房間密碼」以同步帳目內容。</p>";
        document.getElementById('historyCollapseContainer').innerHTML = "<p style='text-align:center;color:#8e8e93;'>等待輸入密碼中...</p>";
        return;
    }
    startListeningGroup(targetGroup, targetPassword);
}

// 📷 智慧發票 QR Code 掃描（相容台灣發票格式）
document.getElementById('scanInvoiceBtn').addEventListener('click', () => {
    const readerDiv = document.getElementById('reader');
    
    if (html5QrcodeScanner && readerDiv.style.display === 'block') {
        cleanupScanner();
        return;
    }

    readerDiv.style.display = 'block';
    document.getElementById('scanInvoiceBtn').innerText = "🛑 關閉發票掃描器";

    try {
        html5QrcodeScanner = new Html5QrcodeScanner("reader", { 
            fps: 10, 
            qrbox: (viewfinderWidth, viewfinderHeight) => {
                const minEdge = Math.min(viewfinderWidth, viewfinderHeight);
                return { width: Math.floor(minEdge * 0.7), height: Math.floor(minEdge * 0.7) };
            },
            videoConstraints: { facingMode: "environment" },
            rememberLastUsedCamera: true
        }, false);

        html5QrcodeScanner.render(
            (qrCodeMessage) => {
                if (!qrCodeMessage || qrCodeMessage.length < 24) return; 

                if (qrCodeMessage.startsWith("**") || (qrCodeMessage.includes(':') && !/^[A-Z]{2}\d{8}/.test(qrCodeMessage))) {
                    alert("⚠️ 這確認是右側明細，請對準「左側」帶有發票號碼的 QR Code！");
                    return;
                }

                try {
                    const match = qrCodeMessage.match(/^([A-Z]{2})(\d{8})(\d{7})/);
                    if (!match) return; 

                    const invNum = match[1] + match[2]; 
                    const dateStr = match[3];           
                    
                    const twYear = parseInt(dateStr.substring(0, 3), 10);
                    const year = twYear + 1911;
                    const month = dateStr.substring(3, 5);
                    const day = dateStr.substring(5, 7);

                    const amountHexIndex = 2 + 8 + 7 + 4; 
                    if (qrCodeMessage.length < (amountHexIndex + 8)) return;
                    
                    const hexAmount = qrCodeMessage.substring(amountHexIndex, amountHexIndex + 8);
                    const amount = parseInt(hexAmount, 16);

                    if (isNaN(year) || isNaN(amount) || parseInt(month, 10) > 12 || parseInt(day, 10) > 31) return;

                    let finalItemName = `發票消費 (${invNum})`;
                    if (qrCodeMessage.includes(':')) {
                        const parts = qrCodeMessage.split(':');
                        if (parts && parts.length > 2) {
                            for (let i = 2; i < parts.length; i++) {
                                let p = parts[i].trim();
                                if (p && isNaN(p) && !p.includes('***') && p.length > 1) {
                                    finalItemName = `發票：${p}`;
                                    break;
                                }
                            }
                        }
                    }

                    document.getElementById('dateInput').value = `${year}-${month}-${day}`;
                    document.getElementById('amountInput').value = amount;
                    document.getElementById('itemInput').value = finalItemName;
                    
                    alert(`🎉 發票掃描成功！\n發票號碼: ${invNum}\n自動帶入金額: $${amount} 元`);
                    cleanupScanner();
                } catch (err) { 
                    console.error("發票解析錯誤:", err); 
                }
            },
            (errorMessage) => {}
        );
    } catch (err) {
        console.error("相機啟動失敗:", err);
    }
});

function cleanupScanner() {
    const readerDiv = document.getElementById('reader');
    document.getElementById('scanInvoiceBtn').innerText = "📷 掃描發票 QR Code 記帳";
    if (html5QrcodeScanner) {
        html5QrcodeScanner.clear()
            .then(() => { readerDiv.style.display = 'none'; })
            .catch(() => { readerDiv.style.display = 'none'; });
    } else {
        readerDiv.style.display = 'none';
    }
}

// 💾 儲存按鈕
document.getElementById('saveBtn').addEventListener('click', async () => {
    const date = document.getElementById('dateInput').value;
    const item = document.getElementById('itemInput').value.trim();
    const amount = parseFloat(document.getElementById('amountInput').value);
    const groupCode = document.getElementById('groupCode').value.trim();
    const groupPassword = document.getElementById('groupPassword').value.trim();

    if (!item || !amount || !date) { alert('請填寫完整的日期、品名與金額！'); return; }
    if (currentMode === 'group' && (!groupCode || !groupPassword)) { alert('群組模式下，必須填寫群組代號與房間密碼！'); return; }

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
        newRecord.groupCode = groupCode;
        newRecord.groupPassword = groupPassword; 
        let payer = document.getElementById('payerInput').value.trim();
        newRecord.payer = payer ? payer : currentUserName;
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

// 🔄 歷史紀錄與收折運算核心
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

        if (!groupedByDate[r.date]) {
            groupedByDate[r.date] = { dayTotal: 0, items: [] };
        }
        groupedByDate[r.date].dayTotal += r.amount;
        groupedByDate[r.date].items.push(r);
    });

    let sortedDates = Object.keys(groupedByDate).sort((a, b) => new Date(b) - new Date(a));

    let mainHTML = '';
    sortedDates.forEach((date) => {
        let group = groupedByDate[date];
        const isExpanded = expandedDates.includes(date);
        const displayStyle = isExpanded ? 'block' : 'none';
        const arrowText = isExpanded ? '▲ 收折' : '▼ 展開';
        
        mainHTML += `
            <div class="date-group" id="group-${date}">
                <div class="date-header" onclick="toggleCollapseVisibility('${date}')">
                    <div class="date-title-left">
                        <input type="checkbox" class="date-group-chk" data-date="${date}" onclick="event.stopPropagation(); toggleSelectDateGroup('${date}', this.checked)">
                        <span>📅 ${date}</span>
                    </div>
                    <div class="date-total-right">
                        <span>當日總計: <b>$${group.dayTotal.toFixed(0)}</b> 元 <span id="arrow-${date}" style="color: #007aff; margin-left: 5px;">${arrowText}</span></span>
                    </div>
                </div>
                <ul class="item-list" id="list-${date}" style="display: ${displayStyle};">
                    ${group.items.map(item => `
                        <li>
                            <div class="history-item-content">
                                <div class="item-left">
                                    <input type="checkbox" class="item-single-chk" data-id="${item.id}" data-date="${item.date}" onclick="checkSingleStatus('${item.date}')">
                                    <div style="margin-left: 10px;">
                                        <div class="item-name">${item.item}</div>
                                        <div class="item-info">${isPersonal ? '' : '付款人: ' + (item.payer || item.payerName)}</div>
                                    </div>
                                </div>
                                <div class="item-amount">$${item.amount}</div>
                            </div>
                        </li>
                    `).join('')}
                </ul>
            </div>
        `;
    });

    document.getElementById('historyCollapseContainer').innerHTML = mainHTML || '<p style="text-align:center;color:#8e8e93;margin-top:20px;">尚無任何記帳紀錄</p>';
    return { totalSpent, records, members: Array.from(membersSet) };
}

window.toggleCollapseVisibility = function(date) {
    const listEl = document.getElementById(`list-${date}`);
    const arrowEl = document.getElementById(`arrow-${date}`);
    if (!listEl) return;
    if (listEl.style.display === 'none') {
        listEl.style.display = 'block'; arrowEl.innerText = '▲ 收折';
        if (!expandedDates.includes(date)) expandedDates.push(date);
    } else {
        listEl.style.display = 'none'; arrowEl.innerText = '▼ 展開';
        expandedDates = expandedDates.filter(d => d !== date);
    }
}

// 監聽個人帳目
function startListeningPersonal() {
    const q = query(collection(db, "all_ledgers"), where("mode", "==", "personal"), where("uid", "==", currentUserUid));
    unsubscribe = onSnapshot(q, (snapshot) => {
        const { totalSpent } = renderCollapsedList(snapshot, true);
        document.getElementById('reportCard').innerHTML = `<p style="font-size:16px; font-weight:bold; color:#007aff;">🔒 您的個人累積總消費：$${totalSpent.toFixed(0)} 元</p>`;
    });
}

// 監聽群組公帳
function startListeningGroup(targetGroup, targetPassword) {
    const q = query(collection(db, "all_ledgers"), where("mode", "==", "group"), where("groupCode", "==", targetGroup), where("groupPassword", "==", targetPassword));
    unsubscribe = onSnapshot(q, (snapshot) => {
        const { totalSpent, records, members } = renderCollapsedList(snapshot, false);
        if (records.length === 0) { document.getElementById('reportCard').innerHTML = "<p>🎉 密碼正確！目前此房間尚無消費紀錄。</p>"; return; }
        if (members.length <= 1) { document.getElementById('reportCard').innerHTML = `<p><b>🏠 房間：${targetGroup} 總花費：</b>$${totalSpent} 元</p>`; return; }

        let paidValues = {}; members.forEach(m => paidValues[m] = 0);
        records.forEach(r => paidValues[r.payer || r.payerName] += r.amount);
        let avgShare = totalSpent / members.length;
        let balances = members.map(m => ({ name: m, net: paidValues[m] - avgShare }));
        let creditors = balances.filter(b => b.net > 0).sort((a, b) => b.net - a.net);
        let debtors = balances.filter(b => b.net < 0).sort((a, b) => a.net - b.net);

        let reportHTML = `<p><b>🏠 房間：${targetGroup} 總花費：</b>$${totalSpent.toFixed(0)} 元 (每人平均 $${avgShare.toFixed(0)} 元)</p><hr style="margin:8px 0; border-color:#b3d7ff;">`;
        let lines = []; let i = 0, j = 0;
        while (i < debtors.length && j < creditors.length) {
            let debtor = debtors[i]; let creditor = creditors[j];
            let amountToPay = Math.min(Math.abs(debtor.net), creditor.net);
            if (amountToPay > 0.1) lines.push(`<div class="settle-line" style="margin-top:4px;">❌ <b>${debtor.name}</b> 應給 <b>${creditor.name}</b>：<b style="color:#ff3b30;">$${amountToPay.toFixed(0)}</b> 元</div>`);
            debtor.net += amountToPay; creditor.net -= amountToPay;
            if (Math.abs(debtor.net) < 0.1) i++; if (creditor.net < 0.1) j++;
        }
        document.getElementById('reportCard').innerHTML = reportHTML + (lines.length ? lines.join('') : "<p>帳目皆清！</p>");
    });
}

// 勾選連動
window.toggleSelectDateGroup = function(date, isChecked) {
    document.querySelectorAll(`.item-single-chk[data-date="${date}"]`).forEach(chk => chk.checked = isChecked);
}
window.checkSingleStatus = function(date) {
    const totalCount = document.querySelectorAll(`.item-single-chk[data-date="${date}"]`).length;
    const checkedCount = document.querySelectorAll(`.item-single-chk[data-date="${date}"]:checked`).length;
    const groupChk = document.querySelector(`.date-group-chk[data-date="${date}"]`);
    if (groupChk) groupChk.checked = (totalCount === checkedCount);
}

// 刪除選中
document.getElementById('deleteSelectedBtn').addEventListener('click', async () => {
    const checkedBoxes = document.querySelectorAll('.item-single-chk:checked');
    if (checkedBoxes.length === 0) { alert('請先勾選你要刪除的記帳項目！'); return; }
    if (!confirm(`⚠️ 確定要刪除這 ${checkedBoxes.length} 筆消費紀錄嗎？`)) return;

    for (let chk of checkedBoxes) {
        try { await deleteDoc(doc(db, "all_ledgers", chk.getAttribute('data-id'))); } 
        catch (err) { console.error("刪除失敗", err); }
    }
    alert('🎉 選擇項目已刪除！');
});

// 清空全部
document.getElementById('deleteAllBtn').addEventListener('click', async () => {
    if (currentLoadedRecords.length === 0) { alert('目前沒有任何可以刪除的紀錄。'); return; }
    if (!confirm(`🚨 警告！確定要清空當前畫面顯示的全部 ${currentLoadedRecords.length} 筆帳目嗎？`)) return;
    if (!confirm(`最後確認：此操作不可逆！真的要全部清空嗎？`)) return;

    for (let record of currentLoadedRecords) {
        try { await deleteDoc(doc(db, "all_ledgers", record.id)); } 
        catch (err) { console.error("刪除失敗", err); }
    }
    alert('💥 所有帳目已徹底清空！');
});