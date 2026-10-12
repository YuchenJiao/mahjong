# 后端 API · 在线房间

在线模式由服务端管理完整牌局并保存房间，浏览器本地单人模式仍可独立运行。后端同时提供工具算分／建议API和静态网页服务，不调用大模型。Node使用SQLite，托管Worker版使用D1。

## 启动

```bash
npm ci
npm run build
npm start
```

默认 `http://localhost:3000` 同时提供首页和API。部署服务通过 `PORT` 指定端口。开发时可以在两个终端分别运行 `npm run dev` 和 `npm run dev:server`；Vite 将 `/api` 代理给3000端口。

## 端点

| 方法 | 路径           | 用途                               |
| ---- | -------------- | ---------------------------------- |
| GET  | `/api/health`  | 版本、服务健康与存储方式           |
| GET  | `/api/rules`   | 模式列表与国标番型参考             |
| POST | `/api/score`   | 计算一手牌的合法性、番型和分值     |
| POST | `/api/analyze` | 根据自己手牌与公开观察生成出牌建议 |

POST 使用 `Content-Type: application/json`，请求体最大64KiB。错误输入返回400，错误方法405，不支持媒体类型415，过大413。无跨域开放配置；本地Vite代理、Vercel同域Functions或Node同站部署可直接使用。

## 牌编码

| 数值  | 牌             |
| ----- | -------------- |
| 0–8   | 一万至九万     |
| 9–17  | 一筒至九筒     |
| 18–26 | 一条至九条     |
| 27–30 | 东、南、西、北 |
| 31–33 | 中、发、白     |

川麻限制0–26。副露格式为 `{kind, tiles, from, concealed, added?}`，kind为chow/pung/kong；吃3张连续同花色，碰3张相同，杠4张相同；from为0–3。

## 算分请求

完整样例见 `examples/score-request.json`，可以执行：

```bash
curl -X POST http://localhost:3000/api/score -H "Content-Type: application/json" --data-binary @examples/score-request.json
```

PowerShell用 `curl.exe` 调用相同命令。样例是清一色、七对、1根，自摸加底：5番、33分。

字段：config与客户端Config对应，可省略除mode以外的配置使用默认值；player包含hand、melds、voidSuit；context包含self、winTile，以及可选的kong、rob、last、heaven、earth、lastCopy、seat、wind。

`config.mcrEightPointMinimum`为布尔值，默认`true`；设为`false`可允许国标不足8分的合法牌型胡牌，仍返回实际番数。仅国标且`scoring=true`时生效；关闭算番时沿用固定底分玩法。`/api/analyze`接收相同配置。

自摸时hand包含和牌张，`hand.length + melds.length * 3 = 14`；点炮时hand不含和牌张，等式为13。API验证自有牌中不超过四张同牌。`legal:false` 是合法计算结果，表示该牌型／番数不满足胡牌条件，不是HTTP输入错误。

## 出牌分析请求

样例见 `examples/analyze-request.json`。格式为客户端的PublicView；自己手牌与副露有效张数为14，传入四家的公开副露、弃牌、定缺和手牌张数，不能传入他家的暗牌。

```bash
curl -X POST http://localhost:3000/api/analyze -H "Content-Type: application/json" --data-binary @examples/analyze-request.json
```

返回recommendations，包含tile、shanten、ukeire、useful、risk、utility、reason、target。服务端重建公开观察，不把收到的wall或其他玩家hand传给AI。risk是启发式估计，不是精确点炮概率。

API供独立调用和后续扩展，当前首页仍使用本地引擎，默认不会把玩家手牌发到服务端。服务器验证牌的基本结构，但不对调用方声明的自摸、牌墙末张等上下文进行对局权威认证；这不是联网对战的可信裁判服务。


## 在线房间协议

| 方法 | 路径 | 用途 |
|---|---|---|
| POST | /api/rooms | 创建房间：{name, config}；返回201及{token, room} |
| POST | /api/rooms/:id/join | 在开局前／结束后加入空座：{name}；返回{token, room} |
| GET | /api/rooms/:id | 读取自己的视图、心跳、处理到期托管和电脑动作 |
| POST | /api/rooms/:id/command | {requestId, stage, command}，返回当前自己的room视图 |

加入后的GET与command必须携带`Authorization: Bearer <token>`。不要将token写入邀请URL、日志或分享的牌谱。服务端只保存SHA-256摘要。一个token只控制一个房间内的一个座位。

RoomView包含房间号、isHost、实际selfSeat、version、stage、serverTime、deadline、config、seats、exchangeReady、voidReady、game、actions、claims。视图中的game会将自己的座位旋转到0，保持原牌桌和吃上家方向；庄家、玩家、碰杠来源、付款和牌谱按相同方式旋转。

game不是服务端真实牌局的完整副本：牌墙用-1占位；seed固定为0；其他玩家未公开手牌／暗杠牌值用-1占位；未结束时frames为空，其他座位的待选动作不会发送。川麻已胡对手只保留一张和牌。结束后可见完整四家手牌和本局牌谱，但牌墙顺序仍不发送。不得把在线视图传回服务器充当权威牌局，也不得导入为本地进行中的存档。

command类型（见src/online/protocol.ts）：

- start／next：仅房主；分别在房间尚未开局／本局已结束时执行。
- exchange：tiles为三张同花色手牌；每人一次，四家提交完毕才同时交换。
- void：suit为0万、1筒、2条；四家选择完毕后公开定缺并行牌。
- discard：tile为牌值；只允许当前座位、合法手牌与定缺约束。
- act／claim：action必须是服务端返回的合法自摸／杠或弃牌响应对象。
- autoplay／takeback：交给电脑或收回操作。
- leave：移除自己的席位凭据，电脑接手；房主转交仍在座的玩家。

requestId为8–80位字母数字或连字符，客户端每次逻辑操作生成一个随机ID；网络重试必须复用同一个ID。服务端保存最近80次操作记录，防止短期内重复出牌和重复扣分。

stage是服务端返回的轮次／阶段／当前玩家／操作帧标识；同一抢牌阶段的不同玩家可以并发提交响应，阶段已变化的旧操作返回409。不要使用每次心跳递增的version作为操作前置条件，否则心跳会使正常操作失效。数据库层另外用版本条件更新并重试，防止并发状态覆盖。

客户端约每秒轮询一次；处理电脑动作至少间隔500ms。没有连接中的客户端时不执行背景对局，重连后按照最后时间戳恢复托管和推进。这不改变跨刷新重连能力，但不会在无人观看期间连续打完所有电脑对局。

主要错误：400输入／非法动作、401座位凭据无效、403权限或来源、404房间不存在／闲置过期、409座位满／旧阶段／托管／当前不能开局、413请求过大、429房间容量达到上限。房间请求正文最多16KiB，HTTP适配器最多64KiB。

跨域分离部署需要后端ALLOWED_ORIGINS白名单；同域不需要。Vercel函数只运行前述无状态工具API，房间请求由VITE_ONLINE_API_URL指向Node后端。
