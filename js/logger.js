// ===== 点击日志工具 =====
// 在 document 捕获阶段拦截所有 click / dblclick / touchend / keydown 事件

const LOG_LIMIT = 500;

class ClickLogger {
  constructor() {
    this.entries = [];
    this._enabled = true;
    this._listeners = [];
  }

  // ===== 启动捕获 =====
  start() {
    // 捕获阶段（capture: true），比任何目标处理都早
    document.addEventListener('click', this._handleClick, true);
    document.addEventListener('dblclick', this._handleDblClick, true);
    document.addEventListener('touchend', this._handleTouch, true);
    document.addEventListener('keydown', this._handleKey, true);
  }

  stop() {
    document.removeEventListener('click', this._handleClick, true);
    document.removeEventListener('dblclick', this._handleDblClick, true);
    document.removeEventListener('touchend', this._handleTouch, true);
    document.removeEventListener('keydown', this._handleKey, true);
  }

  // ===== 公开 API =====
  get entries() { return this._entries; }
  set entries(v) { this._entries = v; }

  getAll() { return [...this._entries]; }

  last(n = 20) { return this._entries.slice(-n); }

  clear() { this._entries = []; this._notify(); }

  toggle() { this._enabled = !this._enabled; return this._enabled; }

  exportJSON() {
    return JSON.stringify(this._entries, null, 2);
  }

  download() {
    const blob = new Blob([this.exportJSON()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `click_log_${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  onUpdate(fn) {
    this._listeners.push(fn);
    return () => {
      this._listeners = this._listeners.filter(f => f !== fn);
    };
  }

  _notify() {
    for (const fn of this._listeners) fn(this._entries);
  }

  // ===== 核心记录方法 =====
  _record(type, detail) {
    if (!this._enabled) return;
    const entry = {
      seq: this._entries.length + 1,
      time: new Date().toISOString(),
      type,
      ...detail,
    };
    this._entries.push(entry);
    if (this._entries.length > LOG_LIMIT) {
      this._entries.splice(0, this._entries.length - LOG_LIMIT);
    }
    // 同时输出到 dev console
    console.debug(
      `[ClickLog #${entry.seq}] ${entry.type}`,
      entry
    );
    this._notify();
  }

  _describe(el) {
    if (!el || !el.tagName) return { tag: '(unknown)', id: '', classList: '', text: '' };
    const text = (el.textContent || '').trim().slice(0, 60);
    return {
      tag: el.tagName.toLowerCase(),
      id: el.id || '',
      classList: (typeof el.classList?.join === 'function'
        ? Array.from(el.classList).filter(c => c && c.length < 40).slice(0, 8).join(' ')
        : ''),
      text: text || (el.getAttribute?.('aria-label') || el.getAttribute?.('title') || ''),
    };
  }

  _resolvePayload(el) {
    // 尝试提取有意义的数据
    const dataset = { ...(el?.dataset || {}) };
    // 从 dataset 中挑有用字段
    const payload = {};
    for (const [k, v] of Object.entries(dataset)) {
      if (v !== undefined && v !== '' && k.length < 30) payload[k] = String(v).slice(0, 100);
    }
    return Object.keys(payload).length > 0 ? payload : undefined;
  }

  _getPos(e) {
    if (e.touches && e.touches[0]) {
      return { x: Math.round(e.touches[0].clientX), y: Math.round(e.touches[0].clientY) };
    }
    return { x: Math.round(e.clientX), y: Math.round(e.clientY) };
  }

  _walkPath(e) {
    // 记录从 target 到 body 的冒泡路径（只取有 id/class 的）
    const path = [];
    let el = e.target;
    while (el && el !== document.body && el !== document.documentElement) {
      if (!el.tagName) break;
      const tag = el.tagName.toLowerCase();
      const id = el.id || '';
      const cls = Array.from(el.classList || []).filter(c => c && c.length < 30).join(' ');
      const label = tag + (id ? `#${id}` : '') + (cls ? `.${cls}` : '');
      path.push(label);
      if (path.length > 10) break;
      el = el.parentElement;
    }
    return path;
  }

  // ===== 事件处理器 =====
  _handleClick = (e) => {
    const target = this._describe(e.target);
    const pos = this._getPos(e);
    const payload = this._resolvePayload(e.target);
    const path = this._walkPath(e);
    this._record('click', {
      target: `${target.tag}${target.id ? '#' + target.id : ''}`,
      targetDetail: target,
      pos,
      path,
      payload,
      ctrlKey: e.ctrlKey || false,
      shiftKey: e.shiftKey || false,
      button: e.button,
    });
  };

  _handleDblClick = (e) => {
    const target = this._describe(e.target);
    const pos = this._getPos(e);
    this._record('dblclick', {
      target: `${target.tag}${target.id ? '#' + target.id : ''}`,
      targetDetail: target,
      pos,
      payload: this._resolvePayload(e.target),
    });
  };

  _handleTouch = (e) => {
    if (e.changedTouches.length === 0) return;
    const t = e.changedTouches[0];
    const el = document.elementFromPoint(t.clientX, t.clientY);
    const target = this._describe(el);
    const pos = { x: Math.round(t.clientX), y: Math.round(t.clientY) };
    this._record('touchend', {
      target: `${target.tag}${target.id ? '#' + target.id : ''}`,
      targetDetail: target,
      pos,
      payload: this._resolvePayload(el),
    });
  };

  _handleKey = (e) => {
    // 只记录有意义的按键
    const meaningfulKeys = ['Enter', 'Escape', 'Space', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Delete', 'Backspace'];
    if (!meaningfulKeys.includes(e.key) && !meaningfulKeys.includes(e.code)) return;
    const active = this._describe(document.activeElement);
    this._record('keydown', {
      key: e.key,
      code: e.code,
      ctrlKey: e.ctrlKey || false,
      shiftKey: e.shiftKey || false,
      activeEl: active.tag + (active.id ? '#' + active.id : ''),
      activeElDetail: active,
    });
  };
}

// 全局单例
const clickLogger = new ClickLogger();
clickLogger._entries = [];

// 自动启动
clickLogger.start();

// 挂到 window 方便控制台调试
window.clickLogger = clickLogger;
window.logEvents = () => clickLogger.last(50);
window.logClear = () => clickLogger.clear();
window.logExport = () => clickLogger.download();
window.logToggle = () => clickLogger.toggle();

console.log(
  '%c[ClickLogger] 已启动 %c| 控制台可用命令:',
  'color:#0f0', 'color:#aaa'
);
console.log('  logEvents()   — 查看最近 50 条');
console.log('  logClear()    — 清空日志');
console.log('  logExport()   — 下载 JSON');
console.log('  logToggle()   — 暂停/恢复');
console.log('  clickLogger.getAll()  — 获取全部');
console.log('  clickLogger.last(n)   — 获取最近 n 条');

export default clickLogger;
