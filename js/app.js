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
  earth.onMissClick = () => {}; // 改由全局处理
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

  // 悬浮卡片：先同步，再注册每帧更新
  syncPlaceCards();
  earth.onFrame(() => updatePlaceCards());
}

// ===== 应用数据到地球 =====
function applyEarthData() {
  if (homeLocation) {
    earth.setHome(homeLocation.lat, homeLocation.lng, homeLocation.name);
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

// ===== 地点悬浮卡片（屏幕空间） =====
function createPlaceCard(place) {
  const svg = document.getElementById('connector-lines');
  const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  line.dataset.placeId = place.id;
  svg.appendChild(line);

  const stars = '★'.repeat(place.rating || 3) + '☆'.repeat(5 - (place.rating || 3));
  const thumb = place.photos && place.photos.length > 0
    ? `<img class="place-card-thumb" src="${place.photos[0].dataUrl}" alt="">` : '';
  const card = document.createElement('div');
  card.className = 'place-card';
  card.dataset.placeId = place.id;
  card.innerHTML = `<div class="place-card-name">${place.name}</div>
    <div class="place-card-meta">${stars}</div>${thumb}`;
  // 单击/双击逻辑
  card.addEventListener('click', (e) => {
    // 折叠代表卡片：先飞过去，再展开
    if (card.classList.contains('place-card-stacked')) {
      const ck = card.dataset.clusterKey;
      earth._focusedPlaceId = place.id;
      earth.highlightFill(place.id);
      earth.focusOnPlace(place.lat, place.lng, () => {
        if (ck && updatePlaceCards._clusters && updatePlaceCards._clusters[ck]) {
          const st = updatePlaceCards._clusters[ck];
          st.expanded = true;
          clearTimeout(st._timer);
          st._timer = setTimeout(() => { st.expanded = false; }, 5000);
        }
      });
      return;
    }

    const now = Date.now();
    if (card._lastTap && now - card._lastTap < 350) {
      // 双击 → 直接进入编辑
      card._lastTap = 0;
      selectedPlaceId = place.id;
      document.getElementById('detail-card').classList.add('hidden');
      earth._focusedPlaceId = place.id;
      earth.highlightFill(place.id);
      earth.focusOnPlace(place.lat, place.lng, () => openEditModal(place));
    } else {
      card._lastTap = now;
      setTimeout(() => {
        if (card._lastTap !== now) return;
        if (earth._focusedPlaceId === place.id) {
          selectedPlaceId = place.id;
          document.getElementById('detail-card').classList.add('hidden');
          earth.focusOnPlace(place.lat, place.lng, () => openEditModal(place));
        } else {
          earth._focusedPlaceId = place.id;
          earth.highlightFill(place.id);
          earth.focusOnPlace(place.lat, place.lng);
        }
      }, 350);
    }
  });
  document.getElementById('place-cards').appendChild(card);
}

function removeAllPlaceCards() {
  document.getElementById('connector-lines').innerHTML = '';
  document.getElementById('place-cards').innerHTML = '';
}

function syncPlaceCards() {
  removeAllPlaceCards();
  // 过滤：跳过父级行政区、跳过重复
  const seen = new Set();
  const visible = places.filter(p => {
    if (seen.has(p.name)) return false;
    const fn = p.fullName || '';
    const isParent = places.some(other => other !== p && (other.fullName || '').startsWith(fn + '·'));
    if (!isParent) seen.add(p.name);
    return !isParent;
  });
  for (const p of visible) createPlaceCard(p);
}

function updatePlaceCards() {
  const svg = document.getElementById('connector-lines');
  const w = window.innerWidth, h = window.innerHeight;
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  const center = earth.getEarthCenterScreen();

  if (!updatePlaceCards._cache) updatePlaceCards._cache = {};
  if (!updatePlaceCards._clusters) updatePlaceCards._clusters = {};

  // 第一遍：计算所有卡片屏幕坐标
  const cardData = [];
  for (const place of places) {
    const line = svg.querySelector(`line[data-place-id="${place.id}"]`);
    const card = document.querySelector(`#place-cards .place-card[data-place-id="${place.id}"]`);
    if (!line || !card) continue;

    const facing = earth.getFacing(place.lat, place.lng);
    const pt = earth.projectToScreen(place.lat, place.lng, earth.earthRadius * 1.02);
    if (!pt.visible) {
      line.style.display = 'none'; card.style.display = 'none'; continue;
    }

    const scale = Math.max(0.2, Math.min(1, 1 + facing));
    const off = 150 * scale;
    const opacity = Math.max(0.05, 0.5 + facing * 0.5).toFixed(2);

    const dx = pt.x - center.x;
    const dy = pt.y - center.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    const nx = d > 0.01 ? dx / d : 0;
    const ny = d > 0.01 ? dy / d : 0;

    let tx = pt.x + nx * off; // 目标位置
    let ty = pt.y + ny * off;

    const cache = updatePlaceCards._cache;
    const key = place.id;
    if (!cache[key]) cache[key] = { x: tx, y: ty };
    // 平滑 + 吸附：到位后不再抖
    cache[key].x += (tx - cache[key].x) * 0.15;
    cache[key].y += (ty - cache[key].y) * 0.15;
    if (Math.abs(cache[key].x - tx) < 0.6) cache[key].x = tx;
    if (Math.abs(cache[key].y - ty) < 0.6) cache[key].y = ty;

    const cx = cache[key].x, cy = cache[key].y;

    cardData.push({ place, line, card, pt, cx, cy, sx: cx, sy: cy, scale, opacity, facing });
  }

  // 第二遍：距离聚类（滞回：120px 合入，已有群 180px 才拆）
  if (!updatePlaceCards._lastCluster) updatePlaceCards._lastCluster = {}; // placeId → clusterTag
  const joinThresh = 120, splitThresh = 180;
  const clustered = new Set();
  const clusters = [];
  for (let i = 0; i < cardData.length; i++) {
    if (clustered.has(i)) continue;
    const group = [i];
    clustered.add(i);
    for (let j = i + 1; j < cardData.length; j++) {
      if (clustered.has(j)) continue;
      const a = cardData[i], b = cardData[j];
      const dist = Math.sqrt((a.sx - b.sx) ** 2 + (a.sy - b.sy) ** 2);
      const sameLast = updatePlaceCards._lastCluster[a.place.id]
        && updatePlaceCards._lastCluster[a.place.id] === updatePlaceCards._lastCluster[b.place.id];
      const threshold = sameLast ? splitThresh : joinThresh;
      if (dist < threshold) { group.push(j); clustered.add(j); }
    }
    clusters.push(group);
  }
  // 更新每张卡片的集群标签
  const newLast = {};
  for (let ci = 0; ci < clusters.length; ci++) {
    for (const idx of clusters[ci]) {
      newLast[cardData[idx].place.id] = ci;
    }
  }
  updatePlaceCards._lastCluster = newLast;

  // 第三遍：渲染
  for (const group of clusters) {
    if (group.length === 1) {
      // 单张卡片：正常渲染
      const d = cardData[group[0]];
      d.card.classList.remove('place-card-stacked');
      d.card.dataset.clusterKey = '';
      d.line.style.display = '';
      d.line.setAttribute('x1', d.pt.x); d.line.setAttribute('y1', d.pt.y);
      d.line.setAttribute('x2', d.cx); d.line.setAttribute('y2', d.cy);
      d.line.style.opacity = d.opacity;
      d.card.style.display = '';
      d.card.style.left = d.cx + 'px';
      d.card.style.top = d.cy + 'px';
      d.card.style.transform = `translate(-50%, -100%) scale(${d.scale})`;
      d.card.style.opacity = d.opacity;
    } else {
      // 多张卡片聚类
      const clusterKey = group.map(i => cardData[i].place.id).sort().join(',');
      // 状态跨帧保持：相同成员集复用之前的展开状态
      if (!updatePlaceCards._memberState) updatePlaceCards._memberState = {};
      const memberSet = group.map(i => cardData[i].place.id).sort().join(',');
      const savedExpanded = updatePlaceCards._memberState[memberSet];
      const state = updatePlaceCards._clusters[clusterKey] || { expanded: savedExpanded || false };
      updatePlaceCards._clusters[clusterKey] = state;
      updatePlaceCards._memberState[memberSet] = state.expanded;

      // 质心
      let sumX = 0, sumY = 0;
      for (const idx of group) { sumX += cardData[idx].sx; sumY += cardData[idx].sy; }
      const bx = sumX / group.length, by = sumY / group.length;

      // 找代表：优先下级行政区，缓存在 state 上防闪动
      let bestIdx = group[0], bestScore = -Infinity;
      for (const idx of group) {
        const d = cardData[idx];
        const dist = (d.sx - bx) ** 2 + (d.sy - by) ** 2;
        let lvl = 0;
        const dots = ((d.place.fullName || '').match(/·/g) || []).length;
        if (dots >= 2) lvl = 2; else if (dots === 1) lvl = 1;
        const score = lvl * 10000 - dist;
        if (score > bestScore) { bestScore = score; bestIdx = idx; }
      }
      // 锁：旧代表在群内且分差不悬殊则不换
      if (state._repIdx !== undefined && group.includes(state._repIdx)) {
        const d = cardData[state._repIdx];
        const oldDist = (d.sx - bx) ** 2 + (d.sy - by) ** 2;
        let oldLvl = 0;
        const od = ((d.place.fullName || '').match(/·/g) || []).length;
        if (od >= 2) oldLvl = 2; else if (od === 1) oldLvl = 1;
        const oldScore = oldLvl * 10000 - oldDist;
        if (bestScore - oldScore < 5000) bestIdx = state._repIdx; // 差距不到半级不换
      }
      state._repIdx = bestIdx;
      const rep = cardData[bestIdx];

      // 计算展开目标：沿各卡片原始方向径向散开
      const spreadR = 140;
      const targets = [];
      for (const idx of group) {
        const d = cardData[idx];
        let dirX = d.cx - bx, dirY = d.cy - by;
        const mag = Math.sqrt(dirX * dirX + dirY * dirY);
        if (mag < 1) {
          const ang = (targets.length / group.length) * Math.PI * 2;
          dirX = Math.cos(ang); dirY = Math.sin(ang);
        } else {
          dirX /= mag; dirY /= mag;
        }
        targets.push({ idx, tx: bx + dirX * spreadR, ty: by + dirY * spreadR });
      }

      // 展开/折叠状态切换
      const justExpanded = state.expanded && !state._wasExpanded;
      const justCollapsed = !state.expanded && state._wasExpanded;
      state._wasExpanded = state.expanded;

      // 两阶段：先闪现到起点（无过渡），再设置终点（CSS过渡），标记动画中防止被稳态覆盖
      if (justExpanded) {
        state._animating = true;
        for (const t of targets) {
          const d = cardData[t.idx];
          d.card.style.transition = 'none';
          d.card.style.display = '';
          d.card.style.left = bx + 'px';
          d.card.style.top = by + 'px';
          d.card.classList.remove('place-card-stacked');
          d.card.dataset.clusterKey = '';
          d.line.style.display = 'none';
        }
        // 下一帧读取布局后触发过渡
        requestAnimationFrame(() => {
          for (const idx of group) { cardData[idx].card.offsetHeight; }
          for (const t of targets) {
            const d = cardData[t.idx];
            d.card.style.transition = 'left 0.4s cubic-bezier(0.34,1.56,0.64,1), top 0.4s cubic-bezier(0.34,1.56,0.64,1)';
            d.card.style.left = t.tx + 'px';
            d.card.style.top = t.ty + 'px';
            d.card.style.transform = `translate(-50%, -100%) scale(${d.scale})`;
            d.card.style.opacity = d.opacity;
            d.line.style.display = '';
            d.line.setAttribute('x1', d.pt.x); d.line.setAttribute('y1', d.pt.y);
            d.line.setAttribute('x2', t.tx); d.line.setAttribute('y2', t.ty);
            d.line.style.opacity = d.opacity;
          }
          // 过渡结束清标记
          clearTimeout(state._doneTimer);
          state._doneTimer = setTimeout(() => { state._animating = false; }, 450);
        });
      }

      if (justCollapsed) {
        state._animating = true;
        for (const idx of group) {
          const d = cardData[idx];
          d.card.style.transition = 'none';
          d.card.classList.remove('place-card-stacked');
          d.card.dataset.clusterKey = '';
          if (idx !== bestIdx) {
            d.card.style.display = '';
            const ti = targets.find(t => t.idx === idx);
            d.card.style.left = (ti || { tx: bx }).tx + 'px';
            d.card.style.top = (ti || { ty: by }).ty + 'px';
            d.line.style.display = '';
          }
        }
        requestAnimationFrame(() => {
          for (const idx of group) { cardData[idx].card.offsetHeight; }
          for (const idx of group) {
            const d = cardData[idx];
            d.card.style.transition = 'left 0.35s ease-in, top 0.35s ease-in, opacity 0.25s';
            d.card.style.left = bx + 'px';
            d.card.style.top = by + 'px';
            d.card.style.transform = `translate(-50%, -100%) scale(${d.scale})`;
            d.card.style.opacity = '0';
            d.line.style.display = 'none';
          }
          clearTimeout(state._doneTimer);
          state._doneTimer = setTimeout(() => {
            for (const idx of group) {
              const d = cardData[idx];
              if (idx === bestIdx) {
                d.card.style.transition = 'opacity 0.2s';
                d.card.classList.add('place-card-stacked');
                d.card.dataset.clusterKey = clusterKey;
                d.card.style.opacity = d.opacity;
                d.card.style.left = bx + 'px';
                d.card.style.top = by + 'px';
                d.line.style.display = '';
                d.line.setAttribute('x1', d.pt.x); d.line.setAttribute('y1', d.pt.y);
                d.line.setAttribute('x2', bx); d.line.setAttribute('y2', by);
                d.line.style.opacity = d.opacity;
              } else {
                d.card.style.display = 'none';
              }
            }
            state._animating = false;
          }, 400);
        });
      }

      // 稳态：动画中不干预 transition，动画完了清空
      if (!state._animating) {
        if (state.expanded) {
          for (const t of targets) {
            const d = cardData[t.idx];
            d.card.style.transition = '';
            d.card.style.display = '';
            d.card.style.left = t.tx + 'px';
            d.card.style.top = t.ty + 'px';
            d.card.style.transform = `translate(-50%, -100%) scale(${d.scale})`;
            d.card.style.opacity = d.opacity;
            d.line.style.display = '';
            d.line.setAttribute('x1', d.pt.x); d.line.setAttribute('y1', d.pt.y);
            d.line.setAttribute('x2', t.tx); d.line.setAttribute('y2', t.ty);
            d.line.style.opacity = d.opacity;
          }
        } else {
          for (const idx of group) {
            const d = cardData[idx];
            d.card.style.transition = '';
            d.card.classList.remove('place-card-stacked');
            if (idx === bestIdx) {
              d.card.dataset.clusterKey = clusterKey;
              d.card.classList.add('place-card-stacked');
              d.line.style.display = '';
              d.line.setAttribute('x1', d.pt.x); d.line.setAttribute('y1', d.pt.y);
              d.line.setAttribute('x2', bx); d.line.setAttribute('y2', by);
              d.line.style.opacity = d.opacity;
              d.card.style.display = '';
              d.card.style.left = bx + 'px';
              d.card.style.top = by + 'px';
              d.card.style.transform = `translate(-50%, -100%) scale(${d.scale})`;
              d.card.style.opacity = d.opacity;
            } else {
              d.card.dataset.clusterKey = '';
              d.line.style.display = 'none';
              d.card.style.display = 'none';
            }
          }
        }
      }
    }
  }
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
    earth.highlightFill(place.id);
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
    syncPlaceCards();
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
  syncPlaceCards();
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
  document.getElementById('btn-delete-modal').style.display = '';
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
    document.getElementById('btn-delete-modal').style.display = 'none';
    document.getElementById('add-modal').classList.remove('hidden');
    dropdown.classList.add('hidden');
    settingsBtn.classList.remove('active');
  });

  // 关闭按钮
  document.querySelectorAll('.btn-close, .modal-backdrop').forEach(el => {
    el.addEventListener('click', (e) => {
      const modal = e.target.closest('.modal');
      if (modal) {
        modal.classList.add('hidden');
        if (modal.id === 'add-modal') {
          const pid = selectedPlaceId;
          if (pid) {
            const p = places.find(pl => pl.id === pid);
            if (p) earth.zoomOutFromPlace(p.lat, p.lng);
            else earth.resetView();
          } else {
            earth.resetView();
          }
        }
      }
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
    earth.setHome(c.lat, c.lng, c.name);
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
      earth.zoomOutFromPlace(place.lat, place.lng);
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
    syncPlaceCards();
    earth.zoomOutFromPlace(newPlace.lat, newPlace.lng);

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
    const pid = selectedPlaceId;
    isEditing = false;
    if (pid) {
      const p = places.find(pl => pl.id === pid);
      if (p) earth.zoomOutFromPlace(p.lat, p.lng);
      else earth.resetView();
    } else {
      earth.resetView();
    }
  });

  // 编辑弹窗里的删除按钮
  document.getElementById('btn-delete-modal').addEventListener('click', async () => {
    if (!selectedPlaceId) return;
    const place = places.find(p => p.id === selectedPlaceId);
    if (!place) return;
    if (!confirm(`删除 ${place.name} ？`)) return;
    await deletePlace(place.id);
    places = await getAllPlaces();
    document.getElementById('add-modal').classList.add('hidden');
    isEditing = false;
    selectedPlaceId = null;
    updateStats();
    refreshEarth();
    earth.resetView();
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

  // 点击空白关闭详情（canvas 点击由地球自己处理，不关）
  document.addEventListener('click', (e) => {
    const card = document.getElementById('detail-card');
    if (card.classList.contains('hidden')) return;
    if (e.target.tagName === 'CANVAS') return;
    if (!card.contains(e.target) && !e.target.closest('.modal')) {
      card.classList.add('hidden');
      selectedPlaceId = null;
    }
  });

  // 全局：点击非卡片区域回退视角
  document.addEventListener('click', (e) => {
    if (e.target.closest('.place-card') || e.target.closest('.place-card-badge')) return;
    if (earth._focusedPlaceId) earth.resetView();
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
