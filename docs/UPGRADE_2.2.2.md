# 从2.2.1升级到2.2.2

修复恢复国标牌局／刷新时的`Cannot read properties of undefined (reading 'ccall')`。

旧版`App`在返回加载页之前已执行`ownActions → winScore → rawScore → core.ccall`，而真正的引擎初始化在首次渲染完成后的effect中才开始。国标行牌存档触发首次渲染异常，初始化effect因此无法执行，页面崩溃。这次将引擎加载器移到整个牌桌外层，就绪后才挂载牌桌；不是通过删存档回避问题。

推荐将完整源码包中的`quiet-mahjong/`合并到自己的仓库，保留`.git`、`.env`、`.data`及部署设置。也可把`docs/upgrade-2.2.2.patch`放到原始2.2.1仓库根目录：

```bash
git apply --check docs/upgrade-2.2.2.patch
git apply docs/upgrade-2.2.2.patch
npm ci
npm test
npm run build
git add .
git commit -m "Initialize Mahjong engine before restoring the table"
git push
```

完整源码合并和应用补丁二选一，不要覆盖新源码后再次应用旧补丁。有自定义代码且检查报冲突时，请按差异合并。

Render单服务：推送连接的仓库后重新部署；如果未自动部署，可在Render执行Deploy latest commit。完成后正常刷新页面即可，不需要清空浏览器数据或删除存档。分开部署时至少更新前端；后端同时包含初始化失败后可重试的调整，建议一起更新。API和数据库结构不变。

新增jsdom、esbuild及类型声明仅为开发／测试依赖，`npm ci`会按锁文件安装。运行`npm test`时会执行完整前端入口的DOM回归，包括延迟WASM、助手开关、StrictMode、失败重试和存档保留。生产构建不会打包这些测试工具。

底层初始化失败时会显示“重试加载”按钮，重试不会删除保存的牌局。低层计分API在未就绪时抛出`CoreNotReadyError`，正常调用者仍应先等待`initCore()`。

本次测试不等同于Chrome/Safari实机或手机视觉／语音验证。没有连接或修改你的Render、GitHub等外部账户；重新部署后此修复才会出现在现有网址。
