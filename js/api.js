// ===== API 数据层（替代 data.js） =====

const API_BASE = window.API_BASE || 'http://localhost:8000';

let _token = localStorage.getItem('auth_token');
let _user = null;

function authHeaders() {
  return _token ? { Authorization: `Bearer ${_token}`, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' };
}

async function request(method, path, body) {
  const opts = { method, headers: authHeaders() };
  if (body !== undefined) {
    // FormData 不用设 Content-Type（让浏览器自动加 boundary）
    if (body instanceof FormData) {
      delete opts.headers['Content-Type'];
      opts.headers['Authorization'] = `Bearer ${_token}`;
    }
    opts.body = body instanceof FormData ? body : JSON.stringify(body);
  }
  const resp = await fetch(`${API_BASE}${path}`, opts);
  if (resp.status === 401) {
    logout();
    throw new Error('登录已过期，请重新登录');
  }
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ detail: resp.statusText }));
    throw new Error(err.detail || '请求失败');
  }
  const text = await resp.text();
  return text ? JSON.parse(text) : null;
}

// ===== 认证 =====
export async function login(email, password) {
  const data = await request('POST', '/api/auth/login', { email, password });
  _token = data.access_token;
  _user = data.user;
  localStorage.setItem('auth_token', _token);
  return _user;
}

export async function register(email, password) {
  const data = await request('POST', '/api/auth/register', { email, password });
  _token = data.access_token;
  _user = data.user;
  localStorage.setItem('auth_token', _token);
  return _user;
}

export function logout() {
  _token = null;
  _user = null;
  localStorage.removeItem('auth_token');
}

export function isLoggedIn() {
  return !!_token;
}

export function getCurrentUser() {
  return _user;
}

// ===== 初始化 =====
export async function initDB() {
  if (!_token) return { theme: '#ff6b6b', home: null };
  try {
    const meta = await request('GET', '/api/meta');
    return { theme: meta.theme || '#ff6b6b', home: meta.home || null };
  } catch {
    logout();
    return { theme: '#ff6b6b', home: null };
  }
}

// ===== Meta =====
export async function setMeta(key, value) {
  if (!_token) return;
  if (key === 'home') {
    await request('PUT', '/api/meta', { home: value });
  } else if (key === 'theme') {
    await request('PUT', '/api/meta', { theme: value });
  }
}

export async function getMeta(key, def = null) {
  if (!_token) return def;
  try {
    const meta = await request('GET', '/api/meta');
    return meta[key] !== undefined ? meta[key] : def;
  } catch { return def; }
}

// ===== 格式转换 =====
function _placeToFront(backend) {
  return {
    id: backend.id,
    name: backend.name,
    fullName: backend.full_name || backend.name,
    lat: backend.lat,
    lng: backend.lng,
    rating: backend.rating || 3,
    notes: backend.notes || '',
    visitDate: backend.visit_date || '',
    photos: (backend.photos || []).map(p => ({
      id: p.id,
      dataUrl: API_BASE + p.url,   // 保持字段名兼容，但值是完整 URL 而非 base64
      caption: p.caption || '',
    })),
    _exists: true,  // 标记为服务端已有记录，savePlace 时走 PUT
  };
}

function _placeToBack(frontend) {
  return {
    name: frontend.name,
    full_name: frontend.fullName || frontend.name,
    lat: frontend.lat,
    lng: frontend.lng,
    rating: frontend.rating || 3,
    notes: frontend.notes || '',
    visit_date: frontend.visitDate || '',
  };
}

// ===== 地点 CRUD =====
export async function getAllPlaces() {
  if (!_token) return [];
  try {
    const data = await request('GET', '/api/places');
    return data.map(_placeToFront);
  } catch { return []; }
}

export async function savePlace(place) {
  if (!_token) throw new Error('未登录');
  const body = _placeToBack(place);
  if (place._exists) {
    await request('PUT', `/api/places/${place.id}`, body);
  } else {
    const data = await request('POST', '/api/places', body);
    place.id = data.id; // 回填服务端生成的 ID
  }
}

export async function deletePlace(id) {
  if (!_token) throw new Error('未登录');
  await request('DELETE', `/api/places/${id}`);
}

// ===== 照片 =====
export async function uploadPhoto(placeId, file) {
  if (!_token) throw new Error('未登录');
  const form = new FormData();
  form.append('file', file);
  form.append('caption', '');
  const data = await request('POST', `/api/photos/places/${placeId}`, form);
  return {
    id: data.id,
    dataUrl: API_BASE + data.url,   // 完整 URL
    caption: data.caption || '',
  };
}

export async function deletePhoto(photoId) {
  if (!_token) throw new Error('未登录');
  await request('DELETE', `/api/photos/${photoId}`);
}

// ===== 导出导入 =====
export async function exportAllData() {
  if (!_token) throw new Error('未登录');
  const [places, meta] = await Promise.all([
    request('GET', '/api/places'),
    request('GET', '/api/meta'),
  ]);
  return {
    exportTime: new Date().toISOString(),
    theme: meta.theme || '#ff6b6b',
    home: meta.home || null,
    places: places.map(_placeToFront),
  };
}

export async function importAllData(data) {
  if (!_token) throw new Error('未登录');
  if (data.theme) await setMeta('theme', data.theme);
  if (data.home) await setMeta('home', data.home);
  if (data.places) {
    for (const p of data.places) {
      const body = _placeToBack(p);
      await request('POST', '/api/places', body);
    }
  }
}
