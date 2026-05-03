# 旅行相册 (Colorful·Meridian)

## 项目定位
3D 粒子地球个人旅行记录工具。大数据专业大二学生简历项目。

## 仓库结构
| 分支 | 类型 | 部署 |
|---|---|---|
| `static` | 纯前端 · IndexedDB 本地存储 | GitHub Pages → jjrick62.github.io |
| `master` | 前后端 · FastAPI + SQLite | 本地开发 |

## 技术栈
- 前端: Vanilla JS + Three.js v0.160 + IndexedDB
- 后端: Python FastAPI + SQLAlchemy + SQLite + JWT
- 工具: ESLint + EditorConfig

## JS 模块
| 文件 | 用途 | 分支 |
|---|---|---|
| js/earth.js | 3D粒子地球引擎 | 两个分支共用 |
| js/app.js | 主逻辑+UI交互 | 两个分支不同版本 |
| js/data.js | IndexedDB数据层 | 仅 static |
| js/api.js | HTTP数据层 | 仅 master |
| js/logger.js | 点击日志调试工具 | 两个分支共用 |
| js/utils.js | 公共工具函数 | 两个分支共用 |

## 工作流
- `npm run check` → eslint + node --check ×4
- `npm run dev` → http-server :8081
- 改 static → `git checkout static` → 改 → 验证 → commit → push → 同步到 jjrick62.github.io
- 改 master → `git checkout master` → 改 → 验证 → commit → push
