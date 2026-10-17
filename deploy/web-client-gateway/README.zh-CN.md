# 网页远控的受控入口

本目录说明如何让网页远控经过 Console 的角色授权网关。它不是本轮已部署结果；现有 VPS 未更改。更新需要同时升级 Console 与 Console Web，并完成下面的入口配置，否则不能认为角色权限已完整生效。

## 数据流与配置

浏览器先使用 Console 登录态申请短期、单次、目标与用途绑定的票据，再连接同源 `/api/web-client/socket`。网关校验当前登录 JTI、账号、角色与设备范围；桌面和文件分别授权。远端仍要求原生密码或批准，媒体与控制内容保持端到端加密，Console 只透明转发。

以下字段在 Console 的 **设置 -> Web 客户端** 页面中配置（旧部署的 `WEB_CLIENT_*` 环境变量会在升级后首次启动时一次性导入数据库）：

| 设置字段 | 旧环境变量 |
| --- | --- |
| 启用开关 | `WEB_CLIENT_ENABLED` |
| 允许的来源 | `WEB_CLIENT_ALLOWED_ORIGIN` |
| 公开 ID 服务器地址 | `WEB_CLIENT_ID_SERVER_URL` |
| 公开中继服务器地址 | `WEB_CLIENT_RELAY_SERVER_URL` |
| 服务器公钥 | `WEB_CLIENT_SERVER_PUBLIC_KEY` |
| 内部 ID 上游（可选） | `WEB_CLIENT_ID_UPSTREAM_URL` |
| 内部中继上游（可选） | `WEB_CLIENT_RELAY_UPSTREAM_URL` |

允许的来源是浏览器实际访问地址的 HTTPS origin，包括非默认端口，不带路径或末尾斜线。上游地址由部署管理员配置，不能来自客户端的中继广告。上游示例是同一个 Docker 网络内的服务；不用通过公网绕回服务器。公开 WSS 地址继续用于被控端身份与中继广告校验，不包含票据。

Console Web 的 Nginx 模板已经为网关路径单独转发 WebSocket Upgrade。最外层 HTTPS 代理也须转发这一地址到 Console Web，保留 `Origin`、Upgrade 和 Connection，允许长连接。不要在访问日志、错误页或请求正文调试日志中记录票据；票据仅在首个 WebSocket 数据帧中出现，登录 JWT 不进入远控 Worker。

## 角色升级行为

系统所有者自动具有全部权限。普通用户必须明确获得 `web_client.connect`；角色可限定设备组或全局范围。自己的设备、原生设备组 ACL、设备管理的 `devices.view` 均不隐式授予网页远控。

文件传输另外要求 `web_client.file_transfer`，同角色依赖 `web_client.connect`，两项有效范围都必须覆盖目标。新增权限不会自动授予已有普通角色，也不会改变原生 `/peers` 的兼容 ACL。升级后应由所有者检查并分配所需角色。

## 必须关闭浏览器直通的旁路

原来直通 hbbs/hbbr 的匿名 WS/WSS 地址不能继续接受浏览器请求，否则浏览器可以避开 Console 网关。需要检查**所有**公开入口，包括旧 `/ws/id`、`/ws/relay`，以及裸 21118/21119 端口。

- 裸 hbbs/hbbr WS 端口仅在 Docker 网络内暴露，或由入口代理接管并拒绝带 `Origin` 的请求。
- 原生 TCP/UDP 的 21115/21116/21117 按原配置保留。
- 如果继续提供桌面客户端的 WebSocket 模式，代理可以保留不带 `Origin` 的原生握手。附带的 Nginx 示例展示此分流；部署前用实际桌面版本验证，不把模拟客户端当作兼容验收。
- 最外层 HTTPS 代理上的旧 WSS 路径同样拒绝带 `Origin` 的请求，不能只改裸端口。网关到原生上游是服务端连接，不依赖浏览器 Origin。
- Origin 来自浏览器握手，但非浏览器程序可以自行构造它。因此这种分流仅防止浏览器旁路，不是原生客户端的身份认证，不替代原生密码/批准，也不宣称 Console 角色限制所有原生 TCP/WS 连接。

依据：[WebSocket RFC 6455 的客户端握手与 Origin 安全边界](https://www.rfc-editor.org/rfc/rfc6455.html#section-4.1)。跨域请求不是合法的网页网关入口；网关对缺失、不匹配的 Origin 均拒绝。

## 四服务 Compose 的最小调整

保留 Console 数据、RustDesk server 数据、密钥、证书和当前 TCP/UDP 端口。不要直接覆盖整套 Compose。针对已有服务调整：

1. Console 添加上面配置，保持与 hbbs/hbbr 位于同一 `rustdesk-net`。
2. 移除 hbbs/hbbr 的公开 `21118:21118` / `21119:21119` 映射，仅 `expose` 对内；如需原生 WS，使用入口代理监听这些端口。
3. 如使用 Console Web 内的 Nginx 作为原生 WS 入口，把本目录的 `nginx-raw-websocket.conf.example` 挂载为 `/etc/nginx/conf.d/20-raw-websocket.conf`，在 Console Web 上发布 `21118:21118` 和 `21119:21119`；两个原生服务仍只有网络内部 WS 端口。
4. 原公开 `/ws/id` / `/ws/relay` 也配置同样的 Origin 分流，或者停止公开这两条直通路径。被控端广告仍须与固定中继地址的校验规则一致。
5. 保留精确旧镜像和旧 Compose 作为回退；切换前先在验收环境验证 Nginx 配置与升级。

## 上线验收

至少使用所有者、无远控权限账号、设备组 A 的操作员和只有连接权限的操作员逐项验收：

| 场景 | 结果 |
| --- | --- |
| 无角色账号连接自己的设备 | 拒绝，Worker 不建立原生连接 |
| A 组操作员手动输入 B 组 ID | 拒绝，与设备列表范围一致 |
| 只有 connect，打开文件传输 | 拒绝独立文件连接，桌面仍可使用 |
| 连接后移除角色/禁用账号/撤销登录 | 服务端复验后关闭桌面和文件子连接 |
| 设备禁用或登记 ID 改变 | 当前连接终止，不能继续沿旧授权操作 |
| 管理员断开 | 仅当前 devices.disconnect 范围内可执行，真实网关关闭 |
| 从浏览器直接访问原公开 WS/WSS | 所有旁路被入口拒绝 |
| 原生 TCP 与需保留的原生 WS | 实际桌面客户端能正常登记和连接 |
| 审计查看 | 有操作者、目标 ID、关联会话、来源及结束原因，无秘密/内容 |

周期复验有有限延迟，并非“撤权零延迟”。异常断网、进程退出和到期不能永久留下可用票据；应用重启后旧内存票据不可复用。

## 审计证据边界

Console 操作审计中，`web_client_session` 记录服务端授权、通道开启和关闭事实。远端认证、文件结果等由浏览器报告，明确标记 `source=browser`；不能据此证明远端应用已经执行操作或文件已经写入。原生公共心跳及审计上报目前的来源验证限制没有被本轮网关自动解决，不能仅凭登记 UUID 将它升级为可信硬件身份。

网关不解析已加密的键鼠、剪贴板、聊天或录制内容。本轮角色只管网页连接与独立文件连接，不提供只有前端开关的“强制只读角色”。

独立文件连接权限也不等于内容级禁止传文件：官方原生客户端由加密的 LoginRequest 决定用途，没有与 hbbs 的明文用途独立绑定。恶意客户端持有桌面 grant 后构造加密文件请求，透明网关无法检查或拦截。需要严格禁止文件操作时，仍应关闭被控端原生文件权限；不能仅凭网页文件入口隐藏就认为安全隔离已经成立。

源码依据：[固定官方 RustDesk 的连接与用途授权实现](https://github.com/rustdesk/rustdesk/blob/4812a9815bd3c6a93f3ad903f29504168c4930a1/src/server/connection.rs)。
