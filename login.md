# Login - 用户登录

## 接口说明
用户登录接口，支持多种认证类型：账号密码、邮箱验证码、两步验证码等。根据不同的认证类型和用户状态，服务端可能返回不同类型的响应，客户端需根据 `type` 字段判断后续流程。

> **注意**：客户端代码中定义了 `mobile`（手机号登录）和 `sms_code`（短信验证码登录）类型常量，但当前客户端 UI 并未使用这两种登录方式，仅定义了常量而未集成到登录流程中。`tfa_code` 类型同理，客户端定义了常量但实际 2FA 验证码提交使用的是 `email_code` 类型配合 `tfaCode` 字段。

## 协议类型
HTTP REST API

## 请求方法
POST

## 请求路径
/api/login

## 请求头
| Header | 值 | 说明 |
|--------|-----|------|
| Content-Type | application/json | 请求体为 JSON 格式 |

## 请求参数

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| username | string | 条件必填 | 用户名（`type` 为 `account` 或 `email_code` 时必填；某些认证流程可不提供） |
| password | string | 条件必填 | 密码（仅 `type` 为 `account` 时必填，其余类型不提供） |
| id | string | 是 | 客户端设备 ID |
| uuid | string | 是 | 客户端设备 UUID |
| autoLogin | bool | 否 | 是否自动登录 |
| type | string | 是 | 认证类型，见下方说明 |
| verificationCode | string | 否 | 验证码（邮箱验证码登录时使用） |
| tfaCode | string | 否 | 两步验证码（2FA 验证时使用，与 `type: "email_code"` 配合提交） |
| secret | string | 否 | TFA 密钥（2FA/邮箱验证时使用，由服务端在上一步响应中返回） |
| deviceInfo | object | 否 | 设备信息（客户端自动填充，无需手动构造；客户端始终发送此字段，即使获取设备信息失败也会发送空对象 `{}`） |

### 认证类型（type 字段）

| 值 | 说明 | 客户端实际使用 |
|----|------|----------------|
| account | 账号密码登录 | ✅ 使用 |
| mobile | 手机号登录 | ⚠️ 仅定义常量，未集成到登录流程 |
| sms_code | 短信验证码登录 | ⚠️ 仅定义常量，未集成到登录流程 |
| email_code | 邮箱验证码登录 | ✅ 使用（同时用于邮箱验证和 2FA 验证码的二次提交） |
| tfa_code | 两步验证码登录 | ⚠️ 仅定义常量，客户端实际使用 `email_code` + `tfaCode` 字段提交 2FA 验证码 |

### deviceInfo 结构

| 字段 | 类型 | 说明 |
|------|------|------|
| os | string | 操作系统（如 `linux`、`windows`、`android`，取自 `std::env::consts::OS`） |
| type | string | 来源类型（固定值 `"client"` 表示 RustDesk 客户端，`"browser"` 表示浏览器 |
| name | string | 设备名称（客户端取自主机名 hostname） |

## 响应定义

| 字段 | 类型 | 说明 |
|------|------|------|
| access_token | string | 访问令牌（登录成功时返回） |
| type | string | 响应类型，见下方说明 |
| tfa_type | string | 验证类型提示（当 `type` 为 `email_check` 时使用，区分是邮箱验证还是 2FA 验证） |
| secret | string | TFA/验证密钥（需要验证时由服务端返回，客户端在后续请求中回传） |
| user | UserPayload | 用户信息（登录成功或需要邮箱验证时返回） |

### 响应类型（type 字段）

| 值 | 说明 |
|----|------|
| access_token | 登录完成，返回令牌 |
| email_check | 需要邮箱验证或两步验证（通过 `tfa_type` 区分） |

> **注意**：客户端代码中仅处理 `access_token` 和 `email_check` 两种响应类型。当需要 2FA 验证时，服务端返回 `type: "email_check"`，并通过 `tfa_type: "tfa_check"` 来区分 2FA 场景。参见 `flutter/lib/common/widgets/login.dart:510-516`。

### tfa_type 字段（当 type 为 email_check 时使用）

| 值 | 说明 |
|----|------|
| email_check（或 null） | 需要邮箱验证码 |
| tfa_check | 需要两步验证码（2FA） |

### UserPayload 结构

| 字段 | 类型 | 说明 | 客户端实际使用 |
|------|------|------|----------------|
| name | string | 用户名 | ✅ 使用（存储到本地、显示用户名） |
| display_name | string | 显示名称 | ✅ 使用（存储到本地、显示名称） |
| avatar | string | 头像 URL | ✅ 使用（存储到本地、显示头像） |
| email | string | 邮箱地址 | ⚠️ 客户端解析但仅用于验证码对话框展示，不持久化 |
| note | string | 备注 | ⚠️ 仅解析，客户端未实际使用 |
| status | int | 用户状态 | ✅ 使用（判断用户状态：0=禁用, 1=正常, -1=未验证） |
| is_admin | bool | 是否为管理员 | ✅ 使用（存储到本地状态） |
| verifier | string? | 验证者信息 | ⚠️ 仅在 Web 平台存储到本地（`isWeb` 条件），其他平台未使用；Rust 端 UserPayload 未定义此字段，反序列化时自动忽略 |
| info | UserInfo | 用户附加信息 | ⚠️ 服务端返回此字段，但客户端 Flutter 代码中 UserPayload 未解析 `info` 字段（代码注释 "to-do: The UserPayload does not contain all the fields of the user"），仅 Rust 端 OIDC 流程中存储部分字段 |
| third_auth_type | string? | 第三方认证类型 | ⚠️ 仅 Rust 端定义并反序列化，客户端未使用 |

### UserInfo 结构

> **注意**：Rust 端 `UserInfo` 的 `settings` 字段使用了 `#[serde(default, flatten)]` 属性（参见 `src/hbbs_http/account.rs:56`），这意味着 `UserSettings` 的字段在 JSON 序列化/反序列化时会被**展开到 `UserInfo` 的同一层级**，而非嵌套在 `settings` 对象中。因此，实际 JSON 中 `email_verification` 和 `email_alarm_notification` 与 `login_device_whitelist`、`other` 同级，不存在 `settings` 嵌套对象。

| 字段 | 类型 | 说明 | 客户端实际使用 |
|------|------|------|----------------|
| settings | UserSettings | 用户设置（flatten，实际 JSON 中子字段与同级字段平铺） | ⚠️ 仅 Rust 端定义和反序列化，客户端未使用 |
| login_device_whitelist | WhitelistItem[] | 登录设备白名单 | ⚠️ 仅 Rust 端定义和反序列化，客户端未使用 |
| other | HashMap<String, String> | 其他附加信息 | ⚠️ 仅 Rust 端定义和反序列化，客户端未使用 |

### WhitelistItem 结构

| 字段 | 类型 | 说明 |
|------|------|------|
| data | string | 白名单数据（IP 或设备 UUID） |
| info | DeviceInfo | 设备信息 |
| exp | u64 | 过期时间戳 |

### UserSettings 结构

| 字段 | 类型 | 说明 | 客户端实际使用 |
|------|------|------|----------------|
| email_verification | bool | 邮箱验证是否开启 | ⚠️ 仅 Rust 端定义和反序列化，客户端未使用 |
| email_alarm_notification | bool | 邮箱告警通知是否开启 | ⚠️ 仅 Rust 端定义和反序列化，客户端未使用 |

### UserStatus 枚举

| 值 | 说明 |
|----|------|
| 0 | 已禁用（Disabled） |
| 1 | 正常（Normal） |
| -1 | 未验证（Unverified） |

## 错误响应

```json
{"error": "error message"}
```

## 相关代码位置
- `flutter/lib/common/hbbs/hbbs.dart` L10-L20（认证类型与响应类型常量定义）
- `flutter/lib/common/hbbs/hbbs.dart` L26-L75（UserPayload 解析）
- `flutter/lib/common/hbbs/hbbs.dart` L133-L197（LoginRequest 构造与 LoginResponse 解析）
- `flutter/lib/models/user_model.dart` L178-L220（登录 API 调用与认证流程处理）
- `flutter/lib/common/widgets/login.dart` L456-L685（登录对话框与流程控制）
- `flutter/lib/common/widgets/login.dart` L687-L796（验证码对话框）
- `src/hbbs_http/account.rs` L30-L108（Rust 端数据结构定义：DeviceInfo、UserPayload、AuthBody 等）
- `src/ui_interface.rs` L50-L55、L1295-L1307（LoginDeviceInfo 定义与构造）

---

## 登录流程详解与示例

### 流程一：账号密码登录（无验证）

最简单的登录场景，一步完成。

```
客户端                                    服务端
  |                                         |
  |--- POST /api/login ------------------>  |
  |    {type: "account", username,          |
  |     password, id, uuid, autoLogin,     |
  |     deviceInfo}                         |
  |                                         |
  |<-- {type: "access_token",              |
  |     access_token, user} ---------------|
  |                                         |
```

**请求：**

```bash
curl -X POST https://api.example.com/api/login \
  -H "Content-Type: application/json" \
  -d '{
    "username": "user@example.com",
    "password": "mypassword",
    "id": "123456789",
    "uuid": "dXVpZC1zdHJpbmc=",
    "autoLogin": true,
    "type": "account",
    "deviceInfo": {
      "os": "linux",
      "type": "client",
      "name": "my-hostname"
    }
  }'
```

**响应（登录成功）：**

```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "type": "access_token",
  "user": {
    "name": "user@example.com",
    "display_name": "John Doe",
    "avatar": "https://cdn.example.com/avatar.png",
    "email": "user@example.com",
    "note": "",
    "status": 1,
    "is_admin": false,
    "info": {
      "email_verification": true,
      "email_alarm_notification": false,
      "login_device_whitelist": [],
      "other": {}
    }
  }
}
```

### 流程二：账号密码登录 → 邮箱验证

用户开启了邮箱验证，首次登录需要验证邮箱。

```
客户端                                    服务端
  |                                         |
  |--- POST /api/login ------------------>  |
  |    {type: "account", username,          |
  |     password, id, uuid, autoLogin,     |
  |     deviceInfo}                         |
  |                                         |
  |<-- {type: "email_check",               |
  |     tfa_type: "email_check",           |
  |     secret: "...", user} --------------|
  |                                         |
  |  （用户输入邮箱验证码）                   |
  |                                         |
  |--- POST /api/login ------------------>  |
  |    {type: "email_code",                 |
  |     verificationCode: "123456",        |
  |     secret: "...", username,           |
  |     id, uuid, autoLogin, deviceInfo}   |
  |                                         |
  |<-- {type: "access_token",              |
  |     access_token, user} ---------------|
  |                                         |
```

**第一步请求（账号密码登录）：**

```bash
curl -X POST https://api.example.com/api/login \
  -H "Content-Type: application/json" \
  -d '{
    "username": "user@example.com",
    "password": "mypassword",
    "id": "123456789",
    "uuid": "dXVpZC1zdHJpbmc=",
    "autoLogin": true,
    "type": "account",
    "deviceInfo": {
      "os": "linux",
      "type": "client",
      "name": "my-hostname"
    }
  }'
```

**第一步响应（需要邮箱验证）：**

```json
{
  "type": "email_check",
  "tfa_type": "email_check",
  "secret": "a1b2c3d4e5f6",
  "user": {
    "name": "user@example.com",
    "display_name": "John Doe",
    "avatar": "",
    "email": "u***@example.com",
    "note": "",
    "status": 1,
    "is_admin": false
  }
}
```

> 客户端根据 `type: "email_check"` + `tfa_type: "email_check"`（或 `tfa_type` 为 null）判断为邮箱验证流程，弹出邮箱验证码输入框。

**第二步请求（提交邮箱验证码）：**

```bash
curl -X POST https://api.example.com/api/login \
  -H "Content-Type: application/json" \
  -d '{
    "username": "user@example.com",
    "id": "123456789",
    "uuid": "dXVpZC1zdHJpbmc=",
    "autoLogin": true,
    "type": "email_code",
    "verificationCode": "123456",
    "secret": "a1b2c3d4e5f6",
    "deviceInfo": {
      "os": "linux",
      "type": "client",
      "name": "my-hostname"
    }
  }'
```

**第二步响应（登录成功）：**

```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "type": "access_token",
  "user": {
    "name": "user@example.com",
    "display_name": "John Doe",
    "avatar": "https://cdn.example.com/avatar.png",
    "email": "user@example.com",
    "note": "",
    "status": 1,
    "is_admin": false,
    "info": {
      "email_verification": true,
      "email_alarm_notification": false,
      "login_device_whitelist": [],
      "other": {}
    }
  }
}
```

### 流程三：账号密码登录 → 两步验证（2FA）

用户开启了 2FA，登录时需要输入两步验证码。

```
客户端                                    服务端
  |                                         |
  |--- POST /api/login ------------------>  |
  |    {type: "account", username,          |
  |     password, id, uuid, autoLogin,     |
  |     deviceInfo}                         |
  |                                         |
  |<-- {type: "email_check",               |
  |     tfa_type: "tfa_check",             |
  |     secret: "...", user} --------------|
  |                                         |
  |  （用户输入 2FA 验证码）                  |
  |                                         |
  |--- POST /api/login ------------------>  |
  |    {type: "email_code",                 |
  |     verificationCode: "654321",        |
  |     tfaCode: "654321",                 |
  |     secret: "...", username,           |
  |     id, uuid, autoLogin, deviceInfo}   |
  |                                         |
  |<-- {type: "access_token",              |
  |     access_token, user} ---------------|
  |                                         |
```

> **重要**：2FA 验证码提交时，`type` 字段使用的是 `"email_code"`（不是 `"tfa_code"`）。客户端代码中 `verificationCode` 和 `tfaCode` 两个字段均被设置为同一个验证码值同时发送（参见 `flutter/lib/common/widgets/login.dart:700-708`），服务端通过 `tfaCode` 字段识别 2FA 验证码。

**第一步请求（账号密码登录）：** 同流程二第一步。

**第一步响应（需要 2FA 验证）：**

```json
{
  "type": "email_check",
  "tfa_type": "tfa_check",
  "secret": "JBSWY3DPEHPK3PXP",
  "user": {
    "name": "user@example.com",
    "display_name": "John Doe",
    "avatar": "",
    "email": "user@example.com",
    "note": "",
    "status": 1,
    "is_admin": false
  }
}
```

> 客户端根据 `type: "email_check"` + `tfa_type: "tfa_check"` 判断为 2FA 验证流程，弹出 2FA 验证码输入框。

**第二步请求（提交 2FA 验证码）：**

```bash
curl -X POST https://api.example.com/api/login \
  -H "Content-Type: application/json" \
  -d '{
    "username": "user@example.com",
    "id": "123456789",
    "uuid": "dXVpZC1zdHJpbmc=",
    "autoLogin": true,
    "type": "email_code",
    "verificationCode": "654321",
    "tfaCode": "654321",
    "secret": "JBSWY3DPEHPK3PXP",
    "deviceInfo": {
      "os": "linux",
      "type": "client",
      "name": "my-hostname"
    }
  }'
```

**第二步响应（登录成功）：** 同流程二第二步。

### 流程四：OIDC 第三方登录

通过 OIDC（如 GitHub、Google 等）进行第三方认证登录。此流程不走 `/api/login`，而是通过 OIDC 认证接口完成。

```
客户端                                    服务端
  |                                         |
  |--- POST /api/oidc/auth -------------->  |
  |    {op: "github", id, uuid,            |
  |     deviceInfo}                         |
  |                                         |
  |<-- {code: "...",                       |
  |     url: "https://..."} --------------|
  |                                         |
  |  （浏览器打开 URL，用户授权）              |
  |                                         |
  |--- GET /api/oidc/auth-query --------->  |
  |    ?code=...&id=...&uuid=...           |
  |                                         |
  |<-- {type: "access_token",              |
  |     access_token, user} ---------------|
  |                                         |
```

> OIDC 流程不在本文档详细描述，仅供参考。认证完成后返回的 `AuthBody` 结构与 `/api/login` 的成功响应格式一致（`access_token`、`type`、`user`）。

---

## 字段使用情况汇总

### 请求字段

| 字段 | 账号密码登录 | 邮箱验证码提交 | 2FA 验证码提交 |
|------|-------------|---------------|---------------|
| username | ✅ 必填 | ✅ 提供 | ✅ 提供 |
| password | ✅ 必填 | ❌ 不提供 | ❌ 不提供 |
| id | ✅ 必填 | ✅ 必填 | ✅ 必填 |
| uuid | ✅ 必填 | ✅ 必填 | ✅ 必填 |
| autoLogin | ✅ 提供 | ✅ 提供 | ✅ 提供 |
| type | `"account"` | `"email_code"` | `"email_code"` |
| verificationCode | ❌ | ✅ 邮箱验证码 | ✅ 同 tfaCode 值（冗余发送） |
| tfaCode | ❌ | ❌ | ✅ 2FA 验证码 |
| secret | ❌ | ✅ 上一步返回 | ✅ 上一步返回 |
| deviceInfo | ✅ 自动填充 | ✅ 自动填充 | ✅ 自动填充 |

### 响应字段

| 字段 | 登录成功 | 需要邮箱验证 | 需要 2FA |
|------|---------|-------------|---------|
| access_token | ✅ 令牌 | ❌ | ❌ |
| type | `"access_token"` | `"email_check"` | `"email_check"` |
| tfa_type | ❌ | `"email_check"` 或 null | `"tfa_check"` |
| secret | ❌ | ✅ 验证密钥 | ✅ TFA 密钥 |
| user | ✅ 完整用户信息 | ✅ 部分用户信息 | ✅ 部分用户信息 |
