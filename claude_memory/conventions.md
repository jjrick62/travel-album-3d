# 代码约定

## JS
- camelCase 命名
- ES module (import/export)
- 所有 async 函数必须有 try-catch 或错误兜底
- DOM 操作前检查 null
- 复用 js/utils.js 中的工具函数，禁止重复造轮子
- 无用的 import 和变量及时清理（eslint 会报）

## Python
- snake_case 命名
- FastAPI router 放 backend/routers/
- 数据校验用 Pydantic schemas
- SQLAlchemy async session

## CSS
- kebab-case 类名
- 暗色主题基调 (#000背景, #ccc文字)
- 三断点响应式: 480 / 768

## Git
- 每改一个文件 → 单独验证 → 再改下一个
- commit message 中文描述改动原因
- push 前跑 npm run check
