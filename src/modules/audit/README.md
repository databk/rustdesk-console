# Audit Module

This module provides connection auditing and file auditing, used to record and track connection and file transfer activity of RustDesk clients.

## Database Adaptation

This module supports multiple database types and adapts automatically to the database type:

- **SQLite**: Uses `varchar` and `int` types to store enum values
- **PostgreSQL/MySQL**: Can use the `enum` type to store enum values

The current implementation uses SQLite-compatible types (`varchar` and `int`), ensuring it works on all databases.

## Features

- **Connection audit** (`/audit/conn`): Records device connection, disconnection and authorization events
- **File audit** (`/audit/file`): Records file transfer activity (send/receive)
- **Alarm audit** (`/audit/alarm`): Records security alarm events

## Database Table Structure

### connection_audits (connection audit table)
- `id`: Primary key
- `deviceId`: Device ID
- `deviceUuid`: Device UUID (base64 encoded)
- `connId`: Connection ID (optional)
- `sessionId`: Session ID (optional)
- `ip`: Client IP address
- `action`: Action type ('new' | 'close')
- `peerId`: Peer device ID (optional)
- `peerName`: Peer device name (optional)
- `type`: Connection type (0-4)
  - 0: Remote control
  - 1: File transfer
  - 2: Port forwarding
  - 3: Camera
  - 4: Terminal
- `createdAt`: Creation time
- `requestedAt`: Connection request time (action = 'open')
- `establishedAt`: Connection established time (action = 'established')
- `closedAt`: Connection closed time (action = 'close')
- `nonce`: Deduplication unique identifier (optional; the client sends the same value when retrying, and the server deduplicates on it)
- `connAuditRef`: Controlling-side user attribution reference (optional)
- `primaryAuth`: Primary authentication method (optional, 0=None, 1=Click, 2=TemporaryPassword, 3=PermanentPassword, 4=SwitchSides)
- `twoFactor`: Two-factor authentication method (optional, 0=None, 1=Totp, 2=TrustedDevice)

### file_audits (file audit table)
- `id`: Primary key
- `deviceId`: Device ID
- `deviceUuid`: Device UUID (base64 encoded)
- `peerId`: Peer device ID
- `connId`: Connection ID (optional)
- `type`: Transfer type (0: send | 1: receive)
- `path`: File path (optional)
- `isFile`: Whether it is a file (true/false)
- `clientIp`: Client IP address
- `clientName`: Client name
- `fileCount`: Total number of files
- `files`: File list (at most 10, sorted by size) - JSON format: [['file name', size], ...]
- `createdAt`: Creation time
- `nonce`: Deduplication unique identifier (optional; the client sends the same value when retrying, and the server deduplicates on it)

### alarm_audits (alarm audit table)
- `id`: Primary key
- `deviceId`: Device ID
- `deviceUuid`: Device UUID (base64 encoded)
- `typ`: Alarm type (0-10)
  - 0: IP whitelist violation
  - 1: More than 30 attempts
  - 2: 6 attempts within 1 minute
  - 6: Too many attempts from an IPv6 prefix
  - 7: Terminal OS login backoff
  - 8: Terminal OS login concurrency limit exceeded
  - 9: Session scope violation
  - 10: ID whitelist violation
- `infoId`: Device ID in the alarm info (optional)
- `infoIp`: IP address in the alarm info
- `infoName`: Device name in the alarm info (optional)
- `createdAt`: Creation time
- `connId`: Connection ID (optional)
- `nonce`: Deduplication unique identifier (optional; the client sends the same value when retrying, and the server deduplicates on it)
- `connAuditRef`: Controlling-side user attribution reference (optional; only carried by IP whitelist and ID whitelist alarms)

## API Endpoints

### 1. Connection Audit Endpoint

**Endpoint**: `POST /audit/conn`

**Request body**:
```json
{
  "id": "device ID",
  "uuid": "device UUID (base64 encoded)",
  "conn_id": "connection ID",
  "session_id": "session ID",
  "ip": "client IP address",
  "action": "new",
  "peer": ["peer ID", "peer name"],
  "type": 0,
  "nonce": "deduplication unique identifier (UUID)",
  "conn_audit_ref": "controlling-side user attribution reference",
  "primary_auth": 0,
  "two_factor": 0
}
```

**Trigger scenarios**:
- When a connection is created: `action: "new"` + IP address -> records the `requestedAt` time
- When a connection is established: `action: ""` or omitted -> records the `establishedAt` time
- When a connection is closed: `action: "close"` -> records the `closedAt` time
- When login authorization succeeds: includes peer info and connection type

**Response**:
```json
{
  "message": "Connection audit recorded successfully",
  "status": "success",
  "data": {
    "id": 1,
    "deviceId": "device ID",
    "deviceUuid": "device UUID",
    "connId": "connection ID",
    "sessionId": "session ID",
    "ip": "client IP address",
    "action": "new",
    "peerId": "peer ID",
    "peerName": "peer name",
    "type": 0,
    "createdAt": "2024-01-01T00:00:00.000Z",
    "requestedAt": "2024-01-01T00:00:00.000Z",
    "establishedAt": "2024-01-01T00:00:05.000Z",
    "closedAt": "2024-01-01T00:10:00.000Z"
  }
}
```

### 2. File Audit Endpoint

**Endpoint**: `POST /audit/file`

**Request body**:
```json
{
  "id": "device ID",
  "uuid": "device UUID (base64 encoded)",
  "peer_id": "peer device ID",
  "type": 0,
  "path": "file path",
  "is_file": true,
  "info": {
    "ip": "client IP",
    "name": "client name",
    "num": 2,
    "files": [
      ["file name 1", 1024],
      ["file name 2", 2048]
    ]
  }
}
```

**Trigger scenarios**:
- Sending a file remotely: `type: 0`
- Receiving a file remotely: `type: 1`
- Clipboard file transfer

**Response**:
```json
{
  "message": "File audit recorded successfully",
  "status": "success",
  "data": {
    "id": 1,
    "deviceId": "device ID",
    "deviceUuid": "device UUID",
    "peerId": "peer device ID",
    "type": 0,
    "path": "file path",
    "isFile": true,
    "clientIp": "client IP",
    "clientName": "client name",
    "fileCount": 2,
    "files": [
      ["file name 1", 1024],
      ["file name 2", 2048]
    ],
    "createdAt": "2024-01-01T00:00:00.000Z"
  }
}
```

### 3. Alarm Audit Endpoint

**Endpoint**: `POST /audit/alarm`

**Request body**:
```json
{
  "id": "device ID",
  "uuid": "device UUID (base64 encoded)",
  "typ": 0,
  "info": {
    "ip": "192.168.1.1",
    "reason": "IP whitelist violation"
  }
}
```

**Alarm types**:
- `0`: IP whitelist violation
- `1`: More than 30 attempts
- `2`: 6 attempts within 1 minute
- `6`: Too many attempts from an IPv6 prefix
- `7`: Terminal OS login backoff
- `8`: Terminal OS login concurrency limit exceeded
- `9`: Session scope violation
- `10`: ID whitelist violation

**Trigger scenarios**:
- IP whitelist violation detection
- Login attempt count exceeded
- Multiple attempts in a short time
- Abnormal access from an IPv6 prefix
- Abnormal terminal OS login
- Session scope permission violation
- ID whitelist violation detection

**Response**:
```json
{
  "message": "Alarm audit recorded successfully",
  "status": "success",
  "data": {
    "id": 1,
    "deviceId": "device ID",
    "deviceUuid": "device UUID",
    "typ": 0,
    "info": {
      "ip": "192.168.1.1",
      "reason": "IP whitelist violation"
    },
    "createdAt": "2024-01-01T00:00:00.000Z"
  }
}
```

## Usage Examples

### Testing connection audit with curl

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

### Testing file audit with curl

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

### Testing alarm audit with curl

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

## Notes

1. **File count limit**: The file audit endpoint records at most 10 files (sorted by size)
2. **Validation**: All requests are validated automatically to ensure the data format is correct
3. **Timestamps**: All audit records automatically record their creation time
4. **Database**: Uses a SQLite database; data is stored in the `rustdesk-console.db` file

## Testing

Run the audit module tests:

```bash
npm run test -- audit
```

Run all tests:

```bash
npm run test
```

## Related Files

- `audit.controller.ts`: Controller layer, handles HTTP requests
- `audit.service.ts`: Service layer, handles business logic
- `audit.module.ts`: Module configuration
- `dto/`: Data transfer object definitions
- `entities/`: Database entity definitions
- `audit.controller.spec.ts`: Unit tests
