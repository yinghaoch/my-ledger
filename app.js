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
let currentMode = "personal"; // "personal" 或 "group"
let unsubscribe = null; // 用於存放實時監聽的取消函數
let html5QrcodeScanner = null; // QR 掃描器實例
let currentLoadedRecords = []; // 存放目前畫面上加載的紀錄（刪除用）
let expandedDates = []; // 紀錄目前被展開的日期分組

// 頁面載入時自動將日期填入今天
document.getElementById('dateInput').value = new Date().toISOString().split('T')[0];

// 監聽登入狀態
onAuthStateChanged(auth, (user) => {
    if (user) {
        currentUserUid = user.uid;
        currentUserName = user.displayName || "匿名使用者";
        document.getElementById('welcomeMsg').innerText = `👋 嗨，${currentUserName}！歡迎回來。`;
        document.getElementById('loginBtn').style.display = "none";
        document.getElementById('logoutBtn').style.display = "block";
        
        // 解鎖填寫區域
        document.getElementById('mainApp').style.opacity = "1";
        document.getElementById('mainApp').style.pointerEvents = "auto";
        
        // 初始化載入個人帳目
        switchMode('personal');
    } else {
        currentUserUid = null;
        currentUserName = "";
        document.getElementById('welcomeMsg').innerText = "請先登入以同步您的雲端帳本";
        document.getElementById('loginBtn').style.display = "block";
        document.getElementById('logoutBtn').style.display = "none";
        
        // 鎖定填寫區域
        document.getElementById('mainApp').style.opacity = "0.3";
        document.getElementById('mainApp').style.pointerEvents = "none";
        if (unsubscribe) unsubscribe();
    }
});

// 登入事件
document.getElementById('loginBtn').addEventListener('click', () => {
    signInWithPopup(auth, provider).catch((error) => {
        console.error("登入失敗", error);
        alert("登入失敗，請稍後再試！");
    });
});

// 登出事件
document.getElementById('logoutBtn').addEventListener('click', () => {
    signOut(auth).then(() => {
        window.location.reload();
    });
});

// === 📷 智慧發票 QR Code 掃描解析區塊 (全新相容性優化版) ===
document.getElementById('scanInvoiceBtn').addEventListener('click', () => {
    const readerDiv = document.getElementById('reader');
    
    // 如果掃描器已經打開，點擊則關閉
    if (html5QrcodeScanner && readerDiv.style.display === 'block') {
        cleanupScanner();
        return;
    }

    readerDiv.style.display = 'block';
    document.getElementById('scanInvoiceBtn').innerText = "🛑 關閉發票掃描器";
    document.getElementById('scanInvoiceBtn').style.background = "#ff3b30";

    try {
        html5QrcodeScanner = new Html5QrcodeScanner("reader", { 
            fps: 15, 
            qrbox: (viewfinderWidth, viewfinderHeight) => {
                const minEdge = Math.min(viewfinderWidth, viewfinderHeight);
                return { width: Math.floor(minEdge * 0.75), height: Math.floor(minEdge * 0.75) };
            },
            videoConstraints: { facingMode: "environment" }, // 強制調用後鏡頭
            rememberLastUsedCamera: true
        }, false);

        html5QrcodeScanner.render(
            (qrCodeMessage) => {
                // 基礎驗證：電子發票 QR Code 長度通常大於 24 碼
                if (!qrCodeMessage || qrCodeMessage.length < 24) return; 

                // 防呆：如果掃到右側條碼（通常以 ** 開頭或不含金額），不報錯，繼續等待對焦左側
                if (qrCodeMessage.startsWith("**")) return;

                try {
                    // 1. 🔍 使用正規表達式精準抓取台灣發票的「前17碼特徵」(2碼英文 + 8碼數字 + 7碼民國日期)
                    const match = qrCodeMessage.match(/^([A-Z]{2})(\d{8})(\d{7})/);
                    if (!match) return; // 格式不符就默默略過，繼續等待對齊

                    const invNum = match[1] + match[2]; // 發票號碼
                    const dateStr = match[3];           // 民國日期 (例如 1130526)
                    
                    // 2. 🔍 智慧定位十六進位金額（起點固定在第 21 碼，長度 8 碼）
                    if (qrCodeMessage.length < 29) return;
                    const hexAmount = qrCodeMessage.substring(21, 29);
                    const amount = parseInt(hexAmount, 16);

                    // 轉換民國年為西元年
                    const twYear = parseInt(dateStr.substring(0, 3), 10);
                    const year = twYear + 1911;
                    const month = dateStr.substring(3, 5);
                    const day = dateStr.substring(5, 7);

                    // 基礎安全驗證，防止解析出極端不合法的數據
                    if (isNaN(year) || isNaN(amount) || parseInt(month, 10) > 12 || parseInt(day, 10) > 31) return;

                    // 3. 🔍 嘗試解析發票品名（通常夾在後半段的冒號後面）
                    let finalItemName = `電子發票 (${invNum})`;
                    if (qrCodeMessage.includes(':')) {
                        const parts = qrCodeMessage.split(':');
                        if (parts && parts.length > 2) {
                            for (let i = 2; i < parts.length; i++) {
                                let p = parts[i].trim();
                                // 過濾掉純數字明細、太短的字、或星號遮蔽，抓出真正的品名
                                if (p && isNaN(p) && !p.includes('***') && p.length > 1) {
                                    finalItemName = `發票：${p}`;
                                    break;
                                }
                            }
                        }
                    }

                    // 4. 🎉 成功解碼！自動填入網頁表單
                    document.getElementById('dateInput').value = `${year}-${month}-${day}`;
                    document.getElementById('amountInput').value = amount;
                    document.getElementById('itemInput').value = finalItemName;

                    alert(`🎉 發票掃描成功！\n發票號碼: ${invNum}\n自動帶入金額: $${amount} 元`);