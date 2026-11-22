import { util } from 'protobufjs/minimal';
import { imagePacketFits, imagePixels } from '../clipboard/image';
import {
  type CodecPreference,
  decodingOptions,
  supportsTrueColor,
  type VideoCapabilities,
  videoBatch,
} from '../media/video-codecs';
import { hbb } from '../protocol';
import { CHAT_LIMITS, validChat } from './chat';
import {
  challengeFromHash,
  createKeyExchange,
  cryptoReady,
  decodeServerKey,
  derivePasswordHash,
  type KxVersion,
  verifyIdentity,
} from './crypto';
import {
  DISPLAY_LIMITS,
  DisplayCatalog,
  validDisplay,
  validFrameSize,
} from './display';
import { SessionError, type SessionErrorCode } from './errors';
import {
  type IceServer,
  normalizeTargetId,
  type ServerProfile,
  validateAdvertisedRelay,
  validateProfile,
} from './profile';
import type {
  CredentialBinding,
  RememberedCredentials,
} from './remembered-credentials';
import { BinaryTransport, type SocketFactory } from './transport';
import { type RtcFactory, WebRtcOfferer } from './webrtc-transport';

export type SessionState =
  | 'idle'
  | 'connecting'
  | 'securing'
  | 'checkingCredentials'
  | 'automaticAuthenticating'
  | 'authenticating'
  | 'awaitingApproval'
  | 'connected'
  | 'closed'
  | 'failed';
export interface SessionEvents {
  authentication?: (succeeded: boolean) => void;
  security: (kxVersion: KxVersion | undefined) => void;
  state: (state: SessionState) => void;
  error: (code: SessionErrorCode) => void;
  message: (message: hbb.Message) => void | Promise<void>;
  permissions: (permissions: SessionPermissions) => void;
}
export interface SessionPermissions {
  keyboard: boolean;
  clipboard: boolean;
  audio: boolean;
  file: boolean;
  recording?: boolean;
}
export interface ViewOptions {
  quality: 'low' | 'balanced' | 'best' | 'custom';
  customQuality?: number;
  fps: number;
  remoteCursor: boolean;
}
export type VideoFlowMode = 'decoded-ack' | 'bounded-stream';

const MAX_HELD_KEYS = 256;

// 只在 Worker 的桌面/文件会话之间移交，不得发布到页面或持久化。
export interface FileAuthentication {
  profile: ServerProfile;
  targetId: string;
  sessionId: NonNullable<hbb.ILoginRequest['sessionId']>;
  salt: string;
  passwordH1: Uint8Array;
}
function randomSessionId() {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  // uint64 使用 protobuf 的 Long，禁止将完整随机值转成 number。
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  if (!util.Long) throw new SessionError('protocol');
  value ||= 1n;
  // protobuf 的 util 类型只声明 low/high；运行时为生成协议所用的同一 Long。
  return new util.Long(
    Number(value & 0xffffffffn) | 0,
    Number(value >> 32n) | 0,
    true,
  ) as NonNullable<hbb.ILoginRequest['sessionId']>;
}
function sameIceServers(
  a: IceServer[] | undefined,
  b: IceServer[] | undefined,
) {
  if (!a && !b) return true;
  if (!a || !b || a.length !== b.length) return false;
  return a.every((server, index) => {
    const other = b[index];
    return (
      server.urls === other.urls &&
      server.username === other.username &&
      server.credential === other.credential
    );
  });
}
function sameProfile(a: ServerProfile, b: ServerProfile) {
  return (
    a.idServerUrl === b.idServerUrl &&
    a.relayServerUrl === b.relayServerUrl &&
    a.serverPublicKey === b.serverPublicKey &&
    sameIceServers(a.iceServers, b.iceServers)
  );
}

// Mirrors the native controller's relay-fallback delay: an already-established
// relay result is held back this long while a WebRTC attempt is still in flight.
const RELAY_FALLBACK_DELAY_MS = 2500;

interface TransportRace {
  transport: BinaryTransport;
  kind: 'webrtc' | 'relay';
}

// WebRTC is preferred: a WebRTC success wins immediately, a relay success is
// held for the fallback delay before it is used. The first leg to settle under
// these rules wins; both failing rejects with the WebRTC error.
function raceTransports(
  webrtc: Promise<BinaryTransport>,
  relay: Promise<BinaryTransport>,
  fallbackDelayMs: number,
  webrtcEnabled: boolean,
): Promise<TransportRace> {
  if (!webrtcEnabled)
    return relay.then((transport) => ({ transport, kind: 'relay' as const }));
  return new Promise<TransportRace>((resolve, reject) => {
    let settled = false;
    let webrtcResult:
      | { ok: true; value: BinaryTransport }
      | { ok: false; error: unknown }
      | undefined;
    let relayResult:
      | { ok: true; value: BinaryTransport }
      | { ok: false; error: unknown }
      | undefined;
    let relayTimer: ReturnType<typeof setTimeout> | undefined;
    const finish = (kind: 'webrtc' | 'relay', value: BinaryTransport) => {
      if (settled) return;
      settled = true;
      if (relayTimer) clearTimeout(relayTimer);
      resolve({ transport: value, kind });
    };
    const failAll = (error: unknown) => {
      if (settled) return;
      settled = true;
      if (relayTimer) clearTimeout(relayTimer);
      reject(error);
    };
    const settle = () => {
      if (webrtcResult?.ok) {
        finish('webrtc', webrtcResult.value);
        return;
      }
      // If WebRTC has already failed, resolve relay immediately without
      // waiting for the fallback delay.
      if (relayResult?.ok && (!relayTimer || webrtcResult?.ok === false)) {
        finish('relay', relayResult.value);
        return;
      }
      if (webrtcResult && !webrtcResult.ok && relayResult && !relayResult.ok) {
        failAll(webrtcResult.error);
      }
    };
    webrtc.then(
      (value) => {
        webrtcResult = { ok: true, value };
        settle();
      },
      (error) => {
        webrtcResult = { ok: false, error };
        settle();
      },
    );
    relay.then(
      (value) => {
        relayResult = { ok: true, value };
        if (webrtcResult && !webrtcResult.ok) {
          settle();
          return;
        }
        relayTimer = setTimeout(() => {
          relayTimer = undefined;
          settle();
        }, fallbackDelayMs);
      },
      (error) => {
        relayResult = { ok: false, error };
        settle();
      },
    );
  });
}

export class RemoteSession {
  private generation = 0;
  private state: SessionState = 'idle';
  private transport?: BinaryTransport;
  private offerer?: WebRtcOfferer;
  private challenge?: { salt: string; challenge: string };
  private targetId = '';
  private profile?: ServerProfile;
  private sessionId?: NonNullable<hbb.ILoginRequest['sessionId']>;
  private passwordCandidate?: { salt: string; passwordH1: Uint8Array };
  private reuse?: FileAuthentication;
  private credentialEpoch = 0;
  private remember = false;
  private rememberedAttempted = false;
  private rememberedUsed = false;
  private peerKey = '';
  private readOnly = false;
  private clipboardEnabled = true;
  private videoBytes = 0;
  private received = 0;
  private networkDelay: number | undefined;
  private targetBitrateKbps: number | undefined;
  private testDelayReceived = 0;
  private testDelayReplied = 0;
  private lastProbeAt: number | undefined;
  private capabilities: VideoCapabilities = {
    vp9: true,
    vp8: false,
    av1: false,
    vp9_444: false,
    av1_444: false,
  };
  private codecPreference: CodecPreference = 'auto';
  private encoding: hbb.ISupportedEncoding | undefined;
  private trueColor = false;
  private chatSent = -Infinity;
  private callTimestamp = 0;
  private voiceActive = false;
  private videoDisplay = 0;
  private sasEnabled = false;
  private attempts = 0;
  private authenticationRequest = 0;
  private authTimer?: ReturnType<typeof setTimeout>;
  private permissions = {
    keyboard: true,
    clipboard: true,
    audio: true,
    file: true,
    recording: true,
  };
  private displays: hbb.IDisplayInfo[] = [];
  private displayCatalog = new DisplayCatalog();
  // Track accepted wire input separately from the DOM's focus/key state.
  private heldKeys = new Map<string, hbb.IKeyEvent>();
  private heldButtons = new Set<number>();
  private mode: 'desktop' | 'camera' = 'desktop';

  constructor(
    private readonly events: SessionEvents,
    private readonly socketFactory?: SocketFactory,
    private readonly kind: 'desktop' | 'file' = 'desktop',
    private readonly credentials?: Pick<
      RememberedCredentials,
      'load' | 'save' | 'forget' | 'cancel'
    >,
    // 调用者明确选择视频反馈；保留解码后ACK作为同条件对照与兼容回退。
    private readonly videoFlow: VideoFlowMode = 'decoded-ack',
    private readonly rtcFactory?: RtcFactory,
  ) {}

  private transition(state: SessionState) {
    this.state = state;
    this.events.state(state);
  }
  private current(generation: number) {
    if (generation !== this.generation) throw new SessionError('cancelled');
  }

  async connect(
    input: ServerProfile,
    rawId: string,
    reuse?: FileAuthentication,
    mode?: 'desktop' | 'camera',
  ) {
    this.dispose();
    this.reuse = reuse;
    this.mode = mode ?? 'desktop';
    const generation = this.generation;
    this.transition('connecting');
    this.permissions = {
      keyboard: true,
      clipboard: true,
      audio: true,
      file: true,
      recording: true,
    };
    this.attempts = 0;
    try {
      await cryptoReady();
      this.current(generation);
      const profile = validateProfile(input);
      this.targetId = normalizeTargetId(rawId);
      this.profile = profile;
      if (
        this.reuse &&
        (this.kind !== 'file' ||
          this.reuse.targetId !== this.targetId ||
          !sameProfile(this.reuse.profile, profile) ||
          this.reuse.passwordH1.length !== 32)
      ) {
        this.clearReuse();
      }
      this.sessionId = this.reuse?.sessionId ?? randomSessionId();
      // WebRTC offerer: browser P2P over ICE, optional and best-effort.
      let offerer: WebRtcOfferer | undefined;
      let webrtcSdpOffer = '';
      if (profile.iceServers?.length) {
        try {
          offerer = new WebRtcOfferer(profile.iceServers, this.rtcFactory);
          this.offerer = offerer;
          webrtcSdpOffer = await offerer.createOffer();
        } catch {
          offerer?.close();
          offerer = undefined;
          this.offerer = undefined;
          webrtcSdpOffer = '';
        }
      }
      const rendezvous = new BinaryTransport(this.socketFactory);
      this.transport = rendezvous;
      await rendezvous.open(profile.idServerUrl);
      this.current(generation);
      rendezvous.send(
        hbb.RendezvousMessage.encode({
          punchHoleRequest: {
            id: this.targetId,
            licenceKey: profile.serverPublicKey,
            connType:
              this.kind === 'file'
                ? hbb.ConnType.FILE_TRANSFER
                : this.mode === 'camera'
                  ? hbb.ConnType.VIEW_CAMERA
                  : hbb.ConnType.DEFAULT_CONN,
            natType: hbb.NatType.SYMMETRIC,
            forceRelay: true,
            version: '1.4.9',
            webrtcSdpOffer,
          },
        }).finish(),
      );
      const response = hbb.RendezvousMessage.decode(await rendezvous.receive());
      this.current(generation);
      const relay = response.relayResponse;
      if (!relay) {
        const failure = response.punchHoleResponse;
        if (!failure) throw new SessionError('protocol');
        if (failure.failure === hbb.PunchHoleResponse.Failure.LICENSE_MISMATCH)
          throw new SessionError('identity');
        if (
          failure.failure === hbb.PunchHoleResponse.Failure.LICENSE_OVERUSE ||
          failure.otherFailure
        )
          throw new SessionError('denied');
        throw new SessionError('offline');
      }
      if (relay.refuseReason) throw new SessionError('denied');
      if (!relay.uuid || !relay.version || !relay.pk)
        throw new SessionError('identity');
      validateAdvertisedRelay(relay.relayServer || '', profile.relayServerUrl);
      const peerIdentity = verifyIdentity(
        relay.pk,
        decodeServerKey(profile.serverPublicKey),
        this.targetId,
      );
      this.peerKey = Array.from(peerIdentity.publicKey, (value) =>
        value.toString(16).padStart(2, '0'),
      ).join('');
      this.transition('securing');
      const webrtcAnswer = relay.webrtcSdpAnswer || '';
      const rtc = offerer && webrtcAnswer ? offerer : undefined;
      const webrtcViable = rtc !== undefined;
      // Trickle ICE candidates ride the rendezvous socket until the DataChannel
      // opens or the relay wins and signaling is torn down.
      if (rtc) {
        rtc.onLocalIce((candidate) => {
          if (generation !== this.generation || rendezvous !== this.transport)
            return;
          try {
            rendezvous.send(
              hbb.RendezvousMessage.encode({
                iceCandidate: { candidate },
              }).finish(),
            );
          } catch {
            // signaling socket closed; the WebRTC leg fails on its own.
          }
        });
      }
      const iceBridgePromise = rtc
        ? (async () => {
            try {
              while (generation === this.generation) {
                const bytes = await rendezvous.receive();
                if (generation !== this.generation) return;
                const message = hbb.RendezvousMessage.decode(bytes);
                if (message.iceCandidate?.candidate)
                  await rtc.addRemoteIce(message.iceCandidate.candidate);
              }
            } catch {
              // rendezvous closed; the WebRTC leg fails on its own.
            }
          })()
        : undefined;
      void iceBridgePromise?.catch(() => {});
      let relayTransport: BinaryTransport | undefined;
      const relayLeg = (async (): Promise<BinaryTransport> => {
        const transport = new BinaryTransport(this.socketFactory);
        relayTransport = transport;
        await transport.open(profile.relayServerUrl);
        this.current(generation);
        transport.send(
          hbb.RendezvousMessage.encode({
            requestRelay: {
              connType:
                this.kind === 'file'
                  ? hbb.ConnType.FILE_TRANSFER
                  : this.mode === 'camera'
                    ? hbb.ConnType.VIEW_CAMERA
                    : hbb.ConnType.DEFAULT_CONN,
              id: this.targetId,
              uuid: relay.uuid,
              licenceKey: profile.serverPublicKey,
            },
          }).finish(),
        );
        return transport;
      })();
      const webrtcLeg = rtc
        ? (async (): Promise<BinaryTransport> => {
            await rtc.setRemoteAnswer(webrtcAnswer);
            await rtc.whenOpen();
            const transport = new BinaryTransport(() => rtc.asSocket());
            await transport.open('webrtc');
            this.current(generation);
            return transport;
          })()
        : new Promise<BinaryTransport>(() => {});
      let transport: BinaryTransport;
      try {
        const winner = await raceTransports(
          webrtcLeg,
          relayLeg,
          RELAY_FALLBACK_DELAY_MS,
          webrtcViable,
        );
        // The user may have cancelled while the race was pending.
        this.current(generation);
        transport = winner.transport;
        if (winner.kind === 'webrtc') {
          relayTransport?.close();
          relayTransport = undefined;
        } else {
          offerer?.close();
        }
        this.offerer = undefined;
        // Either way the signaling socket is no longer needed.
        rendezvous.close();
      } catch (error) {
        offerer?.close();
        this.offerer = undefined;
        relayTransport?.close();
        rendezvous.close();
        throw error;
      }
      this.transport = transport;
      const signed = hbb.Message.decode(await transport.receive()).signedId?.id;
      this.current(generation);
      if (!signed) throw new SessionError('identity');
      // Only the peer-signed session offer negotiates KX, not relay metadata.
      const offer = verifyIdentity(
        signed,
        peerIdentity.publicKey,
        this.targetId,
      );
      const exchange = createKeyExchange(offer);
      try {
        transport.send(
          hbb.Message.encode({ publicKey: exchange.publicKey }).finish(),
        );
        transport.secure(exchange.cipher);
      } catch (error) {
        exchange.cipher.dispose();
        throw error;
      }
      this.events.security(exchange.kxVersion);
      this.transition(
        this.kind === 'desktop' && this.credentials
          ? 'checkingCredentials'
          : 'authenticating',
      );
      this.armAuthenticationTimeout();
      while (generation === this.generation) {
        const message = hbb.Message.decode(await transport.receive(120000));
        this.current(generation);
        if (message.hash) {
          if (this.state === 'connected') throw new SessionError('protocol');
          const { salt, challenge } = message.hash;
          if (
            !salt ||
            !challenge ||
            salt.length > 4096 ||
            challenge.length > 4096
          )
            throw new SessionError('protocol');
          this.challenge = { salt, challenge };
          if (this.reuse && this.reuse.salt === salt)
            await this.submitAuthentication(undefined, true);
          else {
            this.clearReuse();
            const request = this.authenticationRequest;
            const binding = this.credentialBinding(salt);
            if (
              !this.rememberedAttempted &&
              binding &&
              this.kind === 'desktop' &&
              this.credentials
            )
              this.transition('checkingCredentials');
            const stored =
              !this.rememberedAttempted && binding && this.kind === 'desktop'
                ? await this.credentials?.load(binding).catch(() => undefined)
                : undefined;
            if (
              generation !== this.generation ||
              request !== this.authenticationRequest
            ) {
              stored?.fill(0);
              continue;
            }
            this.rememberedAttempted = true;
            if (stored && this.sessionId && this.profile) {
              this.rememberedUsed = true;
              this.reuse = {
                profile: this.profile,
                targetId: this.targetId,
                sessionId: this.sessionId,
                salt,
                passwordH1: stored,
              };
              await this.submitAuthentication(undefined, true);
            } else {
              this.transition('authenticating');
              await this.submitPassword('');
            }
          }
        } else if (message.loginResponse) {
          if (this.state === 'connected') throw new SessionError('protocol');
          const response = message.loginResponse;
          if (response.error) {
            if (response.error !== 'No Password Access')
              this.events.authentication?.(false);
            if (this.rememberedUsed) {
              this.rememberedUsed = false;
              void this.credentials?.forget();
            }
            ++this.authenticationRequest;
            this.clearPassword();
            this.clearReuse();
            if (response.error === 'Wrong Password') {
              this.transition('authenticating');
              this.events.error('password');
            } else if (response.error === 'No Password Access') {
              // Native click-only approval keeps this encrypted session open.
              // Repeated notices must not extend the authentication deadline.
              this.transition('awaitingApproval');
            } else throw new SessionError('denied');
          } else if (response.peerInfo) {
            const selected = response.peerInfo.currentDisplay ?? 0;
            if (
              (this.kind === 'desktop' &&
                !response.peerInfo.displays?.length) ||
              (response.peerInfo.displays?.length || 0) >
                DISPLAY_LIMITS.count ||
              !(response.peerInfo.displays || []).every(validDisplay) ||
              !Number.isInteger(selected) ||
              selected < 0 ||
              (this.kind === 'desktop' &&
                selected >= (response.peerInfo.displays?.length || 0))
            )
              throw new SessionError('protocol');
            clearTimeout(this.authTimer);
            this.displays = response.peerInfo.displays || [];
            this.displayCatalog.updatePeer(response.peerInfo);
            this.videoDisplay = selected;
            this.sasEnabled = !!response.peerInfo.sasEnabled;
            if (!this.updateEncoding(response.peerInfo.encoding)) return;
            this.challenge = undefined;
            this.clearReuse();
            if (this.kind === 'file') this.clearPassword();
            this.events.authentication?.(true);
            this.transition('connected');
            const binding =
              this.passwordCandidate &&
              this.credentialBinding(this.passwordCandidate.salt);
            if (this.remember && binding && this.passwordCandidate)
              void this.credentials?.save(
                binding,
                this.passwordCandidate.passwordH1,
              );
            this.events.permissions({ ...this.permissions });
            await this.events.message(message);
            // Since native 1.2.4, a versioned client explicitly subscribes displays.
            if (this.kind === 'desktop')
              this.send({
                misc: {
                  captureDisplays: {
                    set: [selected],
                  },
                },
              });
          } else throw new SessionError('protocol');
        } else if (message.testDelay && !message.testDelay.fromClient) {
          this.testDelayReceived = Math.min(
            this.testDelayReceived + 1,
            Number.MAX_SAFE_INTEGER,
          );
          this.lastProbeAt = performance.now();
          // 原生被控端发送上一次往返探测结果（毫秒），0 表示尚无结果。
          const delay = message.testDelay.lastDelay;
          this.networkDelay =
            typeof delay === 'number' && Number.isInteger(delay) && delay > 0
              ? delay
              : undefined;
          // 原生编码器目标单位为kbit/s；不转换成实际接收码率或字节吞吐。
          const target = message.testDelay.targetBitrate;
          this.targetBitrateKbps =
            typeof target === 'number' &&
            Number.isInteger(target) &&
            target > 0 &&
            target <= 0xffffffff
              ? target
              : undefined;
          this.send({ testDelay: message.testDelay });
          // 仅确认本地Socket接受原样回包，不代表远端已收到。
          this.testDelayReplied = Math.min(
            this.testDelayReplied + 1,
            Number.MAX_SAFE_INTEGER,
          );
        } else if (message.misc?.closeReason) {
          throw new SessionError('denied');
        } else if (message.misc?.permissionInfo) {
          const info = message.misc.permissionInfo;
          if (info.permission === hbb.PermissionInfo.Permission.Keyboard) {
            const restored = !this.permissions.keyboard && !!info.enabled;
            this.permissions.keyboard = !!info.enabled;
            // Revoked input stays blocked, including releases. Once restored,
            // release only previously sent holds before enabling the UI again.
            if (restored)
              for (const release of this.takeInputReleases())
                this.send(release);
          }
          if (info.permission === hbb.PermissionInfo.Permission.Clipboard)
            this.permissions.clipboard = !!info.enabled;
          if (info.permission === hbb.PermissionInfo.Permission.Audio)
            this.permissions.audio = !!info.enabled;
          if (info.permission === hbb.PermissionInfo.Permission.Recording)
            this.permissions.recording = !!info.enabled;
          if (!this.permissions.audio) this.closeVoiceCall();
          if (info.permission === hbb.PermissionInfo.Permission.File) {
            this.permissions.file = !!info.enabled;
            if (!this.permissions.file) {
              ++this.credentialEpoch;
              if (!this.remember) this.clearPassword();
              this.clearReuse();
            }
          }
          this.events.permissions({ ...this.permissions });
        } else if (this.state === 'connected') {
          if (message.peerInfo) {
            const peer = message.peerInfo;
            if (
              !peer.displays?.length ||
              peer.displays.length > DISPLAY_LIMITS.count ||
              !peer.displays.every(validDisplay) ||
              !Number.isInteger(peer.currentDisplay ?? 0) ||
              (peer.currentDisplay ?? 0) < 0 ||
              (peer.currentDisplay ?? 0) >= peer.displays.length
            )
              throw new SessionError('protocol');
            this.displays = peer.displays;
            this.displayCatalog.updatePeer(peer);
            if (!this.updateEncoding(peer.encoding)) return;
            if (Object.hasOwn(peer, 'sasEnabled'))
              this.sasEnabled = !!peer.sasEnabled;
          }
          if (
            message.misc?.supportedEncoding &&
            !this.updateEncoding(message.misc.supportedEncoding)
          )
            return;
          if (
            message.misc?.switchDisplay &&
            (!validDisplay(message.misc.switchDisplay) ||
              !Number.isInteger(message.misc.switchDisplay.display) ||
              (message.misc.switchDisplay.display ?? -1) < 0 ||
              (message.misc.switchDisplay.display ?? DISPLAY_LIMITS.count) >=
                this.displays.length)
          )
            throw new SessionError('protocol');
          if (
            (message.peerInfo || message.misc?.switchDisplay) &&
            this.permissions.keyboard
          )
            for (const release of this.takeInputReleases())
              if (!this.sendConnected(release)) return;
          if (message.misc?.switchDisplay) {
            this.displayCatalog.updateSwitch(message.misc.switchDisplay);
            const index = message.misc.switchDisplay.display ?? -1;
            this.displays[index] = {
              ...this.displays[index],
              ...message.misc.switchDisplay,
            };
          }
          if (
            (message.clipboard || message.multiClipboards) &&
            (!this.clipboardEnabled || !this.permissions.clipboard)
          )
            continue;
          if (message.voiceCallResponse) {
            if (
              Number(message.voiceCallResponse.reqTimestamp) !==
                this.callTimestamp ||
              !this.callTimestamp ||
              this.voiceActive
            )
              continue;
            this.voiceActive =
              !!message.voiceCallResponse.accepted && this.permissions.audio;
            if (!this.voiceActive) this.callTimestamp = 0;
          }
          if (message.voiceCallRequest && !message.voiceCallRequest.isConnect) {
            this.callTimestamp = 0;
            this.voiceActive = false;
          }
          await this.events.message(message);
          if (
            generation === this.generation &&
            this.state === 'connected' &&
            message.videoFrame?.display === this.videoDisplay
          ) {
            for (const frame of videoBatch(message.videoFrame)?.batch.frames ||
              []) {
              const bytes = frame.data?.byteLength ?? 0;
              if (Number.isSafeInteger(this.videoBytes + bytes))
                this.videoBytes += bytes;
              if (bytes && this.received < Number.MAX_SAFE_INTEGER)
                ++this.received;
            }
          }
        }
      }
    } catch (error) {
      if (generation !== this.generation) return;

      this.fail(error instanceof SessionError ? error.code : 'protocol');
    }
  }

  // 返回独立副本，文件会话取得所有权；桌面成功只是允许尝试新挑战。
  authenticationForFiles(): FileAuthentication | undefined {
    if (
      this.kind !== 'desktop' ||
      this.state !== 'connected' ||
      !this.permissions.file ||
      !this.profile ||
      !this.sessionId ||
      !this.passwordCandidate
    )
      return;
    return {
      profile: { ...this.profile },
      targetId: this.targetId,
      sessionId: this.sessionId,
      salt: this.passwordCandidate.salt,
      passwordH1: this.passwordCandidate.passwordH1.slice(),
    };
  }
  private clearPassword() {
    this.passwordCandidate?.passwordH1.fill(0);
    this.passwordCandidate = undefined;
  }
  private clearReuse() {
    this.reuse?.passwordH1.fill(0);
    this.reuse = undefined;
  }
  private credentialBinding(salt: string): CredentialBinding | undefined {
    if (!this.profile || !this.peerKey) return undefined;
    return {
      profile: this.profile,
      targetId: this.targetId,
      peerKey: this.peerKey,
      salt,
    };
  }
  forgetPassword() {
    this.remember = false;
    ++this.credentialEpoch;
    void this.credentials?.forget();
  }
  async submitPassword(password: string, remember = false) {
    if (
      !this.challenge ||
      !['authenticating', 'awaitingApproval'].includes(this.state)
    )
      return;
    this.remember = !!password && remember;
    return this.submitAuthentication(password, false);
  }
  private async submitAuthentication(
    password: string | undefined,
    automatic: boolean,
  ) {
    if (
      !this.challenge ||
      ![
        'authenticating',
        'awaitingApproval',
        'checkingCredentials',
        'automaticAuthenticating',
      ].includes(this.state)
    )
      return;
    if ((password?.length || 0) > 4096 || ++this.attempts > 5) {
      this.fail('denied');
      return;
    }
    const generation = this.generation;
    const request = ++this.authenticationRequest;
    const hash = this.challenge;
    const credentialEpoch = this.credentialEpoch;
    this.clearPassword();
    const remembered =
      automatic && this.kind === 'desktop' && this.rememberedUsed;
    this.transition(remembered ? 'automaticAuthenticating' : 'authenticating');
    let first: Uint8Array | undefined;
    let response: Uint8Array | undefined;
    try {
      first = automatic
        ? this.reuse?.passwordH1.slice()
        : password
          ? await derivePasswordHash(password, hash.salt)
          : undefined;
      response = first
        ? await challengeFromHash(first, hash.challenge)
        : new Uint8Array();
      if (
        generation !== this.generation ||
        request !== this.authenticationRequest ||
        hash !== this.challenge ||
        this.state === 'connected'
      )
        return;
      this.send({
        loginRequest: {
          username: this.targetId,
          password: response,
          myId: 'console-web',
          myName: 'Console Web Client',
          myPlatform: 'Web',
          sessionId: this.sessionId,
          version: '1.4.9',
          videoAckRequired:
            this.kind === 'desktop' && this.videoFlow === 'decoded-ack',
          fileTransfer:
            this.kind === 'file' ? { dir: '', showHidden: false } : undefined,
          viewCamera: this.mode === 'camera' ? {} : undefined,
          option:
            this.kind === 'file'
              ? undefined
              : {
                  disableAudio: hbb.OptionMessage.BoolOption.Yes,
                  disableClipboard: this.clipboardEnabled
                    ? hbb.OptionMessage.BoolOption.No
                    : hbb.OptionMessage.BoolOption.Yes,
                  enableFileTransfer: hbb.OptionMessage.BoolOption.No,
                  imageQuality: hbb.ImageQuality.Balanced,
                  showRemoteCursor:
                    this.mode === 'camera'
                      ? hbb.OptionMessage.BoolOption.No
                      : hbb.OptionMessage.BoolOption.Yes,
                  customFps: 30,
                  supportedDecoding: decodingOptions(
                    this.capabilities,
                    this.codecPreference,
                    this.trueColor,
                  ),
                },
        },
      });
      if (
        first &&
        this.kind === 'desktop' &&
        (this.permissions.file || this.remember) &&
        (credentialEpoch === this.credentialEpoch || this.remember)
      ) {
        this.passwordCandidate = { salt: hash.salt, passwordH1: first };
        first = undefined;
      }
      this.clearReuse();
      this.transition(
        remembered ? 'automaticAuthenticating' : 'awaitingApproval',
      );
      this.armAuthenticationTimeout();
    } catch (error) {
      if (
        generation === this.generation &&
        request === this.authenticationRequest
      )
        this.fail(error instanceof SessionError ? error.code : 'protocol');
    } finally {
      first?.fill(0);
      response?.fill(0);
    }
  }

  private armAuthenticationTimeout() {
    const generation = this.generation;
    clearTimeout(this.authTimer);
    this.authTimer = setTimeout(() => {
      if (generation === this.generation) this.fail('timeout');
    }, 120000);
  }

  sendInput(input: { keyEvent?: hbb.IKeyEvent; mouseEvent?: hbb.IMouseEvent }) {
    if (
      this.kind !== 'desktop' ||
      this.state !== 'connected' ||
      !this.permissions.keyboard ||
      this.readOnly ||
      (input.keyEvent?.controlKey === hbb.ControlKey.CtrlAltDel &&
        !this.sasEnabled)
    )
      return false;
    const key = input.keyEvent;
    const functionKey =
      key?.controlKey === hbb.ControlKey.CtrlAltDel ||
      key?.controlKey === hbb.ControlKey.LockScreen;
    const keyId =
      key && !key.press && !functionKey
        ? key.controlKey != null
          ? `control:${key.mode ?? hbb.KeyboardMode.Legacy}:${key.controlKey}`
          : key.chr != null
            ? `chr:${key.mode ?? hbb.KeyboardMode.Legacy}:${key.chr}`
            : undefined
        : undefined;
    if (
      keyId &&
      key?.down &&
      !this.heldKeys.has(keyId) &&
      this.heldKeys.size >= MAX_HELD_KEYS
    ) {
      this.fail('protocol');
      return false;
    }
    if (!this.sendConnected(input)) return false;
    if (keyId && key) {
      if (key.down)
        this.heldKeys.set(keyId, {
          controlKey: key.controlKey,
          chr: key.chr,
          mode: key.mode,
          down: false,
        });
      else this.heldKeys.delete(keyId);
    }
    const mask = input.mouseEvent?.mask ?? 0;
    const button = mask >>> 3;
    if ([1, 2, 4].includes(button)) {
      if ((mask & 7) === 1) this.heldButtons.add(button);
      if ((mask & 7) === 2) this.heldButtons.delete(button);
    }
    return true;
  }

  private takeInputReleases(): hbb.IMessage[] {
    const releases: hbb.IMessage[] = Array.from(
      this.heldKeys.values(),
      (keyEvent) => ({ keyEvent }),
    );
    for (const button of this.heldButtons)
      releases.push({ mouseEvent: { mask: 2 | (button << 3) } });
    this.heldKeys.clear();
    this.heldButtons.clear();
    return releases;
  }

  sendClipboard(clipboard: hbb.IClipboard) {
    if (
      this.kind !== 'desktop' ||
      this.state !== 'connected' ||
      !this.permissions.clipboard ||
      !this.clipboardEnabled
    )
      return false;
    return this.sendConnected({ clipboard });
  }

  sendImage(value: Uint8Array | hbb.IClipboard) {
    if (
      this.kind !== 'desktop' ||
      this.state !== 'connected' ||
      !this.permissions.clipboard ||
      !this.clipboardEnabled
    )
      return false;
    const clipboard =
      value instanceof Uint8Array
        ? { format: hbb.ClipboardFormat.ImagePng, content: value }
        : value;
    // 拒绝本次大图，不进入会关闭会话的 transport 硬限路径。
    try {
      if (!imagePacketFits(clipboard)) return false;
      if (clipboard.format === hbb.ClipboardFormat.ImageRgba)
        imagePixels(clipboard);
      else if (clipboard.format !== hbb.ClipboardFormat.ImagePng) return false;
    } catch {
      return false;
    }
    return this.sendConnected({
      multiClipboards: {
        clipboards: [clipboard],
      },
    });
  }

  async flushClipboard() {
    const transport = this.transport;
    if (
      !transport ||
      this.kind !== 'desktop' ||
      this.state !== 'connected' ||
      !this.permissions.clipboard ||
      !this.clipboardEnabled
    )
      throw new SessionError('denied');
    // 等待本地发送队列清空，不将其当作远端系统写入确认。
    await transport.drain(0);
    if (
      transport !== this.transport ||
      this.state !== 'connected' ||
      !this.permissions.clipboard ||
      !this.clipboardEnabled
    )
      throw new SessionError('cancelled');
  }

  selectDisplay(index: number) {
    if (
      this.state !== 'connected' ||
      !Number.isInteger(index) ||
      !this.displays[index]
    )
      return false;
    if (this.permissions.keyboard) {
      for (const release of this.takeInputReleases())
        if (!this.sendConnected(release)) return false;
    }
    this.videoDisplay = index;
    return (
      this.sendConnected({ misc: { switchDisplay: { display: index } } }) &&
      this.sendConnected({ misc: { captureDisplays: { set: [index] } } })
    );
  }

  qualityMetrics() {
    const probeAge =
      this.lastProbeAt === undefined
        ? undefined
        : performance.now() - this.lastProbeAt;
    return {
      received: this.received,
      videoBytes: this.videoBytes,
      delay: this.networkDelay,
      targetBitrateKbps: this.targetBitrateKbps,
      testDelayReceived: this.testDelayReceived,
      testDelayReplied: this.testDelayReplied,
      lastProbeAgeMs:
        probeAge === undefined
          ? undefined
          : Number.isFinite(probeAge)
            ? Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, probeAge))
            : 0,
      transport: this.transport?.metrics(),
    };
  }
  resetVideoCounters() {
    this.received = 0;
    this.videoBytes = 0;
  }

  changeResolution(display: number, width: number, height: number) {
    const options = this.displayCatalog.get(display);
    if (
      this.kind !== 'desktop' ||
      this.state !== 'connected' ||
      !this.permissions.keyboard ||
      this.readOnly ||
      !Number.isInteger(display) ||
      display !== this.videoDisplay ||
      !options.supported ||
      !validFrameSize(width, height) ||
      !options.resolutions.some(
        (value) => value.width === width && value.height === height,
      )
    )
      return false;
    for (const release of this.takeInputReleases())
      if (!this.sendConnected(release)) return false;
    return this.sendConnected({
      misc: {
        changeDisplayResolution: { display, resolution: { width, height } },
      },
    });
  }

  configureVideo(capabilities: VideoCapabilities) {
    this.capabilities = { ...capabilities };
  }
  private acceptsCodec(prefer: CodecPreference) {
    return (
      prefer === 'auto' ||
      (this.capabilities[prefer] &&
        (prefer === 'vp9' || !this.encoding || !!this.encoding[prefer]))
    );
  }
  private updateEncoding(encoding?: hbb.ISupportedEncoding | null) {
    if (!encoding) return true;
    this.encoding = {
      ...encoding,
      i444: encoding.i444 ? { ...encoding.i444 } : undefined,
    };
    let changed = false;
    if (!this.acceptsCodec(this.codecPreference)) {
      this.codecPreference = 'auto';
      changed = true;
    }
    if (
      this.trueColor &&
      !supportsTrueColor(this.capabilities, this.codecPreference, this.encoding)
    ) {
      this.trueColor = false;
      changed = true;
    }
    return (
      !changed ||
      this.sendConnected({
        misc: {
          option: {
            supportedDecoding: decodingOptions(
              this.capabilities,
              this.codecPreference,
              this.trueColor,
            ),
          },
        },
      })
    );
  }
  setCodec(prefer: CodecPreference, trueColor: boolean) {
    if (
      this.kind !== 'desktop' ||
      this.state !== 'connected' ||
      !['auto', 'vp9', 'vp8', 'av1'].includes(prefer) ||
      typeof trueColor !== 'boolean' ||
      !this.acceptsCodec(prefer) ||
      (trueColor &&
        !supportsTrueColor(this.capabilities, prefer, this.encoding))
    )
      return false;
    this.codecPreference = prefer;
    this.trueColor = trueColor;
    return this.sendConnected({
      misc: {
        option: {
          supportedDecoding: decodingOptions(
            this.capabilities,
            prefer,
            trueColor,
          ),
        },
      },
    });
  }
  sendChat(text: string) {
    const now = performance.now();
    if (
      this.kind !== 'desktop' ||
      this.state !== 'connected' ||
      !validChat(text) ||
      now - this.chatSent < CHAT_LIMITS.intervalMs
    )
      return false;
    if (!this.sendConnected({ misc: { chatMessage: { text } } })) return false;
    this.chatSent = now;
    return true;
  }
  startVoiceCall(timestamp: number) {
    if (
      this.kind !== 'desktop' ||
      this.state !== 'connected' ||
      !this.permissions.audio ||
      this.callTimestamp ||
      !Number.isSafeInteger(timestamp) ||
      timestamp <= 0
    )
      return false;
    this.callTimestamp = timestamp;
    return this.sendConnected({
      voiceCallRequest: { reqTimestamp: timestamp, isConnect: true },
    });
  }
  closeVoiceCall() {
    const active = !!this.callTimestamp;
    this.callTimestamp = 0;
    this.voiceActive = false;
    if (active && this.state === 'connected')
      this.sendConnected({ voiceCallRequest: { isConnect: false } });
  }
  sendVoiceFormat(timestamp: number) {
    return (
      this.voiceActive &&
      timestamp === this.callTimestamp &&
      this.permissions.audio &&
      this.state === 'connected' &&
      this.sendConnected({
        misc: { audioFormat: { sampleRate: 48000, channels: 1 } },
      })
    );
  }
  async sendVoiceAudio(timestamp: number, bytes: Uint8Array) {
    const transport = this.transport;
    if (
      !transport ||
      !this.voiceActive ||
      timestamp !== this.callTimestamp ||
      !this.permissions.audio ||
      bytes.length > 65536
    )
      return false;
    await transport.drain();
    return (
      transport === this.transport &&
      this.state === 'connected' &&
      this.voiceActive &&
      timestamp === this.callTimestamp &&
      this.permissions.audio &&
      this.sendConnected({ audioFrame: { data: bytes } })
    );
  }
  setRecording(enabled: boolean) {
    if (
      this.kind !== 'desktop' ||
      this.state !== 'connected' ||
      (enabled && !this.permissions.recording)
    )
      return false;
    return this.sendConnected({ misc: { clientRecordStatus: enabled } });
  }

  setClipboardEnabled(enabled: boolean) {
    if (this.kind !== 'desktop' || typeof enabled !== 'boolean') return false;
    this.clipboardEnabled = enabled;
    if (this.state !== 'connected') return true;
    return this.sendConnected({
      misc: {
        option: {
          disableClipboard: enabled
            ? hbb.OptionMessage.BoolOption.No
            : hbb.OptionMessage.BoolOption.Yes,
        },
      },
    });
  }

  setAudio(enabled: boolean) {
    if (this.state !== 'connected') return false;
    return this.sendConnected({
      misc: {
        option: {
          disableAudio:
            enabled && this.permissions.audio
              ? hbb.OptionMessage.BoolOption.No
              : hbb.OptionMessage.BoolOption.Yes,
        },
      },
    });
  }

  setReadOnly(enabled: boolean) {
    if (
      this.kind !== 'desktop' ||
      this.state !== 'connected' ||
      typeof enabled !== 'boolean'
    )
      return false;
    if (enabled && !this.readOnly && this.permissions.keyboard) {
      for (const release of this.takeInputReleases())
        if (!this.sendConnected(release)) return false;
    }
    this.readOnly = enabled;
    return true;
  }

  setViewOptions(options: ViewOptions) {
    if (
      this.kind !== 'desktop' ||
      this.state !== 'connected' ||
      !options ||
      !['low', 'balanced', 'best', 'custom'].includes(options.quality) ||
      (options.quality === 'custom' &&
        (!Number.isInteger(options.customQuality) ||
          (options.customQuality ?? 0) < 10 ||
          (options.customQuality ?? 0) > 100)) ||
      !Number.isInteger(options.fps) ||
      options.fps < 5 ||
      options.fps > 120 ||
      typeof options.remoteCursor !== 'boolean'
    )
      return false;
    const quality = {
      low: hbb.ImageQuality.Low,
      balanced: hbb.ImageQuality.Balanced,
      best: hbb.ImageQuality.Best,
    };
    return this.sendConnected({
      misc: {
        option: {
          imageQuality:
            options.quality === 'custom'
              ? hbb.ImageQuality.NotSet
              : quality[options.quality],
          ...(options.quality === 'custom'
            ? { customImageQuality: (options.customQuality ?? 50) << 8 }
            : {}),
          customFps: options.fps,
          showRemoteCursor:
            this.mode !== 'camera' && options.remoteCursor
              ? hbb.OptionMessage.BoolOption.Yes
              : hbb.OptionMessage.BoolOption.No,
        },
      },
    });
  }

  async sendFile(
    message: { fileAction?: hbb.IFileAction; fileResponse?: hbb.IFileResponse },
    current = () => true,
  ) {
    if (
      this.kind !== 'file' ||
      this.state !== 'connected' ||
      !this.permissions.file
    )
      throw new SessionError('denied');
    const transport = this.transport;
    if (!transport) throw new SessionError('cancelled');
    await transport.drain();
    if (transport !== this.transport || !this.permissions.file || !current())
      throw new SessionError('cancelled');
    this.send(message);
  }

  acknowledgeVideo() {
    // false模式由原生发送任务通知fetched，不再发送无序号的额外确认。
    if (
      this.kind === 'desktop' &&
      this.videoFlow === 'decoded-ack' &&
      this.state === 'connected'
    )
      this.sendConnected({ misc: { videoReceived: true } });
  }
  refreshVideo() {
    if (this.state === 'connected')
      this.sendConnected({ misc: { refreshVideo: true } });
  }

  private sendConnected(message: hbb.IMessage) {
    try {
      this.send(message);
      return true;
    } catch (error) {
      this.fail(error instanceof SessionError ? error.code : 'transport');
      return false;
    }
  }

  private send(message: hbb.IMessage) {
    if (!this.transport) throw new SessionError('cancelled');
    this.transport.send(hbb.Message.encode(message).finish());
  }

  private fail(code: SessionErrorCode) {
    this.dispose();
    this.transition('failed');
    this.events.error(code);
  }

  dispose() {
    ++this.generation;
    ++this.authenticationRequest;
    ++this.credentialEpoch;
    this.credentials?.cancel();
    this.remember = false;
    this.rememberedAttempted = false;
    this.rememberedUsed = false;
    this.peerKey = '';
    clearTimeout(this.authTimer);
    const releases = this.takeInputReleases();
    if (this.state === 'connected' && this.permissions.keyboard) {
      try {
        for (const release of releases) this.send(release);
      } catch {
        // Transport failure cannot prevent closing or replay input elsewhere.
      }
    }
    this.transport?.close();
    this.transport = undefined;
    this.offerer?.close();
    this.offerer = undefined;
    this.challenge = undefined;
    this.clearPassword();
    this.clearReuse();
    this.profile = undefined;
    this.sessionId = undefined;
    this.readOnly = false;
    this.sasEnabled = false;
    this.targetId = '';
    this.displays = [];
    this.displayCatalog = new DisplayCatalog();
    this.resetVideoCounters();
    this.networkDelay = undefined;
    this.targetBitrateKbps = undefined;
    this.testDelayReceived = 0;
    this.testDelayReplied = 0;
    this.lastProbeAt = undefined;
    this.videoDisplay = 0;
    this.callTimestamp = 0;
    this.voiceActive = false;
    this.chatSent = -Infinity;
    this.codecPreference = 'auto';
    this.encoding = undefined;
    this.trueColor = false;
    this.state = 'closed';
    this.events.security(undefined);
  }

  disconnect() {
    this.dispose();
    this.transition('closed');
  }
}
