import {
  readRendezvousReply,
  validatePunchHoleRequest,
  validateRequestRelay,
} from './web-client-protocol';

function varint(value: number): Buffer {
  const bytes: number[] = [];
  do {
    bytes.push((value & 127) | (value >= 128 ? 128 : 0));
    value = Math.floor(value / 128);
  } while (value);
  return Buffer.from(bytes);
}
function text(field: number, value: string | Buffer): Buffer {
  const bytes = typeof value === 'string' ? Buffer.from(value) : value;
  return Buffer.concat([varint(field * 8 + 2), varint(bytes.length), bytes]);
}
function integer(field: number, value: number): Buffer {
  return Buffer.concat([varint(field * 8), varint(value)]);
}
const binding = {
  targetId: '123456789',
  kind: 'desktop' as const,
  serverPublicKey: Buffer.alloc(32, 1).toString('base64'),
  relayUuid: '12345678-1234-1234-1234-123456789012',
};
const punchBody = Buffer.concat([
  text(1, binding.targetId),
  integer(2, 2),
  text(3, binding.serverPublicKey),
  text(6, '1.4.9'),
  integer(8, 1),
]);
const relayBody = Buffer.concat([
  text(1, binding.targetId),
  text(2, binding.relayUuid),
  text(6, binding.serverPublicKey),
]);

describe('Web client strict protocol binding', () => {
  it('accepts real proto3 omitted desktop defaults and FILE_TRANSFER=1', () => {
    expect(() =>
      validatePunchHoleRequest(text(8, punchBody), binding),
    ).not.toThrow();
    expect(() =>
      validateRequestRelay(text(18, relayBody), binding),
    ).not.toThrow();
    const file = { ...binding, kind: 'file' as const };
    expect(() =>
      validatePunchHoleRequest(
        text(8, Buffer.concat([punchBody, integer(4, 1)])),
        file,
      ),
    ).not.toThrow();
    expect(() =>
      validateRequestRelay(
        text(18, Buffer.concat([relayBody, integer(7, 1)])),
        file,
      ),
    ).not.toThrow();
  });

  it.each([
    ['different target', { ...binding, targetId: '987654321' }],
    ['different key', { ...binding, serverPublicKey: 'different' }],
    ['file purpose', { ...binding, kind: 'file' as const }],
  ])('rejects %s before forwarding', (_label, other) => {
    expect(() => validatePunchHoleRequest(text(8, punchBody), other)).toThrow();
    expect(() => validateRequestRelay(text(18, relayBody), other)).toThrow();
  });

  it.each([
    [
      'duplicate nested ID',
      text(8, Buffer.concat([punchBody, text(1, binding.targetId)])),
    ],
    [
      'duplicate oneof',
      Buffer.concat([text(8, punchBody), text(8, punchBody)]),
    ],
    [
      'different oneof',
      Buffer.concat([text(8, punchBody), text(18, relayBody)]),
    ],
    [
      'unknown field',
      text(8, Buffer.concat([punchBody, text(12, 'webrtc://offer')])),
    ],
    ['token field', text(8, Buffer.concat([punchBody, text(5, 'secret')]))],
    [
      'PORT_FORWARD purpose',
      text(8, Buffer.concat([punchBody, integer(4, 2)])),
    ],
    [
      'invalid boolean',
      text(8, Buffer.concat([punchBody.subarray(0, -2), integer(8, 2)])),
    ],
    ['force relay missing', text(8, punchBody.subarray(0, -2))],
    ['truncated body', text(8, punchBody).subarray(0, -1)],
    ['wrong wire type', integer(8, 1)],
    ['overlong varint', Buffer.from([0xc2, 0x00, 0x00])],
    ['overflowing varint', Buffer.from([0xff, 0xff, 0xff, 0xff, 0x10])],
    [
      'invalid UTF8',
      text(
        8,
        Buffer.concat([text(1, Buffer.from([0xff])), punchBody.subarray(11)]),
      ),
    ],
    ['oversized message', Buffer.alloc(16 * 1024 + 1)],
  ])('rejects ambiguous or malformed %s', (_label, bytes) => {
    expect(() => validatePunchHoleRequest(bytes, binding)).toThrow();
  });

  it('rejects unbound or cross-session relay UUID and alternate relay options', () => {
    expect(() =>
      validateRequestRelay(text(18, relayBody), {
        ...binding,
        relayUuid: undefined,
      }),
    ).toThrow();
    expect(() =>
      validateRequestRelay(text(18, relayBody), {
        ...binding,
        relayUuid: 'another-session',
      }),
    ).toThrow();
    expect(() =>
      validateRequestRelay(
        text(18, Buffer.concat([relayBody, text(4, 'attacker.invalid:21117')])),
        binding,
      ),
    ).toThrow();
  });

  it('does not normalize a UTF-8 BOM into a different native target ID', () => {
    const differentId = Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from(binding.targetId),
    ]);
    const message = text(
      8,
      Buffer.concat([
        text(1, differentId),
        text(3, binding.serverPublicKey),
        integer(8, 1),
      ]),
    );
    expect(() => validatePunchHoleRequest(message, binding)).toThrow();
  });

  it('binds one UUID only from a valid official RelayResponse', () => {
    const reply = text(
      19,
      Buffer.concat([
        text(2, binding.relayUuid),
        text(5, Buffer.alloc(100)),
        text(7, '1.5.0'),
      ]),
    );
    expect(readRendezvousReply(reply)).toEqual({
      refused: false,
      relayUuid: binding.relayUuid,
    });
    expect(() =>
      readRendezvousReply(
        text(
          19,
          Buffer.concat([
            text(2, binding.relayUuid),
            text(2, binding.relayUuid),
          ]),
        ),
      ),
    ).toThrow();
    expect(() =>
      readRendezvousReply(
        text(
          19,
          Buffer.concat([
            text(2, binding.relayUuid),
            text(4, binding.targetId),
            text(5, Buffer.alloc(100)),
          ]),
        ),
      ),
    ).toThrow();
    expect(() =>
      readRendezvousReply(text(19, text(2, 'not-a-uuid'))),
    ).toThrow();
  });

  it('preserves official offline/refusal results and rejects successful direct replies', () => {
    expect(readRendezvousReply(text(11, integer(3, 2)))).toEqual({
      refused: true,
    });
    expect(readRendezvousReply(text(11, Buffer.alloc(0)))).toEqual({
      refused: true,
    });
    expect(readRendezvousReply(text(19, text(6, 'denied')))).toEqual({
      refused: true,
    });
    expect(() =>
      readRendezvousReply(text(11, text(1, Buffer.from([1, 2, 3])))),
    ).toThrow();
    expect(() =>
      readRendezvousReply(
        Buffer.concat([
          text(11, integer(3, 2)),
          text(19, text(2, binding.relayUuid)),
        ]),
      ),
    ).toThrow();
  });
});
