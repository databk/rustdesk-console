# Database Adaptation Notes

## Current Implementation

To ensure it works correctly on SQLite, the audit module uses SQLite-compatible data types:

### Connection Audit (ConnectionAudit)
- `action`: Uses `varchar(10)` to store ('new' | 'close')
- `type`: Uses `int` to store (0-4)

### File Audit (FileAudit)
- `type`: Uses `int` to store (0: send | 1: receive)

## Configuring for Different Databases

If you use a database that supports the ENUM type (such as PostgreSQL or MySQL), you can modify the entity definitions to use native ENUM types.

### PostgreSQL Configuration Example

Modify `src/audit/entities/connection-audit.entity.ts`:

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

Modify `src/audit/entities/file-audit.entity.ts`:

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

### Updating DTO Validation

If you use enum, the DTO files need to be updated:

Modify `src/audit/dto/connection-audit.dto.ts`:

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

Modify `src/audit/dto/file-audit.dto.ts`:

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

## Summary

- **Current implementation**: Uses SQLite-compatible types, ensuring it works on all databases
- **PostgreSQL/MySQL**: Can use native ENUM types for better type safety and performance
- **Migration**: To switch databases, only the entity definitions and the corresponding DTOs need to be changed

The current implementation has been thoroughly tested and can be used directly in a SQLite environment.
