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
    this._placeSprites = [];
    this._backMeshes = [];
    this._frameCallbacks = [];
    this._focusedPlaceId = null;

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
    this.renderer.domElement.style.touchAction = 'none';

    // 地球组（所有地球相关对象放一起，统一旋转）
    this.earthGroup = new THREE.Group();
    this.scene.add(this.earthGroup);

    // 深度遮挡球：放大到县界级别时撑开，挡住地球背面粒子
    this._occluder = new THREE.Mesh(
      new THREE.SphereGeometry(this.earthRadius, 64, 32),
      new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: true, transparent: false })
    );
    this._occluder.renderOrder = -1;
    this.earthGroup.add(this._occluder);

    window.addEventListener('resize', () => this._onResize());
  }

  _initControls() {
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.rotateSpeed = 0.5;
    this.controls.minDistance = 1.55;
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
      }

    } catch (err) {
        console.warn('Map data load failed, retrying:', err);
    }

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
    mesh.renderOrder = 1;
    this[propName] = mesh;
    this.earthGroup.add(mesh);
    this._sizedPoints.push({ mesh, baseSize: style.size });

    // 背面副本：同一几何体，depthFunc 反转，仅遮挡球后面的粒子可见
    const backMat = mat.clone();
    backMat.depthFunc = THREE.GreaterDepth;
    const backMesh = new THREE.Points(geo, backMat);
    backMesh.renderOrder = 0;
    backMesh.visible = true;
    this.earthGroup.add(backMesh);
    this._backMeshes.push({ front: mesh, back: backMesh, factor: 0.35 });
    this._sizedPoints.push({ mesh: backMesh, baseSize: style.size });

    if (!skipFade) {
      mesh.material.opacity = 0;
      this.fadingItems.push({ mesh, target: style.opacity });
    }
  }

  clearCoastlines() {
    this._breathStartTime = null;
    for (const key of ['coastlinePoints', 'borderPoints', 'admin1ChinaPoints', 'admin1ForeignPoints', 'cityPoints', 'districtPoints']) {
      if (this[key]) {
        this.earthGroup.remove(this[key]);
        this[key] = null;
      }
    }
    // 清理背面副本
    for (const bm of this._backMeshes) {
      this.earthGroup.remove(bm.back);
      bm.back.material.dispose();
    }
    this._backMeshes = [];
  }

  // 缩放图层辅助：平滑淡入淡出，不跳变
  _applyZoomLayer(mesh, dist, threshold, opacity, stateKey) {
    const target = dist < threshold ? opacity : 0;
    if (this[stateKey] === undefined) this[stateKey] = 0;
    // 淡入用较慢速率，淡出稍快
    const speed = target > this[stateKey] ? 0.025 : 0.06;
    this[stateKey] += (target - this[stateKey]) * speed;
    if (Math.abs(this[stateKey] - target) < 0.001) this[stateKey] = target;
    mesh.material.opacity = this[stateKey];
  }

  // ===== 赤道粒子光环 =====
  _drawEquatorRing() {
    const R = 2.4;
    const count = 600;
    const pts = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const lng = (i / count) * 360;
      const lat = (Math.random() - 0.5) * 5; // ±2.5° 随机飘散
      const p = this._latLngToVec3(lat, lng, R * (1 + (Math.random() - 0.5) * 0.02));
      pts[i*3] = p.x;
      pts[i*3+1] = p.y;
      pts[i*3+2] = p.z;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const mat = new THREE.PointsMaterial({
      color: 0xffffff, size: 1.6, transparent: true, opacity: 0.35,
      blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: false,
    });
    this._ringPoints = new THREE.Points(geo, mat);
    this.scene.add(this._ringPoints);
    this._sizedPoints.push({ mesh: this._ringPoints, baseSize: 1.0 });
  }

  // ===== 加载全球一级行政区边界（省/州/都道府县） =====
  async loadAdminBoundaries() {
    try {
      const resp = await fetch('data/map/world_admin1.geojson');
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();

      // 拆成中国和国外两套 mesh，独立控制缩放阈值
      const chinaF = [], foreignF = [];
      for (const f of data.features) {
        const p = f.properties || {};
        if (p.iso_a2 === 'CN' || p.admin === 'China') chinaF.push(f);
        else foreignF.push(f);
      }

      if (chinaF.length > 0) {
        this._provinceFeatures = chinaF;
        this._geoJSONToParticles({ type: 'FeatureCollection', features: chinaF }, {
          color: 0xffffff, size: 1.5, opacity: 0.4,
        }, 'admin1ChinaPoints', true);
      }
      if (foreignF.length > 0) {
        this._geoJSONToParticles({ type: 'FeatureCollection', features: foreignF }, {
          color: 0xffffff, size: 0.85, opacity: 0.28,
        }, 'admin1ForeignPoints', true);
      }

      this._createHomeFill();
      if (this._onDataReady) this._onDataReady();
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
      this._createHomeFill();
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
      this._createHomeFill();
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

  // ===== 3D 到屏幕投影 =====
  _worldPos(lat, lng, radius) {
    const local = this._latLngToVec3(lat, lng, radius || this.earthRadius);
    return local.applyMatrix4(this.earthGroup.matrixWorld);
  }

  isFrontFacing(lat, lng) {
    const pos = this._worldPos(lat, lng, 1.0);
    const normal = pos.clone().normalize();
    const viewDir = this.camera.position.clone().normalize();
    return normal.dot(viewDir) > 0;
  }

  getFacing(lat, lng) {
    const pos = this._worldPos(lat, lng, 1.0);
    const normal = pos.clone().normalize();
    const viewDir = this.camera.position.clone().normalize();
    return normal.dot(viewDir);
  }

  projectToScreen(lat, lng, radius) {
    const world = this._worldPos(lat, lng, radius || this.earthRadius * 1.02);
    const screen = world.clone().project(this.camera);
    return {
      x: (screen.x * 0.5 + 0.5) * window.innerWidth,
      y: (-screen.y * 0.5 + 0.5) * window.innerHeight,
      z: screen.z,
      visible: screen.z < 1,
    };
  }

  getEarthCenterScreen() {
    const center = new THREE.Vector3(0, 0, 0).project(this.camera);
    return {
      x: (center.x * 0.5 + 0.5) * window.innerWidth,
      y: (-center.y * 0.5 + 0.5) * window.innerHeight,
      visible: center.z < 1,
    };
  }

  onFrame(cb) {
    this._frameCallbacks.push(cb);
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
  setHome(lat, lng, name, province) {
    if (this.homeMarker) this.earthGroup.remove(this.homeMarker);

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
    sprite.scale.setScalar(0.04);
    this.earthGroup.add(sprite);
    this.homeMarker = sprite;

    // 存储信息供延迟创建填区（GeoJSON 可能尚未加载完）
    this._homeName = name || null;
    this._homeProvince = province || null;
    this._homeLat = lat;
    this._homeLng = lng;
    this._createHomeFill();
  }

  _createHomeFill() {
    if (!this._homeName) return;
    if (this._homeFill) { this.earthGroup.remove(this._homeFill); this._homeFill = null; }
    let feature = null;
    if (this._districtsGeoJSON) {
      feature = this._districtsGeoJSON.features.find(f => f.properties && f.properties.name === this._homeName)
        || this._districtsGeoJSON.features.find(f => f.properties && (f.properties.name.includes(this._homeName) || this._homeName.includes(f.properties.name)));
    }
    if (!feature && this._citiesGeoJSON) {
      feature = this._citiesGeoJSON.features.find(f => f.properties && f.properties.name === this._homeName)
        || this._citiesGeoJSON.features.find(f => f.properties && (f.properties.name.includes(this._homeName) || this._homeName.includes(f.properties.name)));
    }
    if (!feature && this._provinceFeatures && this._homeProvince) {
      feature = this._provinceFeatures.find(f => f.properties && f.properties.name === this._homeProvince)
        || this._provinceFeatures.find(f => f.properties && (f.properties.name.includes(this._homeProvince) || this._homeProvince.includes(f.properties.name)));
    }
    if (!feature) return;
    const pts = this._fillFeature(feature, 0.01);
    if (!pts || pts.length === 0) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const mat = new THREE.PointsMaterial({
      color: 0xffffff, size: 0.012, transparent: true, opacity: 0.75,
      blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
    });
    this._homeFill = new THREE.Points(geo, mat);
    this.earthGroup.add(this._homeFill);
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
    const baseScale = 0.07 + r * 0.01;
    dot.scale.setScalar(baseScale);
    dot.userData = { placeId: place.id };
    this.earthGroup.add(dot);
    this._placeDots.push(dot);
    this._placeSprites.push({ sprite: dot, base: baseScale });

    // 查找匹配的行政区特征，预生成填充粒子
    let fillMesh = null;
    let fillLevel = null;
    const name = place.name;
    let feature = null;

    if (this._districtsGeoJSON) {
      feature = this._districtsGeoJSON.features.find(f =>
        f.properties && f.properties.name === name
      ) || this._districtsGeoJSON.features.find(f =>
        f.properties && (f.properties.name.includes(name) || name.includes(f.properties.name))
      );
      if (feature) fillLevel = 'district';
    }
    if (!feature && this._citiesGeoJSON) {
      feature = this._citiesGeoJSON.features.find(f =>
        f.properties && f.properties.name === name
      ) || this._citiesGeoJSON.features.find(f =>
        f.properties && (f.properties.name.includes(name) || name.includes(f.properties.name))
      );
      if (feature) fillLevel = 'city';
    }
    if (!feature && this._provinceFeatures) {
      const provName = (place.fullName || '').split('·')[0];
      if (provName) {
        feature = this._provinceFeatures.find(f =>
          f.properties && f.properties.name === provName
        ) || this._provinceFeatures.find(f =>
          f.properties && (f.properties.name.includes(provName) || provName.includes(f.properties.name))
        );
        if (feature) fillLevel = 'province';
      }
    }

    if (feature) {
      const density = fillLevel === 'province' ? 0.006 : 0.008;
      const pts = this._fillFeature(feature, density);
      if (pts && pts.length > 0) {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
        const warmth = 0.65 + r / 5 * 0.35;
        const fillColor = new THREE.Color(1.0, 0.95 * warmth, 0.85 * warmth);
        const mat = new THREE.PointsMaterial({
          color: fillColor,
          size: 0.018,
          transparent: true,
          opacity: 0,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          sizeAttenuation: true,
        });
        fillMesh = new THREE.Points(geo, mat);
        fillMesh.userData = { placeId: place.id };
        this.earthGroup.add(fillMesh);
      }
    }

    this._placeFills.push({ mesh: fillMesh, level: fillLevel, opacity: 0 });
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
    this._placeSprites = [];
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
    const tangent = new THREE.Vector3(0, 1, 0).cross(normal).normalize();

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

  toggleRotation() {
    this.rotating = !this.rotating;
    return this.rotating;
  }

  // 空格切换旋转
  _initKeyboard() {
    document.addEventListener('keydown', (e) => {
      if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault();
        this.toggleRotation();
      }
    });
  }

  // ===== 点击检测（区分点击与拖动） =====
  _initClickHandler() {
    const el = this.renderer.domElement;
    let pointerDown = null;

    el.addEventListener('pointerdown', (e) => {
      pointerDown = { x: e.clientX, y: e.clientY };
    });

    el.addEventListener('pointermove', (e) => {
      if (!pointerDown) return;
      const dx = e.clientX - pointerDown.x;
      const dy = e.clientY - pointerDown.y;
      // 拖动超过 4px 视为拖拽，解锁聚焦让 OrbitControls 自由操控
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
        if (this._focusedPlaceId) {
          this._focusedPlaceId = null;
          this.clearHighlight();
          // 取消飞行动画
          this._flyStart = null;
          this._flyOnArrive = null;
          // target 切回地心，摄像机保持当前高度绕地心旋转
          this.controls.target.set(0, 0, 0);
          if (this._flySavedRotating !== undefined) {
            this.rotating = this._flySavedRotating;
            this._flySavedRotating = undefined;
          }
          if (this._savedMinDist) {
            this.controls.minDistance = this._savedMinDist;
            this._savedMinDist = null;
          }
        }
        pointerDown = null;
      }
    });

    el.addEventListener('click', (e) => {
      // 是拖拽不是点击，跳过
      if (!pointerDown) return;
      pointerDown = null;

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

    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  // ===== 飞行聚焦到地点 =====
  focusOnPlace(lat, lng, onArrive) {
    const local = this._latLngToVec3(lat, lng, this.earthRadius * 1.01);
    const world = local.clone().applyMatrix4(this.earthGroup.matrixWorld);
    const radial = world.clone().normalize();
    const camTarget = world;
    const camPos = world.clone().add(radial.clone().multiplyScalar(0.55));

    if (!this._savedMinDist) {
      this._savedMinDist = this.controls.minDistance;
    }
    this.controls.minDistance = 0.15;

    this._flyFromTarget = this.controls.target.clone();
    this._flyToTarget = camTarget;
    this._flyFromCam = this.camera.position.clone();
    this._flyToCam = camPos;
    this._flyStart = performance.now();
    this._flyDuration = 1000;
    this._flyOnArrive = onArrive || null;

    // 暂停自转，聚焦期间地点不能转走
    if (!this._flySavedRotating) {
      this._flySavedRotating = this.rotating;
      this.rotating = false;
    }
  }

  zoomOutFromPlace(lat, lng) {
    this._focusedPlaceId = null;
    const local = this._latLngToVec3(lat, lng, this.earthRadius * 1.01);
    const world = local.clone().applyMatrix4(this.earthGroup.matrixWorld);
    const radial = world.clone().normalize();
    // 镜头从地点沿径向往后拉远，地点保持画面正中
    this._flyFromTarget = this.controls.target.clone();
    this._flyToTarget = world;
    this._flyFromCam = this.camera.position.clone();
    this._flyToCam = world.clone().add(radial.clone().multiplyScalar(2.5));
    this._flyStart = performance.now();
    this._flyDuration = 1600;
    this._flyOnArrive = () => {
      if (this._flySavedRotating !== undefined) {
        this.rotating = this._flySavedRotating;
        this._flySavedRotating = undefined;
      }
    };
    this.clearHighlight();
    if (this._savedMinDist) {
      this.controls.minDistance = this._savedMinDist;
      this._savedMinDist = null;
    }
  }

  flyToOverview() {
    this._focusedPlaceId = null;
    this.clearHighlight();
    if (this._flySavedRotating !== undefined) {
      this.rotating = this._flySavedRotating;
      this._flySavedRotating = undefined;
    }
    if (this._savedMinDist) {
      this.controls.minDistance = this._savedMinDist;
      this._savedMinDist = null;
    }
    const currentDist = this.camera.position.length();
    // 相机已够远且 target 在地心，不用飞
    if (currentDist >= 3.0 && this.controls.target.length() < 0.01) {
      return;
    }
    this._flyFromTarget = this.controls.target.clone();
    this._flyToTarget = new THREE.Vector3(0, 0, 0);
    this._flyFromCam = this.camera.position.clone();
    const viewDir = this.camera.position.clone().sub(this.controls.target).normalize();
    this._flyToCam = this.camera.position.clone().add(viewDir.clone().multiplyScalar(2.5));
    this._flyStart = performance.now();
    this._flyDuration = 900;
    this._flyOnArrive = () => {
      if (this._flySavedRotating !== undefined) {
        this.rotating = this._flySavedRotating;
        this._flySavedRotating = undefined;
      }
    };
  }

  highlightFill(placeId) {
    this._highlightedId = placeId;
  }

  clearHighlight() {
    this._highlightedId = null;
  }

  resetView() {
    this.flyToOverview();
  }

  // ===== 启动 =====
  start() {
    this._generateStars();
    this._drawEquatorRing();
    this._animate();
  }

  _animate() {
    requestAnimationFrame(() => this._animate());

    // 旋转 + 拖拽灵敏度（放大越近越慢，缩小越远越快）
    const dist = this.camera.position.distanceTo(this.controls.target);
    // 边界显隐用距地心距离，不受 target 漂移影响
    const distFromCenter = this.camera.position.length();
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

    // 海岸线常亮 —— 淡入完成后开始，或 8 秒后强制开始
    if (this.coastlinePoints) {
      if (!this._breathStartTime && (this.fadingItems.length === 0 || performance.now() > 8000)) {
        this._breathStartTime = performance.now();
      }
      if (this._breathStartTime) {
        this.coastlinePoints.material.opacity = 0.8;
      }
    }

    // 赤道光环自转 + 呼吸
    if (this._ringPoints) {
      this._ringPoints.rotation.y += 0.0001;
      const ringBreath = 0.25 + 0.15 * Math.sin(performance.now() * 0.0012);
      this._ringPoints.material.opacity = ringBreath;
    }

    // 常住地发光粒子脉冲（大小锁定，不受缩放影响）
    if (this.homeMarker) {
      const worldPos = this.homeMarker.position.clone().applyMatrix4(this.earthGroup.matrixWorld);
      const dist = this.camera.position.distanceTo(worldPos);
      const base = 0.06 * dist / 3.5;
      const pulse = 0.8 + 0.2 * Math.sin(performance.now() * 0.002);
      this.homeMarker.scale.setScalar(base * pulse);
    }

    // 地点光点大小锁定，不受缩放影响
    for (const ps of this._placeSprites) {
      const worldPos = ps.sprite.position.clone().applyMatrix4(this.earthGroup.matrixWorld);
      const dist = this.camera.position.distanceTo(worldPos);
      ps.sprite.scale.setScalar(ps.base * dist / 3.5);
    }

    // zoom 级别控制边界显隐（distFromCenter = 距地心，不受 target 位置影响）
    // 国界线 —— 等海岸线淡入完再启用
    if (this.fadingItems.length === 0) {
      if (this.borderPoints) {
        const target = distFromCenter < 5 ? 0.8 : 0;
        if (this._borderOpacity === undefined) this._borderOpacity = target;
        this._borderOpacity += (target - this._borderOpacity) * 0.08;
        if (Math.abs(this._borderOpacity - target) < 0.001) this._borderOpacity = target;
      }
    }

    // 省界 — 地心距 < 2.8
    if (this.admin1ChinaPoints) {
      this._applyZoomLayer(this.admin1ChinaPoints, distFromCenter, 2.8, 0.4, '_chinaAdminOpacity');
    }
    // 外国州界
    if (this.admin1ForeignPoints) {
      this._applyZoomLayer(this.admin1ForeignPoints, distFromCenter, 2.2, 0.28, '_foreignAdminOpacity');
    }

    // 市界 — 地心距 < 2.2
    if (this.cityPoints) {
      this._applyZoomLayer(this.cityPoints, distFromCenter, 2.2, 0.5, '_cityOpacity');
    }

    // 县界懒加载 + 显隐 — 地心距 < 2.0
    if (distFromCenter < 2.5 && !this.districtPoints && !this._districtsLoading) {
      this.loadDistricts();
    }
    if (this.districtPoints) {
      this._applyZoomLayer(this.districtPoints, distFromCenter, 2.0, 0.4, '_distOpacity');
    }

    // 边界粒子呼吸（只在阈值内生效，衰减中的不呼吸）
    if (this._breathStartTime) {
      const t = performance.now() * 0.001;
      const breathe = (base, freq) => base > 0.01 ? base * (0.65 + 0.35 * Math.sin(t * freq)) : 0;
      if (this.borderPoints)
        this.borderPoints.material.opacity = breathe(this._borderOpacity || 0, 1.3);
      if (this.admin1ChinaPoints)
        this.admin1ChinaPoints.material.opacity = breathe(this._chinaAdminOpacity || 0, 1.1);
      if (this.admin1ForeignPoints)
        this.admin1ForeignPoints.material.opacity = breathe(this._foreignAdminOpacity || 0, 0.9);
      if (this.cityPoints)
        this.cityPoints.material.opacity = breathe(this._cityOpacity || 0, 1.0);
      if (this.districtPoints)
        this.districtPoints.material.opacity = breathe(this._distOpacity || 0, 1.2);
    }

    // 地点填充粒子 —— 透明度绑定同级轮廓线，高亮时叠加呼吸
    for (const pf of this._placeFills) {
      if (!pf.mesh) continue;
      let base;
      if (pf.level === 'district') base = this._distOpacity || 0;
      else if (pf.level === 'city') base = this._cityOpacity || 0;
      else if (pf.level === 'province') base = this._chinaAdminOpacity || 0;
      else { pf.mesh.material.opacity = 0; continue; }
      let opacity = base * 0.55;
      if (pf.mesh.userData.placeId === this._highlightedId) {
        const breathe = 0.3 + 0.45 * Math.sin(performance.now() * 0.003);
        opacity = Math.max(opacity, breathe);
      }
      pf.mesh.material.opacity = opacity;
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

    // 飞行聚焦动画（ease-out）
    if (this._flyStart) {
      const elapsed = performance.now() - this._flyStart;
      const t = Math.min(1, elapsed / this._flyDuration);
      const ease = 1 - Math.pow(1 - t, 3); // ease-out cubic
      this.controls.target.lerpVectors(this._flyFromTarget, this._flyToTarget, ease);
      this.camera.position.lerpVectors(this._flyFromCam, this._flyToCam, ease);
      if (t >= 1) {
        this._flyStart = null;
        if (this._flyOnArrive) {
          const cb = this._flyOnArrive;
          this._flyOnArrive = null;
          cb();
        }
      }
    }

    // 常住地填区呼吸（始终可见，缓慢呼吸）
    if (this._homeFill) {
      const hb = 0.25 + 0.2 * Math.sin(performance.now() * 0.0015);
      this._homeFill.material.opacity = hb;
    }

    // 同步背面副本：始终可见，opacity 跟随正面
    if (this._backMeshes.length > 0) {
      for (const bm of this._backMeshes) {
        bm.back.visible = true;
        bm.back.material.opacity = bm.front.material.opacity * (bm.factor || 0.35);
      }
    }

    // 更新矩阵，确保帧回调拿到当前帧的地球旋转
    this.earthGroup.updateMatrixWorld();

    // 帧回调（供外部同步 UI 覆盖层）
    for (const cb of this._frameCallbacks) {
      cb();
    }

    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}
