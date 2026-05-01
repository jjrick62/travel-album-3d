# Colorful·Meridian 移动端 App 化 — 详细实施方案

> 生成于 2026-05-01 | 待执行

---

## 一、为什么要搞这套

当前项目是纯桌面网页，手机上三个问题：

1. **装不上** — 没 manifest、没 Service Worker，只能浏览器打开，关掉就没了。Three.js 走 CDN，断网直接白屏。
2. **摸不动** — 浏览器自带手势（双击放大、下拉刷新）跟 OrbitControls 打架。卡片双击区分靠 350ms 延迟，移动端跟浏览器 300ms 双击放大叠在一起，体验稀烂。
3. **不好看** — 全部字号/间距写死 px，只有一个 768px 断点改了几行。小屏上卡片挤、弹窗溢出、聚类阈值不合屏宽。

## 二、目标

把当前桌面网页变成**可安装（PWA）、可离线、手指操作顺畅、小屏不崩**的独立移动端 App。

---

## 三、详细执行步骤

### Phase 0：App 图标

**目的**：PWA 安装和主屏图标必须有 192x192 和 512x512 的 PNG。没有图标 manifest 不报错但 Android 不会弹安装提示。

**操作**：用浏览器 Canvas 生成两张 PNG：
- `icon-512.png` — 512x512，纯黑底(#000)，中央画一个发光的点/球（用径向渐变模拟发光），代表 3D 粒子地球上的一个地点标记
- `icon-192.png` — 192x192，缩小版同上
- `favicon-32.png` — 32x32，缩小版，给浏览器标签页用

**生成方式**：新建一个临时 HTML 文件，用 `<canvas>` 画好，`canvas.toBlob()` 导出下载。画完删掉临时文件。

**输出文件**：
- `D:/大学作业文件夹/自制软件/旅行相册/icon-192.png`
- `D:/大学作业文件夹/自制软件/旅行相册/icon-512.png`
- `D:/大学作业文件夹/自制软件/旅行相册/favicon-32.png`

---

### Phase 1：manifest.json（新建）

**目的**：这是 PWA 的入口。Android Chrome 读到它才会弹"添加到主屏幕"。iOS Safari 不读这个，但 Android 占移动端大头。

**文件**：`D:/大学作业文件夹/自制软件/旅行相册/manifest.json`

```json
{
  "name": "Colorful·Meridian",
  "short_name": "Colorful·Meridian",
  "description": "3D粒子地球旅行相册",
  "start_url": "./index.html",
  "display": "standalone",
  "background_color": "#000000",
  "theme_color": "#000000",
  "orientation": "any",
  "icons": [
    { "src": "icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```

**要点**：
- `start_url: "./index.html"` 用相对路径，本地 `http://localhost:8086/` 和 GitHub Pages `https://jjrick62.github.io/travel-album-3d/` 都通
- `display: standalone` 隐藏浏览器地址栏，全屏沉浸
- `theme_color: #000000` 状态栏黑色，跟 3D 背景一致
- `orientation: any` 不锁方向，横竖都行

---

### Phase 2：sw.js Service Worker（新建）

**目的**：离线可用 + 缓存 CDN 资源省流量。没有 SW 的 PWA 只是多了个图标，断网照样白屏。

**文件**：`D:/大学作业文件夹/自制软件/旅行相册/sw.js`

**缓存策略分四层**：

| 层级 | 资源 | 策略 | 为什么 |
|------|------|------|--------|
| CDN | three.js v0.160, OrbitControls | Cache-first | 版本号固定 URL，内容永远不会变 |
| App壳 | index.html, css/style.css, js/*.js | Network-first | 部署会更新，优先拿新版；离线时有旧版兜底 |
| 小数据 | cities.json(433KB), coastline/borders/china_cities geojson | Cache-first | 静态地图数据 |
| 大数据 | china_districts.geojson(23MB), world_admin1.geojson(17MB) | Network-first + 静默缓存 | 太大不能预缓存(浏览器配额约50-100MB per origin)；在线取到后尝试存，存不进就算了，静默失败 |

**三个事件处理**：

**`install`** — 预缓存 App 壳+小数据（保证首次离线能打开）：
```javascript
const APP_SHELL = [
  './', './index.html', './css/style.css',
  './js/data.js', './js/earth.js', './js/app.js',
  './data/cities.json'
];
// caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL))
// self.skipWaiting()
```

**`activate`** — 删掉旧版缓存，`clients.claim()` 让 SW 立即接管所有页面。

**`fetch`** — 按 URL 特征分流：
```javascript
if (url.hostname === 'cdn.jsdelivr.net')        → cacheFirst(request)
if (url.pathname.includes('/data/map/'))         → networkFirstLarge(request)
if (dest === 'document' || 'script' || 'style')  → networkFirst(request)
else                                               → cacheFirst(request)
```

**大文件处理函数 `networkFirstLarge`**：
```javascript
async function networkFirstLarge(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      try {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(request, response.clone());
      } catch (e) {
        // 配额满了，静默失败 — 不影响功能
        console.warn('缓存大文件失败（配额满？）:', request.url);
      }
    }
    return response;
  } catch (e) {
    // 离线 + 没缓存 → 尝试取缓存，没有就报错
    const cached = await caches.match(request);
    if (cached) return cached;
    throw e;
  }
}
```

**离线降级链**：
- 地球、地点标记、卡片 → App 壳已缓存，正常显示
- 用户照片 → IndexedDB，天然离线
- 地图边界（省/市） → 小 GeoJSON 已预缓存
- 县级边界 → 大 GeoJSON，在线时缓存过就有，没缓存过就不显示（不影响体验）
- Three.js → CDN 缓存，离线正常渲染

---

### Phase 3：index.html 修改

**目的**：挂上 manifest、SW 注册、iOS Safari 兼容标签、viewport 适配刘海屏。

**现有文件**：`D:/大学作业文件夹/自制软件/旅行相册/index.html`

**修改位置 1** — `<head>` 区域（在第 5 行 viewport meta 之后，第 7 行 stylesheet link 之前插入）：

```html
<!-- 现有: <meta name="viewport" content="width=device-width, initial-scale=1.0"> -->
<!-- 改为: -->
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover, maximum-scale=1.0, user-scalable=no">

<!-- 新增: -->
<link rel="manifest" href="./manifest.json">
<meta name="theme-color" content="#000000">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black">
<meta name="apple-mobile-web-app-title" content="Colorful·Meridian">
<link rel="icon" type="image/png" sizes="32x32" href="favicon-32.png">
```

**viewport 变更说明**：
- `viewport-fit=cover` — iOS standalone 模式下延伸到刘海区域，避免黑边
- `maximum-scale=1.0, user-scalable=no` — 禁掉页面缩放，因为 OrbitControls 自己管缩放，浏览器再插手就打架

**修改位置 2** — `</body>` 之前（第 146 行 `<script type="module" src="js/app.js"></script>` 之后）：

```html
<script>
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js', { scope: './' })
        .then(reg => console.log('SW 已注册:', reg.scope))
        .catch(err => console.warn('SW 注册失败:', err));
    });
  }
</script>
```

---

### Phase 4：style.css — 触摸规则 + rem 化 + 三断点

**目的**：这是改动量最大的文件。要做三件事：
1. 顶部加手势控制规则（禁止浏览器干扰触摸）
2. 全站 px 转 rem（以 `html { font-size: 16px }` 为基准）
3. 用三个 @media 断点替换现有单个断点

**现有文件**：`D:/大学作业文件夹/自制软件/旅行相册/css/style.css`（568行）

**当前唯一的 @media（第 562-567 行，要被替换）**：
```css
@media (max-width: 768px) {
  #header { padding: 10px 14px; }
  .header-left h1 { font-size: 15px; }
  .detail-card { right: 10px; width: calc(100% - 20px); max-height: 60vh; bottom: 10px; }
  .dropdown { right: 0; width: 260px; }
}
```

#### 4A：在文件顶部（`* { margin:0... }` 之后）插入触摸/手势规则块

```css
/* ===== 触摸 & 手势控制 ===== */
html {
  touch-action: manipulation;       /* 消除浏览器 300ms 点击延迟，禁双击缩放 */
  overscroll-behavior: none;        /* 禁止下拉刷新（Chrome Android） */
  -webkit-user-select: none;
  user-select: none;
}

/* 输入框、文本域恢复文字选中 */
input, textarea, [contenteditable] {
  -webkit-user-select: text;
  user-select: text;
}

/* Three.js canvas：OrbitControls 需要原始触摸事件，浏览器不准插手 */
canvas {
  touch-action: none !important;
}
```

**每条规则的原理**：
- `touch-action: manipulation` — 告诉浏览器"这页面只接受单指点击和双指滚动，别搞双击放大"，从而消除移动端 300ms 的 tap delay。配合下面 canvas 的 `touch-action: none`，在 3D 区域完全交给 OrbitControls
- `overscroll-behavior: none` — 当前 body 已有 `overflow: hidden`，但 Chrome Android 在顶部仍然可以下拉刷新。加这个彻底锁死
- `user-select: none` — 拖拽地球时不会误选文字
- `canvas { touch-action: none }` — 关键。没有这行的话，双指捏合会被浏览器截胡当成页面缩放，OrbitControls 收不到事件

#### 4B：全站 px → rem 转换

**先设基准**（在第 4A 触摸规则块之后，原有 `* { margin:0... }` 之后）：

```css
html {
  font-size: 16px;  /* 基准：1rem = 16px，后续三个断点只改这个值即可等比缩放整站 */
}
```

**转换表**（以下所有值在 CSS 中按此表替换）：

##### 字号
| 原值 | 新值 (rem) | 用在哪些选择器 |
|------|------------|----------------|
| 11px | 0.6875rem | `.place-card-meta`, `.province` |
| 12px | 0.75rem | `.place-card`, `.dropdown-label`, `.form-group label`, `.detail-meta`, `.detail-fullname`, `.detail-date` |
| 13px | 0.8125rem | `.stats`, `.btn-text`, `.dropdown-btn`, `.home-display`, `.place-card-name` |
| 14px | 0.875rem | `.btn-primary`/`.btn-secondary`/`.btn-outline` font-size, `.detail-notes`, `.form-group input/textarea/select`, `.result-item`, `.home-display` |
| 15px | 0.9375rem | header h1 at ≤768px 断点 |
| 17px | 1.0625rem | `.modal-header h2`, `.detail-header h2` |
| 18px | 1.125rem | `.header-left h1`, `.btn-add` font-size, `.btn-triangle` font-size |
| 22px | 1.375rem | `.btn-close` |
| 24px | 1.5rem | `.star-input span` (星星评分) |
| 32px | 2rem | `.btn-close-light` |

##### 间距（padding / margin / gap）
| 原值 | 新值 (rem) | 用在哪些属性 |
|------|------------|--------------|
| 4px | 0.25rem | photo-grid gap |
| 6px | 0.375rem | header-right gap, margin-top |
| 8px | 0.5rem | detail-footer gap, detail-body gap, dropdown padding |
| 10px | 0.625rem | modal-footer gap, form-group input padding |
| 12px | 0.75rem | dropdown padding |
| 14px | 0.875rem | header padding-top/bottom, header-left gap, form-group margin-bottom, modal/header padding |
| 16px | 1rem | modal-backdrop / btn-close-light / photo-viewer |
| 18px | 1.125rem | btn-primary/btn-secondary/btn-outline padding-left/right |
| 20px | 1.25rem | header padding-left/right, modal-header/body/footer padding |
| 24px | 1.5rem | detail-card bottom/right, modal-header/body/footer padding |

##### 尺寸（宽高）
| 原值 | 新值 (rem) | 用在哪些属性 |
|------|------------|--------------|
| 32px | 2rem | `.btn-add`, `.btn-triangle`, `.btn-pause` 宽高 |
| 60px | 3.75rem | `.place-card-thumb` height |
| 140px | 8.75rem | `.place-card` min-width |
| 200px | 12.5rem | `.place-card` max-width |
| 260px | 16.25rem | `.dropdown` width at breakpoint |
| 280px | 17.5rem | `.dropdown` width |
| 340px | — | `.detail-card` width 改用 clamp (见下) |

**`.detail-card` 宽度特殊处理**（不用 rem 固定值，用 clamp 弹性）：
```css
.detail-card {
  width: clamp(18rem, 25vw, 22rem);  /* 288px ~ 352px，随视口宽度弹性 */
  bottom: 1.5rem;
  right: 1.5rem;
}
```

#### 4C：替换现有 @media 为三个断点

**删除**现有 `@media (max-width: 768px)` 块（第 562-567 行），**替换为**以下三个断点块：

##### 断点 1：手机竖屏 `@media (max-width: 479px)`

```css
/* ===== 手机竖屏 (< 480px) ===== */
@media (max-width: 479px) {
  html { font-size: 14px; }  /* 基准缩小 12.5%，所有 rem 自动等比缩放 */

  #header {
    padding: 0.5rem 0.75rem;
  }
  .header-left h1 {
    font-size: 0.9375rem;
  }
  .header-left { gap: 0.5rem; }
  .stats { font-size: 0.6875rem; }

  /* 按钮缩小 */
  .btn-add, .btn-triangle, .btn-pause {
    width: 1.75rem;
    height: 1.75rem;
    min-width: 1.5rem;
    min-height: 1.5rem;
    font-size: 0.9375rem;
  }

  /* 悬浮卡片：更小更紧凑 */
  .place-card {
    min-width: 5.5rem;
    max-width: 7.5rem;
    padding: 0.35rem 0.4rem;
    border-radius: 0.375rem;
    font-size: 0.6875rem;
    border-width: 1px;
  }
  .place-card-name { font-size: 0.6875rem; }
  .place-card-meta { font-size: 0.625rem; }
  .place-card-thumb { height: 2.5rem; }

  /* 卡片堆叠伪元素：小屏禁用（空间不够） */
  .place-card-stacked::before,
  .place-card-stacked::after { display: none; }

  /* 详情卡片：从底部滑上来的抽屉 */
  .detail-card {
    left: 0;
    right: 0;
    bottom: 0;
    width: 100%;
    max-height: 58vh;
    border-radius: 0.625rem 0.625rem 0 0;
    animation: slideUp 0.25s ease;
  }
  @keyframes slideUp {
    from { transform: translateY(100%); }
    to   { transform: translateY(0); }
  }

  /* 弹窗：底部抽屉式全宽 */
  .modal-content {
    width: 100%;
    max-width: 100%;
    max-height: 88vh;
    border-radius: 0.625rem 0.625rem 0 0;
    align-self: flex-end;
  }
  .modal-header { padding: 1rem 1.25rem 0; }
  .modal-body   { padding: 1rem 1.25rem; }
  .modal-footer { padding: 0 1.25rem 1rem; }

  /* 下拉菜单：几乎全宽 */
  .dropdown {
    width: calc(100vw - 1rem);
    right: 0.5rem;
  }

  /* 照片网格：4列紧凑 */
  .photo-grid { grid-template-columns: repeat(4, 1fr); gap: 0.1875rem; }
  .modal-photo-grid { grid-template-columns: repeat(4, 1fr); }

  /* 照片查看器 */
  .photo-viewer-content {
    max-width: 96vw;
    max-height: 85vh;
  }
}
```

##### 断点 2：手机横屏 / 小平板 `@media (min-width: 480px) and (max-width: 767px)`

```css
/* ===== 手机横屏 / 小平板 (480px - 767px) ===== */
@media (min-width: 480px) and (max-width: 767px) {
  html { font-size: 15px; }

  .place-card {
    min-width: 6rem;
    max-width: 8.5rem;
  }
  .place-card-thumb { height: 3rem; }

  .detail-card {
    width: min(20rem, calc(100% - 0.75rem));
    right: 0.375rem;
    bottom: 0.75rem;
    max-height: 65vh;
  }

  .modal-content { max-width: 28rem; }

  .dropdown { width: 16rem; }

  .photo-grid { grid-template-columns: repeat(3, 1fr); }
}
```

##### 断点 3：桌面 `@media (min-width: 768px)`

```css
/* ===== 桌面 (>= 768px) ===== */
@media (min-width: 768px) {
  html { font-size: 16px; }
  /* 所有值已在基础样式中以 rem 定义，无需覆盖 */
}
```

**额外：搜索结果宽度限制**（加在原有 `.search-results` 规则中）：
```css
.search-results {
  /* 保留原有属性... */
  max-width: min(20rem, calc(100vw - 2rem));  /* 小屏不溢出 */
}
```

---

### Phase 5：earth.js — 最小改动

**目的**：JS 侧补一刀 canvas touch-action + 防长按菜单。

**现有文件**：`D:/大学作业文件夹/自制软件/旅行相册/js/earth.js`（1052行）

**修改 1** — `_initScene()` 方法中，`this.container.appendChild(this.renderer.domElement)` 之后（约第 48 行），加一行：

```javascript
// 禁止浏览器对 canvas 的默认手势，让 OrbitControls 完全接管触摸
this.renderer.domElement.style.touchAction = 'none';
```

**修改 2** — `_initClickHandler()` 方法末尾（约第 725 行后面），加一行：

```javascript
// 禁止长按弹出上下文菜单（移动端长按地球不要弹"保存图片"之类）
el.addEventListener('contextmenu', (e) => e.preventDefault());
```

**不需要改的地方**：
- `_initControls()` — OrbitControls 已内置 pointerdown/move/up，不需要动
- `_initKeyboard()` — 空格暂停正常
- `_onResize()` — resize 逻辑本身没问题，不需要动
- `_animate()` — 动画循环不需要动

---

### Phase 6：app.js — 交互和响应式逻辑

**目的**：双击延迟优化、聚类阈值随屏宽缩放、相机初始距离分三档、全局点击回退 guard 补全。

**现有文件**：`D:/大学作业文件夹/自制软件/旅行相册/js/app.js`（962行）

#### 6A：文件顶部加设备检测常量（约第 5 行 import 之后）

```javascript
// 触摸设备检测（用于调优双击间隔）
const IS_TOUCH = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
const DOUBLE_TAP_MS = IS_TOUCH ? 250 : 350;
```

#### 6B：双击延迟替换（`createPlaceCard()` 函数内，约第 108-148 行）

两处 `350` 替换为 `DOUBLE_TAP_MS`：
- `if (card._lastTap && now - card._lastTap < DOUBLE_TAP_MS)` — 第 112 行附近
- `setTimeout(() => { ... }, DOUBLE_TAP_MS)` — 第 133 行附近

#### 6C：聚类阈值自适应（`updatePlaceCards()` 函数内，约第 220-230 行）

找到 `joinThresh` 和 `splitThresh` 的定义，改为：

```javascript
// 聚类阈值按屏幕宽度缩放：屏幕越窄，越早合并，留出空间
const screenW = window.innerWidth;
const clusterScale = Math.min(1, Math.max(0.35, screenW / 768));
const joinThresh = Math.round(120 * clusterScale);
const splitThresh = Math.round(180 * clusterScale);
```

同时展开半径也缩放（约第 307 行 `spreadR`）：

```javascript
const spreadR = Math.round(140 * clusterScale);
```

**效果对比**：

| 屏幕 | clusterScale | joinThresh | splitThresh | spreadR |
|------|-------------|------------|-------------|---------|
| 1920px | 1.00 | 120px | 180px | 140px |
| 768px | 1.00 | 120px | 180px | 140px |
| 480px | 0.625 | 75px | 113px | 88px |
| 375px | 0.49 | 59px | 88px | 68px |
| 320px | 0.42 | 50px | 75px | 58px |

#### 6D：相机初始距离分三档（`init()` 函数内，约第 38-40 行）

替换现有的单一 `<= 768` 判断：

```javascript
// 手机端/平板端摄像机初始距离适配
const w = window.innerWidth;
if (w <= 480) {
  earth.camera.position.set(0, 2.8, 6.0);   // 小屏：摄像机更远，多看一些地球
} else if (w <= 768) {
  earth.camera.position.set(0, 2.0, 5.2);   // 平板：适中
}
// 桌面保持默认 (0, 1.5, 3.5)
```

#### 6E：全局点击回退补 guard（`bindEvents()` 函数末尾，约第 940-943 行）

现有代码：
```javascript
document.addEventListener('click', (e) => {
    if (e.target.closest('.place-card') || e.target.closest('.place-card-badge')) return;
    if (earth._focusedPlaceId) earth.resetView();
});
```

改为：
```javascript
document.addEventListener('click', (e) => {
    // 点击悬浮卡片 → 不处理，让卡片自己的 click 处理
    if (e.target.closest('.place-card') || e.target.closest('.place-card-badge')) return;
    // 点击弹窗、下拉菜单 → 不触发视角回退
    if (e.target.closest('.modal') || e.target.closest('.dropdown')) return;
    if (earth._focusedPlaceId) earth.resetView();
});
```

---

## 四、完整执行顺序

```
Phase 0  生成 App 图标（独立，无依赖）
    │
Phase 1  创建 manifest.json（独立，无依赖）
    │
Phase 2  创建 sw.js（独立，无依赖）
    │
Phase 3  修改 index.html（依赖 Phase 0/1/2 文件已存在）
    │
Phase 4  修改 style.css（独立，不依赖其他 Phase）
    │
Phase 5  修改 earth.js - canvas touch-action + contextmenu（逻辑上依赖 Phase 4 的 CSS 策略）
    │
Phase 6  修改 app.js - 双击延迟 + 聚类阈值 + 相机距离 + click guard（逻辑上依赖 Phase 4 的断点定义）
    │
    ▼
  验证
```

Phase 0-4 可以并行开工，Phase 5-6 写在 Phase 4 之后。

---

## 五、验证清单

改完后，启本地服务 `npx http-server . -p 8086 -c-1`，逐条过：

### PWA
- [ ] Chrome DevTools → Application → Manifest 无报错
- [ ] Application → Service Workers 显示已激活
- [ ] 断网刷新 — 地球和已有点位正常显示
- [ ] 断网下缩放 — 省/市边界正常（小 GeoJSON 已预缓存），县级边界如果之前缓存过就显示
- [ ] Android Chrome 打开 → 弹"添加到主屏幕"
- [ ] 添加后从主屏打开 → 全屏，无浏览器地址栏

### 触摸
- [ ] Chrome Android 上下拉 → 不触发刷新
- [ ] 双击页面空白 → 不触发浏览器缩放
- [ ] 单指拖拽地球 → 旋转流畅，OrbitControls 正常
- [ ] 双指捏合 → 缩放地球
- [ ] 单指点击地点光点 → 摄像机飞过去，卡片弹出
- [ ] 快速双击卡片 → 弹出编辑框
- [ ] 点击折叠的卡片组 → 展开
- [ ] 长按地球 → 不弹浏览器菜单
- [ ] 点击弹窗内按钮、星星评分、搜索下拉 → 正常响应

### 响应式
- [ ] 375x812 (iPhone) — 卡片小但不挤，详情卡底部抽屉，弹窗全宽
- [ ] 812x375 (iPhone 横屏) — 卡片适中
- [ ] 768x1024 (iPad) — 布局舒适
- [ ] 1920x1080 — 跟原来一样
- [ ] 拖浏览器窗口从宽到窄 → 布局不崩，卡片重新聚类
- [ ] 手机上聚类更激进（更容易合并）
- [ ] 字号在各断点可读（不小于实际 9.6px）

---

## 六、风险与兜底

| 风险 | 概率 | 影响 | 兜底 |
|------|------|------|------|
| 23MB GeoJSON 超出 Cache API 配额 | 中 | 县级边界离线不显示 | 静默失败，不影响核心功能 |
| iOS Safari standalone 状态栏重叠 | 中 | 刘海区域可能遮挡 header | `viewport-fit=cover` + 顶部 safe-area-inset-top padding |
| OrbitControls + touch-action:none 兼容 | 低 | Three 0.160 OrbitControls 已全面支持 pointer events |
| rem 缩放后某些元素过小 | 低 | 最小基准 14px，理论最小值 9.6px | 断点处 `html font-size` 可上调 |
