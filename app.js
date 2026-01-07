// 全局变量
let csvData = [];
let headers = [];
let imageUrlColumn = null;
let currentPage = 1;
let pageSize = 50;
let filteredData = [];
let selectedItems = new Set();
let currentRejectIndex = null;

// CSV解析库（简化版）
function parseCSV(text) {
    const lines = text.split('\n').filter(line => line.trim());
    if (lines.length === 0) return { headers: [], data: [] };
    
    // 处理CSV，支持引号内的逗号
    const parseLine = (line) => {
        const result = [];
        let current = '';
        let inQuotes = false;
        
        for (let i = 0; i < line.length; i++) {
            const char = line[i];
            if (char === '"') {
                inQuotes = !inQuotes;
            } else if (char === ',' && !inQuotes) {
                result.push(current.trim());
                current = '';
            } else {
                current += char;
            }
        }
        result.push(current.trim());
        return result;
    };
    
    const headers = parseLine(lines[0]);
    const data = [];
    
    for (let i = 1; i < lines.length; i++) {
        const values = parseLine(lines[i]);
        if (values.length === headers.length) {
            const row = {};
            headers.forEach((header, index) => {
                row[header] = values[index] || '';
            });
            data.push(row);
        }
    }
    
    return { headers, data };
}

// 识别图片URL列
function detectImageUrlColumn(headers, data) {
    // 可能的图片URL列名
    const possibleNames = [
        '角色图片（超链接）',
        '抠图url',
        '图片url',
        '图片URL',
        'image_url',
        'imageUrl',
        'url',
        '图片',
        'image'
    ];
    
    // 先尝试匹配可能的列名
    for (const name of possibleNames) {
        if (headers.includes(name)) {
            return name;
        }
    }
    
    // 如果没有找到，检查每列是否包含URL
    for (const header of headers) {
        const sampleValues = data.slice(0, 10).map(row => row[header]).filter(v => v);
        const urlCount = sampleValues.filter(v => 
            /^https?:\/\//.test(v) || /\.(jpg|jpeg|png|gif|webp|bmp)$/i.test(v)
        ).length;
        
        if (urlCount > sampleValues.length * 0.5) {
            return header;
        }
    }
    
    return null;
}

// 导入CSV文件
document.getElementById('csvFileInput').addEventListener('change', function(e) {
    const file = e.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = function(event) {
        const text = event.target.result;
        const result = parseCSV(text);
        
        headers = result.headers;
        csvData = result.data;
        
        // 识别图片URL列
        imageUrlColumn = detectImageUrlColumn(headers, csvData);
        
        if (!imageUrlColumn) {
            alert('未找到图片URL列，请确保CSV中包含图片URL字段');
            return;
        }
        
        // 初始化审核状态
        csvData.forEach((row, index) => {
            if (!row._reviewStatus) {
                row._reviewStatus = 'pending';
                row._rejectReason = '';
                row._index = index;
            }
        });
        
        filteredData = [...csvData];
        currentPage = 1;
        selectedItems.clear();
        
        // 显示界面
        setupFilters();
        renderImages();
        updateToolbar();
        
        document.getElementById('emptyState').style.display = 'none';
        document.getElementById('imagesGrid').style.display = 'grid';
        document.getElementById('filtersContainer').style.display = 'block';
        document.getElementById('toolbar').style.display = 'flex';
        document.getElementById('exportBtn').disabled = false;
    };
    
    reader.readAsText(file, 'UTF-8');
});

// 设置筛选器
function setupFilters() {
    const filtersContent = document.getElementById('filtersContent');
    filtersContent.innerHTML = '';
    
    // 排除图片URL列和内部字段
    const filterableHeaders = headers.filter(h => 
        h !== imageUrlColumn && 
        !h.startsWith('_')
    );
    
    filterableHeaders.forEach(header => {
        const filterItem = document.createElement('div');
        filterItem.className = 'filter-item';
        
        const label = document.createElement('label');
        label.textContent = header + ':';
        
        const input = document.createElement('input');
        input.type = 'text';
        input.placeholder = '输入筛选条件...';
        input.dataset.header = header;
        input.addEventListener('input', debounce(applyFilters, 300));
        
        filterItem.appendChild(label);
        filterItem.appendChild(input);
        filtersContent.appendChild(filterItem);
    });
}

// 防抖函数
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// 应用筛选
function applyFilters() {
    const filterInputs = document.querySelectorAll('#filtersContent input');
    const filters = {};
    
    filterInputs.forEach(input => {
        const value = input.value.trim();
        if (value) {
            filters[input.dataset.header] = value.toLowerCase();
        }
    });
    
    filteredData = csvData.filter(row => {
        return Object.keys(filters).every(header => {
            const cellValue = String(row[header] || '').toLowerCase();
            return cellValue.includes(filters[header]);
        });
    });
    
    currentPage = 1;
    selectedItems.clear();
    renderImages();
    updateToolbar();
}

// 清除筛选
function clearFilters() {
    const filterInputs = document.querySelectorAll('#filtersContent input');
    filterInputs.forEach(input => {
        input.value = '';
    });
    filteredData = [...csvData];
    currentPage = 1;
    selectedItems.clear();
    renderImages();
    updateToolbar();
}

// 改变每页显示数量
function changePageSize() {
    pageSize = parseInt(document.getElementById('pageSizeSelect').value);
    currentPage = 1;
    selectedItems.clear();
    renderImages();
    updateToolbar();
}

// 渲染图片
function renderImages() {
    const grid = document.getElementById('imagesGrid');
    grid.innerHTML = '';
    
    const startIndex = (currentPage - 1) * pageSize;
    const endIndex = startIndex + pageSize;
    const pageData = filteredData.slice(startIndex, endIndex);
    
    pageData.forEach((row, index) => {
        const actualIndex = startIndex + index;
        const imageUrl = row[imageUrlColumn] || '';
        const card = createImageCard(row, actualIndex, imageUrl);
        grid.appendChild(card);
    });
    
    // 预加载图片
    pageData.forEach(row => {
        const imageUrl = row[imageUrlColumn] || '';
        if (imageUrl) {
            preloadImage(imageUrl);
        }
    });
}

// 创建图片卡片
function createImageCard(row, index, imageUrl) {
    const card = document.createElement('div');
    card.className = 'image-card';
    card.dataset.index = index;
    
    if (selectedItems.has(index)) {
        card.classList.add('selected');
    }
    
    // 图片区域
    const imageWrapper = document.createElement('div');
    imageWrapper.className = 'image-wrapper';
    
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'image-checkbox';
    checkbox.checked = selectedItems.has(index);
    checkbox.onchange = () => toggleSelect(index);
    
    const img = document.createElement('img');
    img.dataset.index = index;
    
    const loadingDiv = document.createElement('div');
    loadingDiv.className = 'image-loading';
    loadingDiv.textContent = '加载中...';
    
    const errorDiv = document.createElement('div');
    errorDiv.className = 'image-error';
    errorDiv.textContent = '加载失败';
    errorDiv.style.display = 'none';
    
    if (imageUrl) {
        img.src = imageUrl;
        img.onload = () => {
            loadingDiv.style.display = 'none';
        };
        img.onerror = () => {
            loadingDiv.style.display = 'none';
            errorDiv.style.display = 'block';
        };
    } else {
        loadingDiv.textContent = '无图片URL';
        img.style.display = 'none';
    }
    
    imageWrapper.appendChild(checkbox);
    imageWrapper.appendChild(img);
    imageWrapper.appendChild(loadingDiv);
    imageWrapper.appendChild(errorDiv);
    
    // 审核状态标签
    if (row._reviewStatus === 'approved') {
        const statusBadge = document.createElement('div');
        statusBadge.className = 'image-status approved';
        statusBadge.textContent = '已通过';
        imageWrapper.appendChild(statusBadge);
    } else if (row._reviewStatus === 'rejected') {
        const statusBadge = document.createElement('div');
        statusBadge.className = 'image-status rejected';
        statusBadge.textContent = '已拒绝';
        imageWrapper.appendChild(statusBadge);
    }
    
    // 信息区域
    const infoDiv = document.createElement('div');
    infoDiv.className = 'image-info';
    
    headers.forEach(header => {
        if (header !== imageUrlColumn && !header.startsWith('_')) {
            const value = row[header] || '';
            if (value) {
                const rowDiv = document.createElement('div');
                rowDiv.className = 'image-info-row';
                
                const label = document.createElement('span');
                label.className = 'image-info-label';
                label.textContent = header + ':';
                
                const valueSpan = document.createElement('span');
                valueSpan.className = 'image-info-value';
                valueSpan.textContent = value;
                
                rowDiv.appendChild(label);
                rowDiv.appendChild(valueSpan);
                infoDiv.appendChild(rowDiv);
            }
        }
    });
    
    // 操作按钮
    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'image-actions';
    
    const approveBtn = document.createElement('button');
    approveBtn.className = 'btn btn-success';
    approveBtn.textContent = '通过';
    approveBtn.onclick = () => approveImage(index);
    
    const rejectBtn = document.createElement('button');
    rejectBtn.className = 'btn btn-danger';
    rejectBtn.textContent = '不通过';
    rejectBtn.onclick = () => rejectImage(index);
    
    if (row._reviewStatus === 'approved') {
        approveBtn.disabled = true;
        approveBtn.style.opacity = '0.5';
    } else if (row._reviewStatus === 'rejected') {
        rejectBtn.disabled = true;
        rejectBtn.style.opacity = '0.5';
    }
    
    actionsDiv.appendChild(approveBtn);
    actionsDiv.appendChild(rejectBtn);
    
    card.appendChild(imageWrapper);
    card.appendChild(infoDiv);
    card.appendChild(actionsDiv);
    
    return card;
}

// 预加载图片
function preloadImage(url) {
    if (!url) return;
    const img = new Image();
    img.src = url;
}

// 切换选择
function toggleSelect(index) {
    if (selectedItems.has(index)) {
        selectedItems.delete(index);
    } else {
        selectedItems.add(index);
    }
    
    const card = document.querySelector(`.image-card[data-index="${index}"]`);
    if (card) {
        card.classList.toggle('selected');
        const checkbox = card.querySelector('.image-checkbox');
        if (checkbox) {
            checkbox.checked = selectedItems.has(index);
        }
    }
}

// 全选本页
function selectAllCurrentPage() {
    const startIndex = (currentPage - 1) * pageSize;
    const endIndex = Math.min(startIndex + pageSize, filteredData.length);
    
    for (let i = startIndex; i < endIndex; i++) {
        selectedItems.add(i);
        const card = document.querySelector(`.image-card[data-index="${i}"]`);
        if (card) {
            card.classList.add('selected');
            const checkbox = card.querySelector('.image-checkbox');
            if (checkbox) {
                checkbox.checked = true;
            }
        }
    }
}

// 通过图片
function approveImage(index) {
    const row = filteredData[index];
    if (row) {
        row._reviewStatus = 'approved';
        row._rejectReason = '';
        renderImages();
    }
}

// 不通过图片
function rejectImage(index) {
    currentRejectIndex = index;
    document.getElementById('rejectReasonInput').value = '';
    document.getElementById('rejectModal').style.display = 'flex';
}

// 关闭拒绝模态框
function closeRejectModal() {
    document.getElementById('rejectModal').style.display = 'none';
    currentRejectIndex = null;
}

// 确认拒绝
function confirmReject() {
    const reason = document.getElementById('rejectReasonInput').value.trim();
    if (currentRejectIndex !== null) {
        const row = filteredData[currentRejectIndex];
        if (row) {
            row._reviewStatus = 'rejected';
            row._rejectReason = reason;
            renderImages();
        }
    }
    closeRejectModal();
}

// 批量通过选中
function approveSelected() {
    if (selectedItems.size === 0) {
        alert('请先选择要通过的图片');
        return;
    }
    
    if (confirm(`确定要通过选中的 ${selectedItems.size} 张图片吗？`)) {
        selectedItems.forEach(index => {
            const row = filteredData[index];
            if (row) {
                row._reviewStatus = 'approved';
                row._rejectReason = '';
            }
        });
        selectedItems.clear();
        renderImages();
        updateToolbar();
    }
}

// 更新工具栏
function updateToolbar() {
    const totalPages = Math.ceil(filteredData.length / pageSize);
    const pageInfo = document.getElementById('pageInfo');
    pageInfo.textContent = `共 ${filteredData.length} 条，第 ${currentPage} / ${totalPages} 页`;
    
    const pagination = document.getElementById('pagination');
    pagination.innerHTML = '';
    
    // 上一页按钮
    const prevBtn = document.createElement('button');
    prevBtn.textContent = '上一页';
    prevBtn.disabled = currentPage === 1;
    prevBtn.onclick = () => {
        if (currentPage > 1) {
            currentPage--;
            selectedItems.clear();
            renderImages();
            updateToolbar();
        }
    };
    pagination.appendChild(prevBtn);
    
    // 页码按钮
    const maxButtons = 5;
    let startPage = Math.max(1, currentPage - Math.floor(maxButtons / 2));
    let endPage = Math.min(totalPages, startPage + maxButtons - 1);
    
    if (endPage - startPage < maxButtons - 1) {
        startPage = Math.max(1, endPage - maxButtons + 1);
    }
    
    if (startPage > 1) {
        const firstBtn = document.createElement('button');
        firstBtn.textContent = '1';
        firstBtn.onclick = () => {
            currentPage = 1;
            selectedItems.clear();
            renderImages();
            updateToolbar();
        };
        pagination.appendChild(firstBtn);
        
        if (startPage > 2) {
            const ellipsis = document.createElement('span');
            ellipsis.textContent = '...';
            ellipsis.style.padding = '0 5px';
            pagination.appendChild(ellipsis);
        }
    }
    
    for (let i = startPage; i <= endPage; i++) {
        const pageBtn = document.createElement('button');
        pageBtn.textContent = i;
        pageBtn.className = i === currentPage ? 'active' : '';
        pageBtn.onclick = () => {
            currentPage = i;
            selectedItems.clear();
            renderImages();
            updateToolbar();
        };
        pagination.appendChild(pageBtn);
    }
    
    if (endPage < totalPages) {
        if (endPage < totalPages - 1) {
            const ellipsis = document.createElement('span');
            ellipsis.textContent = '...';
            ellipsis.style.padding = '0 5px';
            pagination.appendChild(ellipsis);
        }
        
        const lastBtn = document.createElement('button');
        lastBtn.textContent = totalPages;
        lastBtn.onclick = () => {
            currentPage = totalPages;
            selectedItems.clear();
            renderImages();
            updateToolbar();
        };
        pagination.appendChild(lastBtn);
    }
    
    // 下一页按钮
    const nextBtn = document.createElement('button');
    nextBtn.textContent = '下一页';
    nextBtn.disabled = currentPage === totalPages;
    nextBtn.onclick = () => {
        if (currentPage < totalPages) {
            currentPage++;
            selectedItems.clear();
            renderImages();
            updateToolbar();
        }
    };
    pagination.appendChild(nextBtn);
}

// 导出审核结果
function exportResults() {
    // 创建新的CSV数据，添加审核结果列
    const exportHeaders = [...headers, '审核结果', '不通过理由'];
    const exportData = csvData.map(row => {
        const exportRow = {};
        headers.forEach(header => {
            exportRow[header] = row[header] || '';
        });
        
        // 添加审核结果
        const status = row._reviewStatus || 'pending';
        if (status === 'approved') {
            exportRow['审核结果'] = '通过';
        } else if (status === 'rejected') {
            exportRow['审核结果'] = '不通过';
        } else {
            exportRow['审核结果'] = '待审核';
        }
        
        exportRow['不通过理由'] = row._rejectReason || '';
        
        return exportRow;
    });
    
    // 转换为CSV格式
    const escapeCSV = (value) => {
        if (value === null || value === undefined) return '';
        const str = String(value);
        if (str.includes(',') || str.includes('"') || str.includes('\n')) {
            return '"' + str.replace(/"/g, '""') + '"';
        }
        return str;
    };
    
    let csvContent = exportHeaders.map(escapeCSV).join(',') + '\n';
    exportData.forEach(row => {
        const values = exportHeaders.map(header => escapeCSV(row[header]));
        csvContent += values.join(',') + '\n';
    });
    
    // 下载文件
    const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    
    const now = new Date();
    const timestamp = now.getFullYear() + 
        String(now.getMonth() + 1).padStart(2, '0') + 
        String(now.getDate()).padStart(2, '0') + '_' +
        String(now.getHours()).padStart(2, '0') + 
        String(now.getMinutes()).padStart(2, '0') + 
        String(now.getSeconds()).padStart(2, '0');
    
    link.setAttribute('download', `审核结果_${timestamp}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// 点击模态框外部关闭
document.getElementById('rejectModal').addEventListener('click', function(e) {
    if (e.target === this) {
        closeRejectModal();
    }
});

// 回车确认拒绝
document.getElementById('rejectReasonInput').addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && e.ctrlKey) {
        confirmReject();
    }
});

