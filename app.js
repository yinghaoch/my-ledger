import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getFirestore, collection, addDoc, onSnapshot, query, where, orderBy } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
// 新增：引入雲端相簿儲存套件
import { getStorage, ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js";

// ⚠️ 請填入你在 Firebase 申請的金鑰
const firebaseConfig = {
    apiKey: "請替換成你的API_KEY",
    authDomain: "你的專案.firebaseapp.com",
    projectId: "你的專案ID",
    storageBucket: "你的專案.appspot.com",
    messagingSenderId: "您的ID",
    appId: "你的APP_ID"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const storage = getStorage(app); // 初始化儲存空間
const provider = new GoogleAuthProvider();

let currentUserUid = null;
let currentUserName = "";
let currentMode = "personal";
let unsubscribe = null;
let compressedBlob = null; // 存放壓縮後的圖片二進位資料
let html5QrcodeScanner = null;

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

// 📷 功能一：發票 QR Code 掃描與自動解析邏輯
document.getElementById('scanInvoiceBtn').addEventListener('click', () => {
    const readerDiv = document.getElementById('reader');
    if (readerDiv.style.display === 'none') {
        readerDiv.style.display = 'block';
        // 啟動相機
        html5QrcodeScanner = new Html5Qrcode("reader");
        html5QrcodeScanner.start(
            { facingMode: "environment" }, // 使用後鏡頭
            { fps: 10, qrbox: { width: 250, height: 250 } },
            (qrCodeMessage) => {
                // 掃描成功，解析台灣電子發票格式 (左邊 QR Code 共 84 碼)
                // 格式範例: AB123456781150705... (前10碼發票號碼, 接下來3碼民國年, 2碼月份, 2碼日期, 8碼十六進位金額)
                if (qrCodeMessage.length >= 30) {
                    const year = parseInt(qrCodeMessage.substring(10, 13)) + 1911; // 民國轉西元
                    const month = qrCodeMessage.substring(13, 15);
                    const day = qrCodeMessage.substring(15, 17);
                    // 金額是 17 到 25 碼的十六進位字串，轉成十進位
                    const hexAmount = qrCodeMessage.substring(17, 25);
                    const amount = parseInt(hexAmount, 16);

                    // 自動帶入輸入框
                    document.getElementById('dateInput').value = `${year}-${month}-${day}`;
                    document.getElementById('amountInput').value = amount;
                    document.getElementById('itemInput').value = "電子發票花費";
                    
                    alert(`🎉 掃描成功！自動帶入金額: $${amount}`);
                    stopScanner();
                } else {
                    alert("這似乎不是標準的台灣電子發票左側 QR Code，請掃描左邊那顆試試！");
                }
            },
            (errorMessage) => { /* 掃描中...忽略錯誤提示 */ }
        );
    } else {
        stopScanner();
    }
});

function stopScanner() {
    if (html5QrcodeScanner) {
        html5QrcodeScanner.stop().then(() => {
            document.getElementById('reader').style.display = 'none';
        });
    }
}

// 🖼️ 功能二：本地相片縮圖、Canvas 自動壓縮演算法
document.getElementById('photoInput').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = function (event) {
        const img = new Image();
        img.src = event.target.result;
        img.onload = function () {
            // 設定最大寬度，等比例縮小圖片
            const max_width = 800;
            let width = img.width;
            let height = img.height;

            if (width > max_width) {
                height = Math.round((height * max_width) / width);
                width = max_width;
            }

            // 利用 Canvas 重新繪製壓縮圖
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);

            // 壓縮品質設為 0.7 (70%) 轉成二進位 Blob 檔案
            canvas.toBlob((blob) => {
                compressedBlob = blob;
                // 顯示預覽畫面與壓縮資訊
                document.getElementById('imgPreview').src = canvas.toDataURL('image/jpeg', 0.7);
                document.getElementById('previewArea').style.display = 'block';
                document.getElementById('compressInfo').innerText = `原本: ${(file.size/1024/1024).toFixed(2)}MB -> 壓縮後: ${(blob.size/1024).toFixed(0)}KB (省下大量頻寬！)`;
            }, 'image/jpeg', 0.7);
        };
    };
});

// 儲存按鈕（含檔案上傳邏輯）
document.getElementById('saveBtn').addEventListener('click', async () => {
    const date = document.getElementById('dateInput').value;
    const item = document.getElementById('itemInput').value.trim();
    const amount = parseFloat(document.getElementById('amountInput').value);

    if (!item || !amount || !date) { alert('請填寫完整的日期、品名與金額！'); return; }

    // 按鈕防重複點擊
    document.getElementById('saveBtn').innerText = "上傳中...";
    document.getElementById('saveBtn').disabled = true;

    let imageUrl = "";

    // 如果有附照片，先將壓縮後的圖片上傳至 Firebase Storage
    if (compressedBlob) {
        const fileRef = ref(storage, `receipts/${currentUserUid}_${new Date().getTime()}.jpg`);
        try {
            const uploadResult = await uploadBytes(fileRef, compressedBlob);
            imageUrl = await getDownloadURL(uploadResult.ref); // 拿到雲端圖片的永久公開網址
        } catch (err) {
            console.error("圖片上傳失敗", err);
        }
    }

    let newRecord = {
        mode: currentMode,
        date: date,
        item: item,
        amount: amount,
        imageUrl: imageUrl, // 存入圖片網址（若無則為空字串）
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
        // 還原輸入框
        document.getElementById('itemInput').value = '';
        document.getElementById('amountInput').value = '';
        document.getElementById('photoInput').value = '';
        document.getElementById('previewArea').style.display = 'none';
        compressedBlob = null;
    } catch (e) {
        alert("儲存失敗！");
    } finally {
        document.getElementById('saveBtn').innerText = "儲存至雲端";
        document.getElementById('saveBtn').disabled = false;
    }
});

// 渲染清單（支援圖片點擊放大）
function renderList(snapshot, isPersonal) {
    let total = 0; let html = ''; let records = []; let membersSet = new Set();
    snapshot.forEach((doc) => {
        const r = doc.data(); records.push(r); total += r.amount; if (!isPersonal) membersSet.add(r.payer);
        
        // 檢查是否有附照片網址，有的話就渲染 <img> 標籤
        const imgHtml = r.imageUrl ? `<a href="${r.imageUrl}" target="_blank"><img src="${r.imageUrl}" class="receipt-thumb"></a>` : '';

        html += `
            <li>
                <div class="history-item-content">
                    <div class="history-details">
                        <div class="li-top"><span>${r.item}</span><span>$${r.amount}</span></div>
                        <div class="li-bottom"><span>${isPersonal ? '' : '付款人: ' + r.payer + ' | '}${r.date}</span></div>
                    </div>
                    ${imgHtml}
                </div>
            </li>`;
    });
    document.getElementById('historyList').innerHTML = html;
    return { total, records, members: Array.from(membersSet) };
}

function startListeningPersonal() {
    const q = query(collection(db, "all_ledgers"), where("mode", "==", "personal"), where("uid", "==", currentUserUid), orderBy("timestamp", "desc"));
    unsubscribe = onSnapshot(q, (snapshot) => {
        const { total } = renderList(snapshot, true);
        document.getElementById('reportCard').innerHTML = `<p style="font-size:16px; font-weight:bold;">🔒 您的個人總消費：$${total.toFixed(0)} 元</p>`;
    });
}

function startListeningGroup() {
    const targetGroup = document.getElementById('groupCode').value.trim();
    const q = query(collection(db, "all_ledgers"), where("mode", "==", "group"), where("groupCode", "==", targetGroup), orderBy("timestamp", "desc"));
    unsubscribe = onSnapshot(q, (snapshot) => {
        const { total: totalSpent, records, members } = renderList(snapshot, false);
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