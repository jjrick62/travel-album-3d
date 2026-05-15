// ===== 主入口 =====

import './logger.js';
import { renderStars, calcAvgRating } from './utils.js';
import { initDB, setMeta, getAllPlaces, savePlace, deletePlace, exportAllData, importAllData, login, register, logout, isLoggedIn, uploadPhoto } from './api.js';
import { Earth } from './earth.js';

// 触摸设备检测
const IS_TOUCH = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
const DOUBLE_TAP_MS = IS_TOUCH ? 250 : 350;

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
let regionsData = [];
let worldCitiesData = [];
let regionsLoaded = false;
let worldCitiesLoaded = false;

// ===== 国际数据异步加载 =====
async function ensureRegions() {
  if (regionsLoaded) return;
  try {
    const resp = await fetch('data/regions_world.json');
    if (resp.ok) {
      const raw = await resp.json();
      regionsData = raw.map(r => ({
        name: r.zh || r.en, nameEn: r.en, province: r.ad || r.cc,
        lat: r.la, lng: r.lo, level: 'region',
      }));
      regionsLoaded = true;
    }
  } catch (e) { console.warn('国际地区数据加载失败', e); }
}

async function ensureWorldCities() {
  if (worldCitiesLoaded) return;
  try {
    const resp = await fetch('data/cities_world.json');
    if (resp.ok) {
      const raw = await resp.json();
      worldCitiesData = raw.map(c => ({
        name: c.en, nameEn: c.en, province: c.cc,
        lat: c.la, lng: c.lo, level: 'city', pop: c.pop || 0,
      }));
      worldCitiesLoaded = true;
    }
  } catch (e) { console.warn('国际城市数据加载失败', e); }
}

function scoreMatch(item, q) {
  let score = 0;
  const name = item.name || '';
  const nameEn = (item.nameEn || '').toLowerCase();
  const province = item.province || '';
  const qLower = q.toLowerCase();
  if (name === q || nameEn === qLower) { score = 100; }
  else if (name.startsWith(q) || nameEn.startsWith(qLower)) { score = 80; }
  else if (name.includes(q) || nameEn.includes(qLower)) { score = 50; }
  else if (province.includes(q) || province.toLowerCase().includes(qLower)) { score = 20; }
  else { return 0; }
  if (item.level === 'city') score += 2;
  else if (item.level === 'province') score += 1;
  return score;
}

// ===== 初始化 =====
async function init() {
  // 加载城市数据
  const resp = await fetch('data/cities.json');
  citiesData = await resp.json();

  // 先绑定认证事件（不依赖登录状态）
  bindAuthEvents();

  // 检查登录状态
  if (!isLoggedIn()) {
    showAuthModal();
    return;
  }

  await doInit();
}

async function doInit() {
  // 初始化数据库
  const meta = await initDB();
  homeLocation = meta.home || null;
  places = await getAllPlaces();

  // 初始化地球
  earth = new Earth(document.getElementById('globe-container'));
  earth.onPlaceClick = (id) => showDetail(id);
  earth._onDataReady = () => { refreshEarth(); };

  // 根据屏幕宽高比连续调整初始摄像机高度
  // 窄屏（手机竖屏）→ 更高更远俯视；宽屏（桌面）→ 更低更近
  const aspect = window.innerWidth / window.innerHeight;
  const t = Math.max(0, Math.min(1, (1.6 - aspect) / 1.2));
  const camY = 1.5 + t * 2.0;
  const camZ = 3.5 + t * 2.0;
  earth.camera.position.set(0, camY, camZ);

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
    earth.setHome(homeLocation.lat, homeLocation.lng, homeLocation.name, homeLocation.province);
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
  const avg = calcAvgRating(places);
  document.getElementById('stats').textContent = `${total} 个地点 · ★ ${avg}`;
}

// ===== 地点悬浮卡片（屏幕空间） =====
function createPlaceCard(place) {
  const svg = document.getElementById('connector-lines');
  const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  line.dataset.placeId = place.id;
  svg.appendChild(line);

  const stars = renderStars(place.rating);
  const card = document.createElement('div');
  card.className = 'place-card';
  card.dataset.placeId = place.id;

  const nameDiv = document.createElement('div');
  nameDiv.className = 'place-card-name';
  nameDiv.textContent = place.name;
  card.appendChild(nameDiv);

  const metaDiv = document.createElement('div');
  metaDiv.className = 'place-card-meta';
  metaDiv.textContent = stars;
  card.appendChild(metaDiv);

  if (place.photos && place.photos.length > 0) {
    const img = document.createElement('img');
    img.className = 'place-card-thumb';
    img.src = place.photos[0].dataUrl;
    img.alt = '';
    card.appendChild(img);
  }
  // 单击/双击逻辑
  card.addEventListener('click', () => {
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
    if (card._lastTap && now - card._lastTap < DOUBLE_TAP_MS) {
      // 双击 → 直接进入编辑
      card._lastTap = 0;
      selectedPlaceId = place.id;
      document.getElementById('detail-card').classList.add('hidden');
      earth._focusedPlaceId = place.id;
      earth.highlightFill(place.id);
      earth.focusOnPlace(place.lat, place.lng, () => openEditModal(place));
    } else {
      card._lastTap = now;
      // 已聚焦卡片：第二次点击直接进编辑，不再飞一次
      if (earth._focusedPlaceId === place.id) {
        selectedPlaceId = place.id;
        document.getElementById('detail-card').classList.add('hidden');
        openEditModal(place);
        return;
      }
      setTimeout(() => {
        if (card._lastTap !== now) return;
        earth._focusedPlaceId = place.id;
        earth.highlightFill(place.id);
        earth.focusOnPlace(place.lat, place.lng);
      }, DOUBLE_TAP_MS);
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
  const screenW = window.innerWidth;
  const clusterScale = Math.min(1, Math.max(0.35, screenW / 768));
  const joinThresh = Math.round(120 * clusterScale);
  const splitThresh = Math.round(180 * clusterScale);
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

      // 计算展开目标：沿各卡片原始方向径向散开
      const spreadR = Math.round(140 * clusterScale);
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

  input.addEventListener('focus', () => { ensureRegions(); });

  input.addEventListener('input', () => {
    const q = input.value.trim();
    if (!q) { results.classList.remove('active'); return; }

    // 输入非中文时，触发国际城市异步加载
    if (!/[一-鿿]/.test(q)) { ensureWorldCities(); }

    const scored = [];
    for (const c of citiesData) {
      const s = scoreMatch(c, q);
      if (s > 0) scored.push({ city: c, score: s });
    }
    for (const r of regionsData) {
      const s = scoreMatch(r, q);
      if (s > 0) scored.push({ city: r, score: s });
    }
    for (const w of worldCitiesData) {
      const s = scoreMatch(w, q);
      if (s > 0) scored.push({ city: w, score: s });
    }
    scored.sort((a, b) => b.score - a.score);
    const matched = scored.slice(0, 15).map(s => s.city);

    results.innerHTML = '';
    if (matched.length === 0) { results.classList.remove('active'); return; }
    results.classList.add('active');
    const rect = input.getBoundingClientRect();
    results.style.top = (rect.bottom + 4) + 'px';
    results.style.left = rect.left + 'px';
    results.style.width = rect.width + 'px';

    for (const c of matched) {
      const div = document.createElement('div');
      div.className = 'result-item';
      div.appendChild(document.createTextNode(c.name));
      const provSpan = document.createElement('span');
      provSpan.className = 'province';
      provSpan.textContent = c.province;
      div.appendChild(provSpan);
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
      try {
        const photo = await uploadPhoto(place.id, file);
        place.photos.push(photo);
      } catch (err) {
        alert('照片上传失败: ' + err.message);
      }
    }
    renderPhotos(place);
    syncPlaceCards();
    fileInput.value = '';
  };
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

let _pvPlace = null;
let _pvIndex = 0;

function openPhotoViewer(photo, place) {
  _pvPlace = place;
  _pvIndex = place.photos ? place.photos.indexOf(photo) : 0;
  if (_pvIndex < 0) _pvIndex = 0;
  _renderPhotoViewer();

  const viewer = document.getElementById('photo-viewer');
  viewer.classList.remove('hidden');
}

function _renderPhotoViewer() {
  const photos = _pvPlace?.photos || [];
  const photo = photos[_pvIndex];
  if (!photo) return;

  document.getElementById('photo-viewer-img').src = photo.dataUrl;
  document.getElementById('photo-caption').value = photo.caption || '';
  document.getElementById('photo-index').textContent = photos.length > 1 ? `${_pvIndex + 1} / ${photos.length}` : '';

  document.getElementById('photo-prev').style.display = photos.length > 1 ? '' : 'none';
  document.getElementById('photo-next').style.display = photos.length > 1 ? '' : 'none';
}

function _navigatePhoto(delta) {
  const photos = _pvPlace?.photos || [];
  if (photos.length === 0) return;
  _pvIndex = (_pvIndex + delta + photos.length) % photos.length;
  _renderPhotoViewer();
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
  document.getElementById('input-lat').value = place.lat;
  document.getElementById('input-lng').value = place.lng;
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

  // 账号按钮
  document.getElementById('btn-account').addEventListener('click', () => {
    if (isLoggedIn()) {
      if (confirm(`确定退出登录？`)) { logout(); location.reload(); }
    } else {
      showAuthModal();
    }
  });

  // 添加地点按钮
  document.getElementById('btn-add').addEventListener('click', () => {
    isEditing = false;
    selectedCity = null;
    addRating = 0;
    tempPhotos = [];
    document.getElementById('city-search').value = '';
    document.getElementById('input-lat').value = '';
    document.getElementById('input-lng').value = '';
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
    earth.setHome(c.lat, c.lng, c.name, c.province);
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
      let match = citiesData.find(c => c.name === name)
        || regionsData.find(r => r.name === name || r.nameEn === name)
        || worldCitiesData.find(w => w.name === name || w.nameEn === name);
      if (!match) match = citiesData.find(c => c.name.includes(name));
      if (match) {
        selectedCity = match;
        document.getElementById('city-search').value = match.name;
      } else {
        // 降级：手动输入经纬度
        const lat = parseFloat(document.getElementById('input-lat').value);
        const lng = parseFloat(document.getElementById('input-lng').value);
        if (isNaN(lat) || isNaN(lng)) {
          alert('未匹配到城市，请手动输入经纬度坐标'); return;
        }
        selectedCity = { name, province: '', lat, lng };
      }
    }

    const newPhotos = tempPhotos.filter(p => p._new);
    const existingPhotos = tempPhotos.filter(p => !p._new).map(p => ({ id: p.id, dataUrl: p.dataUrl, caption: p.caption }));

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
      place.photos = existingPhotos;
      await savePlace(place);
      // 上传新照片
      for (const p of newPhotos) {
        try {
          const uploaded = await uploadPhoto(place.id, p.file);
          place.photos.push(uploaded);
        } catch (err) { console.warn('Photo upload failed:', err); }
      }
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
      photos: existingPhotos
    };

    await savePlace(newPlace);
    // 上传新照片
    for (const p of newPhotos) {
      try {
        const uploaded = await uploadPhoto(newPlace.id, p.file);
        newPlace.photos.push(uploaded);
      } catch (err) { console.warn('Photo upload failed:', err); }
    }
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

    // 从最新数据获取完整地点
    places = await getAllPlaces();
    const saved = places.find(p => p.id === newPlace.id);
    if (saved) showDetail(saved.id);
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
      tempPhotos.push({
        id: crypto.randomUUID(),
        file: file,
        dataUrl: URL.createObjectURL(file), // 预览用 blob URL
        caption: '',
        _new: true, // 标记为新增，保存时需要上传
      });
    }
    renderModalPhotos();
    e.target.value = '';
  });

  // 取消添加
  document.getElementById('btn-cancel-add').addEventListener('click', () => {
    document.getElementById('add-modal').classList.add('hidden');
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

  // 导入数据
  const importInput = document.getElementById('import-file');
  document.getElementById('btn-import').addEventListener('click', () => {
    dropdown.classList.add('hidden');
    settingsBtn.classList.remove('active');
    importInput.click();
  });
  importInput.addEventListener('change', async () => {
    const file = importInput.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (!data.places && !data.home && !data.theme) {
        alert('无效的备份文件');
        return;
      }
      if (!confirm(`将导入 ${data.places?.length || 0} 个地点，覆盖现有数据？`)) return;
      await importAllData(data);
      places = await getAllPlaces();
      homeLocation = (await initDB()).home || null;
      updateStats();
      refreshEarth();
      if (homeLocation) {
        document.getElementById('home-name').textContent = homeLocation.name;
        document.getElementById('home-display').classList.remove('hidden');
      } else {
        document.getElementById('home-display').classList.add('hidden');
      }
      alert('导入完成');
    } catch (err) {
      alert('导入失败：' + err.message);
    }
    importInput.value = '';
  });

  // 地点总览
  document.getElementById('btn-overview').addEventListener('click', () => {
    dropdown.classList.add('hidden');
    settingsBtn.classList.remove('active');
    renderOverview();
    document.getElementById('overview-modal').classList.remove('hidden');
  });

  // 重置视角
  document.getElementById('btn-reset-view').addEventListener('click', () => {
    earth.resetView();
    dropdown.classList.add('hidden');
    settingsBtn.classList.remove('active');
  });

  // 全局点击统一处理
  document.addEventListener('click', (e) => {
    const hitCard = e.target.closest('.place-card');
    const hitModal = e.target.closest('.modal');
    const hitDropdown = e.target.closest('.dropdown') || e.target.closest('#btn-settings');
    const hitOverview = e.target.closest('.overview-content');
    const hitDetail = e.target.closest('#detail-card');
    const hitHeaderBtn = e.target.closest('header button, header input');
    const isInteractive = hitCard || hitModal || hitDropdown || hitOverview || hitDetail || hitHeaderBtn || e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA';

    // 关闭下拉菜单
    if (!hitDropdown) {
      dropdown.classList.add('hidden');
      settingsBtn.classList.remove('active');
    }

    // 关闭详情卡片
    const card = document.getElementById('detail-card');
    if (!card.classList.contains('hidden') && !hitDetail && !hitModal) {
      card.classList.add('hidden');
      selectedPlaceId = null;
    }

    // 非交互区域：回退视角（聚焦某地点时点击空白即拉回全景）
    if (!isInteractive && earth._focusedPlaceId) {
      earth.resetView();
    }
  });

  // 关闭详情
  document.getElementById('btn-close-detail').addEventListener('click', () => {
    document.getElementById('detail-card').classList.add('hidden');
    selectedPlaceId = null;
  });

  // 总览弹窗关闭
  document.getElementById('overview-modal').querySelector('.btn-close').addEventListener('click', () => {
    document.getElementById('overview-modal').classList.add('hidden');
  });
  document.getElementById('overview-modal').querySelector('.modal-backdrop').addEventListener('click', () => {
    document.getElementById('overview-modal').classList.add('hidden');
  });

  // 照片查看器：关闭、翻页、caption 保存、键盘
  const photoViewer = document.getElementById('photo-viewer');
  const closePV = () => {
    const captionInput = document.getElementById('photo-caption');
    const photos = _pvPlace?.photos || [];
    const photo = photos[_pvIndex];
    if (photo && captionInput.value !== (photo.caption || '')) {
      photo.caption = captionInput.value;
      savePlace(_pvPlace).then(() => {
        renderPhotos(_pvPlace);
        syncPlaceCards();
      });
    }
    photoViewer.classList.add('hidden');
  };
  photoViewer.querySelector('.btn-close').addEventListener('click', closePV);
  photoViewer.querySelector('.modal-backdrop').addEventListener('click', closePV);

  document.getElementById('photo-prev').addEventListener('click', (e) => { e.stopPropagation(); _navigatePhoto(-1); });
  document.getElementById('photo-next').addEventListener('click', (e) => { e.stopPropagation(); _navigatePhoto(1); });

  document.addEventListener('keydown', (e) => {
    if (photoViewer.classList.contains('hidden')) return;
    if (e.key === 'ArrowLeft') _navigatePhoto(-1);
    else if (e.key === 'ArrowRight') _navigatePhoto(1);
    else if (e.key === 'Escape') closePV();
  });

  // 退出登录
  document.getElementById('btn-logout').addEventListener('click', () => {
    dropdown.classList.add('hidden');
    settingsBtn.classList.remove('active');
    if (confirm('确定退出登录？')) {
      logout();
      location.reload();
    }
  });

}

// ===== 认证 =====
function bindAuthEvents() {
  document.getElementById('btn-auth-submit').addEventListener('click', handleAuthSubmit);
  document.getElementById('btn-auth-switch').addEventListener('click', handleAuthSwitch);
  document.getElementById('btn-auth-close').addEventListener('click', hideAuthModal);
  document.getElementById('auth-modal').querySelector('.modal-backdrop').addEventListener('click', hideAuthModal);
  document.getElementById('auth-password').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleAuthSubmit();
  });
}

let _authMode = 'login'; // 'login' | 'register'

function showAuthModal() {
  _authMode = 'login';
  document.getElementById('auth-title').textContent = '登录';
  document.getElementById('btn-auth-submit').textContent = '登录';
  document.getElementById('btn-auth-switch').textContent = '没有账号？注册';
  document.getElementById('auth-error').style.display = 'none';
  document.getElementById('auth-email').value = '';
  document.getElementById('auth-password').value = '';
  document.getElementById('auth-modal').classList.remove('hidden');
}

function hideAuthModal() {
  document.getElementById('auth-modal').classList.add('hidden');
}

function handleAuthSwitch() {
  _authMode = _authMode === 'login' ? 'register' : 'login';
  document.getElementById('auth-title').textContent = _authMode === 'login' ? '登录' : '注册';
  document.getElementById('btn-auth-submit').textContent = _authMode === 'login' ? '登录' : '注册';
  document.getElementById('btn-auth-switch').textContent = _authMode === 'login' ? '没有账号？注册' : '已有账号？登录';
  document.getElementById('auth-error').style.display = 'none';
}

async function handleAuthSubmit() {
  const email = document.getElementById('auth-email').value.trim();
  const password = document.getElementById('auth-password').value;
  const errEl = document.getElementById('auth-error');

  if (!email || !password || password.length < 6) {
    errEl.textContent = '请输入有效邮箱和至少6位密码';
    errEl.style.display = '';
    return;
  }

  try {
    if (_authMode === 'login') {
      await login(email, password);
    } else {
      await register(email, password);
    }
    hideAuthModal();
    await doInit();
  } catch (err) {
    errEl.textContent = err.message || '操作失败';
    errEl.style.display = '';
  }
}

// ===== 地点总览列表 =====
function renderOverview() {
  const container = document.getElementById('overview-list');
  const sorted = [...places].sort((a, b) => (b.visitDate || '').localeCompare(a.visitDate || ''));

  const total = sorted.length;
  const avg = calcAvgRating(sorted);
  document.getElementById('overview-stats').textContent = `${total} 个地点 · ★ ${avg}`;

  if (total === 0) {
    container.innerHTML = '<div class="overview-empty">还没有地点，点击右上角 + 添加</div>';
    return;
  }

  container.innerHTML = sorted.map(p => {
    const stars = '★'.repeat(p.rating || 3) + '☆'.repeat(5 - (p.rating || 3));
    const photoCount = p.photos ? p.photos.length : 0;
    return `
      <div class="overview-item" data-id="${p.id}">
        <div class="overview-item-main">
          <div class="overview-item-name">${p.name}</div>
          <div class="overview-item-sub">${p.fullName || p.name} · ${p.visitDate || '无日期'}</div>
        </div>
        <span class="overview-item-stars">${stars}</span>
        <span class="overview-item-photos">${photoCount}张</span>
        <div class="overview-item-actions">
          <button class="overview-btn" data-action="edit" data-id="${p.id}">编辑</button>
          <button class="overview-btn danger" data-action="delete" data-id="${p.id}">删除</button>
        </div>
      </div>`;
  }).join('');

  // 整行点击 — 编辑
  container.querySelectorAll('.overview-item').forEach(item => {
    item.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      const id = item.dataset.id;
      document.getElementById('overview-modal').classList.add('hidden');
      const place = places.find(p => p.id === id);
      if (!place) return;
      selectedPlaceId = id;
      earth._focusedPlaceId = id;
      earth.highlightFill(id);
      earth.focusOnPlace(place.lat, place.lng, () => openEditModal(place));
    });
  });

  // 编辑按钮
  container.querySelectorAll('[data-action="edit"]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      document.getElementById('overview-modal').classList.add('hidden');
      const place = places.find(p => p.id === id);
      if (!place) return;
      selectedPlaceId = id;
      earth._focusedPlaceId = id;
      earth.highlightFill(id);
      earth.focusOnPlace(place.lat, place.lng, () => openEditModal(place));
    });
  });

  // 删除按钮
  container.querySelectorAll('[data-action="delete"]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      const place = places.find(p => p.id === id);
      if (!place || !confirm(`删除 ${place.name} ？`)) return;
      await deletePlace(id);
      places = await getAllPlaces();
      updateStats();
      refreshEarth();
      renderOverview();
    });
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
