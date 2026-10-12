// 字段来自官方 vendor/rustdesk-protocol/rendezvous.proto；只解析绑定授权所需的明文握手。
// 不采用 protobuf 的重复字段“最后一个胜出”规则，避免网关与原生服务解释不同。
type WireValue = number | Buffer;
type Field = { wire: 0 | 2; max?: number };
type Schema = Readonly<Record<number, Field>>;

const MAX_HANDSHAKE_BYTES = 16 * 1024;
const textDecoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

function invalid(): never {
  throw new Error('Invalid web client handshake');
}

function readVarint(bytes: Buffer, cursor: { offset: number }): number {
  let value = 0;
  for (let i = 0; i < 5; i++) {
    if (cursor.offset >= bytes.length) return invalid();
    const byte = bytes[cursor.offset++];
    if (i === 4 && byte > 15) return invalid();
    value += (byte & 127) * 2 ** (7 * i);
    if (!(byte & 128)) {
      if (i && byte === 0) return invalid();
      return value;
    }
  }
  return invalid();
}

function fields(bytes: Buffer, schema: Schema): Map<number, WireValue> {
  if (bytes.length > MAX_HANDSHAKE_BYTES) return invalid();
  const values = new Map<number, WireValue>();
  const cursor = { offset: 0 };
  while (cursor.offset < bytes.length) {
    const tag = readVarint(bytes, cursor);
    const field = Math.floor(tag / 8);
    const definition = schema[field];
    if (!definition || tag % 8 !== definition.wire || values.has(field))
      return invalid();
    if (definition.wire === 0) {
      const value = readVarint(bytes, cursor);
      if (definition.max !== undefined && value > definition.max)
        return invalid();
      values.set(field, value);
    } else {
      const length = readVarint(bytes, cursor);
      if (
        length > (definition.max ?? MAX_HANDSHAKE_BYTES) ||
        length > bytes.length - cursor.offset
      )
        return invalid();
      values.set(field, bytes.subarray(cursor.offset, cursor.offset + length));
      cursor.offset += length;
    }
  }
  return values;
}

function string(values: Map<number, WireValue>, field: number): string {
  const value = values.get(field);
  if (value === undefined) return '';
  if (!Buffer.isBuffer(value)) return invalid();
  return textDecoder.decode(value);
}

function number(values: Map<number, WireValue>, field: number): number {
  const value = values.get(field) ?? 0;
  if (typeof value !== 'number') return invalid();
  return value;
}

function envelope(bytes: Buffer, allowed: number[]): [number, Buffer] {
  const schema = Object.fromEntries(
    allowed.map((field) => [field, { wire: 2 }]),
  ) as Schema;
  const values = fields(bytes, schema);
  if (values.size !== 1) return invalid();
  const [field, value] = [...values.entries()][0];
  if (!Buffer.isBuffer(value)) return invalid();
  return [field, value];
}

export interface ProtocolBinding {
  targetId: string;
  kind: 'desktop' | 'file';
  serverPublicKey: string;
  relayUuid?: string;
}

export function validatePunchHoleRequest(
  bytes: Buffer,
  binding: ProtocolBinding,
): void {
  const [, body] = envelope(bytes, [8]);
  // FILE_TRANSFER=1；2 是 PORT_FORWARD，不能用作文件会话。
  const values = fields(body, {
    1: { wire: 2, max: 256 },
    2: { wire: 0, max: 2 },
    3: { wire: 2, max: 128 },
    4: { wire: 0, max: 1 },
    6: { wire: 2, max: 64 },
    8: { wire: 0, max: 1 },
  });
  if (
    string(values, 1) !== binding.targetId ||
    string(values, 3) !== binding.serverPublicKey ||
    number(values, 4) !== (binding.kind === 'file' ? 1 : 0) ||
    number(values, 8) !== 1
  )
    return invalid();
  string(values, 6);
}

export function validateRequestRelay(
  bytes: Buffer,
  binding: ProtocolBinding,
): void {
  const [, body] = envelope(bytes, [18]);
  const values = fields(body, {
    1: { wire: 2, max: 256 },
    2: { wire: 2, max: 36 },
    6: { wire: 2, max: 128 },
    7: { wire: 0, max: 1 },
  });
  if (
    !binding.relayUuid ||
    string(values, 1) !== binding.targetId ||
    string(values, 2) !== binding.relayUuid ||
    string(values, 6) !== binding.serverPublicKey ||
    number(values, 7) !== (binding.kind === 'file' ? 1 : 0)
  )
    return invalid();
}

export type RendezvousReply =
  { refused: true } | { refused: false; relayUuid: string };

export function readRendezvousReply(bytes: Buffer): RendezvousReply {
  const [field, body] = envelope(bytes, [11, 19]);
  if (field === 11) {
    // 仅保留原生的离线/拒绝答复；直连成功或其它传输不适用于此网关。
    const values = fields(body, {
      3: { wire: 0, max: 4 },
      4: { wire: 2, max: 2048 },
      7: { wire: 2, max: 256 },
      8: { wire: 0 },
    });
    if (![0, 2, 3, 4].includes(number(values, 3))) return invalid();
    string(values, 4);
    string(values, 7);
    return { refused: true };
  }
  const values = fields(body, {
    1: { wire: 2, max: 128 },
    2: { wire: 2, max: 36 },
    3: { wire: 2, max: 2048 },
    4: { wire: 2, max: 256 },
    5: { wire: 2, max: 4096 },
    6: { wire: 2, max: 256 },
    7: { wire: 2, max: 64 },
    9: { wire: 0 },
    10: { wire: 2, max: 128 },
    11: { wire: 0, max: 65535 },
  });
  if (values.has(4) && values.has(5)) return invalid();
  for (const field of [3, 4, 6, 7]) string(values, field);
  if (string(values, 6)) return { refused: true };
  const relayUuid = string(values, 2);
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      relayUuid,
    )
  )
    return invalid();
  return { refused: false, relayUuid };
}
