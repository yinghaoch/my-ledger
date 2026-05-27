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

// 強制每次點擊都跳出帳戶選擇器，避免快取錯誤的帳號
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

// 🔥【核心修復 1】：主動捕捉從 Google 認證跳轉回來的結果
getRedirectResult(auth)
    .then((result) => {
        if (result && result.user) {
            console.log("跳轉登入成功，使用者：", result.user.displayName);
        }
    })
    .catch((error) => {
        console.error("跳轉認證處理解析失敗：", error);
        alert("登入程序發生錯誤，請重試：" + error.message);
    });

// 登入狀態監聽
onAuthStateChanged(auth, (user) => {
    if (user) {
        currentUserUid = user.uid;
        currentUserName = user.displayName || "使用者";
        document.getElementById('welcomeMsg').innerText = `👋 嗨，${currentUserName}！已透過 Google 連線雲端。`;
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

document.getElementById('loginBtn').addEventListener('click', () => signInWithRedirect(auth, provider));
document.getElementById('logoutBtn').addEventListener('click', () => {
    signOut(auth).then(() => {
        window.location.reload(); // 登出後強制重新整理頁面，確保狀態乾淨
    });
});

// 頁籤切換
document.getElementById('tabPersonal').addEventListener('click', () => { expandedDates = []; switchMode('personal'); });
document.getElementById('tabGroup').addEventListener('click', () => { expandedDates = []; switchMode('group'); });

// 當群組代號或密碼輸入時，觸發監聽
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

// 📷 智慧發票 QR Code 掃描（🔥【核心修復 2】：重新優化台灣電子發票格式相容性）
document.getElementById('scanInvoiceBtn').addEventListener('click', () => {
    const readerDiv = document.getElementById('reader');
    
    if (html5QrcodeScanner && readerDiv.style.display === 'block') {
        cleanupScanner();
        return;
    }

    readerDiv.style.display = 'block';
    document.getElementById('scanInvoiceBtn').innerText = "🛑 關閉發票掃描器";
    document.getElementById('scanInvoiceBtn').style.background = "#ff3b30";

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

                // 檢查是否誤掃到右側明細（通常以 ** 開頭，或者包含很多冒號但長度不對）
                if (qrCodeMessage.startsWith("**") || (qrCodeMessage.includes(':') && !/^[A-Z]{2}\d{8}/.test(qrCodeMessage))) {
                    alert("⚠️ 這確認是右側明細，請對準「左側」帶有發票號碼的 QR Code！");
                    return;
                }

                try {
                    // 標準左側格式：2碼英文 + 8碼數字 + 7碼民國年月日與資訊
                    const match = qrCodeMessage.match(/^([A-Z]{2})(\d{8})(\d{7})/);
                    if (!match) {
                        alert("⚠️ 讀取到的條碼格式不符，請對準發票左側的 QR Code 喔！");
                        return; 
                    }

                    const invNum = match[1] + match[2]; 
                    const dateStr = match[3];           
                    
                    const twYear = parseInt(dateStr.substring(0, 3), 10);
                    const year = twYear + 1911;
                    const month = dateStr.substring(3, 5);
                    const day = dateStr.substring(5, 7);

                    // 金額位於第 21 字元開始的 8 位十六進位碼 (Hex)
                    const amountHexIndex = 2 + 8 + 7 + 4; 
                    if (qrCodeMessage.length < (amountHexIndex + 8)) return;
                    
                    const hexAmount = qrCodeMessage.substring(amountHexIndex, amountHexIndex + 8);
                    const amount = parseInt(hexAmount, 16);

                    if (isNaN(year) || isNaN(amount) || parseInt(month, 10) > 12 || parseInt(day, 10) > 31) return;

                    let finalItemName = `發票消費 (${invNum})`;
                    // 如果後面有帶明細項目資訊，嘗試切開抓出第一個品名
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
        console.error("相機啟動錯誤:", err);
    }
});

function cleanupScanner() {
    const readerDiv = document.getElementById('reader');
    document.getElementById('scanInvoiceBtn').innerText = "📷 掃描發票 QR Code 記帳";
    document.getElementById('scanInvoiceBtn').style.background = "#af52de";
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
            <div class="date-group" id="group-${date}" style="margin-top: 10px; border: 1px solid #e5e5ea; border-radius: 8px; overflow: hidden;">
                <div class="date-header" onclick="toggleCollapseVisibility('${date}')" style="background: #f2f2f7; padding: 10px; display: flex; justify-content: space-between; align-items: center; cursor: pointer;">
                    <div class="date-title-left">
                        <input type="checkbox" class="date-group-chk" data-date="${date}" onclick="event.stopPropagation(); toggleSelectDateGroup('${date}', this.checked)">
                        <span style="font-weight: bold; margin-left: 5px;">📅 ${date}</span>
                    </div>
                    <div class="date-total-right">
                        <span style="font-size: 13px; color: #3a3a3c;">當日總計: <b>$${group.dayTotal.toFixed(0)}</b> 元 <span id="arrow-${date}" style="color: #007aff; margin-left: 5px;">${arrowText}</span></span>
                    </div>
                </div>
                <ul class="item-list" id="list-${date}" style="display: ${displayStyle}; list-style: none; padding: 0; margin: 0; background: #fff;">
                    ${group.items.map(item => `
                        <li style="padding: 10px; border-top: 1px solid #e5e5ea;">
                            <div class="history-item-content" style="display: flex; justify-content: space-between; align-items: center;">
                                <div class="item-left" style="display: flex; align-items: center;">
                                    <input type="checkbox" class="item-single-chk" data-id="${item.id}" data-date="${date}" onclick="checkSingleStatus('${date}')">
                                    <div style="margin-left: 10px;">
                                        <div class="item-name" style="font-weight: 500;">${item.item}</div>
                                        <div class="item-info" style="font-size: 11px; color: #8e8e93;">${isPersonal ? '' : '付款人: ' + (item.payer || item.payerName)}</div>
                                    </div>
                                </div>
                                <div class="item-amount" style="font-weight: bold; color: #3a3a3c;">$${item.amount}</div>
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
    if (listEl.style.display === 'none') {
        listEl.style.display = 'block'; arrowEl.innerText = '▲ 收折';
        if (!expandedDates.includes(date)) expandedDates.push(date);
    } else {
        listEl.style.display = 'none'; arrowEl.innerText = '▼ 展開';
        expandedDates = expandedDates.filter(d => d !== date);
    }
}