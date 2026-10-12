# 从2.1更新到2.2：大牌面、动画和语音

将下载包中`quiet-mahjong/`的内容合并到你的仓库，保留自己的`.git`、`.env`、`.data`和部署环境变量。不要上传SQLite房间数据或重连凭据。

也可以只取出`docs/upgrade-2.2.patch`，在原始2.1仓库根目录执行：

```bash
git apply --check docs/upgrade-2.2.patch
git apply docs/upgrade-2.2.patch
npm ci
npm test
npm run build
git add .
git commit -m "Enlarge Mahjong table and add confirmed action voice feedback"
git push
```

补丁基于上一版完整2.1交付包；如果本地已有改动导致检查失败，请按差异合并。完整合并源码和应用补丁二选一，不要在已覆盖后的新代码上再应用旧补丁。若仍在2.0版本，可以依次应用2.1、2.2补丁或直接合并最新完整源码。

Render单服务应重新部署整个仓库。前后端分离部署时，两端都更新到2.2，联机语音需要新的公开动作事件字段。前端变量`VITE_ONLINE_API_URL`和后端`ALLOWED_ORIGINS`沿用已有设置。数据库表结构和本地存档版本不变；旧牌局首次新动作自动补齐事件字段，不要删库或清空`.data`。

页面上的“音效”“语音”独立控制，偏好自动保存。默认启用语音，首次点击页面操作或“试听语音”后播放；建议先试听确认设备中文声音。回放保持静音，暗杠只读“杠”，不透露牌面。快速模式积压时优先保留吃碰杠胡，淘汰过时弃牌播报。

手机横屏保留46×66像素手牌，空间不足可横向滚动牌桌；页面可以纵向滚动。系统启用“减少动态效果”时自动停用动画。

本次交付更新源码与补丁，未连接或修改你自行创建的GitHub、Render、Vercel或Pages账户；推送到自己的仓库并重新部署后生效。浏览器实际发音、设备声音可用性和手机视觉效果尚未实机复测。
