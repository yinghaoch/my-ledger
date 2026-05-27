import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getFirestore, collection, addDoc, onSnapshot, query, where, doc, deleteDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
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
const storage = getStorage(app);
const provider = new GoogleAuthProvider();

let currentUserUid = null;
let currentUserName = "";
let currentMode = "personal";
let unsubscribe = null;
let html5QrcodeScanner = null;
let currentLoadedRecords = [];

let expandedDates = [];
let globalCompressedBlob = null;

// 初始化填入今日日期
document.getElementById('dateInput').value = new Date().toISOString().split('T')[0];

// 登入狀態監聽 (Google Auth)
onAuthStateChanged(auth, (user) => {
    if (user) {
        currentUserUid = user.uid;
        currentUserName = user.displayName;
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

document.getElementById('loginBtn').addEventListener('click', () => signInWithPopup(auth, provider));
document.getElementById('logoutBtn').addEventListener('click', () => signOut(auth));

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

// 📷 智慧發票 QR Code 掃描（相容性最優版本，絕不卡死網頁）
document.getElementById('scanInvoiceBtn').addEventListener('click', () => {
    const readerDiv = document.getElementById('reader');
    readerDiv.style.display = 'block';

    if (html5QrcodeScanner) {
        html5QrcodeScanner.clear().catch(() => {});
    }

    try {
        html5QrcodeScanner = new Html5QrcodeScanner("reader", { 
            fps: 15, 
            qrbox: (viewfinderWidth, viewfinderHeight) => {
                const minEdge = Math.min(viewfinderWidth, viewfinderHeight);
                return { width: Math.floor(minEdge * 0.8), height: Math.floor(minEdge * 0.8) };
            },
            // 使用非 exact 緩和設定，瀏覽器會自主挑選最合適的標準主後置鏡頭，且不引發權限與初始化卡死
            videoConstraints: { facingMode: "environment" },
            rememberLastUsedCamera: true
        }, false);

        html5QrcodeScanner.render(
            (qrCodeMessage) => {
                if (!qrCodeMessage || qrCodeMessage.length < 30 || !qrCodeMessage.includes(':')) return; 

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

                    if (isNaN(year) || isNaN(amount) || parseInt(month, 10) > 12 || parseInt(day, 10) > 31) return;

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
                    
                    html5QrcodeScanner.clear().then(() => { readerDiv.style.display = 'none'; }).catch(() => { readerDiv.style.display = 'none'; });
                } catch (err) { console.log("過濾無效訊號:", err); }
            },
            (errorMessage) => {}
        );
    } catch (err) {
        console.error("相機啟動錯誤:", err);
    }
});

// 照片壓縮與預覽
document.getElementById('photoInput').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) { document.getElementById('previewArea').style.display = 'none'; globalCompressedBlob = null; return; }

    const origSizeKb = (file.size / 1024).toFixed(1);
    const reader = new FileReader();
    reader.onload = function (event) {
        const img = new Image();
        img.onload = function () {
            const canvas = document.createElement('canvas');
            let width = img.width; let height = img.height;
            const max_size = 1024;
            if (width > height) { if (width > max_size) { height *= max_size / width; width = max_size; } } 
            else { if (height > max_size) { width *= max_size / height; height = max_size; } }
            canvas.width = width; canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);
            canvas.toBlob((blob) => {
                globalCompressedBlob = blob;
                document.getElementById('imgPreview').src = URL.createObjectURL(blob);
                document.getElementById('compressInfo').innerText = `📐 壓縮成功：${origSizeKb} KB ➔ ${(blob.size / 1024).toFixed(1)} KB`;
                document.getElementById('previewArea').style.display = 'block';
            }, 'image/jpeg', 0.7);
        };
        img.src = event.target.result;
    };
    reader.readAsDataURL(file);
});

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

    let uploadedImageUrl = "";
    if (globalCompressedBlob) {
        try {
            const fileRef = ref(storage, `receipts/${currentUserUid}_${new Date().getTime()}.jpg`);
            const snapshot = await uploadBytes(fileRef, globalCompressedBlob);
            uploadedImageUrl = await getDownloadURL(snapshot.ref);
        } catch (storageErr) {
            console.error(storageErr);
        }
    }

    let newRecord = {
        mode: currentMode,
        date: date,
        item: item,
        amount: amount,
        imageUrl: uploadedImageUrl,
        uid: currentUserUid,        // 保留 Google UID
        payerName: currentUserName,  // 記錄記帳者的名字
        timestamp: new Date().getTime()
    };

    if (currentMode === 'group') {
        newRecord.groupCode = groupCode;
        newRecord.groupPassword = groupPassword; // 密碼防護
        let payer = document.getElementById('payerInput').value.trim();
        newRecord.payer = payer ? payer : currentUserName;
    }

    try {
        await addDoc(collection(db, "all_ledgers"), newRecord);
        document.getElementById('itemInput').value = '';
        document.getElementById('amountInput').value = '';
        document.getElementById('photoInput').value = '';
        document.getElementById('previewArea').style.display = 'none';
        globalCompressedBlob = null;
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
                            <div class="history-item-content">
                                <div class="item-left">
                                    <input type="checkbox" class="item-single-chk" data-id="${item.id}" data-date="${date}" onclick="checkSingleStatus('${date}')">
                                    <div>
                                        <div class="item-name">${item.item}</div>
                                        <div class="item-info">${isPersonal ? '' : '付款人: ' + item.payer}</div>
                                    </div>
                                </div>
                                <div style="display: flex; align-items: center;">
                                    <div class="item-amount">$${item.amount}</div>
                                    ${item.imageUrl ? `<img src="${item.imageUrl}" class="receipt-thumb" onclick="window.open('${item.imageUrl}', '_blank')">` : ''}
                                </div>
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

// 監聽個人帳目：回歸用 Google uid 做隔離
function startListeningPersonal() {
    const q = query(collection(db, "all_ledgers"), where("mode", "==", "personal"), where("uid", "==", currentUserUid));
    unsubscribe = onSnapshot(q, (snapshot) => {
        const { totalSpent } = renderCollapsedList(snapshot, true);
        document.getElementById('reportCard').innerHTML = `<p style="font-size:16px; font-weight:bold; color:#007aff;">🔒 您的個人累積總消費：$${totalSpent.toFixed(0)} 元</p>`;
    });
}

// 監聽群組公帳：同樣採雙重鎖定（房間代號 + 房間密碼）
function startListeningGroup(targetGroup, targetPassword) {
    const q = query(collection(db, "all_ledgers"), where("mode", "==", "group"), where("groupCode", "==", targetGroup), where("groupPassword", "==", targetPassword));
    unsubscribe = onSnapshot(q, (snapshot) => {
        const { totalSpent, records, members } = renderCollapsedList(snapshot, false);
        if (records.length === 0) { document.getElementById('reportCard').innerHTML = "<p>🎉 密碼正確！目前此房間尚無消費紀錄。</p>"; return; }
        if (members.length <= 1) { document.getElementById('reportCard').innerHTML = `<p><b>群組總花費：</b>$${totalSpent} 元</p>`; return; }

        let paidValues = {}; members.forEach(m => paidValues[m] = 0);
        records.forEach(r => paidValues[r.payer] += r.amount);
        let avgShare = totalSpent / members.length;
        let balances = members.map(m => ({ name: m, net: paidValues[m] - avgShare }));
        let creditors = balances.filter(b => b.net > 0).sort((a, b) => b.net - a.net);
        let debtors = balances.filter(b => b.net < 0).sort((a, b) => a.net - b.net);

        let reportHTML = `<p><b>🏠 房間：${targetGroup} 總花費：</b>$${totalSpent.toFixed(0)} 元 (每人平均 $${avgShare.toFixed(0)} 元)</p><hr style="margin:8px 0; border-color:#b3d7ff;">`;
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