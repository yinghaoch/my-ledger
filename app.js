import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getFirestore, collection, addDoc, onSnapshot, query, where, doc, deleteDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

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

let currentUserUid = null;
let currentUserName = "";
let currentMode = "personal";
let unsubscribe = null;
let html5QrcodeScanner = null;
let currentLoadedRecords = [];

// 全域記憶哪些日期被手動「展開」了，預設為空（代表初始全部收折）
let expandedDates = [];

// 初始化填入今日日期
document.getElementById('dateInput').value = new Date().toISOString().split('T')[0];

// 登入狀態監聽
onAuthStateChanged(auth, (user) => {
    if (user) {
        currentUserUid = user.uid;
        currentUserName = user.displayName;
        document.getElementById('welcomeMsg').innerText = `👋 嗨，${currentUserName}！已連線雲端。`;
        document.getElementById('loginBtn').style.display = "none";
        document.getElementById('logoutBtn').style.display = "block";
        document.getElementById('mainApp').style.opacity = "1";
        document.getElementById('mainApp').style.pointerEvents = "auto";
        switchMode(currentMode);
    } else {
        currentUserUid = null;
        document.getElementById('loginBtn').style.display = "block";
        document.getElementById('logoutBtn').style.display = "none";
        document.getElementById('mainApp').style.opacity = "0.3";
        document.getElementById('mainApp').style.pointerEvents = "none";
        if (unsubscribe) unsubscribe();
    }
});

document.getElementById('loginBtn').addEventListener('click', () => signInWithPopup(auth, provider));
document.getElementById('logoutBtn').addEventListener('click', () => signOut(auth));

// 頁籤切換
document.getElementById('tabPersonal').addEventListener('click', () => { expandedDates = []; switchMode('personal'); });
document.getElementById('tabGroup').addEventListener('click', () => { expandedDates = []; switchMode('group'); });
document.getElementById('groupCode').addEventListener('change', () => { if (currentMode === 'group') { expandedDates = []; switchMode('group'); } });

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
        startListeningGroup();
    }
}

// 📷 智慧發票 QR Code 掃描解析（含自動抓取真實商品品名名稱）
document.getElementById('scanInvoiceBtn').addEventListener('click', () => {
    const readerDiv = document.getElementById('reader');
    readerDiv.style.display = 'block';

    if (html5QrcodeScanner) {
        html5QrcodeScanner.clear().catch(() => {});
    }

    html5QrcodeScanner = new Html5QrcodeScanner("reader", { 
        fps: 15, 
        qrbox: (viewfinderWidth, viewfinderHeight) => {
            const minEdge = Math.min(viewfinderWidth, viewfinderHeight);
            return { width: Math.floor(minEdge * 0.7), height: Math.floor(minEdge * 0.7) };
        },
        rememberLastUsedCamera: true
    }, false);

    html5QrcodeScanner.render(
        (qrCodeMessage) => {
            if (qrCodeMessage.length >= 30) {
                try {
                    // 1. 使用智慧 Regex 搜尋字串中「連續7位數字」作為日期特徵
                    const dateMatch = qrCodeMessage.match(/\d{7}/);
                    if (!dateMatch) {
                        throw new Error("找不到標準發票日期特徵");
                    }

                    const dateStr = dateMatch[0];
                    const twYear = parseInt(dateStr.substring(0, 3), 10);
                    const year = twYear + 1911;
                    const month = dateStr.substring(3, 5);
                    const day = dateStr.substring(5, 7);

                    // 2. 定位金額：從找到的日期位置往後推算 11 碼，切出 8 碼 16 進位金額
                    const dateIndex = qrCodeMessage.indexOf(dateStr);
                    const hexAmount = qrCodeMessage.substring(dateIndex + 11, dateIndex + 19);
                    const amount = parseInt(hexAmount, 16);

                    // 安全防呆驗證
                    if (isNaN(year) || isNaN(amount) || parseInt(month, 10) > 12 || parseInt(day, 10) > 31) {
                        throw new Error("計算出的日期或金額不合法");
                    }

                    // 🎯 3. 動態解析品名邏輯：
                    // 台灣發票格式後半段通常是用冒號（:）隔開商品明細，例如 :1:10:1:108茶王:1:60
                    // 我們切開所有冒號，尋找不包含純數字、也不是五角星號的「第一個中文字串/商品名稱」
                    let finalItemName = "電子發票消費"; // 預設防呆備用值
                    const parts = qrCodeMessage.split(':');
                    
                    if (parts.length > 2) {
                        // 從第三個區段開始尋找可能的品名
                        for (let i = 2; i < parts.length; i++) {
                            let p = parts[i].trim();
                            // 如果這個區段不是純數字、長度大於0、且不是用來遮蔽的星號
                            if (p && isNaN(p) && !p.includes('***')) {
                                finalItemName = `發票：${p}`;
                                break;
                            }
                        }
                    }

                    // 成功解析，自動帶入表單欄位
                    document.getElementById('dateInput').value = `${year}-${month}-${day}`;
                    document.getElementById('amountInput').value = amount;
                    document.getElementById('itemInput').value = finalItemName;
                    
                    alert(`🎉 掃描成功！\n發票日期: ${year}-${month}-${day}\n消費品名: ${finalItemName}\n自動帶入金額: $${amount} 元`);
                    
                    // 關閉全螢幕相機視窗並隱藏
                    html5QrcodeScanner.clear().then(() => {
                        readerDiv.style.display = 'none';
                    }).catch(() => {
                        readerDiv.style.display = 'none';
                    });

                } catch (err) {
                    alert("發票條碼解析失敗！請確保對準的是左側那顆「帶有發票號碼」的 QR Code 喔！");
                }
            } else {
                alert("這似乎是右側明細，請改掃發票左邊那顆 QR Code 喔！");
            }
        },
        (errorMessage) => {}
    );
});

// 儲存按鈕
document.getElementById('saveBtn').addEventListener('click', async () => {
    const date = document.getElementById('dateInput').value;
    const item = document.getElementById('itemInput').value.trim();
    const amount = parseFloat(document.getElementById('amountInput').value);

    if (!item || !amount || !date) { alert('請填寫完整的日期、品名與金額！'); return; }

    document.getElementById('saveBtn').innerText = "上傳中...";
    document.getElementById('saveBtn').disabled = true;

    let newRecord = {
        mode: currentMode,
        date: date,
        item: item,
        amount: amount,
        imageUrl: "",
        timestamp: new Date().getTime()
    };

    if (currentMode === 'personal') {
        newRecord.uid = currentUserUid;
    } else {
        newRecord.groupCode = document.getElementById('groupCode').value.trim();
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

// 🔄 歷史紀錄日期收折與運算核心
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
        if (!isPersonal) membersSet.add(r.payer);

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
                        <span>當日總計: <b>$${group.dayTotal.toFixed(0)}</b> 元 <span id="arrow-${date}">${arrowText}</span></span>
                    </div>
                </div>
                <ul class="item-list" id="list-${date}" style="display: ${displayStyle};">
                    ${group.items.map(item => `
                        <li>
                            <div class="item-left">
                                <input type="checkbox" class="item-single-chk" data-id="${item.id}" data-date="${date}" onclick="checkSingleStatus('${date}')">
                                <div>
                                    <div class="item-name">${item.item}</div>
                                    <div class="item-info">${isPersonal ? '' : '付款人: ' + item.payer}</div>
                                </div>
                            </div>
                            <div class="item-amount">$${item.amount}</div>
                        </li>
                    `).join('')}
                </ul>
            </div>
        `;
    });

    document.getElementById('historyCollapseContainer').innerHTML = mainHTML || '<p style="text-align:center;color:#8e8e93;margin-top:20px;">尚無任何記帳紀錄</p>';
    return { totalSpent, records, members: Array.from(membersSet) };
}

// 展開與收折的狀態記憶控制
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

// 監聽個人私帳
function startListeningPersonal() {
    const q = query(collection(db, "all_ledgers"), where("mode", "==", "personal"), where("uid", "==", currentUserUid));
    unsubscribe = onSnapshot(q, (snapshot) => {
        const { totalSpent } = renderCollapsedList(snapshot, true);
        document.getElementById('reportCard').innerHTML = `<p style="font-size:16px; font-weight:bold; color:#007aff;">🔒 您的個人累積總消費：$${totalSpent.toFixed(0)} 元</p>`;
    });
}

// 監聽群組公帳
function startListeningGroup() {
    const targetGroup = document.getElementById('groupCode').value.trim();
    const q = query(collection(db, "all_ledgers"), where("mode", "==", "group"), where("groupCode", "==", targetGroup));
    unsubscribe = onSnapshot(q, (snapshot) => {
        const { totalSpent, records, members } = renderCollapsedList(snapshot, false);
        if (records.length === 0) { document.getElementById('reportCard').innerHTML = "<p>目前此群組尚無消費紀錄。</p>"; return; }
        if (members.length <= 1) { document.getElementById('reportCard').innerHTML = `<p><b>群組總花費：</b>$${totalSpent} 元</p>`; return; }

        let paidValues = {}; members.forEach(m => paidValues[m] = 0);
        records.forEach(r => paidValues[r.payer] += r.amount);
        let avgShare = totalSpent / members.length;
        let balances = members.map(m => ({ name: m, net: paidValues[m] - avgShare }));
        let creditors = balances.filter(b => b.net > 0).sort((a, b) => b.net - a.net);
        let debtors = balances.filter(b => b.net < 0).sort((a, b) => a.net - b.net);

        let reportHTML = `<p><b>群組總花費：</b>$${totalSpent.toFixed(0)} 元 (每人平均 $${avgShare.toFixed(0)} 元)</p><hr style="margin:8px 0; border-color:#b3d7ff;">`;
        let lines = []; let i = 0, j = 0;
        while (i < debtors.length && j < creditors.length) {
            let debtor = debtors[i]; let creditor = creditors[j];
            let amountToPay = Math.min(Math.abs(debtor.net), creditor.net);
            if (amountToPay > 0.1) lines.push(`<div class="settle-line">❌ <b>${debtor.name}</b> 應給 <b>${creditor.name}</b>：<b>$${amountToPay.toFixed(0)}</b> 元</div>`);
            debtor.net += amountToPay; creditor.net -= amountToPay;
            if (Math.abs(debtor.net) < 0.1) i++; if (creditor.net < 0.1) j++;
        }
        document.getElementById('reportCard').innerHTML = reportHTML + (lines.length ? lines.join('') : "<p>帳目皆清！</p>");
    });
}

// 點擊日期勾選框全選
window.toggleSelectDateGroup = function(date, isChecked) {
    const checkboxes = document.querySelectorAll(`.item-single-chk[data-date="${date}"]`);
    checkboxes.forEach(chk => chk.checked = isChecked);
}

// 連動群組勾選框狀態
window.checkSingleStatus = function(date) {
    const totalCount = document.querySelectorAll(`.item-single-chk[data-date="${date}"]`).length;
    const checkedCount = document.querySelectorAll(`.item-single-chk[data-date="${date}"]:checked`).length;
    const groupChk = document.querySelector(`.date-group-chk[data-date="${date}"]`);
    if (groupChk) {
        groupChk.checked = (totalCount === checkedCount);
    }
}

// 🗑️ 功能：刪除選中項目
document.getElementById('deleteSelectedBtn').addEventListener('click', async () => {
    const checkedBoxes = document.querySelectorAll('.item-single-chk:checked');
    if (checkedBoxes.length === 0) { alert('請先勾選你要刪除的記帳項目！'); return; }

    const confirmDelete = confirm(`⚠️ 確定要刪除這 ${checkedBoxes.length} 筆消費紀錄嗎？\n刪除後雲端資料將無法復原！`);
    if (!confirmDelete) return;

    for (let chk of checkedBoxes) {
        const id = chk.getAttribute('data-id');
        try {
            await deleteDoc(doc(db, "all_ledgers", id));
        } catch (err) {
            console.error("刪除失敗ID: " + id, err);
        }
    }
    alert('🎉 選擇的項目已成功從雲端刪除！');
});

// ⚠️ 功能：清空全部項目
document.getElementById('deleteAllBtn').addEventListener('click', async () => {
    if (currentLoadedRecords.length === 0) { alert('目前沒有任何可以刪除的紀錄。'); return; }

    const firstConfirm = confirm(`🚨 警告！你正在執行【全部清空】功能！\n這將會刪除當前畫面上顯示的全部 ${currentLoadedRecords.length} 筆帳目！\n你確定要繼續嗎？`);
    if (!firstConfirm) return;

    const secondConfirm = confirm(`最後確認：真的要「全數刪除」嗎？此操作不可逆！`);
    if (!secondConfirm) return;

    for (let record of currentLoadedRecords) {
        try {
            await deleteDoc(doc(db, "all_ledgers", record.id));
        } catch (err) {
            console.error("刪除失敗", err);
        }
    }
    alert('💥 所有帳目已徹底清空！');
});