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

// 全域管理當前啟用的房間代號
let activeGroupCode = null;

// 全域記憶哪些節點被手動「展開」了，預設為空（代表初始全部收折）
let expandedNodes = [];

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
        
        // 嘗試從記憶中載入上一次最後使用的房間
        const lastCode = localStorage.getItem('lastActiveGroupCode');
        if (lastCode) {
            activeGroupCode = lastCode;
        }
        
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
document.getElementById('tabPersonal').addEventListener('click', () => { expandedNodes = []; switchMode('personal'); });
document.getElementById('tabGroup').addEventListener('click', () => { expandedNodes = []; switchMode('group'); });

// 將群組代碼存入歷史清單並儲存
function saveGroupToHistory(code) {
    if (!code) return;
    let history = JSON.parse(localStorage.getItem('groupHistory')) || [];
    if (!history.includes(code)) {
        history.push(code);
        localStorage.setItem('groupHistory', JSON.stringify(history));
    }
    localStorage.setItem('lastActiveGroupCode', code);
}

// 在界面上渲染歷史群組按鈕清單
function renderGroupHistoryUI() {
    let historyContainer = document.getElementById('groupHistoryList');
    
    if (!historyContainer) {
        const groupCodeArea = document.getElementById('groupCodeArea');
        if (groupCodeArea) {
            const historyDiv = document.createElement('div');
            historyDiv.style.marginTop = "14px";
            historyDiv.style.paddingTop = "10px";
            historyDiv.style.borderTop = "1px dashed #e5e5ea";
            historyDiv.innerHTML = `
                <label style="font-size: 13px; color: #8e8e93; margin-bottom: 6px; display: block;">快速切換歷史房間：</label>
                <div id="groupHistoryList" style="display: flex; flex-wrap: wrap; gap: 8px;"></div>
            `;
            groupCodeArea.appendChild(historyDiv);
            historyContainer = document.getElementById('groupHistoryList');
        }
    }

    if (!historyContainer) return;

    let history = JSON.parse(localStorage.getItem('groupHistory')) || [];
    if (history.length === 0) {
        historyContainer.innerHTML = `<span style="font-size: 13px; color: #bcbcbf;">暫無加入歷史紀錄</span>`;
        return;
    }

    let buttonsHtml = "";
    history.forEach(code => {
        const isActive = (code === activeGroupCode);
        const btnStyle = isActive 
            ? "background: #5856d6; color: white; border: none; padding: 6px 12px; border-radius: 6px; font-size: 13px; font-weight: bold; cursor: pointer;"
            : "background: #e5e5ea; color: #1c1c1e; border: none; padding: 6px 12px; border-radius: 6px; font-size: 13px; cursor: pointer;";
        
        buttonsHtml += `<button type="button" class="history-room-btn" data-code="${code}" style="${btnStyle}">🏠 房間 ${code}</button>`;
    });
    historyContainer.innerHTML = buttonsHtml;

    document.querySelectorAll('.history-room-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const selectedCode = e.target.getAttribute('data-code');
            activeGroupCode = selectedCode;
            localStorage.setItem('lastActiveGroupCode', selectedCode);
            updateGroupUIState();
            if (currentMode === 'group') { expandedNodes = []; startListeningGroup(); }
        });
    });
}

function updateGroupUIState() {
    const statusEl = document.getElementById('currentGroupStatus');
    const leaveBtn = document.getElementById('leaveGroupBtn');
    const groupInput = document.getElementById('groupCode');
    
    if (groupInput) {
        groupInput.type = "text";
        groupInput.pattern = "[0-9]*";
        groupInput.inputMode = "numeric";
        groupInput.maxLength = 4;
        groupInput.placeholder = "請輸入 4 碼數字";
    }
    
    if (activeGroupCode) {
        if (statusEl) statusEl.innerText = `當前狀態：已連線房間【${activeGroupCode}】`;
        if (leaveBtn) leaveBtn.style.display = "block";
        if (groupInput) { groupInput.disabled = true; groupInput.value = activeGroupCode; }
    } else {
        if (statusEl) statusEl.innerText = "當前狀態：尚未進入任何群組房間";
        if (leaveBtn) leaveBtn.style.display = "none";
        if (groupInput) { groupInput.disabled = false; groupInput.value = ""; }
    }

    renderGroupHistoryUI();
}

const joinGroupBtn = document.getElementById('joinGroupBtn');
if (joinGroupBtn) {
    joinGroupBtn.addEventListener('click', () => {
        const code = document.getElementById('groupCode').value.trim();
        if (!/^\d{4}$/.test(code)) { alert('請輸入正確的 4 碼純數字房間代碼！'); return; }
        activeGroupCode = code;
        saveGroupToHistory(code);
        updateGroupUIState();
        if (currentMode === 'group') { expandedNodes = []; startListeningGroup(); }
    });
}

const createGroupBtn = document.getElementById('createGroupBtn');
if (createGroupBtn) {
    createGroupBtn.addEventListener('click', () => {
        let code = Math.floor(1000 + Math.random() * 9000).toString();
        activeGroupCode = code;
        saveGroupToHistory(code);
        alert(`🎉 成功建立群組房間！房間代號為：【${code}】\n請將這 4 碼數字分享給朋友，即可同步記帳！`);
        updateGroupUIState();
        if (currentMode === 'group') { expandedNodes = []; startListeningGroup(); }
    });
}

const leaveGroupBtn = document.getElementById('leaveGroupBtn');
if (leaveGroupBtn) {
    leaveGroupBtn.addEventListener('click', () => {
        if (confirm('🚪 確定要斷開當前群組房間的連線嗎？（不會清除歷史清單）')) {
            activeGroupCode = null;
            localStorage.removeItem('lastActiveGroupCode');
            updateGroupUIState();
            if (currentMode === 'group') { expandedNodes = []; startListeningGroup(); }
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

// 智慧發票 QR Code 掃描解析
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
                if (!dateMatch) throw new Error("找不到標準發票日期特徵");

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

// 個人資料監聽
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

// 群組資料監聽
function startListeningGroup() {
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

// 💡 核心功能：前端數據綜合渲染（包含完美對齊表格）
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
    let treeData = {};

    currentLoadedRecords.forEach(r => {
        totalSum += r.amount;
        if (currentMode === 'group') {
            let pName = r.payer ? r.payer : "未知成員";
            memberMap[pName] = (memberMap[pName] || 0) + r.amount;
        }

        const dateParts = r.date.split('-');
        if (dateParts.length === 3) {
            const year = dateParts[0] + "年";
            const month = dateParts[1] + "月";
            const day = dateParts[2] + "日";

            if (!treeData[year]) treeData[year] = {};
            if (!treeData[year][month]) treeData[year][month] = {};
            if (!treeData[year][month][day]) treeData[year][month][day] = [];
            
            treeData[year][month][day].push(r);
        }
    });

    // 1. 渲染上方統計報表卡片
    if (currentMode === 'personal') {
        reportCard.innerHTML = `<p style="font-size: 16px; margin: 5px 0;">個人私帳總消費：<strong style="color:#007aff; font-size:20px;">$${totalSum}</strong> 元</p>`;
    } else {
        let members = Object.keys(memberMap);
        let count = members.length;
        let avg = count > 0 ? Math.round(totalSum / count) : 0;

        let reportHtml = `<p style="font-size: 15px; margin-bottom: 10px;">👥 群組總消費：<strong style="color:#5856d6; font-size:18px;">$${totalSum}</strong> 元（平分人數：${count} 人，人均：$${avg} 元）</p><hr style="border:0; border-top:1px solid #e5e5ea; margin: 10px 0;">`;
        
        members.forEach(m => {
            let diff = memberMap[m] - avg;
            let statusStr = diff >= 0 
                ? `<span style="color:#34c759; font-weight:bold;">應拿回 $${Math.abs(diff)}</span>`
                : `<span style="color:#ff3b30; font-weight:bold;">應補分 $${Math.abs(diff)}</span>`;
            reportHtml += `<p style="font-size: 14px; margin: 6px 0;">🔹 <strong>${m}</strong>：共代墊 $${memberMap[m]} 元 (${statusStr})</p>`;
        });
        reportCard.innerHTML = reportHtml;
    }

    // 2. 建立巢狀歷史面板 HTML
    let html = '';
    const sortedYears = Object.keys(treeData).sort((a, b) => b.localeCompare(a));
    
    sortedYears.forEach(year => {
        let yearTotal = 0;
        Object.values(treeData[year]).forEach(m => Object.values(m).forEach(d => d.forEach(r => yearTotal += r.amount)));
        
        let isYearExpanded = expandedNodes.includes(year);
        html += `
        <div class="nested-group year-group">
            <div class="nested-header year-header" onclick="toggleNestedNode('${year}')">
                <span>${isYearExpanded ? '▼' : '▶'} 📅 ${year}</span>
                <span class="nested-total">年總計: $${yearTotal}</span>
            </div>
            <div class="nested-content" style="display: ${isYearExpanded ? 'block' : 'none'};">
        `;

        const sortedMonths = Object.keys(treeData[year]).sort((a, b) => b.localeCompare(a));
        sortedMonths.forEach(month => {
            const monthKey = `${year}-${month}`;
            let monthTotal = 0;
            Object.values(treeData[year][month]).forEach(d => d.forEach(r => monthTotal += r.amount));

            let isMonthExpanded = expandedNodes.includes(monthKey);
            html += `
            <div class="nested-group month-group" style="margin-left: 12px; margin-top: 4px;">
                <div class="nested-header month-header" onclick="event.stopPropagation(); toggleNestedNode('${monthKey}')">
                    <span>${isMonthExpanded ? '▼' : '▶'} 🗓️ ${month}</span>
                    <span class="nested-total">月總計: $${monthTotal}</span>
                </div>
                <div class="nested-content" style="display: ${isMonthExpanded ? 'block' : 'none'};">
            `;

            const sortedDays = Object.keys(treeData[year][month]).sort((a, b) => b.localeCompare(a));
            sortedDays.forEach(day => {
                const dayKey = `${year}-${month}-${day}`;
                const records = treeData[year][month][day];
                let dayTotal = records.reduce((sum, r) => sum + r.amount, 0);
                const rawDateStr = records[0].date; 

                let isDayExpanded = expandedNodes.includes(dayKey);
                html += `
                <div class="nested-group day-group" style="margin-left: 12px; margin-top: 4px; margin-bottom: 4px;">
                    <div class="nested-header day-header" onclick="event.stopPropagation(); toggleNestedNode('${dayKey}')">
                        <div class="date-title-left">
                            <input type="checkbox" class="date-group-chk" data-date="${rawDateStr}" onclick="event.stopPropagation(); toggleSelectDateGroup('${rawDateStr}', this.checked)">
                            <span>${isDayExpanded ? '▼' : '▶'} 📍 ${day}</span>
                        </div>
                        <span class="nested-total">日總計: $${dayTotal}</span>
                    </div>
                    <ul class="item-list" id="list-${rawDateStr}" style="display: ${isDayExpanded ? 'block' : 'none'}; margin-left: 12px; padding-left: 0;">
                `;

                // 💡 加入表格欄位表頭
                html += `
                        <div class="item-table-header">
                            <div style="width: 30px;"></div> <div class="col-name">品名</div>
                            ${currentMode === 'group' ? '<div class="col-payer">付款人</div>' : ''}
                            <div class="col-amount">金額</div>
                        </div>
                `;

                // 💡 替換為表格化單列設計
                records.forEach(r => {
                    let payerHtml = (currentMode === 'group') ? `<div class="col-payer item-payer">${r.payer || "未知"}</div>` : "";
                    html += `
                        <li class="item-row">
                            <div style="width: 30px; display: flex; align-items: center;">
                                <input type="checkbox" class="item-single-chk" data-id="${r.id}" data-date="${rawDateStr}" onclick="event.stopPropagation(); checkSingleStatus('${rawDateStr}')">
                            </div>
                            <div class="col-name item-name">${r.item}</div>
                            ${payerHtml}
                            <div class="col-amount item-amount">$${r.amount}</div>
                        </li>
                    `;
                });

                html += `</ul></div>`; // 關閉 day-group
            });

            html += `</div></div>`; // 關閉 month-group
        });

        html += `</div></div>`; // 關閉 year-group
    });

    container.innerHTML = html;
}

// 全域控制：折疊與展開節點常式
window.toggleNestedNode = function(nodeKey) {
    const index = expandedNodes.indexOf(nodeKey);
    if (index > -1) {
        expandedNodes.splice(index, 1);
    } else {
        expandedNodes.push(nodeKey);
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

// 刪除選中項目
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

// 清空全部項目
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