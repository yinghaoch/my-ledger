// 在日期展開後的清單頂部，加上「欄位標題列」
html += `
    <div class="item-table-header">
        <div style="width: 30px;"></div> <div class="col-name">品名</div>
        ${currentMode === 'group' ? '<div class="col-payer">付款人</div>' : ''}
        <div class="col-amount">金額</div>
    </div>
`;

records.forEach(r => {
    let payerHtml = (currentMode === 'group') ? `<div class="col-payer item-payer">${r.payer}</div>` : "";
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