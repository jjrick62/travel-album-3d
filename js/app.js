// ===== 主入口 =====

import { initDB, setMeta, getAllPlaces, savePlace, deletePlace, exportAllData } from './data.js';
import { Earth } from './earth.js';

// ===== 全局状态 =====
let earth;
let homeLocation = null;
let places = [];
let citiesData = [];
let selectedCity = null;
let addRating = 0;
let selectedPlaceId = null;
let isEditing = false;
let tempPhotos = [];

// ===== DOM 引用 =====
const $ = (id) => document.getElementById(id);

// ===== 初始化 =====
async function init() { 
  // 加载城市数据
  const resp = await fetch('data/cities.json');
  citiesData = await resp.json();

  // 初始化数据库
  const meta = await initDB();
  homeLocation = meta.home || null;
  places = await getAllPlaces();

  // 初始化地球
  earth = new Earth(document.getElementById('globe-container'));
  earth.onPlaceClick = (id) => showDetail(id);
  earth._onDataReady = () => { refreshEarth(); };

  // 手机端摄像机初始拉远
  if (window.innerWidth <= 768) {
    earth.camera.position.set(0, 2.0, 5.2);
  }

  // 先加载已有地点数据，再启动（地图数据异步加载，不阻塞）
  applyEarthData();
  earth.start();

  // 地图数据后台加载，不阻塞渲染
  earth.loadCoastlines().catch(err => console.warn('Map load:', err));
  earth.loadAdminBoundaries().catch(err => console.warn('Admin load:', err));
  earth.loadCities().catch(err => console.warn('Cities load:', err));

  // 统计信息
  updateStats();

  // 绑定事件
  bindEvents();

  // 恢复常驻地显示
  if (homeLocation) {
    document.getElementById('home-name').textContent = homeLocation.name;
    document.getElementById('home-display').classList.remove('hidden');
  }
}

// ===== 应用数据到地球 =====
function applyEarthData() {
  if (homeLocation) {
    earth.setHome(homeLocation.lat, homeLocation.lng);
  }
  for (const p of places) {
    earth.addPlace(p, '#ffffff', p.rating || 3);
    if (homeLocation) {
      earth.addArc(homeLocation.lat, homeLocation.lng, p.lat, p.lng, '#ffffff', p.rating || 3, p.id);
    }
  }
}

// ===== 更新统计 =====
function updateStats() {
  const total = places.length;
  if (total === 0) {
    document.getElementById('stats').textContent = '';
    return;
  }
  const avg = (places.reduce((s, p) => s + (p.rating || 0), 0) / total).toFixed(1);
  document.getElementById('stats').textContent = `${total} 个地点 · ★ ${avg}`;
}

// ===== 搜索组件 =====
function createSearch(inputId, resultsId, onSelect) {
  const input = document.getElementById(inputId);
  const results = document.getElementById(resultsId);
  // 挂到 body 下，避开 modal overflow 裁剪
  if (results.parentElement !== document.body) {
    document.body.appendChild(results);
  }

  input.addEventListener('input', () => {
    const q = input.value.trim();
    if (!q) { results.classList.remove('active'); return; }

    // 相关度排序：精准匹配 > 开头匹配 > 包含匹配 > 省份匹配
    const scored = [];
    for (const c of citiesData) {
      let score = 0;
      if (c.name === q) { score = 100; }
      else if (c.name.startsWith(q)) { score = 80; }
      else if (c.name.includes(q)) { score = 50; }
      else if (c.province.includes(q)) { score = 20; }
      else { continue; }
      if (c.level === 'city') score += 2;
      else if (c.level === 'province') score += 1;
      scored.push({ city: c, score });
    }
    scored.sort((a, b) => b.score - a.score);
    const matched = scored.slice(0, 15).map(s => s.city);

    results.innerHTML = '';
    if (matched.length === 0) { results.classList.remove('active'); return; }
    results.classList.add('active');
    // fixed 定位贴到输入框正下方
    const rect = input.getBoundingClientRect();
    results.style.top = (rect.bottom + 4) + 'px';
    results.style.left = rect.left + 'px';
    results.style.width = rect.width + 'px';

    for (const c of matched) {
      const div = document.createElement('div');
      div.className = 'result-item';
      div.innerHTML = `${c.name}<span class="province">${c.province}</span>`;
      div.addEventListener('click', () => {
        input.value = c.name;
        results.classList.remove('active');
        onSelect(c);
      });
      results.appendChild(div);
    }
  });

  input.addEventListener('blur', () => {
    setTimeout(() => results.classList.remove('active'), 200);
  });
}

// ===== 显示详情 =====
function showDetail(id) {
  const place = places.find(p => p.id === id);
  if (!place) return;

  selectedPlaceId = id;
  const card = document.getElementById('detail-card');
  card.classList.remove('hidden');

  document.getElementById('detail-name').textContent = place.name;
  document.getElementById('detail-fullname').textContent = place.fullName || place.name;
  document.getElementById('detail-date').textContent = place.visitDate || '';

  // 星星
  const starContainer = document.getElementById('detail-stars');
  starContainer.innerHTML = '';
  for (let i = 1; i <= 5; i++) {
    const span = document.createElement('span');
    span.textContent = '★';
    span.className = i <= (place.rating || 0) ? 'active' : '';
    span.dataset.value = i;
    span.addEventListener('click', async () => {
      place.rating = i;
      await savePlace(place);
      renderDetailStars(starContainer, i);
      updateStats();
      refreshEarth();
    });
    starContainer.appendChild(span);
  }

  // 笔记
  document.getElementById('detail-notes').textContent = place.notes || '';

  // 照片
  renderPhotos(place);

  // 按钮事件
  document.getElementById('btn-delete-place').onclick = async () => {
    if (!confirm(`删除 ${place.name} ？`)) return;
    await deletePlace(place.id);
    places = await getAllPlaces();
    card.classList.add('hidden');
    updateStats();
    refreshEarth();
  };

  document.getElementById('btn-edit-place').onclick = () => {
    card.classList.add('hidden');
    openEditModal(place);
  };
}

function renderDetailStars(container, rating) {
  const spans = container.querySelectorAll('span');
  spans.forEach((s, i) => s.className = i < rating ? 'active' : '');
}

function renderPhotos(place) {
  const grid = document.getElementById('photo-grid');
  grid.innerHTML = '';

  if (!place.photos || place.photos.length === 0) {
    grid.innerHTML = '<div style="color:#666;font-size:13px;">暂无照片</div>';
  } else {
    for (const photo of place.photos) {
      const wrapper = document.createElement('div');
      wrapper.style.cssText = 'display:flex;flex-direction:column;gap:2px;';
      const img = document.createElement('img');
      img.src = photo.dataUrl;
      img.alt = photo.caption || '';
      img.title = photo.caption || '';
      img.addEventListener('click', () => openPhotoViewer(photo, place));
      wrapper.appendChild(img);
      if (photo.caption) {
        const cap = document.createElement('span');
        cap.textContent = photo.caption;
        cap.style.cssText = 'font-size:11px;color:#888;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
        wrapper.appendChild(cap);
      }
      grid.appendChild(wrapper);
    }
  }

  // 添加照片按钮
  const fileInput = document.getElementById('photo-input');
  document.getElementById('btn-add-photo').onclick = () => fileInput.click();

  fileInput.onchange = async (e) => {
    const files = Array.from(e.target.files);
    if (!place.photos) place.photos = [];
    for (const file of files) {
      const dataUrl = await fileToDataUrl(file);
      place.photos.push({
        id: crypto.randomUUID(),
        dataUrl,
        caption: ''
      });
    }
    await savePlace(place);
    renderPhotos(place);
    fileInput.value = '';
  };
}

function fileToDataUrl(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(file);
  });
}

function renderModalPhotos() {
  const grid = document.getElementById('modal-photo-grid');
  grid.innerHTML = '';
  for (let i = 0; i < tempPhotos.length; i++) {
    const photo = tempPhotos[i];
    const wrap = document.createElement('div');
    wrap.className = 'modal-photo-wrap';
    const img = document.createElement('img');
    img.src = photo.dataUrl;
    img.title = photo.caption || '照片';
    wrap.appendChild(img);
    const del = document.createElement('button');
    del.className = 'modal-photo-del';
    del.textContent = '×';
    del.addEventListener('click', () => {
      tempPhotos.splice(i, 1);
      renderModalPhotos();
    });
    wrap.appendChild(del);
    grid.appendChild(wrap);
  }
}

function openPhotoViewer(photo, place) {
  const viewer = document.getElementById('photo-viewer');
  viewer.classList.remove('hidden');
  document.getElementById('photo-viewer-img').src = photo.dataUrl;

  const captionInput = document.getElementById('photo-caption');
  captionInput.value = photo.caption || '';
  captionInput.oninput = async () => {
    photo.caption = captionInput.value;
    await savePlace(place);
    renderPhotos(place);
  };

  viewer.querySelector('.btn-close').onclick = () => viewer.classList.add('hidden');
  viewer.querySelector('.modal-backdrop').addEventListener('click', () => viewer.classList.add('hidden'));
}

// ===== 刷新地球 =====
function refreshEarth() {
  earth.clearPlaces();
  for (const p of places) {
    earth.addPlace(p, '#ffffff', p.rating || 3);
    if (homeLocation) {
      earth.addArc(homeLocation.lat, homeLocation.lng, p.lat, p.lng, '#ffffff', p.rating || 3, p.id);
    }
  }
}

// ===== 编辑地点模态框 =====
function openEditModal(place) {
  isEditing = true;
  selectedCity = { name: place.name, province: place.fullName ? place.fullName.split('·')[0] : '', lat: place.lat, lng: place.lng };
  addRating = place.rating || 0;
  tempPhotos = place.photos ? place.photos.slice() : [];
  document.getElementById('city-search').value = place.name;
  document.getElementById('visit-date').value = place.visitDate || '';
  document.getElementById('place-notes').value = place.notes || '';
  updateStarInput(addRating);
  renderModalPhotos();
  document.getElementById('add-modal').classList.remove('hidden');
  document.getElementById('add-modal').querySelector('.modal-header h2').textContent = '编辑地点';
}

// ===== 绑定事件 =====
function bindEvents() {
  // 暂停/播放按钮
  const pauseBtn = document.getElementById('btn-pause');
  if (pauseBtn) {
    pauseBtn.addEventListener('click', () => {
      const playing = earth.toggleRotation();
      pauseBtn.classList.toggle('paused', !playing);
    });
  }

  // 设置下拉菜单
  const settingsBtn = document.getElementById('btn-settings');
  const dropdown = document.getElementById('settings-dropdown');
  settingsBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    dropdown.classList.toggle('hidden');
    settingsBtn.classList.toggle('active');
  });

  // 添加地点按钮
  document.getElementById('btn-add').addEventListener('click', () => {
    isEditing = false;
    selectedCity = null;
    addRating = 0;
    tempPhotos = [];
    document.getElementById('city-search').value = '';
    document.getElementById('visit-date').value = new Date().toISOString().split('T')[0];
    document.getElementById('place-notes').value = '';
    updateStarInput(0);
    renderModalPhotos();
    document.getElementById('add-modal').querySelector('.modal-header h2').textContent = '添加地点';
    document.getElementById('add-modal').classList.remove('hidden');
    dropdown.classList.add('hidden');
    settingsBtn.classList.remove('active');
  });

  // 关闭按钮
  document.querySelectorAll('.btn-close, .modal-backdrop').forEach(el => {
    el.addEventListener('click', (e) => {
      // 只关闭父级模态框
      const modal = e.target.closest('.modal');
      if (modal) modal.classList.add('hidden');
    });
  });

  // 搜索
  createSearch('city-search', 'city-search-results', (c) => {
    selectedCity = c;
  });
  createSearch('home-search', 'home-search-results', async (c) => {
    homeLocation = c;
    await setMeta('home', c);
    document.getElementById('home-name').textContent = c.name;
    document.getElementById('home-display').classList.remove('hidden');
    earth.setHome(c.lat, c.lng);
    refreshEarth();
  });

  // 星星输入
  const starInput = document.getElementById('star-input');
  starInput.querySelectorAll('span').forEach(s => {
    s.addEventListener('click', () => {
      addRating = parseInt(s.dataset.value);
      updateStarInput(addRating);
    });
    s.addEventListener('mouseenter', () => {
      const v = parseInt(s.dataset.value);
      updateStarInput(v);
    });
    s.addEventListener('mouseleave', () => {
      updateStarInput(addRating);
    });
  });

  // 保存添加地点
  document.getElementById('btn-save-add').addEventListener('click', async () => {
    const name = document.getElementById('city-search').value.trim();
    if (!name) { alert('请输入城市名称'); return; }
    // 确保 selectedCity 有效：下拉选中直接用，否则从数据库智能匹配
    if (!selectedCity || selectedCity.name !== name) {
      let match = citiesData.find(c => c.name === name);
      if (!match) match = citiesData.find(c => c.name.includes(name));
      if (match) {
        selectedCity = match;
        document.getElementById('city-search').value = match.name;
      } else {
        alert('未找到匹配城市，请从下拉列表中选择'); return;
      }
    }

    if (isEditing && selectedPlaceId) {
      // 编辑模式
      const place = places.find(p => p.id === selectedPlaceId);
      if (!place) return;
      place.name = selectedCity.name;
      place.fullName = selectedCity.province + '·' + selectedCity.name;
      place.lat = selectedCity.lat;
      place.lng = selectedCity.lng;
      place.rating = addRating;
      place.notes = document.getElementById('place-notes').value;
      place.visitDate = document.getElementById('visit-date').value;
      place.photos = tempPhotos.slice();
      await savePlace(place);
      places = await getAllPlaces();
      document.getElementById('add-modal').classList.add('hidden');
      isEditing = false;
      updateStats();
      refreshEarth();
      showDetail(place.id);
      return;
    }

        // 新建模式
    try {
    const newPlace = {
      id: crypto.randomUUID(),
      name: selectedCity.name,
      fullName: selectedCity.province + '·' + selectedCity.name,
      lat: selectedCity.lat,
      lng: selectedCity.lng,
      rating: addRating || 3,
      notes: document.getElementById('place-notes').value,
      visitDate: document.getElementById('visit-date').value,
      photos: tempPhotos.slice()
    };

    await savePlace(newPlace);
    places = await getAllPlaces();
    document.getElementById('add-modal').classList.add('hidden');
    updateStats();
    isEditing = false;

    earth.addPlace(newPlace, '#ffffff', newPlace.rating);
    if (homeLocation) {
      earth.addArc(homeLocation.lat, homeLocation.lng, newPlace.lat, newPlace.lng, '#ffffff', newPlace.rating, newPlace.id);
    }

    showDetail(newPlace.id);
    } catch (err) {
      console.error('Save failed:', err);
      alert('保存失败：' + err.message);
    }
  });

  // 模态框照片：添加按钮
  document.getElementById('btn-modal-add-photo').addEventListener('click', () => {
    document.getElementById('modal-photo-input').click();
  });
  document.getElementById('modal-photo-input').addEventListener('change', async (e) => {
    const files = Array.from(e.target.files);
    for (const file of files) {
      const dataUrl = await fileToDataUrl(file);
      tempPhotos.push({ id: crypto.randomUUID(), dataUrl, caption: '' });
    }
    renderModalPhotos();
    e.target.value = '';
  });

  // 取消添加
  document.getElementById('btn-cancel-add').addEventListener('click', () => {
    document.getElementById('add-modal').classList.add('hidden');
    isEditing = false;
  });

  // 导出
  document.getElementById('btn-export').addEventListener('click', async () => {
    const data = await exportAllData();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `旅行数据_${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
    dropdown.classList.add('hidden');
    settingsBtn.classList.remove('active');
  });

  // 重置视角
  document.getElementById('btn-reset-view').addEventListener('click', () => {
    earth.resetView();
    dropdown.classList.add('hidden');
    settingsBtn.classList.remove('active');
  });

  // 点击空白关闭下拉菜单
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#btn-settings') && !e.target.closest('#settings-dropdown')) {
      dropdown.classList.add('hidden');
      settingsBtn.classList.remove('active');
    }
  });

  // 点击空白关闭详情
  document.addEventListener('click', (e) => {
    const card = document.getElementById('detail-card');
    if (card.classList.contains('hidden')) return;
    if (!card.contains(e.target) && !e.target.closest('.modal')) {
      card.classList.add('hidden');
      selectedPlaceId = null;
    }
  });

  // 关闭详情
  document.getElementById('btn-close-detail').addEventListener('click', () => {
    document.getElementById('detail-card').classList.add('hidden');
    selectedPlaceId = null;
  });
}

function updateStarInput(rating) {
  const spans = document.getElementById('star-input').querySelectorAll('span');
  spans.forEach(s => {
    const v = parseInt(s.dataset.value);
    s.textContent = v <= rating ? '★' : '☆';
    s.className = v <= rating ? 'active' : '';
  });
}

// ===== 启动 =====
init();
