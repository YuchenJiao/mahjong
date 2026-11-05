# 从2.2.2升级到2.2.3

修复开局选“基础”，电脑玩家卡片仍显示“进阶”的问题。此前玩家副标题与页脚是固定文字；实际出牌算法通过`publicView.config.aiDifficulty`读取设置，本次没有修改算法。

现在三个电脑标签和页脚读取当前牌局的难度，局中切换也会同步。定缺、胡牌和庄家状态继续显示；联机真人与电脑托管分别标注。个人助手仍使用进阶分析，与电脑档位独立。

将完整包`quiet-mahjong/`合并到现有仓库，保留`.git`、`.env`、`.data`和部署设置。也可以在原始2.2.2仓库应用包内补丁：

```bash
git apply --check docs/upgrade-2.2.3.patch
git apply docs/upgrade-2.2.3.patch
npm ci
npm test
npm run build
git add .
git commit -m "Show the configured Mahjong computer difficulty"
git push
```

完整合并源码和应用补丁二选一；已有自定义改动导致检查失败时请按差异合并。Render单服务重新部署整个仓库；前后端分开部署时只更新前端即可，后端API行为未变。存档、房间和数据库无需迁移或清空。

新增验证运行在真实前端入口的jsdom DOM环境，覆盖难度标签切换与实际电脑弃牌；不等同于Chrome／Safari实机视觉验证。本次未登录或修改你自行部署的GitHub／Render账户，重新部署后生效。
