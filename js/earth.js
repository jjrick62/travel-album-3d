// ===== Three.js 粒子地球 =====

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export class Earth {
  constructor(container) {
    this.container = container;
    this.visitedClusters = [];
    this.arcLines = [];
    this.clickMeshes = [];
    this.homeMarker = null;
    this.homeGlow = null;
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();
    this.onPlaceClick = null;
    this.earthRadius = 1.4;
    this.fadingItems = [];
    this.meteorTimer = 0;
    this.meteors = [];
    this._glowTex = this._makeGlowTexture();
    this._sizedPoints = [];
    this._refHeight = 1080;
    this._placeDots = [];
    this._placeFills = [];

    this._initScene();
    this._initControls();
    this._startRotation();
    this._initClickHandler();
    this._initKeyboard();
  }

  _initScene() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x000000);

    this.camera = new THREE.PerspectiveCamera(45, this.container.clientWidth / this.container.clientHeight, 0.1, 1000);
    this.camera.position.set(0, 1.5, 3.5);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.container.appendChild(this.renderer.domElement);

    // 地球组（所有地球相关对象放一起，统一旋转）
    this.earthGroup = new THREE.Group();
    this.scene.add(this.earthGroup);

    window.addEventListener('resize', () => this._onResize());
  }

  _initControls() {
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.rotateSpeed = 0.5;
    this.controls.minDistance = 1.8;
    this.controls.maxDistance = 6;
    this.controls.target.set(0, 0, 0);
  }

  _onResize() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);

    const scale = Math.max(h, 600) / this._refHeight;
    for (const { mesh, baseSize } of this._sizedPoints) {
      mesh.material.size = baseSize * scale;
    }
  }

  // ===== 加载真实海岸线 + 国界线 =====
  async loadCoastlines() {
    try {
      const base = 'data/map';
      const [coastResp, borderResp] = await Promise.all([
        fetch(`${base}/coastline.geojson`),
        fetch(`${base}/borders.geojson`),
      ]);

      if (!coastResp.ok) throw new Error(`coastline HTTP ${coastResp.status}`);

      const coastData = await coastResp.json();
      this._geoJSONToParticles(coastData, {
        color: 0xffffff,
        size: 1.2,
        opacity: 0.8,
      }, 'coastlinePoints');

      if (borderResp.ok) {
        const borderData = await borderResp.json();
        this._geoJSONToParticles(borderData, {
          color: 0xffffff,
          size: 1.2,
          opacity: 0.8,
        }, 'borderPoints', true);
        console.log(`[Earth] borders loaded`);
      }

      console.log(`[Earth] coastline loaded`);
    } catch (err) {
      console.warn('Map data load failed:', err);
    }

    this._drawRim();
  }

  _geoJSONToParticles(geojson, style, propName, skipFade = false, step = 1) {
    const RADIUS = this.earthRadius * 1.003;
    const pts = [];

    for (const feature of geojson.features) {
      const geom = feature.geometry;
      if (!geom) continue;
      let lines = [];
      if (geom.type === 'LineString') lines = [geom.coordinates];
      else if (geom.type === 'MultiLineString') lines = geom.coordinates;
      else if (geom.type === 'Polygon') lines = [geom.coordinates[0]];
      else if (geom.type === 'MultiPolygon') {
        for (const poly of geom.coordinates) lines.push(poly[0]);
      }
      for (const line of lines) {
        for (let ci = 0; ci < line.length; ci += step) {
          const [lng, lat] = line[ci];
          const p = this._latLngToVec3(lat, lng, RADIUS);
          pts.push(p.x, p.y, p.z);
        }
        // 确保首尾点都在（闭合多边形需要）
        if (step > 1 && line.length > 1 && (line.length - 1) % step !== 0) {
          const [lng, lat] = line[line.length - 1];
          const p = this._latLngToVec3(lat, lng, RADIUS);
          pts.push(p.x, p.y, p.z);
        }
      }
    }

    if (pts.length === 0) return;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));

    const mat = new THREE.PointsMaterial({
      color: style.color,
      size: style.size,
      transparent: true,
      opacity: style.opacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: false,
    });

    const mesh = new THREE.Points(geo, mat);
    mesh.material.transparent = true;
    this[propName] = mesh;
    this.earthGroup.add(mesh);
    this._sizedPoints.push({ mesh, baseSize: style.size });
    if (!skipFade) {
      mesh.material.opacity = 0;
      this.fadingItems.push({ mesh, target: style.opacity });
    }
    console.log(`[Earth] ${propName}: ${pts.length / 3} pts`);
  }

  clearCoastlines() {
    for (const key of ['coastlinePoints', 'borderPoints', 'admin1Points', 'cityPoints', 'districtPoints']) {
      if (this[key]) {
        this.earthGroup.remove(this[key]);
        this[key] = null;
      }
    }
  }

  // 缩放图层辅助：进入阈值立即显示，退出阈值平滑淡出
  _applyZoomLayer(mesh, dist, threshold, opacity, stateKey) {
    const target = dist < threshold ? opacity : 0;
    if (this[stateKey] === undefined) this[stateKey] = 0;
    if (target > 0 && this[stateKey] < 0.01) {
      this[stateKey] = target;
    } else if (target === 0 && this[stateKey] < 0.005) {
      this[stateKey] = 0;
    } else {
      this[stateKey] += (target - this[stateKey]) * 0.05;
    }
    mesh.material.opacity = this[stateKey];
  }

  // ===== 地球地平线粒子轮廓 =====
  _drawRim() {
    const R = this.earthRadius * 1.03;
    const count = 300;
    const pts = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      // 略微随机偏移，看起来像自然粒子
      const jitter = 1 + (Math.random() - 0.5) * 0.02;
      pts[i*3] = R * Math.cos(a) * jitter;
      pts[i*3+1] = (Math.random() - 0.5) * 0.03;
      pts[i*3+2] = R * Math.sin(a) * jitter;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const mat = new THREE.PointsMaterial({
      color: 0xffffff, size: 1.2, transparent: true, opacity: 0.2,
      blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: false,
    });
    this.rimPoints = new THREE.Points(geo, mat);
    this.scene.add(this.rimPoints);
    this._sizedPoints.push({ mesh: this.rimPoints, baseSize: 1.2 });
  }

  // ===== 加载省级行政区边界 =====
  async loadAdminBoundaries() {
    try {
      const resp = await fetch('data/map/china_provinces.geojson');
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      this._geoJSONToParticles(data, {
        color: 0xffffff,
        size: 1.5,
        opacity: 0.4,
      }, 'admin1Points', true);
      console.log(`[Earth] admin1 boundaries loaded`);
    } catch (err) {
      console.warn('Admin1 load failed:', err);
    }
  }

  // ===== 加载地级市边界 =====
  async loadCities() {
    try {
      const resp = await fetch('data/map/china_cities.geojson');
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      this._citiesGeoJSON = data;
      this._geoJSONToParticles(data, {
        color: 0xffffff,
        size: 0.85,
        opacity: 0.35,
      }, 'cityPoints', true, 2);
      if (this._onDataReady) this._onDataReady();
      console.log(`[Earth] cities loaded`);
    } catch (err) {
      console.warn('Cities load failed:', err);
    }
  }

  // ===== 加载县级边界（懒加载，放大到足够近才触发） =====
  async loadDistricts() {
    if (this._districtsLoading || this.districtPoints) return;
    this._districtsLoading = true;
    try {
      const resp = await fetch('data/map/china_districts.geojson');
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      this._districtsGeoJSON = data;
      this._geoJSONToParticles(data, {
        color: 0xffffff,
        size: 0.75,
        opacity: 0.25,
      }, 'districtPoints', true, 4);
      console.log(`[Earth] districts loaded`);
    } catch (err) {
      console.warn('Districts load failed:', err);
    }
  }

  // ===== 经纬度转3D =====
  _latLngToVec3(lat, lng, radius) {
    const phi = (90 - lat) * Math.PI / 180;
    const theta = (lng + 180) * Math.PI / 180;
    return new THREE.Vector3(
      -radius * Math.sin(phi) * Math.cos(theta),
      radius * Math.cos(phi),
      radius * Math.sin(phi) * Math.sin(theta)
    );
  }

  // ===== 星空 =====
  _generateStars() {
    const count = 1000;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const r = 12 + Math.random() * 25;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      positions[i*3] = r * Math.sin(phi) * Math.cos(theta);
      positions[i*3+1] = r * Math.cos(phi);
      positions[i*3+2] = r * Math.sin(phi) * Math.sin(theta);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color: 0xffffff, size: 0.04,
      transparent: true, opacity: 0.8,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this.starsMesh = new THREE.Points(geo, mat);
    this.scene.add(this.starsMesh);
    this._sizedPoints.push({ mesh: this.starsMesh, baseSize: 0.04 });
  }

  // ===== 设置常住地 =====
  setHome(lat, lng) {
    if (this.homeMarker) {
      this.earthGroup.remove(this.homeMarker);
    }
    const pos = this._latLngToVec3(lat, lng, this.earthRadius * 1.02);

    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: this._glowTex,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      color: 0xffffff,
      opacity: 0.9,
    }));
    sprite.position.copy(pos);
    sprite.scale.setScalar(0.16);
    this.earthGroup.add(sprite);
    this.homeMarker = sprite;
  }

  // ===== 多边形内点判断（射线法） =====
  _pointInPolygon(lng, lat, ring) {
    let inside = false;
    const n = ring.length;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = ring[i][0], yi = ring[i][1];
      const xj = ring[j][0], yj = ring[j][1];
      if ((yi > lat) !== (yj > lat) && lng < (xj - xi) * (lat - yi) / (yj - yi) + xi) {
        inside = !inside;
      }
    }
    return inside;
  }

  // ===== 填充行政区划多边形 =====
  _fillFeature(feature, density) {
    const RADIUS = this.earthRadius * 1.004;
    const geom = feature.geometry;
    if (!geom) return [];

    let rings = [];
    if (geom.type === 'Polygon') rings = [geom.coordinates[0]];
    else if (geom.type === 'MultiPolygon') {
      for (const poly of geom.coordinates) rings.push(poly[0]);
    } else return [];

    const pts = [];
    for (const ring of rings) {
      if (ring.length < 3) continue;
      let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;
      for (const c of ring) {
        if (c[0] < minLng) minLng = c[0];
        if (c[0] > maxLng) maxLng = c[0];
        if (c[1] < minLat) minLat = c[1];
        if (c[1] > maxLat) maxLat = c[1];
      }
      const dLng = maxLng - minLng;
      const dLat = maxLat - minLat;
      const step = density || 0.012;
      const cols = Math.ceil(dLng / step);
      const rows = Math.ceil(dLat / step);

      for (let ci = 0; ci < cols; ci++) {
        for (let ri = 0; ri < rows; ri++) {
          const lng = minLng + (ci + Math.random()) * step;
          const lat = minLat + (ri + Math.random()) * step;
          if (this._pointInPolygon(lng, lat, ring)) {
            const p = this._latLngToVec3(lat, lng, RADIUS);
            pts.push(p.x, p.y, p.z);
          }
        }
      }
    }
    return pts;
  }

  // ===== 添加地点（远看点，近看填充轮廓） =====
  addPlace(place, themeColor, rating) {
    const r = rating || 3;
    const dotPos = this._latLngToVec3(place.lat, place.lng, this.earthRadius * 1.015);

    // 小光点（始终可见）
    const dot = new THREE.Sprite(new THREE.SpriteMaterial({
      map: this._glowTex,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      color: 0xffffff,
      opacity: 0.6 + r / 5 * 0.4,
    }));
    dot.position.copy(dotPos);
    dot.scale.setScalar(0.07 + r * 0.01);
    dot.userData = { placeId: place.id };
    this.earthGroup.add(dot);
    if (!this._placeDots) this._placeDots = [];
    this._placeDots.push(dot);

    // 查找匹配的行政区特征，预生成填充粒子
    let fillMesh = null;
    let fillLevel = null;
    const name = place.name;
    let feature = null;

    if (this._districtsGeoJSON) {
      feature = this._districtsGeoJSON.features.find(f =>
        f.properties && f.properties.name === name
      );
      if (feature) fillLevel = 'district';
    }
    if (!feature && this._citiesGeoJSON) {
      feature = this._citiesGeoJSON.features.find(f =>
        f.properties && f.properties.name === name
      );
      if (feature) fillLevel = 'city';
    }

    if (feature) {
      const density = 0.008 + r * 0.001;
      const pts = this._fillFeature(feature, density);
      if (pts && pts.length > 0) {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
        const mat = new THREE.PointsMaterial({
          color: 0xffffff,
          size: 1.2,
          transparent: true,
          opacity: 0,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          sizeAttenuation: false,
        });
        fillMesh = new THREE.Points(geo, mat);
        fillMesh.userData = { placeId: place.id };
        this.earthGroup.add(fillMesh);
        this._sizedPoints.push({ mesh: fillMesh, baseSize: 1.2 });
      }
    }

    if (!this._placeFills) this._placeFills = [];
    this._placeFills.push({ mesh: fillMesh, level: fillLevel, opacity: 0 });

    // 存储以便清除
    if (!this.visitedClusters) this.visitedClusters = [];
    this.visitedClusters.push(dot);
    if (fillMesh) this.visitedClusters.push(fillMesh);

    // 点击检测用不可见小球
    const clickPos = this._latLngToVec3(place.lat, place.lng, this.earthRadius * 1.01);
    const clickMesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.08, 8, 8),
      new THREE.MeshBasicMaterial({ visible: false })
    );
    clickMesh.position.copy(clickPos);
    clickMesh.userData = { placeId: place.id };
    this.earthGroup.add(clickMesh);
    this.clickMeshes.push(clickMesh);

    return dot;
  }

  // ===== 弧线 =====
  addArc(homeLat, homeLng, destLat, destLng, themeColor, rating, placeId) {
    const home = this._latLngToVec3(homeLat, homeLng, this.earthRadius);
    const dest = this._latLngToVec3(destLat, destLng, this.earthRadius);
    const dist = home.distanceTo(dest);
    const height = 0.3 + dist * 0.2;
    const mid = home.clone().add(dest).multiplyScalar(0.5).normalize().multiplyScalar(this.earthRadius + height);

    const curve = new THREE.QuadraticBezierCurve3(home, mid, dest);
    const pts = curve.getPoints(40);

    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const color = new THREE.Color(themeColor);
    color.multiplyScalar(0.35 + rating / 5 * 0.65);

    const line = new THREE.Line(
      geo,
      new THREE.LineBasicMaterial({
        color: color,
        transparent: true,
        opacity: 0.4 + rating / 5 * 0.35,
      })
    );
    this.earthGroup.add(line);
    this.arcLines.push(line);

    // 弧线中点点击检测
    if (placeId) {
      const midClick = new THREE.Mesh(
        new THREE.SphereGeometry(0.08, 6, 6),
        new THREE.MeshBasicMaterial({ visible: false })
      );
      midClick.position.copy(curve.getPoint(0.5));
      midClick.userData = { placeId };
      this.earthGroup.add(midClick);
      this.clickMeshes.push(midClick);
    }

    return line;
  }

  // ===== 清除地点 =====
  clearPlaces() {
    for (const c of this.visitedClusters) this.earthGroup.remove(c);
    for (const l of this.arcLines) this.earthGroup.remove(l);
    for (const m of this.clickMeshes) this.earthGroup.remove(m);
    this.visitedClusters = [];
    this._placeDots = [];
    this._placeFills = [];
    this.arcLines = [];
    this.clickMeshes = [];
  }

  _makeGlowTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 32; canvas.height = 32;
    const ctx = canvas.getContext('2d');
    const grad = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.2, 'rgba(255,255,255,0.6)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 32, 32);
    return new THREE.CanvasTexture(canvas);
  }

  _triggerMeteor() {
    if (!this.coastlinePoints) return;
    const pos = this.coastlinePoints.geometry.attributes.position;
    const idx = Math.floor(Math.random() * (pos.count - 1)) * 3;
    const p = new THREE.Vector3(
      pos.array[idx], pos.array[idx + 1], pos.array[idx + 2]
    ).normalize().multiplyScalar(this.earthRadius * 1.01);

    const normal = p.clone().normalize();
    const tangent = new THREE.Vector3(
      Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5
    ).cross(normal).normalize();

    const segs = 6;
    const trail = [];
    for (let i = 0; i < segs; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({
        map: this._glowTex, transparent: true, depthWrite: false,
        blending: THREE.AdditiveBlending, opacity: 0,
      }));
      s.scale.setScalar(0);
      this.scene.add(s);
      trail.push(s);
    }

    this.meteors.push({
      pos: p.clone(),
      normal,
      tangent,
      speed: 0.0015,
      life: 0,
      maxLife: 100 + Math.floor(Math.random() * 50),
      trail,
      history: [],
    });
  }

  _startRotation() {
    this.rotateSpeed = 0.0004;
    this.rotating = true;
  }

  // 空格切换旋转
  _initKeyboard() {
    document.addEventListener('keydown', (e) => {
      if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault();
        this.rotating = !this.rotating;
      }
    });
  }

  // ===== 点击检测 =====
  _initClickHandler() {
    const el = this.renderer.domElement;
    el.addEventListener('click', (e) => {
      const rect = el.getBoundingClientRect();
      this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      this.raycaster.setFromCamera(this.mouse, this.camera);
      const hits = this.raycaster.intersectObjects(this.clickMeshes, false);
      if (hits.length > 0) {
        const id = hits[0].object.userData.placeId;
        if (id && this.onPlaceClick) this.onPlaceClick(id);
      }
    });
  }

  resetView() {
    this.camera.position.set(0, 1.5, 3.5);
    this.controls.target.set(0, 0, 0);
    this.controls.update();
  }

  // ===== 启动 =====
  start() {
    this._generateStars();
    this._animate();
  }

  _animate() {
    requestAnimationFrame(() => this._animate());

    // 旋转 + 拖拽灵敏度（放大越近越慢，缩小越远越快）
    const dist = this.camera.position.distanceTo(this.controls.target);
    const speedFactor = Math.min(1.0, Math.max(0.2, dist / 5.0));
    if (this.rotating) {
      this.earthGroup.rotation.y += this.rotateSpeed * speedFactor;
    }
    this.controls.rotateSpeed = 0.5 * speedFactor;

    // 淡入动画（慢速）
    for (let i = this.fadingItems.length - 1; i >= 0; i--) {
      const item = this.fadingItems[i];
      item.mesh.material.opacity += 0.006;
      if (item.mesh.material.opacity >= item.target) {
        item.mesh.material.opacity = item.target;
        this.fadingItems.splice(i, 1);
      }
    }

    // 海岸线持续呼吸（淡入淡出）
    if (this.coastlinePoints && this.fadingItems.length === 0) {
      const breathe = 0.50 + 0.30 * Math.sin(performance.now() * 0.0008);
      this.coastlinePoints.material.opacity = breathe;
    }

    // 常住地发光粒子脉冲
    if (this.homeMarker) {
      const pulse = 0.8 + 0.2 * Math.sin(performance.now() * 0.002);
      this.homeMarker.scale.setScalar(0.16 * pulse);
    }

    // zoom 级别控制边界显隐
    // 海岸线/国界/省界 —— 等海岸线淡入完再启用（共用 fadingItems 节奏）
    if (this.fadingItems.length === 0) {
      const dist = this.camera.position.distanceTo(this.controls.target);

      // 国界线淡入淡出
      if (this.borderPoints) {
        const target = dist < 5 ? 0.8 : 0;
        if (this._borderOpacity === undefined) this._borderOpacity = target;
        this._borderOpacity += (target - this._borderOpacity) * 0.08;
        if (Math.abs(this._borderOpacity - target) < 0.001) this._borderOpacity = target;
        this.borderPoints.material.opacity = this._borderOpacity;
      }

      // 省界线淡入淡出
      if (this.admin1Points) {
        const target = dist < 3.2 ? 0.4 : 0;
        if (this._adminOpacity === undefined) this._adminOpacity = target;
        this._adminOpacity += (target - this._adminOpacity) * 0.08;
        if (Math.abs(this._adminOpacity - target) < 0.001) this._adminOpacity = target;
        this.admin1Points.material.opacity = this._adminOpacity;
      }
    }

    // 市级边界
    if (this.cityPoints) {
      this._applyZoomLayer(this.cityPoints, dist, 2.1, 0.5, '_cityOpacity');
    }

    // 县级边界懒加载 + 显隐
    if (dist < 2.4 && !this.districtPoints && !this._districtsLoading) {
      this.loadDistricts();
    }
    if (this.districtPoints) {
      this._applyZoomLayer(this.districtPoints, dist, 1.85, 0.4, '_distOpacity');
    }

    // 地点填充粒子 —— 放大到对应行政级别才点亮
    for (const pf of this._placeFills) {
      if (!pf.mesh) continue;
      let threshold;
      if (pf.level === 'district') threshold = 1.85;
      else if (pf.level === 'city') threshold = 2.1;
      else { pf.mesh.material.opacity = 0; continue; }
      const target = dist < threshold ? 0.55 : 0;
      pf.opacity += (target - pf.opacity) * 0.06;
      pf.mesh.material.opacity = pf.opacity;
    }

    // 流星触发（间隔拉长，约 10~16 秒一次）
    this.meteorTimer++;
    if (this.meteorTimer > 600 + Math.random() * 400 && this.coastlinePoints) {
      this.meteorTimer = 0;
      this._triggerMeteor();
    }
    for (let i = this.meteors.length - 1; i >= 0; i--) {
      const m = this.meteors[i];
      m.life++;
      const progress = m.life / m.maxLife;

      // 慢慢加速
      m.speed += 0.00035;

      m.history.push(m.pos.clone());
      if (m.history.length > 6) m.history.shift();

      // 前期贴地表切向滑行，后期加速径向离开
      const radialFrac = Math.pow(progress, 3);
      const moveDir = m.tangent.clone().multiplyScalar(1 - radialFrac)
        .add(m.normal.clone().multiplyScalar(radialFrac * 2.5))
        .normalize();

      m.pos.add(moveDir.clone().multiplyScalar(m.speed));
      const dist = this.earthRadius * (1.01 + radialFrac * 2.0);
      m.pos.normalize().multiplyScalar(dist);

      // 更新尾巴（细尾）
      for (let j = 0; j < m.trail.length; j++) {
        const hi = m.history.length - 1 - j;
        if (hi >= 0) {
          m.trail[j].position.copy(m.history[hi]);
          const t = j / m.trail.length;
          const fade = (1 - progress) * (1 - t * 0.4);
          m.trail[j].material.opacity = fade * 0.7;
          m.trail[j].scale.setScalar(0.025 * (1 - t * 0.5) * (1 - progress * 0.2));
        } else {
          m.trail[j].material.opacity = 0;
        }
      }

      if (m.life >= m.maxLife) {
        for (const s of m.trail) {
          this.scene.remove(s);
          s.material.dispose();
        }
        this.meteors.splice(i, 1);
      }
    }

    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}
