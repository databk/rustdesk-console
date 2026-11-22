import sodium from 'libsodium-wrappers';
import { hbb } from '../protocol';
import { SessionError } from './errors';

export const SECRETBOX_TAG_BYTES = 16;
export type KxVersion = 0 | 1;
export interface VerifiedIdentity {
  publicKey: Uint8Array;
  kxVersion: number;
}
export interface KxTranscript {
  initiatorPk: Uint8Array;
  responderPk: Uint8Array;
  advertised: number;
  picked: KxVersion;
}
const validVersion = (value: number) =>
  Number.isInteger(value) && value >= 0 && value <= 0xffffffff;

export const cryptoReady = () => sodium.ready;

export function decodeServerKey(value: string): Uint8Array {
  try {
    const key = sodium.from_base64(value, sodium.base64_variants.ORIGINAL);
    if (
      key.length !== 32 ||
      sodium.to_base64(key, sodium.base64_variants.ORIGINAL) !== value
    ) {
      throw new Error();
    }
    return key;
  } catch {
    throw new SessionError('configuration');
  }
}

// Each identity is signed by the preceding trusted key: server -> peer -> box key.
export function verifyIdentity(
  signed: Uint8Array,
  signer: Uint8Array,
  targetId: string,
): VerifiedIdentity {
  try {
    if (signed.length > 4096 || signed.length < 64 || signer.length !== 32)
      throw new Error();
    const identity = hbb.IdPk.decode(sodium.crypto_sign_open(signed, signer));
    if (
      identity.id !== targetId ||
      identity.pk.length !== 32 ||
      !validVersion(identity.kxVersion)
    )
      throw new Error();
    return { publicKey: identity.pk.slice(), kxVersion: identity.kxVersion };
  } catch {
    throw new SessionError('identity');
  }
}

export function createKeyExchange(peer: VerifiedIdentity) {
  if (peer.publicKey.length !== 32 || !validVersion(peer.kxVersion))
    throw new SessionError('identity');
  const kxVersion: KxVersion = peer.kxVersion >= 1 ? 1 : 0;
  const pair = sodium.crypto_box_keypair();
  let key: Uint8Array | undefined;
  try {
    key = sodium.crypto_secretbox_keygen();
    const publicKey: hbb.IPublicKey = {
      kxVersion,
      asymmetricValue: pair.publicKey,
      symmetricValue: sodium.crypto_box_easy(
        key,
        new Uint8Array(24),
        peer.publicKey,
        pair.privateKey,
      ),
    };
    return {
      publicKey,
      kxVersion,
      cipher: SessionCipher.negotiated(key, true, {
        initiatorPk: pair.publicKey,
        responderPk: peer.publicKey,
        advertised: peer.kxVersion,
        picked: kxVersion,
      }),
    };
  } finally {
    sodium.memzero(pair.privateKey);
    if (key) sodium.memzero(key);
  }
}

export class SessionCipher {
  // Legacy peers share a key; KX 1 uses separate keys with the same wire nonces.
  private sendKey: Uint8Array | undefined;
  private receiveKey: Uint8Array | undefined;
  private sent = 0n;
  private received = 0n;

  constructor(sendKey: Uint8Array, receiveKey = sendKey) {
    if (sendKey.length !== 32 || receiveKey.length !== 32)
      throw new SessionError('encryption');
    this.sendKey = sendKey.slice();
    this.receiveKey = receiveKey.slice();
  }

  static negotiated(key: Uint8Array, initiator: boolean, t: KxTranscript) {
    if (
      key.length !== 32 ||
      t.initiatorPk.length !== 32 ||
      t.responderPk.length !== 32 ||
      !validVersion(t.advertised) ||
      (t.picked !== 0 && t.picked !== 1) ||
      t.picked > t.advertised
    )
      throw new SessionError('encryption');
    if (t.picked === 0) return new SessionCipher(key);

    // hbb_common@229b904: keyed BLAKE2b-256(domain, direction, versions LE, keys).
    const input = new Uint8Array(81);
    input.set(new TextEncoder().encode('rdkx-spl'));
    const view = new DataView(input.buffer);
    view.setUint32(9, t.advertised, true);
    view.setUint32(13, t.picked, true);
    input.set(t.initiatorPk, 17);
    input.set(t.responderPk, 49);
    let forward: Uint8Array | undefined;
    let backward: Uint8Array | undefined;
    try {
      input[8] = 1;
      forward = sodium.crypto_generichash(32, input, key);
      input[8] = 2;
      backward = sodium.crypto_generichash(32, input, key);
      return initiator
        ? new SessionCipher(forward, backward)
        : new SessionCipher(backward, forward);
    } catch {
      throw new SessionError('encryption');
    } finally {
      if (forward) sodium.memzero(forward);
      if (backward) sodium.memzero(backward);
    }
  }

  private nonce(sequence: bigint) {
    if (sequence > 0xffffffffffffffffn) throw new SessionError('encryption');
    const nonce = new Uint8Array(24);
    new DataView(nonce.buffer).setBigUint64(0, sequence, true);
    return nonce;
  }

  encrypt(data: Uint8Array): Uint8Array {
    try {
      if (!this.sendKey) throw new Error();
      return sodium.crypto_secretbox_easy(
        data,
        this.nonce(++this.sent),
        this.sendKey,
      );
    } catch {
      this.dispose();
      throw new SessionError('encryption');
    }
  }

  decrypt(data: Uint8Array): Uint8Array {
    try {
      if (!this.receiveKey || data.length < SECRETBOX_TAG_BYTES)
        throw new Error();
      return sodium.crypto_secretbox_open_easy(
        data,
        this.nonce(++this.received),
        this.receiveKey,
      );
    } catch {
      this.dispose();
      throw new SessionError('encryption');
    }
  }

  dispose() {
    if (this.sendKey) sodium.memzero(this.sendKey);
    if (this.receiveKey) sodium.memzero(this.receiveKey);
    this.sendKey = undefined;
    this.receiveKey = undefined;
  }
}

// H1 只属于当前 Worker 会话；调用方必须在失效时清零。
export async function derivePasswordHash(password: string, salt: string) {
  const salted = new TextEncoder().encode(password + salt);
  try {
    return new Uint8Array(await crypto.subtle.digest('SHA-256', salted));
  } finally {
    sodium.memzero(salted);
  }
}

export async function challengeFromHash(first: Uint8Array, challenge: string) {
  if (first.length !== 32) throw new SessionError('protocol');
  const suffix = new TextEncoder().encode(challenge);
  const input = new Uint8Array(first.length + suffix.length);
  input.set(first);
  input.set(suffix, first.length);
  try {
    return new Uint8Array(await crypto.subtle.digest('SHA-256', input));
  } finally {
    sodium.memzero(input);
  }
}

export async function passwordChallenge(
  password: string,
  salt: string,
  challenge: string,
): Promise<Uint8Array> {
  const first = await derivePasswordHash(password, salt);
  try {
    return await challengeFromHash(first, challenge);
  } finally {
    sodium.memzero(first);
  }
}
