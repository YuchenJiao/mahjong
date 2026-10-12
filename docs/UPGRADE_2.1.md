# 更新已部署的2.0仓库

推荐将下载包的quiet-mahjong目录内容合并进现有仓库，保留你的.git、.env、.data、ALLOWED_ORIGINS以及自行配置的部署变量。不要上传本地SQLite文件或重连凭据。

如果希望只应用改动，可只从下载包取出docs/upgrade-2.1.patch，放到你的原仓库内，然后：

```bash
git apply --check docs/upgrade-2.1.patch
git apply docs/upgrade-2.1.patch
npm ci
npm test
npm run build
git add .
git commit -m "Improve Mahjong strategy and claim synchronization"
git push
```

补丁基于此前交付的原始2.0多人大包。若你已改过相同代码且检查失败，请合并相应差异；不要用覆盖命令丢弃自己的改动。完整合并源码和应用补丁是两种替代方式，不应在已覆盖后的新代码上再次应用旧版本补丁。

在Render重新部署连接的仓库；分离部署时前后端都应更新到2.1，以使新的房间助手接口和前端风格选择配套。原VITE_ONLINE_API_URL与ALLOWED_ORIGINS无需因本次接口更新而改变。

SQLite表结构不变，JSON新增字段均提供兼容默认值；已存在的房间不需要SQL迁移。不要执行Reset、删库或清空.data。部署平台自己的临时磁盘限制仍适用。

这次没有连接或修改你自行建立的GitHub／Render账户。原ChatGPT Site的接口返回“项目不存在”，故没有把2.1发布到旧网址，也没有另建站点替代你的部署。
