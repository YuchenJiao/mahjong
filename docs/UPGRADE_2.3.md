# 从2.2.3升级到2.3.0

本版新增新摸牌独立槽、公开的归入／摸切／手切动作、本地手动理牌、吃碰杠胡建议和实时做牌方向。联机的新增字段及命令需要前后端同时更新。

## 使用完整源码

将本代码包中的源码覆盖到自己的仓库，保留自己的`.env`及SQLite数据目录，提交并推送。不要复制`node_modules`、`dist`或其他环境的数据库。默认忽略这些文件。

## 使用补丁

如果自己的代码仍是未修改的2.2.3，可将本包的`docs/upgrade-2.3.patch`复制到旧仓库，再运行：

```bash
git apply --check docs/upgrade-2.3.patch
git apply docs/upgrade-2.3.patch
npm ci
npm test
npm run build
```

补丁以完整的2.2.3包为基线，不包含补丁本身及`MANIFEST.json`。若有自己的改动，请先检查冲突，不要强制覆盖。

## 重新部署

- Render单服务：推送自己的仓库后按已有方式重新部署，构建`npm ci && npm run build`，启动`npm start`，Node.js 24以上。保留原数据盘／SQLite路径。
- Vercel或GitHub Pages前端与Render后端分开部署：两端都要推送并重新部署。保持现有`VITE_ONLINE_API_URL`与CORS配置。
- 部署后刷新客户端，在`/api/health`核对`version`为`2.3.0`。旧客户端保留传统出牌兼容字段，但不会显示新功能，请刷新。

浏览器存档版本仍为3，SQLite表结构不变。旧牌局没有独立摸牌状态时会使用兼容推断，后续新动作记录完整状态。手动理牌在本机存储，不上传隐藏牌序；归入手牌是公开动作，不会重置45秒行牌计时。

本包提供代码与升级材料，不会自动修改用户自行管理的GitHub、Render、Vercel或Pages部署。
