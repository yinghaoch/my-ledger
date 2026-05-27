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

// 新增：全域管理當前啟用的房間代號
let activeGroupCode = null;

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

// 💡 修正：整合新版 index.html 的房間按鈕事件與 UI 邏輯
function updateGroupUIState() {
    const statusEl = document.getElementById('currentGroupStatus');
    const leaveBtn = document.getElementById('leaveGroupBtn');
    const groupInput = document.getElementById('groupCode');
    
    if (activeGroupCode) {
        if (statusEl) statusEl.innerText = `當前狀態：已連線房間【${activeGroupCode}】`;
        if (leaveBtn) leaveBtn.style.display = "block";
        if (groupInput) { groupInput.disabled = true; groupInput.value = activeGroupCode; }
    } else {
        if (statusEl) statusEl.innerText = "當前狀態：尚未進入任何群組房間";
        if (leaveBtn) leaveBtn.style.display = "none";
        if (groupInput) { groupInput.disabled = false; groupInput.value = ""; }
    }
}

// 💡 修正：綁定「加入房間」按鈕
const joinGroupBtn = document.getElementById('joinGroupBtn');
if (joinGroupBtn) {
    joinGroupBtn.addEventListener('click', () => {
        const code = document.getElementById('groupCode').value.trim().toUpperCase();
        if (code.length !== 4) { alert('請輸入完整的 4 碼房間代碼！'); return; }
        activeGroupCode = code;
        updateGroupUIState();
        if (currentMode === 'group') { expandedDates = []; startListeningGroup(); }
    });
}

// 💡 修正：綁定「建立新群組房間」按鈕
const createGroupBtn = document.getElementById('createGroupBtn');
if (createGroupBtn) {
    createGroupBtn.addEventListener('click', () => {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        let code = '';
        for (let i = 0; i < 4; i++) {
            code += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        activeGroupCode = code;
        alert(`🎉 成功建立群組房間！房間代號為：【${code}】\n請將代號分享給朋友，即可同步記帳！`);
        updateGroupUIState();
        if (currentMode === 'group') { expandedDates = []; startListeningGroup(); }
    });
}

// 💡 修正：綁定「退出當前群組」按鈕
const leaveGroupBtn = document.getElementById('leaveGroupBtn');
if (leaveGroupBtn) {
    leaveGroupBtn.addEventListener('click', () => {
        if (confirm('🚪 確定要退出當前群組房間嗎？')) {
            activeGroupCode = null;
            updateGroupUIState();
            if (currentMode === 'group') { expandedDates = []; startListeningGroup(); }
        }
    });
}

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
        updateGroupUIState();
        startListeningGroup();
    }
}

// 📷 智慧發票 QR Code 掃描解析
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
            if (!qrCodeMessage || qrCodeMessage.length < 30 || !qrCodeMessage.includes(':')) {
                return; 
            }

            try {
                const dateMatch = qrCodeMessage.match(/\d{7}/);
                if (!dateMatch) {
                    throw new Error("找不到標準發票日期特徵");
                }

                const dateStr = dateMatch[0];
                const twYear = parseInt(dateStr.substring(0, 3), 10);
                const year = twYear + 1911;
                const month = dateStr.substring(3, 5);
                const day = dateStr.substring(5, 7);

                const dateIndex = qrCodeMessage.indexOf(dateStr);
                if (dateIndex === -1 || (dateIndex + 19) > qrCodeMessage.length) {
                    throw new Error("字串長度不足以切出金額位置");
                }
                
                const hexAmount = qrCodeMessage.substring(dateIndex + 11, dateIndex + 19);
                const amount = parseInt(hexAmount, 16);

                if (isNaN(year) || isNaN(amount) || parseInt(month, 10) > 12 || parseInt(day, 10) > 31) {
                    throw new Error("計算出的日期或金額不合法");
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
                console.log("解析發票字串時過濾掉的無效訊號:", err.message);
            }
        }, (errorMessage) => {}
    );
});

// 儲存按鈕
document.getElementById('saveBtn').addEventListener('click', async () => {
    const date = document.getElementById('dateInput').value;
    const item = document.getElementById('itemInput').value.trim();
    const amount = parseFloat(document.getElementById('amountInput').value);
    
    if (!item || !amount || !date) { alert('請填寫完整的日期、品名與金額！'); return; }
    
    // 💡 修正：群組防呆改用全域的 activeGroupCode 來驗證
    if (currentMode === 'group' && !activeGroupCode) { 
        alert('請先在房間管理內「建立房間」或「加入房間」！'); 
        return; 
    }

    document.getElementById('saveBtn').innerText = "上傳中...";
    document.getElementById('saveBtn').disabled = true;

    let newRecord = { mode: currentMode, date: date, item: item, amount: amount, imageUrl: "", timestamp: new Date().getTime() };
    
    if (currentMode === 'personal') {
        newRecord.uid = currentUserUid;
    } else {
        // 💡 修正：使用全域連線成功的代碼與付款人欄位邏輯
        newRecord.groupCode = activeGroupCode;
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

// 核心：個人資料監聽
function startListeningPersonal() {
    document.getElementById('historyCollapseContainer').innerHTML = `<p style="text-align: center; color: #8e8e93; margin-top: 20px;">正在讀取個人雲端私帳明細...</p>`;
    
    const q = query(collection(db, "all_ledgers"), where("uid", "==", currentUserUid), where("mode", "==", "personal"));
    
    unsubscribe = onSnapshot(q, (snapshot) => {
        currentLoadedRecords = [];
        snapshot.forEach((doc) => {
            currentLoadedRecords.push({ id: doc.id, ...doc.data() });
        });
        
        currentLoadedRecords.sort((a, b) => b.date.localeCompare(a.date) || b.timestamp - a.timestamp);
        renderData();
    });
}

// 核心：群組資料監聽 (對應 activeGroupCode)
function startListeningGroup() {
    // 💡 修正：如果尚未登入房間，優雅顯示提示訊息
    if (!activeGroupCode) {
        document.getElementById('historyCollapseContainer').innerHTML = `<p style="text-align: center; color: #8e8e93; margin-top: 20px;">請先在上方房間連線管理輸入 4 碼代號加入或建立房間</p>`;
        document.getElementById('reportCard').innerHTML = `<p>⚠️ 尚未連線任何群組房間</p>`;
        return;
    }

    document.getElementById('historyCollapseContainer').innerHTML = `<p style="text-align: center; color: #8e8e93; margin-top: 20px;">正在讀取群組房間【${activeGroupCode}】明細...</p>`;
    
    const q = query(collection(db, "all_ledgers"), where("groupCode", "==", activeGroupCode), where("mode", "==", "group"));
    
    unsubscribe = onSnapshot(q, (snapshot) => {
        currentLoadedRecords = [];
        snapshot.forEach((doc) => {
            currentLoadedRecords.push({ id: doc.id, ...doc.data() });
        });
        
        currentLoadedRecords.sort((a, b) => b.date.localeCompare(a.date) || b.timestamp - a.timestamp);
        renderData();
    });
}

// 核心功能：前端數據綜合渲染 (歷史收折 + 報表計算)
function renderData() {
    const reportCard = document.getElementById('reportCard');
    const container = document.getElementById('historyCollapseContainer');

    if (currentLoadedRecords.length === 0) {
        container.innerHTML = `<p style="text-align: center; color: #8e8e93; margin-top: 20px;">目前尚無任何消費紀錄</p>`;
        reportCard.innerHTML = `<p>💰 目前無任何消費，總金額為 $0 元。</p>`;
        return;
    }

    let totalSum = 0;
    let memberMap = {};
    let groupsByDate = {};

    currentLoadedRecords.forEach(r => {
        totalSum += r.amount;
        if (currentMode === 'group') {
            let pName = r.payer ? r.payer : "未知成員";
            memberMap[pName] = (memberMap[pName] || 0) + r.amount;
        }
        if (!groupsByDate[r.date]) {
            groupsByDate[r.date] = [];
        }
        groupsByDate[r.date].push(r);
    });

    // 1. 渲染上方圓角大字統計報表卡片
    if (currentMode === 'personal') {
        reportCard.innerHTML = `<p style="font-size: 16px; margin: 5px 0;">個人私帳總消費：<strong style="color:#007aff; font-size:20px;">$${totalSum}</strong> 元</p>`;
    } else {
        let members = Object.keys(memberMap);
        let count = members.length;
        let avg = count > 0 ? Math.round(totalSum / count) : 0;

        let reportHtml = `<p style="font-size: 15px; margin-bottom: 10px;">👥 群組總消費：<strong style="color:#5856d6; font-size:18px;">$${totalSum}</strong> 元（平分人數：${count} 人，人均：$${avg} 元）</p><hr style="border:0; border-top:1px solid #e5e5ea; margin: 10px 0;">`;
        
        members.forEach(m => {
            let diff = memberMap[m] - avg;
            let statusStr = "";
            if (diff >= 0) {
                statusStr = `<span style="color:#34c759; font-weight:bold;">應拿回 $${Math.abs(diff)}</span>`;
            } else {
                statusStr = `<span style="color:#ff3b30; font-weight:bold;">應補分 $${Math.abs(diff)}</span>`;
            }
            reportHtml += `<p style="font-size: 14px; margin: 6px 0;">🔹 <strong>${m}</strong>：共代墊 $${memberMap[m]} 元 (${statusStr})</p>`;
        });
        reportCard.innerHTML = reportHtml;
    }

    // 2. 建立動態折疊歷史面板 DOM 結構
    let html = '';
    Object.keys(groupsByDate).forEach(date => {
        let records = groupsByDate[date];
        let dayTotal = records.reduce((sum, r) => sum + r.amount, 0);
        
        let isExpanded = expandedDates.includes(date);
        let arrow = isExpanded ? "▼" : "▶";
        let listDisplayStyle = isExpanded ? "block" : "none";

        html += `
        <div class="date-group">
            <div class="date-header" onclick="toggleDateGroup('${date}')">
                <div class="date-title-left">
                    <input type="checkbox" class="date-group-chk" data-date="${date}" onclick="event.stopPropagation(); toggleSelectDateGroup('${date}', this.checked)">
                    <span>${arrow} ${date}</span>
                </div>
                <div class="date-total-right">當日總計: $${dayTotal}</div>
            </div>
            <ul class="item-list" id="list-${date}" style="display: ${listDisplayStyle};">
        `;

        records.forEach(r => {
            let detailStr = "";
            if (currentMode === 'group') {
                detailStr = `<span class="item-payer">${r.payer} 墊</span>`;
            }
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

    container.innerHTML = html;
}

// 掛載全域折疊與勾選控制常式
window.toggleDateGroup = function(date) {
    const index = expandedDates.indexOf(date);
    if (index > -1) {
        expandedDates.splice(index, 1);
    } else {
        expandedDates.push(date);
    }
    renderData();
}

window.toggleSelectDateGroup = function(date, isChecked) {
    const items = document.querySelectorAll(`.item-single-chk[data-date="${date}"]`);
    items.forEach(chk => chk.checked = isChecked);
}

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

    const firstConfirm = confirm(`🚨 警告！你正在執行【全部清空】功能！\n這將會把你畫面上看得到的這 ${currentLoadedRecords.length} 筆明細，通通從雲端資料庫徹底刪除！\n\n確定要繼續嗎？`);
    if (!firstConfirm) return;

    const secondConfirm = confirm(`🔥 最後一次機會確認：你真的確定要把畫面上所有的雲端資料永久清空？此動作絕對無法復原！`);
    if (!secondConfirm) return;

    for (let record of currentLoadedRecords) {
        try {
            await deleteDoc(doc(db, "all_ledgers", record.id));
        } catch (err) {
            console.error("刪除失敗ID: " + record.id, err);
        }
    }
    alert('🎉 雲端帳本已全部清空！');
});