# Colorful · Meridian — 开发日志

## 2026-05-01 — 全面重构日

### 响应式 & 触摸适配

**CSS rem 化**
- 全站 px→rem（基准 16px），三个响应式断点替代原来单个 768px
- 手机竖屏 <480px：基准 14px，详情卡变底部抽屉，弹窗全宽，悬浮卡片缩小
- 小平板 480-767px：基准 15px
- 桌面 ≥768px：基准 16px

**触摸手势控制**
- `html` 加 `touch-action: manipulation`（消 300ms 延迟）、`overscroll-behavior: none`（禁下拉刷新）
- `canvas` 加 `touch-action: none`，所有触摸交给 OrbitControls
- `user-select: none` 防拖拽误选文字，输入框恢复选择

### 交互优化

**点击 vs 拖动区分** (earth.js `_initClickHandler`)
- pointerdown 记起点，pointermove >4px 视为拖拽
- 拖拽时解锁聚焦、恢复自转和 minDistance，让 OrbitControls 自由操控
- 纯点击才触发聚焦/回退逻辑

**双击延迟优化** (app.js)
- 触摸设备 `DOUBLE_TAP_MS = 250`，鼠标 `350`
- 已聚焦卡片第二次点击直接进编辑，不重飞、不等延迟

**摄像机回退** (flyToOverview)
- 纯相对位移：沿视线方向后退 2.5 单位，不设固定终点
- target 不在地心时必须飞回（防止残留偏焦）
- 状态重置（自转、高亮、minDistance）始终执行

**聚类阈值自适应**
- joinThresh/splitThresh/spreadR 按屏宽比例缩放（clusterScale = screenW/768）
- 小屏更激进合并，留出空间

### 边界 & 填充粒子大修

**参照系修正（关键 bug）**
- 边界显隐从 `camera.distanceTo(target)` 改为 `camera.position.length()`（距地心）
- 旧方案 target 漂到球面时导致所有层级边界全亮，排查两小时
- 新阈值：省 2.8、市 2.2、县 2.0（统一距地心判定）

**三级精度回退**
- 填充先匹配县界，无则市界，再无则省界（上限）
- 从 `place.fullName` 提取省份名做模糊匹配
- 省界填充密度 0.006、市县 0.008

**填充渲染优化**
- `sizeAttenuation: true`，世界空间尺寸 0.018，拉近拉远密度均匀
- 暖色调（评分越高越暖），不再纯白
- 透明度直接绑定同级轮廓线 state（`_chinaAdminOpacity/_cityOpacity/_distOpacity * 0.55`）
- 高亮呼吸合并到同一循环，删掉第二套覆盖逻辑
- _homeFill 参数与地点填充统一

**呼吸动画修正**
- 只在 base 透明度 >0.01 时生效，衰减中不残留显示

### 地点总览页面

- 下拉菜单新增「地点总览」入口
- 全列表展示：名称、完整地址、日期、星级、照片数
- 点击行或「编辑」→ 摄像机飞过去弹出编辑框
- 「删除」→ 确认后删，列表即时刷新
- 空态引导、三个断点响应式适配

### 数据导入

- `data.js` `importAllData` 加 export
- 下拉菜单加「导入数据」按钮 + 隐藏 file input
- 读 JSON → 验证格式 → 确认覆盖 → 导入 → 刷新全 UI

### 照片查看器翻页

- 左右箭头按钮 `‹` `›`，单张自动隐藏
- 键盘 ← → 切换，ESC 关闭
- 显示当前索引 `2 / 5`
- caption 关闭时保存，样式移到 CSS

### 代码清理

- 删 6 处 console.log 调试日志
- 删 `dbReady` 死变量（只写不读）
- 删 `onMissClick` 空函数 + 对应分支
- 删 4 处 constructor 已初始化的冗余防御检查
- 删 `_occluder` 每帧无用 scale/depthWrite 设置
- 删 `id="detail-photos"` 无人引用的 DOM id
- 删 borderPoints 被呼吸立即覆盖的无用赋值
- 三个 `document click` 监听器合并为一个
- 海岸线 `_breathStartTime` 双重 if 简化为单条件

### 部署

- GitHub Pages 同步更新：`https://jjrick62.github.io/travel-album-3d/`

---

## 待办

### 后端化（下一阶段）

- [ ] 选定技术栈：Express+SQLite / FastAPI+PostgreSQL / Supabase BaaS
- [ ] 用户认证系统（注册/登录/JWT）
- [ ] 地点数据从 IndexedDB 迁移到后端数据库
- [ ] 照片上传到服务器/云存储，不再 base64 塞浏览器
- [ ] 多端数据同步
- [ ] 数据导入/导出保持与旧版兼容

### 安卓版（暂缓）

- [ ] 基于当前代码复制安卓专属版本
- [ ] manifest.json 添加图标（用户自备）
- [ ] index.html viewport PWA 适配
- [ ] sw.js Service Worker 离线缓存
- [ ] 测试 APK 打包

### 细节优化

- [ ] 照片查看器支持触摸滑动切换
- [ ] 相机初始距离三档可能需要微调
- [ ] 粒子填充密度可进一步调整视觉
