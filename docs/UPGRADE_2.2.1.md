# 从2.2更新到2.2.1

此版本针对截图中中央“出牌”提示向下堆叠，以及普通系统声音偏机械的问题。

推荐合并完整源码包，保留自己的`.git`、`.env`、`.data`和部署设置。也可把本包`docs/upgrade-2.2.1.patch`放到原始2.2仓库根目录：

```bash
git apply --check docs/upgrade-2.2.1.patch
git apply docs/upgrade-2.2.1.patch
npm ci
npm test
npm run build
git add .
git commit -m "Keep Mahjong feedback stable and prefer gentle Chinese female voices"
git push
```

不要同时覆盖新源码后再应用旧补丁。若检查报冲突，请按差异合并已有改动。

Render前后端单服务重新部署整个仓库；前后端分离部署时，仅前端需要更新，已有2.2动作事件接口兼容。数据库、房间、重连凭据和本地存档无需迁移或清空。部署完成后刷新页面，点击“试听语音”；如果仍有旧画面，可完整刷新页面以加载最新构建。

中央提示采用固定节点与固定边界，不再给每个动作创建带新key的提示容器。动画使用短暂效果，每次替换和隐藏都会取消，不保留已结束画面。禁用浏览器翻译对动态牌局节点的重写。

“音色”默认自动优先女声，识别可用的自然／增强中文声音；“语速”默认柔和0.92，可改舒缓0.85或轻快1.05。选中的音色和速度自动保存，音色消失时回退，未知声音不会自动标记为女声。Web Speech API没有性别字段，本项目依据常见声音名称识别，是有限候选规则，并非完整声音目录。

浏览器只会使用设备实际提供的声音。本版没有内置固定录音，不能保证每台设备都有高质量、温柔的中文女声；仅调语速和音高无法把低质量系统声音变成自然配音。为所有设备保证同一音色需要单独的配音资源或已配置的语音服务。没有新增付费接口或服务密钥依赖。

浏览器端及iPhone实际试听、视觉复测尚未完成。本次提供完整代码及补丁，未修改你自行部署的GitHub、Render、Vercel或Pages账户。

参考：

- https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesis/getVoices
- https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesisVoice
- https://learn.microsoft.com/en-us/azure/ai-services/speech-service/language-support
