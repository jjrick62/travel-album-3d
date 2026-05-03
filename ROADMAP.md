# Colorful·Meridian 改进路线图

基于 2026-05-02 行业同类项目调研（AdventureLog / Voyage-Wise / TravStats / earth-flyline）整理。

## 高价值（业界标配 + 简历加分明显）

| 序号 | 方向 | 说明 | 难度 |
|---|---|---|---|
| 1 | **飞线动画** | 常住地→各地点弧线加流动光点动画，类似航班轨迹效果 | 中 |
| 2 | **热力图 / 区域填色** | 到访区域颜色随次数加深，一眼看出旅行分布 | 中 |
| 3 | **PWA 离线完整化** | 已有 sw.js，需完善地图数据缓存和离线体验 | 中 |
| 4 | **分享卡片导出** | 一键生成地球截图 + 统计数据的分享图片 | 低 |

## 中价值（差异化 + 体验提升）

| 序号 | 方向 | 说明 | 难度 |
|---|---|---|---|
| 5 | **旅行时间轴** | 按时间线滑动浏览每次旅行，"时光穿梭"播放动画 | 高 |
| 6 | **想去清单** | 灰色标记未去地点，区分"已去"和"想去" | 低 |
| 7 | **照片地理标记** | 上传照片自动读 EXIF GPS 坐标，匹配城市 | 中 |
| 8 | **统计面板** | 省份/城市/国家数、评分分布、频率日历热图 | 低 |

## 趣味性增强

| 序号 | 方向 | 说明 | 难度 |
|---|---|---|---|
| 9 | **手势控制** | MediaPipe Hands 摄像头手势操控地球 | 中 |
| 10 | **语音添加** | "我去过杭州" → 自动搜索城市并添加记录 | 高 |
| 11 | **旅行拼图** | 中国地图省份拼图，集齐解锁成就徽章 | 中 |

## 已完成的工程质量优化

- [x] ESLint + EditorConfig + package.json（`npm run check` 一键验证）
- [x] js/utils.js 公共工具提取（星星渲染、平均分计算）
- [x] DOM null 安全 + 未用代码清理
- [x] 摄像机高度自适应屏幕宽高比
- [x] 拖拽时 target 切回地心
- [x] 全局点击空白回拉视角
- [x] 点击日志工具 (js/logger.js)

---

**参考项目**: [AdventureLog](https://github.com/seanmorley15/AdventureLog), [Voyage-Wise](https://github.com/ploosond/voyage-wise), [TravStats](https://github.com/ploosond/voyage-wise), [earth-flyline](https://github.com/ploosond/voyage-wise)
