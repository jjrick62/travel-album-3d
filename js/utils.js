// ===== 公共工具函数 =====

/** 安全获取 DOM 元素，缺失时抛出明确错误而非静默炸 */
export function safeGet(id) {
  const el = document.getElementById(id);
  if (!el) throw new Error(`[DOM Error] element "${id}" not found`);
  return el;
}

/** 生成星星 HTML 字符串：★ 实心 + ☆ 空心 */
export function renderStars(rating, maxStars = 5) {
  const r = Math.max(0, Math.min(maxStars, rating || 3));
  return '★'.repeat(r) + '☆'.repeat(maxStars - r);
}

/** 计算地点列表的平均评分 */
export function calcAvgRating(places) {
  if (!places || places.length === 0) return '0';
  const total = places.reduce((sum, p) => sum + (p.rating || 0), 0);
  return (total / places.length).toFixed(1);
}
