# fnOS 首次配置向导（一处填写服务器地址，全局生效）

## Context

当前 FPK 版本需要在多处重复填写服务器地址：常规设置的站点前端/后端地址、网页客户端的 ID/中继地址、定制客户端、被控设备端。地址缺失或不一致已造成两个实际故障：云端构建拿到默认 `http://localhost:3000`（curl exit 7）、网页远控因中继地址不一致报“设备 ID 或服务器配置无效”。

目标：软件中心点“打开”后，未完成配置时先进入向导弹窗页（类似 RustDesk Server Pro 配置面板），只填一次服务器地址，保存后站点地址、网页远控、定制客户端默认配置全部自动生效；老版本升级用户不受影响。

## 基线与约束

- 后端基线：`fnos-1.11.5`（commit `87d5f36`），从该提交切分支 `fnos-setup-wizard`，不要在 main 上做。
- 前端基线：`databk/rustdesk-console-web` 1.7.0（本地 `/tmp/cw170`），保持现有界面风格，只新增向导页。
- 该基线 FPK 不管理 hbbs/hbbr（由用户的 Server Pro FPK 负责），向导**不修改 hbbs**，只在结果页提示中继地址需一致。
- 定制客户端无需改动：`custom-client.service.ts` 的 `applyServerDefaults/serverDefaults` 已从 `effectiveBackendUrl` 推导，站点地址填对即自动修好。
- 发布 `fnos-1.11.10`，保留所有旧 Release，不删除。

## 后端改动（新分支，基于 87d5f36）

新增 `src/modules/setup/`：`setup.module.ts`、`setup.controller.ts`、`setup.service.ts`、`dto/complete-setup.dto.ts`、`setup.service.spec.ts`；在 `src/app.module.ts` 注册。独立模块避免 UserModule↔SettingsModule 循环依赖。

1. `@Public() GET /api/settings/setup` → `{ completed: boolean }`。
   判定复用 `GeneralSettingsService.getSiteSettings()`：`frontendUrl` 非空即已完成（老用户升级后自动跳过向导）。
2. `@Public() POST /api/settings/setup` → 完成向导。
   - 已完成返回 409；进程内锁防并发重复提交。
   - DTO：`serverUrl`（必填）、`serverPublicKey`（可选）、`currentAdminPassword`+`newAdminPassword`（可选，成对出现）。
   - `serverUrl` 只接受 http(s) origin：禁止路径/查询/fragment/凭据/空白，去末尾 `/`；非 https 或 IP 主机时仍允许保存，但按下面规则降级并在响应里给出警告。
3. 保存动作（全部成功后才写入站点地址作为“完成提交点”）：
   - 复用 `GeneralSettingsService.updateSettings()` 写 `general.siteFrontendUrl=origin`，`siteBackendUrl` 置空（自动跟随前端地址）。
   - 网页远控复用 `WebClientSettingsService.updateSettings()`（保存后调用 `WebClientService.refresh()`）：
     - https：`allowedOrigin=origin`、`idServerUrl=wss://<host>/ws/id`、`relayServerUrl=wss://<host>/ws/relay`；有合法公钥（已有或本次提交，Base64 32 字节）则 `enabled=true`，否则预填地址但保持 `enabled=false`。
     - http/内网：只保存站点地址，不写网页远控配置，响应中提示“网页远控与云端构建需要公网 HTTPS 地址”。
   - 修改密码：查 admin 用户后复用 `UserService.changePassword()`（自带旧密码校验、bcrypt、会话注销），不绕过 RBAC 的其他路径。
   - 需要 `web-client.module.ts` 导出 `WebClientSettingsService`、`WebClientService`。
4. 单元测试：状态判定、重复提交 409、非法地址 400、https 派生 URL、无公钥不启用、密码错误不写入任何设置。

## 前端改动（1.7.0 源码）

1. `config/routes.ts`：新增 `{ path: '/setup', layout: false, component: './setup' }`。
2. `src/app.tsx`：
   - `getInitialState` 并行请求公开的 setup 状态；`completed=false` 且当前不在 `/setup` 时 `history.replace('/setup')`，并跳过用户信息请求。
   - `layout.onPageChange` 放行 `/setup`，避免未登录被踢回登录页。
3. 新增 `src/pages/setup/index.tsx`：AntD Card + Form，字段为服务器地址、可选服务器公钥、可选管理员密码区（当前密码/新密码/确认）；保存后结果页展示派生配置与提示：
   - 客户端 ID/中继地址说明；
   - 无公钥时提示到 Server Pro 的 hbbs `id_ed25519.pub` 取 key，再到“设置→网页客户端”启用；
   - 提示 hbbs 的 `relay-servers` 需与该地址一致、网页远控走公网域名访问；
   - “进入登录”按钮清 token 后跳 `/user/login`。
4. `src/services/rustdesk-console/settings.ts` 增加 `getSetupStatus()`、`completeSetup()`；`typings.d.ts` 增加类型；`src/locales/{zh-CN,en-US,pt-BR,ru-RU,fr-FR}/pages.ts` 增加 `pages.setup.*` 文案。
5. 修改后的前端推送到 fork 分支，保证 FPK 可重复构建。

## FPK 与发布

- `fnos/ui/config`、`fnos/cmd/service-setup` 不改：向导就在现有 Web UI 内，升级保留 `${TRIM_PKGVAR}/data` 与 credentials。
- `.github/workflows/fnos.yml`：前端改为从 fork 源码 `npm run build` 并构建 musl Rust 二进制（不再下载官方 1.7.0 二进制）；后端 `npm run build:sea`；组包流程沿用现状，版本号 1.11.10。
- 打 tag `fnos-1.11.10` 发布，旧版本全部保留。

## 验证

1. 后端 `npm test`（含新增 setup 测试）、前端 `npm run build` 通过。
2. 全新安装：打开即进向导 → 填 `https://rdc.tmnas.top` 保存 → 常规设置站点地址已写入；提交定制客户端构建，GitHub 日志中 backend-url 不再是 localhost。
3. 有公钥时网页远控自动启用；无公钥时地址已预填、保持禁用且控制台可正常登录使用。
4. 模拟升级（数据库已有 `siteFrontendUrl`）：不出现向导，数据与设置不变。
5. 重复 POST `/api/settings/setup` 返回 409。
