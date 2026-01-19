// 全局变量
let csvData = [];
let headers = [];
let imageUrlColumns = []; // 改为数组，支持多列URL
let currentPage = 1;
let pageSize = 50;
let filteredData = [];
let selectedItems = new Set();
let currentRejectIndex = null;
let currentRejectColumnIndex = null; // 当前拒绝的是哪个URL列
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

// 识别所有图片URL列（支持多列）
function detectImageUrlColumns(headers, data) {
    const urlColumns = [];
    
    // 检查每列是否包含URL
    for (const header of headers) {
        // 跳过内部字段
        if (header.startsWith('_')) continue;
        
        // 检查列名是否包含url关键字
        const headerLower = header.toLowerCase();
        const hasUrlKeyword = headerLower.includes('url') || 
                             headerLower.includes('图片') || 
                             headerLower.includes('image') ||
                             headerLower.includes('封面');
        
        if (hasUrlKeyword) {
            // 检查该列的值是否确实是URL
            const sampleValues = data.slice(0, 10).map(row => row[header]).filter(v => v);
            const urlCount = sampleValues.filter(v => 
                /^https?:\/\//.test(v) || /\.(jpg|jpeg|png|gif|webp|bmp)$/i.test(v)
            ).length;
            
            if (urlCount > sampleValues.length * 0.3) {
                urlColumns.push(header);
            }
        }
    }
    
    return urlColumns;
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
        
        // 识别所有图片URL列
        imageUrlColumns = detectImageUrlColumns(headers, csvData);
        
        if (imageUrlColumns.length === 0) {
            alert('未找到图片URL列，请确保CSV中包含图片URL字段（列名包含"url"或"图片"）');
            return;
        }
        
        console.log('检测到的图片URL列:', imageUrlColumns);
        
        // 初始化审核状态（为每个URL列创建独立的审核状态）
        csvData.forEach((row, index) => {
            imageUrlColumns.forEach((column, colIndex) => {
                const statusKey = `_reviewStatus_${colIndex}`;
                const reasonKey = `_rejectReason_${colIndex}`;
                const checkedKey = `_checked_${colIndex}`;
                
                if (!row[statusKey]) {
                    row[statusKey] = 'pending';
                    row[reasonKey] = '';
                    row[checkedKey] = false; // 每个图片的勾选状态
                }
            });
            row._index = index;
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
    
    // 排除所有图片URL列和内部字段
    const filterableHeaders = headers.filter(h => 
        !imageUrlColumns.includes(h) && 
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
    
    // 根据URL列数量调整网格布局
    const columnCount = imageUrlColumns.length;
    if (columnCount > 1) {
        grid.style.gridTemplateColumns = '1fr'; // 每行一个卡片（卡片内部再分列）
    } else {
        grid.style.gridTemplateColumns = 'repeat(auto-fill, minmax(300px, 1fr))'; // 原有布局
    }
    
    const startIndex = (currentPage - 1) * pageSize;
    const endIndex = startIndex + pageSize;
    const pageData = filteredData.slice(startIndex, endIndex);
    
    pageData.forEach((row, index) => {
        const actualIndex = startIndex + index;
        const card = createImageCard(row, actualIndex);
        grid.appendChild(card);
    });
    
    // 预加载图片
    pageData.forEach(row => {
        imageUrlColumns.forEach(column => {
            const imageUrl = row[column] || '';
            if (imageUrl) {
                preloadImage(imageUrl);
            }
        });
    });
}

// 更新图片信息显示
function updateImageInfo(infoDiv, row) {
    infoDiv.innerHTML = '';
    
    // 显示CSV中的其他字段（排除所有URL列）
    headers.forEach(header => {
        if (!imageUrlColumns.includes(header) && !header.startsWith('_')) {
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

// 创建图片卡片（支持多列URL并排展示）
function createImageCard(row, index) {
    const card = document.createElement('div');
    card.className = 'image-card';
    card.dataset.index = index;
    
    if (imageUrlColumns.length > 1) {
        card.classList.add('multi-image-card');
    }
    
    // 如果有多个URL列，创建并排布局
    if (imageUrlColumns.length > 1) {
        // 图片行容器
        const imagesRow = document.createElement('div');
        imagesRow.className = 'images-row';
        imagesRow.style.display = 'flex';
        imagesRow.style.gap = '10px';
        imagesRow.style.marginBottom = '10px';
        
        // 为每个URL列创建图片区域
        imageUrlColumns.forEach((column, colIndex) => {
            const imageUrl = row[column] || '';
            const imageBox = createImageBox(row, index, colIndex, imageUrl, column);
            imagesRow.appendChild(imageBox);
        });
        
        card.appendChild(imagesRow);
        
        // 信息区域（显示其他字段）
        const infoDiv = document.createElement('div');
        infoDiv.className = 'image-info';
        updateImageInfo(infoDiv, row);
        card.appendChild(infoDiv);
        
    } else {
        // 单列URL时使用原有布局
        const imageUrl = row[imageUrlColumns[0]] || '';
        const imageWrapper = createSingleImageWrapper(row, index, 0, imageUrl);
        
        const infoDiv = document.createElement('div');
        infoDiv.className = 'image-info';
        updateImageInfo(infoDiv, row);
        
        const actionsDiv = document.createElement('div');
        actionsDiv.className = 'image-actions';
        
        const approveBtn = document.createElement('button');
        approveBtn.className = 'btn btn-success';
        approveBtn.textContent = '通过';
        approveBtn.onclick = () => approveImage(index, 0);
        
        const rejectBtn = document.createElement('button');
        rejectBtn.className = 'btn btn-danger';
        rejectBtn.textContent = '不通过';
        rejectBtn.onclick = () => rejectImage(index, 0);
        
        const statusKey = `_reviewStatus_0`;
        if (row[statusKey] === 'approved') {
            approveBtn.disabled = true;
            approveBtn.style.opacity = '0.5';
        } else if (row[statusKey] === 'rejected') {
            rejectBtn.disabled = true;
            rejectBtn.style.opacity = '0.5';
        }
        
        actionsDiv.appendChild(approveBtn);
        actionsDiv.appendChild(rejectBtn);
        
        card.appendChild(imageWrapper);
        card.appendChild(infoDiv);
        card.appendChild(actionsDiv);
    }
    
    return card;
}

// 创建单个图片区域（多列布局用）
function createImageBox(row, rowIndex, colIndex, imageUrl, columnName) {
    const box = document.createElement('div');
    box.className = 'image-box';
    box.style.flex = '1';
    box.style.display = 'flex';
    box.style.flexDirection = 'column';
    box.style.border = '1px solid #e8e8e8';
    box.style.borderRadius = '4px';
    box.style.overflow = 'hidden';
    
    // 图片区域
    const imageWrapper = document.createElement('div');
    imageWrapper.className = 'image-wrapper';
    imageWrapper.style.position = 'relative';
    imageWrapper.style.aspectRatio = '3/4';
    imageWrapper.style.backgroundColor = '#f5f5f5';
    
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'image-checkbox';
    const checkedKey = `_checked_${colIndex}`;
    checkbox.checked = row[checkedKey] || false;
    checkbox.onchange = () => toggleImageCheck(rowIndex, colIndex);
    checkbox.style.position = 'absolute';
    checkbox.style.top = '8px';
    checkbox.style.left = '8px';
    checkbox.style.zIndex = '10';
    
    const img = document.createElement('img');
    img.dataset.index = rowIndex;
    img.dataset.colIndex = colIndex;
    img.style.width = '100%';
    img.style.height = '100%';
    img.style.objectFit = 'contain';
    
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
        loadingDiv.textContent = '无图片';
        img.style.display = 'none';
    }
    
    imageWrapper.appendChild(checkbox);
    imageWrapper.appendChild(img);
    imageWrapper.appendChild(loadingDiv);
    imageWrapper.appendChild(errorDiv);
    
    // 审核状态标签
    const statusKey = `_reviewStatus_${colIndex}`;
    if (row[statusKey] === 'approved') {
        const statusBadge = document.createElement('div');
        statusBadge.className = 'image-status approved';
        statusBadge.textContent = '已通过';
        statusBadge.style.position = 'absolute';
        statusBadge.style.top = '8px';
        statusBadge.style.right = '8px';
        imageWrapper.appendChild(statusBadge);
    } else if (row[statusKey] === 'rejected') {
        const statusBadge = document.createElement('div');
        statusBadge.className = 'image-status rejected';
        statusBadge.textContent = '已拒绝';
        statusBadge.style.position = 'absolute';
        statusBadge.style.top = '8px';
        statusBadge.style.right = '8px';
        imageWrapper.appendChild(statusBadge);
    }
    
    box.appendChild(imageWrapper);
    
    // 列名标签
    const columnLabel = document.createElement('div');
    columnLabel.style.padding = '8px';
    columnLabel.style.fontSize = '12px';
    columnLabel.style.fontWeight = 'bold';
    columnLabel.style.color = '#666';
    columnLabel.style.backgroundColor = '#fafafa';
    columnLabel.style.borderTop = '1px solid #e8e8e8';
    columnLabel.textContent = columnName;
    box.appendChild(columnLabel);
    
    // 操作按钮
    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'image-actions';
    actionsDiv.style.padding = '8px';
    actionsDiv.style.display = 'flex';
    actionsDiv.style.gap = '8px';
    actionsDiv.style.borderTop = '1px solid #e8e8e8';
    
    const approveBtn = document.createElement('button');
    approveBtn.className = 'btn btn-success btn-small';
    approveBtn.textContent = '通过';
    approveBtn.style.flex = '1';
    approveBtn.style.fontSize = '12px';
    approveBtn.style.padding = '4px 8px';
    approveBtn.onclick = () => approveImage(rowIndex, colIndex);
    
    const rejectBtn = document.createElement('button');
    rejectBtn.className = 'btn btn-danger btn-small';
    rejectBtn.textContent = '不通过';
    rejectBtn.style.flex = '1';
    rejectBtn.style.fontSize = '12px';
    rejectBtn.style.padding = '4px 8px';
    rejectBtn.onclick = () => rejectImage(rowIndex, colIndex);
    
    if (row[statusKey] === 'approved') {
        approveBtn.disabled = true;
        approveBtn.style.opacity = '0.5';
    } else if (row[statusKey] === 'rejected') {
        rejectBtn.disabled = true;
        rejectBtn.style.opacity = '0.5';
    }
    
    actionsDiv.appendChild(approveBtn);
    actionsDiv.appendChild(rejectBtn);
    box.appendChild(actionsDiv);
    
    return box;
}

// 创建单列图片包装器（原有单列布局用）
function createSingleImageWrapper(row, index, colIndex, imageUrl) {
    const imageWrapper = document.createElement('div');
    imageWrapper.className = 'image-wrapper';
    
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'image-checkbox';
    const checkedKey = `_checked_${colIndex}`;
    checkbox.checked = row[checkedKey] || false;
    checkbox.onchange = () => toggleImageCheck(index, colIndex);
    
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
    const statusKey = `_reviewStatus_${colIndex}`;
    if (row[statusKey] === 'approved') {
        const statusBadge = document.createElement('div');
        statusBadge.className = 'image-status approved';
        statusBadge.textContent = '已通过';
        imageWrapper.appendChild(statusBadge);
    } else if (row[statusKey] === 'rejected') {
        const statusBadge = document.createElement('div');
        statusBadge.className = 'image-status rejected';
        statusBadge.textContent = '已拒绝';
        imageWrapper.appendChild(statusBadge);
    }
    
    return imageWrapper;
}

// 预加载图片
function preloadImage(url) {
    if (!url) return;
    const img = new Image();
    img.src = url;
}

// 切换图片勾选状态
function toggleImageCheck(rowIndex, colIndex) {
    const row = filteredData[rowIndex];
    if (row) {
        const checkedKey = `_checked_${colIndex}`;
        row[checkedKey] = !row[checkedKey];
        renderImages();
        updateToolbar();
    }
}

// 切换选择（已废弃，但保留兼容性）
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

// 全选本页（选中所有图片的勾选框）
function selectAllCurrentPage() {
    const startIndex = (currentPage - 1) * pageSize;
    const endIndex = Math.min(startIndex + pageSize, filteredData.length);
    
    for (let i = startIndex; i < endIndex; i++) {
        const row = filteredData[i];
        if (row) {
            // 勾选该行所有图片
            imageUrlColumns.forEach((column, colIndex) => {
                const checkedKey = `_checked_${colIndex}`;
                row[checkedKey] = true;
            });
        }
    }
    
    renderImages();
    updateToolbar();
}

// 通过图片
function approveImage(index, colIndex) {
    const row = filteredData[index];
    if (row) {
        const statusKey = `_reviewStatus_${colIndex}`;
        const reasonKey = `_rejectReason_${colIndex}`;
        const checkedKey = `_checked_${colIndex}`;
        
        row[statusKey] = 'approved';
        row[reasonKey] = '';
        row[checkedKey] = true; // 自动勾选
        renderImages();
    }
}

// 不通过图片
function rejectImage(index, colIndex) {
    currentRejectIndex = index;
    currentRejectColumnIndex = colIndex;
    document.getElementById('rejectReasonInput').value = '';
    document.getElementById('rejectModal').style.display = 'flex';
}

// 确认拒绝
function confirmReject() {
    const reason = document.getElementById('rejectReasonInput').value.trim();
    if (currentRejectIndex !== null && currentRejectColumnIndex !== null) {
        const row = filteredData[currentRejectIndex];
        if (row) {
            const statusKey = `_reviewStatus_${currentRejectColumnIndex}`;
            const reasonKey = `_rejectReason_${currentRejectColumnIndex}`;
            const checkedKey = `_checked_${currentRejectColumnIndex}`;
            
            row[statusKey] = 'rejected';
            row[reasonKey] = reason;
            row[checkedKey] = false; // 不通过时取消勾选
            renderImages();
        }
    }
    closeRejectModal();
}

// 关闭拒绝模态框
function closeRejectModal() {
    document.getElementById('rejectModal').style.display = 'none';
    currentRejectIndex = null;
    currentRejectColumnIndex = null;
}

// 批量通过选中
function approveSelected() {
    // 统计所有已勾选的图片
    let selectedCount = 0;
    const selectedImages = [];
    
    // 遍历所有数据（不仅仅是当前页）
    filteredData.forEach((row, rowIndex) => {
        imageUrlColumns.forEach((column, colIndex) => {
            const checkedKey = `_checked_${colIndex}`;
            if (row[checkedKey]) {
                selectedCount++;
                selectedImages.push({ rowIndex, colIndex, row });
            }
        });
    });
    
    if (selectedCount === 0) {
        alert('请先勾选要批量通过的图片');
        return;
    }
    
    // 确认操作
    const confirmed = confirm(`确定要批量通过 ${selectedCount} 张已勾选的图片吗？`);
    if (!confirmed) {
        return;
    }
    
    // 批量通过
    selectedImages.forEach(({ rowIndex, colIndex, row }) => {
        const statusKey = `_reviewStatus_${colIndex}`;
        const reasonKey = `_rejectReason_${colIndex}`;
        
        row[statusKey] = 'approved';
        row[reasonKey] = '';
        // 保持勾选状态
    });
    
    // 重新渲染
    renderImages();
    updateToolbar();
    
    alert(`成功批量通过 ${selectedCount} 张图片`);
}

// 导出审核结果
function exportResults() {
    // 创建新的CSV数据，为每个URL列添加审核结果列
    const exportHeaders = [];
    
    headers.forEach(header => {
        exportHeaders.push(header);
        
        // 如果是URL列，在后面添加审核结果列
        const colIndex = imageUrlColumns.indexOf(header);
        if (colIndex !== -1) {
            exportHeaders.push(`${header}_审核结果`);
        }
    });
    
    const exportData = csvData.map(row => {
        const exportRow = {};
        
        headers.forEach(header => {
            exportRow[header] = row[header] || '';
            
            // 如果是URL列，添加审核结果
            const colIndex = imageUrlColumns.indexOf(header);
            if (colIndex !== -1) {
                const statusKey = `_reviewStatus_${colIndex}`;
                const checkedKey = `_checked_${colIndex}`;
                
                // 未勾选则为不通过
                if (!row[checkedKey]) {
                    exportRow[`${header}_审核结果`] = '不通过';
                } else {
                    exportRow[`${header}_审核结果`] = '通过';
                }
            }
        });
        
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

// 更新工具栏
function updateToolbar() {
    const totalPages = Math.ceil(filteredData.length / pageSize);
    const pageInfo = document.getElementById('pageInfo');
    pageInfo.textContent = `共 ${filteredData.length} 条，第 ${currentPage} / ${totalPages} 页`;
    
    // 统计已选中的图片数量
    let selectedCount = 0;
    filteredData.forEach((row) => {
        imageUrlColumns.forEach((column, colIndex) => {
            const checkedKey = `_checked_${colIndex}`;
            if (row[checkedKey]) {
                selectedCount++;
            }
        });
    });
    
    // 更新已选中数量显示
    const selectedCountEl = document.getElementById('selectedCount');
    const batchApproveBtn = document.getElementById('batchApproveBtn');
    if (selectedCountEl) {
        if (selectedCount > 0) {
            selectedCountEl.textContent = `已选中 ${selectedCount} 张图片`;
            selectedCountEl.style.color = '#1890ff';
            selectedCountEl.style.fontWeight = 'bold';
            if (batchApproveBtn) {
                batchApproveBtn.disabled = false;
            }
        } else {
            selectedCountEl.textContent = '';
            if (batchApproveBtn) {
                batchApproveBtn.disabled = true;
            }
        }
    }
    
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
