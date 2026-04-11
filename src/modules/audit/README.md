# 审计模块 (Audit Module)

本模块提供连接审计和文件审计功能，用于记录和跟踪RustDesk客户端的连接和文件传输活动。

## 数据库适配

本模块支持多种数据库类型，自动根据数据库类型进行适配：

- **SQLite**: 使用 `varchar` 和 `int` 类型存储枚举值
- **PostgreSQL/MySQL**: 可以使用 `enum` 类型存储枚举值

当前实现使用 SQLite 兼容的类型（`varchar` 和 `int`），确保在所有数据库上都能正常工作。

## 功能特性

- **连接审计** (`/audit/conn`): 记录设备连接、断开和授权事件
- **文件审计** (`/audit/file`): 记录文件传输活动（发送/接收）
- **告警审计** (`/audit/alarm`): 记录安全告警事件

## 数据库表结构

### connection_audits (连接审计表)
- `id`: 主键
- `deviceId`: 设备ID
- `deviceUuid`: 设备UUID (base64编码)
- `connId`: 连接ID (可选)
- `sessionId`: 会话ID (可选)
- `ip`: 客户端IP地址
- `action`: 动作类型 ('new' | 'close')
- `peerId`: 对端设备ID (可选)
- `peerName`: 对端设备名称 (可选)
- `type`: 连接类型 (0-4)
  - 0: 远程控制
  - 1: 文件传输
  - 2: 端口转发
  - 3: 摄像头
  - 4: 终端
- `createdAt`: 创建时间
- `requestedAt`: 连接发起时间（action = 'open'）
- `establishedAt`: 连接建立时间（action = 'established'）
- `closedAt`: 连接关闭时间（action = 'close'）

### file_audits (文件审计表)
- `id`: 主键
- `deviceId`: 设备ID
- `deviceUuid`: 设备UUID (base64编码)
- `peerId`: 对端设备ID
- `type`: 传输类型 (0: 发送 | 1: 接收)
- `path`: 文件路径 (可选)
- `isFile`: 是否为文件 (true/false)
- `clientIp`: 客户端IP地址
- `clientName`: 客户端名称
- `fileCount`: 文件总数
- `files`: 文件列表 (最多10个，按大小排序) - JSON格式: [['文件名', 大小], ...]
- `createdAt`: 创建时间

### alarm_audits (告警审计表)
- `id`: 主键
- `deviceId`: 设备ID
- `deviceUuid`: 设备UUID (base64编码)
- `typ`: 告警类型 (0-6)
  - 0: IP白名单违规
  - 1: 超过30次尝试
  - 2: 1分钟内6次尝试
  - 6: IPv6前缀尝试过多
- `infoId`: 告警信息中的设备ID (可选)
- `infoIp`: 告警信息中的IP地址
- `infoName`: 告警信息中的设备名称 (可选)
- `createdAt`: 创建时间

## API 接口

### 1. 连接审计接口

**端点**: `POST /audit/conn`

**请求体**:
```json
{
  "id": "设备ID",
  "uuid": "设备UUID(base64编码)",
  "conn_id": "连接ID",
  "session_id": "会话ID",
  "ip": "客户端IP地址",
  "action": "new",
  "peer": ["对端ID", "对端名称"],
  "type": 0
}
```

**触发场景**:
- 新建连接时: `action: "new"` + IP 地址 → 记录 `requestedAt` 时间
- 连接建立时: `action: ""` 或不传 → 记录 `establishedAt` 时间
- 关闭连接时: `action: "close"` → 记录 `closedAt` 时间
- 登录授权成功时: 包含 peer 信息和连接类型

**响应**:
```json
{
  "message": "连接审计记录成功",
  "status": "success",
  "data": {
    "id": 1,
    "deviceId": "设备ID",
    "deviceUuid": "设备UUID",
    "connId": "连接ID",
    "sessionId": "会话ID",
    "ip": "客户端IP地址",
    "action": "new",
    "peerId": "对端ID",
    "peerName": "对端名称",
    "type": 0,
    "createdAt": "2024-01-01T00:00:00.000Z",
    "requestedAt": "2024-01-01T00:00:00.000Z",
    "establishedAt": "2024-01-01T00:00:05.000Z",
    "closedAt": "2024-01-01T00:10:00.000Z"
  }
}
```

### 2. 文件审计接口

**端点**: `POST /audit/file`

**请求体**:
```json
{
  "id": "设备ID",
  "uuid": "设备UUID(base64编码)",
  "peer_id": "对端设备ID",
  "type": 0,
  "path": "文件路径",
  "is_file": true,
  "info": {
    "ip": "客户端IP",
    "name": "客户端名称",
    "num": 2,
    "files": [
      ["文件名1", 1024],
      ["文件名2", 2048]
    ]
  }
}
```

**触发场景**:
- 远程发送文件: `type: 0`
- 远程接收文件: `type: 1`
- 剪贴板文件传输

**响应**:
```json
{
  "message": "文件审计记录成功",
  "status": "success",
  "data": {
    "id": 1,
    "deviceId": "设备ID",
    "deviceUuid": "设备UUID",
    "peerId": "对端设备ID",
    "type": 0,
    "path": "文件路径",
    "isFile": true,
    "clientIp": "客户端IP",
    "clientName": "客户端名称",
    "fileCount": 2,
    "files": [
      ["文件名1", 1024],
      ["文件名2", 2048]
    ],
    "createdAt": "2024-01-01T00:00:00.000Z"
  }
}
```

### 3. 告警审计接口

**端点**: `POST /audit/alarm`

**请求体**:
```json
{
  "id": "设备ID",
  "uuid": "设备UUID(base64编码)",
  "typ": 0,
  "info": {
    "ip": "192.168.1.1",
    "reason": "IP whitelist violation"
  }
}
```

**告警类型**:
- `0`: IP白名单违规
- `1`: 超过30次尝试
- `2`: 1分钟内6次尝试
- `6`: IPv6前缀尝试过多

**触发场景**:
- IP白名单违规检测
- 登录尝试次数超限
- 短时间内多次尝试
- IPv6前缀异常访问

**响应**:
```json
{
  "message": "告警审计记录成功",
  "status": "success",
  "data": {
    "id": 1,
    "deviceId": "设备ID",
    "deviceUuid": "设备UUID",
    "typ": 0,
    "info": {
      "ip": "192.168.1.1",
      "reason": "IP whitelist violation"
    },
    "createdAt": "2024-01-01T00:00:00.000Z"
  }
}
```

## 使用示例

### 使用 curl 测试连接审计

```bash
curl -X POST http://localhost:3000/audit/conn \
  -H "Content-Type: application/json" \
  -d '{
    "id": "device123",
    "uuid": "uuid123",
    "conn_id": "conn123",
    "session_id": "session123",
    "ip": "192.168.1.1",
    "action": "new",
    "peer": ["peer123", "peerName"],
    "type": 0
  }'
```

### 使用 curl 测试文件审计

```bash
curl -X POST http://localhost:3000/audit/file \
  -H "Content-Type: application/json" \
  -d '{
    "id": "device123",
    "uuid": "uuid123",
    "peer_id": "peer123",
    "type": 0,
    "path": "/path/to/file",
    "is_file": true,
    "info": {
      "ip": "192.168.1.1",
      "name": "clientName",
      "num": 2,
      "files": [
        ["file1.txt", 1024],
        ["file2.txt", 2048]
      ]
    }
  }'
```

### 使用 curl 测试告警审计

```bash
curl -X POST http://localhost:3000/audit/alarm \
  -H "Content-Type: application/json" \
  -d '{
    "id": "device123",
    "uuid": "uuid123",
    "typ": 0,
    "info": {
      "ip": "192.168.1.1",
      "reason": "IP whitelist violation"
    }
  }'
```

## 注意事项

1. **文件数量限制**: 文件审计接口最多记录10个文件（按大小排序）
2. **验证**: 所有请求都会经过自动验证，确保数据格式正确
3. **时间戳**: 所有审计记录都会自动记录创建时间
4. **数据库**: 使用SQLite数据库，数据存储在 `rustdesk.db` 文件中

## 测试

运行审计模块的测试:

```bash
npm run test -- audit
```

运行所有测试:

```bash
npm run test
```

## 相关文件

- `audit.controller.ts`: 控制器层，处理HTTP请求
- `audit.service.ts`: 服务层，处理业务逻辑
- `audit.module.ts`: 模块配置
- `dto/`: 数据传输对象定义
- `entities/`: 数据库实体定义
- `audit.controller.spec.ts`: 单元测试
