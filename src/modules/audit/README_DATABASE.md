# 数据库适配说明

## 当前实现

为了确保在 SQLite 数据库上正常工作，审计模块使用了 SQLite 兼容的数据类型：

### 连接审计 (ConnectionAudit)
- `action`: 使用 `varchar(10)` 存储 ('new' | 'close')
- `type`: 使用 `int` 存储 (0-4)

### 文件审计 (FileAudit)
- `type`: 使用 `int` 存储 (0: 发送 | 1: 接收)

## 为不同数据库配置

如果您使用支持 ENUM 类型的数据库（如 PostgreSQL 或 MySQL），可以修改实体定义以使用原生 ENUM 类型。

### PostgreSQL 配置示例

修改 `src/audit/entities/connection-audit.entity.ts`:

```typescript
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

export enum ConnAction {
  NEW = 'new',
  CLOSE = 'close',
}

export enum ConnType {
  REMOTE_CONTROL = 0,
  FILE_TRANSFER = 1,
  PORT_FORWARD = 2,
  CAMERA = 3,
  TERMINAL = 4,
}

@Entity('connection_audits')
export class ConnectionAudit {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 255 })
  deviceId: string;

  @Column({ type: 'text' })
  deviceUuid: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  connId: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  sessionId: string | null;

  @Column({ type: 'varchar', length: 45 })
  ip: string;

  @Column({
    type: 'enum',
    enum: ConnAction,
  })
  action: ConnAction;

  @Column({ type: 'varchar', length: 255, nullable: true })
  peerId: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  peerName: string | null;

  @Column({
    type: 'enum',
    enum: ConnType,
    nullable: true,
  })
  type: ConnType | null;

  @CreateDateColumn()
  createdAt: Date;
}
```

修改 `src/audit/entities/file-audit.entity.ts`:

```typescript
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

export enum FileAuditType {
  SEND = 0,
  RECEIVE = 1,
}

@Entity('file_audits')
export class FileAudit {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 255 })
  deviceId: string;

  @Column({ type: 'text' })
  deviceUuid: string;

  @Column({ type: 'varchar', length: 255 })
  peerId: string;

  @Column({
    type: 'enum',
    enum: FileAuditType,
  })
  type: FileAuditType;

  @Column({ type: 'text', nullable: true })
  path: string | null;

  @Column({ type: 'boolean' })
  isFile: boolean;

  @Column({ type: 'varchar', length: 45 })
  clientIp: string;

  @Column({ type: 'varchar', length: 255 })
  clientName: string;

  @Column({ type: 'int' })
  fileCount: number;

  @Column({ type: 'json' })
  files: Array<[string, number]>;

  @CreateDateColumn()
  createdAt: Date;
}
```

### 更新 DTO 验证

如果使用 enum，需要更新 DTO 文件：

修改 `src/audit/dto/connection-audit.dto.ts`:

```typescript
import { IsString, IsEnum, IsOptional, IsArray, IsInt, Min, Max } from 'class-validator';
import { ConnAction, ConnType } from '../entities/connection-audit.entity';

export class ConnectionAuditDto {
  @IsString()
  id: string;

  @IsString()
  uuid: string;

  @IsString()
  @IsOptional()
  connId?: string;

  @IsString()
  @IsOptional()
  sessionId?: string;

  @IsString()
  ip: string;

  @IsEnum(ConnAction)
  action: ConnAction;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  peer?: string[];

  @IsInt()
  @Min(0)
  @Max(4)
  @IsOptional()
  type?: ConnType;
}
```

修改 `src/audit/dto/file-audit.dto.ts`:

```typescript
import { IsString, IsInt, IsBoolean, IsArray, ValidateNested, Min, Max, IsOptional, Type } from 'class-validator';
import { FileAuditType } from '../entities/file-audit.entity';

export class FileInfoDto {
  @IsString()
  ip: string;

  @IsString()
  name: string;

  @IsInt()
  @Min(0)
  num: number;

  @IsArray()
  files: Array<[string, number]>;
}

export class FileAuditDto {
  @IsString()
  id: string;

  @IsString()
  uuid: string;

  @IsString()
  peer_id: string;

  @IsInt()
  @Min(0)
  @Max(1)
  type: FileAuditType;

  @IsString()
  @IsOptional()
  path?: string;

  @IsBoolean()
  is_file: boolean;

  @ValidateNested()
  @Type(() => FileInfoDto)
  info: FileInfoDto;
}
```

## 总结

- **当前实现**: 使用 SQLite 兼容的类型，确保在所有数据库上都能工作
- **PostgreSQL/MySQL**: 可以使用原生 ENUM 类型获得更好的类型安全性和性能
- **迁移**: 如果需要切换数据库，只需修改实体定义和相应的 DTO

当前实现已经过充分测试，可以直接在 SQLite 环境中使用。
