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
document.getElementById('tabPersonal').addEventListener('click', () => switchMode('personal'));
document.getElementById('tabGroup').addEventListener('click', () => switchMode('group'));
document.getElementById('groupCode').addEventListener('change', () => { if (currentMode === 'group') switchMode('group'); });

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

// 📷 修正後的發票 QR Code 掃描與高速辨識對焦邏輯
document.getElementById('scanInvoiceBtn').addEventListener('click', () => {
    const readerDiv = document.getElementById('reader');
    if (readerDiv.style.display === 'none') {
        readerDiv.style.display = 'block';
        html5QrcodeScanner = new Html5Qrcode("reader");
        html5QrcodeScanner.start(
            { facingMode: "environment" },
            { 
                fps: 15, // 提高偵率讓辨識更流暢
                qrbox: function(viewfinderWidth, viewfinderHeight) {
                    // 動態計算對焦框大小，方便大眾對準發票
                    const minEdge = Math.min(viewfinderWidth, viewfinderHeight);
                    return { width: Math.floor(minEdge * 0.7), height: Math.floor(minEdge * 0.7) };
                },
                experimentalFeatures: { useBarCodeDetectorIfSupported: true } // 啟用硬體加速
            },
            (qrCodeMessage) => {
                // 台灣電子發票左側 QR Code 字串長度通常大於等於 30 碼
                if (qrCodeMessage.length >= 30) {
                    try {
                        // 精準解析你提供的範例格式：BP25966064 1150526 4174 000001f6 ...
                        // 10 到 13 碼為民國年 (例如 115)
                        const twYear = parseInt(qrCodeMessage.substring(10, 13), 10);
                        const year = twYear + 1911;
                        
                        // 月份與日期
                        const month = qrCodeMessage.substring(13, 15);
                        const day = qrCodeMessage.substring(15, 17);
                        
                        // 金額位置：第 21 到 29 碼為 16 進位金額字串 (共 8 碼)
                        const hexAmount = qrCodeMessage.substring(21, 29);
                        const amount = parseInt(hexAmount, 16);

                        if (isNaN(year) || isNaN(amount)) {
                            throw new Error("格式解析失敗");
                        }

                        // 自動帶入表單
                        document.getElementById('dateInput').value = `${year}-${month}-${day}`;
                        document.getElementById('amountInput').value = amount;
                        document.getElementById('itemInput').value = "電子發票消費";
                        
                        alert(`🎉 掃描成功！\n發票日期: ${year}-${month}-${day}\n自動帶入金額: $${amount} 元`);
                        stopScanner();
                    } catch (err) {
                        alert("能讀取條碼，但解析發票內容出錯了，請嘗試掃描發票的另一顆 QR Code！");
                    }
                } else {
                    alert("這似乎是右側明細條碼，請對準左側帶有發票號碼的那顆 QR Code 喔！");
                }
            },
            (errorMessage) => {}
        );
    } else {
        stopScanner();
    }
});

function stopScanner() {
    if (html5QrcodeScanner) {
        html5QrcodeScanner.stop().then(() => {
            document.getElementById('reader').style.display = 'none';
        }).catch(()=>{
            document.getElementById('reader').style.display = 'none';
        });
    }
}

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

// 🔄 核心邏輯：日期歸納收折、當日總計運算、預設【全部收折】狀態
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
        
        // 🔒 關鍵改動：將 <ul> 的 style 改為 display: none 讓它預設全部收折起來
        // 並且在箭頭符號提示改為「▼ 展開」，點擊時動態切換
        mainHTML += `
            <div class="date-group" id="group-${date}">
                <div class="date-header" onclick="toggleCollapseVisibility('${date}')">
                    <div class="date-title-left">
                        <input type="checkbox" class="date-group-chk" data-date="${date}" onclick="event.stopPropagation(); toggleSelectDateGroup('${date}', this.checked)">
                        <span>📅 ${date}</span>
                    </div>
                    <div class="date-total-right">
                        <span>當日總計: <b>$${group.dayTotal.toFixed(0)}</b> 元 <span id="arrow-${date}">▼ 展開</span></span>
                    </div>
                </div>
                <ul class="item-list" id="list-${date}" style="display: none;">
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

// 展開與收折的動態切換函式
window.toggleCollapseVisibility = function(date) {
    const listEl = document.getElementById(`list-${date}`);
    const arrowEl = document.getElementById(`arrow-${date}`);
    if (listEl.style.display === 'none') {
        listEl.style.display = 'block';
        arrowEl.innerText = '▲ 收折';
    } else {
        listEl.style.display = 'none';
        arrowEl.innerText = '▼ 展開';
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

// 點擊日期勾選框，自動全選/全不選該日期的細項
window.toggleSelectDateGroup = function(date, isChecked) {
    const checkboxes = document.querySelectorAll(`.item-single-chk[data-date="${date}"]`);
    checkboxes.forEach(chk => chk.checked = isChecked);
}

// 當單筆細項全部被手動取消時，自動取消日期的全選框
window.checkSingleStatus = function(date) {
    const totalCount = document.querySelectorAll(`.item-single-chk[data-date="${date}"]`).length;
    const checkedCount = document.querySelectorAll(`.item-single-chk[data-date="${date}"]:checked`).length;
    const groupChk = document.querySelector(`.date-group-chk[data-date="${date}"]`);
    if (groupChk) {
        groupChk.checked = (totalCount === checkedCount);
    }
}

// 🗑️ 功能：刪除選中項目 (含確認視窗)
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