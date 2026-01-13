// 全局变量
let csvData = [];
let headers = [];
let imageUrlColumn = null;
let currentPage = 1;
let pageSize = 50;
let filteredData = [];
let selectedItems = new Set();
let currentRejectIndex = null;
let imageMetadataCache = new Map(); // 缓存图片元数据
let filterSelections = {}; // 存储每个筛选项的选中值
let activeDropdown = null; // 当前打开的下拉框
let isMobileView = false; // 手机预览模式状态

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


// 统计字段值分布
function getFieldStatistics(fieldName) {
    const stats = {};
    
    // 文本字段直接统计
    csvData.forEach(row => {
        const value = row[fieldName] || '(空)';
        stats[value] = (stats[value] || 0) + 1;
    });
    
    // 转换为数组并排序
    const result = Object.entries(stats)
        .map(([value, count]) => ({ value, count }))
        .sort((a, b) => b.count - a.count);
    
    return result;
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
        document.getElementById('mobileViewBtn').style.display = 'inline-block';
    };
    
    reader.readAsText(file, 'UTF-8');
});

// 设置筛选器
function setupFilters() {
    const filtersContent = document.getElementById('filtersContent');
    filtersContent.innerHTML = '';
    
    // 初始化筛选选择
    filterSelections = {};
    
    // 排除图片URL列和内部字段
    const filterableHeaders = headers.filter(h => 
        h !== imageUrlColumn && 
        !h.startsWith('_')
    );
    
    filterableHeaders.forEach(header => {
        createFilterDropdown(filtersContent, header, header, 'text');
    });
}

// 创建筛选下拉框
function createFilterDropdown(container, label, fieldName, type) {
    const filterItem = document.createElement('div');
    filterItem.className = 'filter-item';
    
    const labelSpan = document.createElement('span');
    labelSpan.textContent = label + ':';
    
    const button = document.createElement('button');
    button.className = 'filter-button';
    button.dataset.field = fieldName;
    button.dataset.type = type;
    
    const buttonText = document.createElement('span');
    buttonText.textContent = '全部';
    buttonText.className = 'filter-button-text';
    
    const arrow = document.createElement('span');
    arrow.className = 'filter-arrow';
    arrow.textContent = '▼';
    
    button.appendChild(buttonText);
    button.appendChild(arrow);
    
    button.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleFilterDropdown(button, fieldName, type);
    });
    
    filterItem.appendChild(labelSpan);
    filterItem.appendChild(button);
    container.appendChild(filterItem);
    
    // 初始化筛选选择
    filterSelections[fieldName] = new Set();
}

// 切换筛选下拉框
function toggleFilterDropdown(button, fieldName, type) {
    // 关闭其他下拉框
    if (activeDropdown && activeDropdown !== button) {
        closeActiveDropdown();
    }
    
    // 如果已经打开，则关闭
    const existingDropdown = button.parentElement.querySelector('.filter-dropdown');
    if (existingDropdown) {
        existingDropdown.remove();
        button.classList.remove('open');
        activeDropdown = null;
        return;
    }
    
    // 创建下拉框
    const dropdown = createDropdownPanel(fieldName, type);
    button.parentElement.appendChild(dropdown);
    button.classList.add('open');
    activeDropdown = button;
    
    // 显示下拉框
    setTimeout(() => dropdown.classList.add('show'), 10);
}

// 创建下拉面板
function createDropdownPanel(fieldName, type) {
    const dropdown = document.createElement('div');
    dropdown.className = 'filter-dropdown';
    
    // 搜索框
    const searchDiv = document.createElement('div');
    searchDiv.className = 'filter-search';
    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.placeholder = '搜索...';
    searchInput.addEventListener('input', (e) => {
        filterDropdownOptions(dropdown, e.target.value);
    });
    searchDiv.appendChild(searchInput);
    dropdown.appendChild(searchDiv);
    
    // 选项列表
    const optionsDiv = document.createElement('div');
    optionsDiv.className = 'filter-options';
    
    // 获取统计数据
    const stats = getFieldStatistics(fieldName);
    
    // 创建选项
    stats.forEach(({ value, count }) => {
        const option = document.createElement('div');
        option.className = 'filter-option';
        option.dataset.value = value;
        
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = filterSelections[fieldName].size === 0 || filterSelections[fieldName].has(value);
        checkbox.addEventListener('change', () => {
            updateFilterSelection(fieldName, value, checkbox.checked);
        });
        
        const labelSpan = document.createElement('span');
        labelSpan.className = 'filter-option-label';
        labelSpan.textContent = value;
        labelSpan.title = value;
        
        const countSpan = document.createElement('span');
        countSpan.className = 'filter-option-count';
        countSpan.textContent = `(${count})`;
        
        option.appendChild(checkbox);
        option.appendChild(labelSpan);
        option.appendChild(countSpan);
        
        option.addEventListener('click', (e) => {
            if (e.target !== checkbox) {
                checkbox.checked = !checkbox.checked;
                checkbox.dispatchEvent(new Event('change'));
            }
        });
        
        optionsDiv.appendChild(option);
    });
    
    dropdown.appendChild(optionsDiv);
    
    // 操作按钮
    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'filter-actions';
    
    const selectAllBtn = document.createElement('button');
    selectAllBtn.textContent = '全选';
    selectAllBtn.addEventListener('click', () => selectAllOptions(dropdown, fieldName, true));
    
    const clearAllBtn = document.createElement('button');
    clearAllBtn.textContent = '清除';
    clearAllBtn.addEventListener('click', () => selectAllOptions(dropdown, fieldName, false));
    
    const applyBtn = document.createElement('button');
    applyBtn.textContent = '确定';
    applyBtn.style.backgroundColor = '#1890ff';
    applyBtn.style.color = 'white';
    applyBtn.style.border = 'none';
    applyBtn.addEventListener('click', () => {
        closeActiveDropdown();
        applyFilters();
    });
    
    actionsDiv.appendChild(selectAllBtn);
    actionsDiv.appendChild(clearAllBtn);
    actionsDiv.appendChild(applyBtn);
    dropdown.appendChild(actionsDiv);
    
    return dropdown;
}

// 筛选下拉选项
function filterDropdownOptions(dropdown, searchText) {
    const options = dropdown.querySelectorAll('.filter-option');
    const search = searchText.toLowerCase();
    
    options.forEach(option => {
        const label = option.querySelector('.filter-option-label').textContent.toLowerCase();
        option.style.display = label.includes(search) ? 'flex' : 'none';
    });
}

// 更新筛选选择
function updateFilterSelection(fieldName, value, checked) {
    if (checked) {
        filterSelections[fieldName].add(value);
    } else {
        filterSelections[fieldName].delete(value);
    }
    
    updateFilterButtonText(fieldName);
}

// 全选/清除选项
function selectAllOptions(dropdown, fieldName, selectAll) {
    const checkboxes = dropdown.querySelectorAll('.filter-option input[type="checkbox"]');
    checkboxes.forEach(checkbox => {
        const option = checkbox.closest('.filter-option');
        if (option.style.display !== 'none') {
            checkbox.checked = selectAll;
            const value = option.dataset.value;
            if (selectAll) {
                filterSelections[fieldName].add(value);
            } else {
                filterSelections[fieldName].delete(value);
            }
        }
    });
    
    updateFilterButtonText(fieldName);
}

// 更新筛选按钮文本
function updateFilterButtonText(fieldName) {
    const button = document.querySelector(`.filter-button[data-field="${fieldName}"]`);
    if (!button) return;
    
    const buttonText = button.querySelector('.filter-button-text');
    const selectedCount = filterSelections[fieldName].size;
    
    if (selectedCount === 0) {
        buttonText.innerHTML = '全部';
        button.classList.remove('active');
    } else {
        const stats = getFieldStatistics(fieldName);
        const totalCount = stats.length;
        
        if (selectedCount === totalCount) {
            buttonText.innerHTML = '全部';
            button.classList.remove('active');
        } else {
            buttonText.innerHTML = `已选 <span class="filter-badge">${selectedCount}</span>`;
            button.classList.add('active');
        }
    }
}

// 关闭当前打开的下拉框
function closeActiveDropdown() {
    if (activeDropdown) {
        const dropdown = activeDropdown.parentElement.querySelector('.filter-dropdown');
        if (dropdown) {
            dropdown.remove();
        }
        activeDropdown.classList.remove('open');
        activeDropdown = null;
    }
}

// 点击外部关闭下拉框
document.addEventListener('click', (e) => {
    if (activeDropdown && !e.target.closest('.filter-item')) {
        closeActiveDropdown();
    }
});

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
    filteredData = csvData.filter(row => {
        // 检查每个筛选字段
        return Object.keys(filterSelections).every(fieldName => {
            const selectedValues = filterSelections[fieldName];
            
            // 如果没有选中任何值，显示全部
            if (selectedValues.size === 0) {
                return true;
            }
            
            // 获取该行在该字段的值
            let rowValue = row[fieldName];
            
            if (!rowValue) {
                rowValue = '(空)';
            }
            
            // 检查该值是否在选中的值中
            return selectedValues.has(rowValue);
        });
    });
    
    currentPage = 1;
    selectedItems.clear();
    renderImages();
    updateToolbar();
}

// 清除筛选
function clearFilters() {
    // 清除所有筛选选择
    Object.keys(filterSelections).forEach(fieldName => {
        filterSelections[fieldName].clear();
        updateFilterButtonText(fieldName);
    });
    
    // 关闭打开的下拉框
    closeActiveDropdown();
    
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

// 更新图片信息显示
function updateImageInfo(infoDiv, row) {
    infoDiv.innerHTML = '';
    
    // 显示CSV中的其他字段
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
    updateImageInfo(infoDiv, row);
    
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


// 切换手机预览模式
function toggleMobileView() {
    isMobileView = !isMobileView;
    const container = document.querySelector('.container');
    const btn = document.getElementById('mobileViewBtn');
    
    if (isMobileView) {
        container.classList.add('mobile-view');
        btn.textContent = '💻 桌面预览';
        btn.classList.remove('btn-secondary');
        btn.classList.add('btn-primary');
    } else {
        container.classList.remove('mobile-view');
        btn.textContent = '📱 手机预览';
        btn.classList.remove('btn-primary');
        btn.classList.add('btn-secondary');
    }
}
