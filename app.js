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

// 📷 智慧發票 QR Code 掃描解析（加入多鏡頭強制鎖定主相機機制）
document.getElementById('scanInvoiceBtn').addEventListener('click', () => {
    const readerDiv = document.getElementById('reader');
    readerDiv.style.display = 'block';

    if (html5QrcodeScanner) {
        html5QrcodeScanner.clear().catch(() => {});
    }

    // 🎯 精準硬體鎖定：告訴瀏覽器一定要用後置(environment)的主相機，並設定標準解析度避免開到長焦
    html5QrcodeScanner = new Html5QrcodeScanner("reader", { 
        fps: 20, // 提升幀率讓對焦更靈敏
        qrbox: (viewfinderWidth, viewfinderHeight) => {
            const minEdge = Math.min(viewfinderWidth, viewfinderHeight);
            // 放大對焦框比例到 0.8，讓手機更好對準發票
            return { width: Math.floor(minEdge * 0.8), height: Math.floor(minEdge * 0.8) };
        },
        videoConstraints: {
            facingMode: { exact: "environment" },
            // 強制設定為標準 Full HD 比例，有助於行動瀏覽器直接調用一號主鏡頭
            width: { ideal: 1920 },
            height: { ideal: 1080 }
        },
        rememberLastUsedCamera: true
    }, false);

    html5QrcodeScanner.render(
        (qrCodeMessage) => {
            if (!qrCodeMessage || qrCodeMessage.length < 30 || !qrCodeMessage.includes(':')) {
                return; 
            }

            try {
                const dateMatch = qrCodeMessage.match(/\d{7}/);
                if (!dateMatch) return;

                const dateStr = dateMatch[0];
                const twYear = parseInt(dateStr.substring(0, 3), 10);
                const year = twYear + 1911;
                const month = dateStr.substring(3, 5);
                const day = dateStr.substring(5, 7);

                const dateIndex = qrCodeMessage.indexOf(dateStr);
                if (dateIndex === -1 || (dateIndex + 19) > qrCodeMessage.length) return;
                
                const hexAmount = qrCodeMessage.substring(dateIndex + 11, dateIndex + 19);
                const amount = parseInt(hexAmount, 16);

                if (isNaN(year) || isNaN(amount) || parseInt(month, 10) > 12 || parseInt(day, 10) > 31) {
                    return;
                }

                let finalItemName = "電子發票消費"; 
                const parts = qrCodeMessage.split(':');
                if (parts && parts.length > 2) {
                    for (let i = 2; i < parts.length; i++) {
                        let p = parts[i].trim();
                        if (p && isNaN(p) && !p.includes('***')) {
                            finalItemName = `發票：${p}`;
                            break;
                        }
                    }
                }

                document.getElementById('dateInput').value = `${year}-${month}-${day}`;
                document.getElementById('amountInput').value = amount;
                document.getElementById('itemInput').value = finalItemName;
                
                alert(`🎉 掃描成功！\n發票日期: ${year}-${month}-${day}\n消費品名: ${finalItemName}\n自動帶入金額: $${amount} 元`);
                
                html5QrcodeScanner.clear().then(() => {
                    readerDiv.style.display = 'none';
                }).catch(() => {
                    readerDiv.style.display = 'none';
                });

            } catch (err) {
                console.log("過濾無效的掃描訊號:", err);
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