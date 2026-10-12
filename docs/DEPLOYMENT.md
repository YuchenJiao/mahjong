# 自行创建仓库与部署

已有2.0仓库升级请先看[2.1升级步骤](UPGRADE_2.1.md)。

## 创建自己的Git仓库

解压后进入quiet-mahjong目录：

```bash
git init
git add .
git commit -m "Initial online Mahjong game"
git branch -M main
git remote add origin https://github.com/YOUR_NAME/YOUR_REPO.git
git push -u origin main
```

先在GitHub网页创建空仓库，再替换命令中的用户名／仓库名。不要上传node_modules、dist、.data、.env或真实重连凭据。

## 方案A：Render同时部署前后端（推荐）

1. 在Render连接自己的GitHub仓库，用Blueprint读取render.yaml，或者手动创建Node Web Service。
2. Node版本24；构建`npm ci --include=dev && npm run build`；启动`npm start`；健康检查`/api/health`。
3. 选择Free实例。一个域名同时提供React网页、工具API与房间API，不用配置跨域。
4. 部署后打开服务URL，创建房间，复制邀请链接给朋友。

免费实例闲置15分钟会休眠，唤醒可能约1分钟。免费服务没有持久磁盘，SQLite房间数据在重新部署、重启、休眠时可能丢失。活动玩家的轮询会持续产生入站请求；离开后停止轮询。需要跨服务重启长期保留房间时，应使用持久磁盘或外部数据库，不能将临时磁盘当永久存储。

官方：[免费实例](https://render.com/docs/free)、[持久磁盘](https://render.com/docs/disks)。额度、资格和政策可能改变，免费计算配置不代表永久免费或无限使用。

## 方案B：Vercel前端＋Render后端

1. 先按方案A部署Node后端，取得https://YOUR_BACKEND.onrender.com。
2. Vercel导入同一仓库，选择Vite；构建npm run build，输出dist。仓库提供vercel.json。
3. 在Vercel设置构建环境变量`VITE_ONLINE_API_URL=https://YOUR_BACKEND.onrender.com`，重新部署。
4. 在Render设置`ALLOWED_ORIGINS=https://YOUR_FRONTEND.vercel.app`，重启服务。多个允许来源用逗号分隔，填写完整origin，不含路径或末尾斜线。
5. 玩家使用Vercel网页中的邀请链接进入同一个Render房间。

Vercel里的api/health、rules、score、analyze是无状态工具函数；房间不应放进这些函数的内存。未配置独立后端时，本地单人玩法可用，联网房间不可用。Vercel Hobby的适用范围与额度请查看[官方计划说明](https://vercel.com/docs/plans/hobby)。

## 方案C：GitHub Pages前端＋Node后端

1. 在GitHub仓库Settings → Pages中选择GitHub Actions。
2. 在Actions Variables中设置`DEPLOY_GITHUB_PAGES=true`和`VITE_ONLINE_API_URL=https://YOUR_BACKEND.onrender.com`。
3. 在后端ALLOWED_ORIGINS中加入`https://YOUR_NAME.github.io`（origin不包含仓库路径）。
4. 推送main或手动运行Deploy GitHub Pages。Vite采用相对资源路径，支持仓库子路径。

Actions的测试与构建工作流在push和pull_request运行；Pages工作流默认关闭，按上述变量启用。Pages只托管网页，联网数据由后端保存。

## 本地／服务器持久部署

Node.js 24：`npm ci && npm run build && npm start`。服务绑定0.0.0.0，读取PORT（默认3000）。

环境变量：

| 名称 | 用途 |
|---|---|
| PORT | Node服务端口 |
| ONLINE_DB_PATH | SQLite路径，默认.data/rooms.sqlite；挂载持久磁盘时指向挂载目录 |
| ALLOWED_ORIGINS | 分离部署时允许访问API的网页origin，逗号分隔 |
| VITE_ONLINE_API_URL | 前端构建时的联机API地址；同域部署留空 |

只运行一个Node实例共享一个SQLite文件，不要用多个隔离实例分别保存同一房间。备份数据库时使用SQLite一致性备份工具，或者停止服务后备份主数据库及WAL文件。房间闲置2小时会过期，之后创建新房间时清理过期记录。

部署文件不创建付费磁盘、付费数据库或付费服务；在平台控制台选择资源时仍应检查最终套餐。项目未代你注册账户、创建GitHub仓库或发布到Vercel／Render／Pages。
