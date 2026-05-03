# 常用命令

## 开发
```bash
# 前端
npx http-server . -p 8081 -c-1     # 或 npm run dev
npm run lint                         # eslint 自动修复
npm run check                        # 全量检查

# 后端
cd backend && python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

## 部署
```bash
# 静态版推送 → GitHub Pages 自动部署
git checkout static
git push origin static

# 同步 GitHub Pages 顶级域名仓库
cd ../jjrick62.github.io
git fetch album static && git checkout album/static -- . && git commit -m "sync" && git push origin master --force
```

## 调试
```javascript
// 浏览器 F12 console
logEvents()           // 查看最近50条点击日志
logClear()            // 清空日志
logExport()           // 下载日志JSON
```
