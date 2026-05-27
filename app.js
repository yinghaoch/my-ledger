// 📷 智慧發票 QR Code 掃描解析（徹底加入防呆，杜絕晃動卡死錯誤）
document.getElementById('scanInvoiceBtn').addEventListener('click', () => {
    const readerDiv = document.getElementById('reader');
    readerDiv.style.display = 'block';

    if (html5QrcodeScanner) {
        html5QrcodeScanner.clear().catch(() => {});
    }

    html_5_qrcode_scanner = new Html5QrcodeScanner("reader", {
        fps: 15, 
        qrbox: (viewfinderWidth, viewfinderHeight) => {
            const minEdge = Math.min(viewfinderWidth, viewfinderHeight);
            return { width: Math.floor(minEdge * 0.7), height: Math.floor(minEdge * 0.7) };
        },
        rememberLast_used_camera:true
    }, false);

    html5QrcodeScanner.render(
        (qrCodeMessage) => {
            // 1. 基礎過濾
            if (!qrCodeMessage || qrCodeMessage.length < 30) return;

            try {
                // 2. 尋找日期 (找 7 位數字，例如 1130520)
                const dateMatch = qrCodeMessage.match(/\d{7}/);
                if (!dateMatch) throw new Error("找不到日期");

                const dateStr = dateMatch[0];
                const twYear = parseInt(dateStr.substring(0, 3), 10);
                const year = twYear + 1911;
                const month = dateStr.substring(3, 5);
                const day = dateStr.substring(5, 7);

                // 3. 【關鍵修改】使用正則尋找金額
                // 傳統發票 QR Code 金額通常在日期後方一段距離，且為 8 碼 16 進位
                // 這裡我們改用尋找日期後方「符合 16 進位特徵的 8 碼字串」
                // 或是尋找包含冒號後的特定區塊

                let amount = 0;
                // 嘗試尋找日期後方緊接的 8 碼 16 進位字串
                const amountRegex = new RegExp(dateStr + "(\\d{4,8})", "i");
                // 備案：如果無法直接定位，我們掃描整個字串中符合 16 進位特徵的區塊
                const hexPattern = /[0-9A-F]{8,}/i;
                const hexMatch = qrCodeMessage.match(hexPattern);

                if (hexMatch) {
                    // 這裡我們取日期後方最接近的一個 16 進位區塊
                    // 為了安全，我們先嘗試找日期後面那個 block
                    const afterDateStr = qrCodeMessage.substring(qrCodeMessage.indexOf(dateStr) + 7);
                    const nextHexMatch = afterDateStr.match(/[0-9A-F]{8}/i);
                    if (nextHexMatch) {
                        amount = parseInt(nextHexMatch[0], 16);
                    } else {
                        // 如果找不到，退而求其次使用原有的邏輯但加上 try-catch
                        const fallbackHex = qrCodeMessage.substring(qrCodeMessage.indexOf(dateStr) + 11, qrCodeMessage.indexOf(dateStr) + 19);
                        amount = parseInt(fallbackHex, 16);
                    }
                }

                if (isNaN(amount) || amount <= 0) throw new Error("金額解析失敗");

                // 4. 品名解析 (保持你原本的邏輯，但增加防呆)
                let finalItemName = "電子發票消費";
                const parts = qrCodeMessage.split(':');
                if (parts.length > 2) {
                    for (let i = 2; i < parts.length; i++) {
                        let p = parts[i].trim();
                        if (p && !isNaN(p) === false && !p.includes('***')) {
                            finalItemName = `發票：${p}`;
                            break;
                        }
                    }
                }

                // 5. 填入表單
                document.getElementById('dateInput').value = `${year}-${month}-${day}`;
                document.getElementById('amountInput').value = amount;
                document.getElementById('itemInput').value = finalItemName;

                alert(`🎉 掃描成功！\n金額: $${amount} 元`);

                html5QrcodeScanner.clear().then(() => {
                    readerDiv.style.display = 'none';
                }).catch(() => {
                    readerDiv.style.display = 'none';
                });

            } catch (err) {
                console.log("掃描解析失敗:", err.message);
            }
        },
        (errorMessage) => {}
    );
});
