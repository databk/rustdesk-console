/** 协议 v1：此文件是 API、发布器、安装器和备份适配器的共同边界。 */
export const UPDATE_PROTOCOL = 1;
export const OFFICIAL_REPOSITORIES = {
  backend: 'databk/rustdesk-console',
  web: 'databk/rustdesk-console-web',
} as const;
export type Component = 'backend' | 'web';
export type DeploymentKind = 'managed-compose' | 'managed-linux';
export type DatabaseKind = 'sqlite' | 'mysql';
export interface Blocker {
  code: string;
  message: string;
}
export interface Platform {
  os: 'linux';
  arch: 'x64' | 'arm64';
  libc: 'glibc' | 'musl';
}
export interface ReleaseArtifact {
  kind: 'oci' | 'archive';
  platform: Platform;
  name: string;
  /** archive 为官方 release asset URL；oci 为固定官方命名空间的 digest 引用。 */
  url: string;
  sha256: string;
  size: number;
}
export interface ReleaseManifest {
  schemaVersion: 1;
  repository: string;
  component: Component;
  version: string;
  releaseId: number;
  tag: string;
  sourceCommit: string;
  publishedAt: string;
  /** v1 支持由空格分隔的 >=、>、<=、<、= 正式三段版本比较式。 */
  peerVersionRange: string;
  updaterProtocol: 1;
  maintenanceProtocol: 1;
  bundleFormat: 1;
  artifacts: ReleaseArtifact[];
}
export interface InstalledComponent {
  version: string;
  sourceCommit: string;
  artifact: ReleaseArtifact;
  manifest: ReleaseManifest;
}
export interface ComponentChange {
  component: Component;
  action: 'update' | 'unchanged';
  current: string;
  target: string;
  releaseUrl: string;
}
export interface Capabilities {
  protocolVersion: 1;
  installationId: string | null;
  supported: boolean;
  ready: boolean;
  deployment: DeploymentKind | null;
  database: DatabaseKind | null;
  current: { backend: string; web: string } | null;
  blockers: Blocker[];
  activeJobId: string | null;
}
export interface UpdatePlan {
  protocolVersion: 1;
  installationId: string;
  planId: string;
  createdAt: string;
  expiresAt: string;
  components: ComponentChange[];
  changes: boolean;
  downtime: boolean;
  backup: {
    database: DatabaseKind;
    method: string;
    includesBusinessFiles: true;
  };
  blockers: Blocker[];
  executable: boolean;
}
export type JobStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'rolled_back'
  | 'recovery_required';
export type JobPhase =
  | 'preparing'
  | 'maintenance'
  | 'backing_up'
  | 'switching'
  | 'verifying'
  | 'updating_helper'
  | 'committing'
  | 'restoring';
export interface JobView {
  protocolVersion: 1;
  installationId: string;
  jobId: string;
  planId: string;
  status: JobStatus;
  phase: JobPhase;
  components: ComponentChange[];
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
  resultCode: string | null;
  safeMessage: string;
  recoveryGuidance: string | null;
}
export interface CreateJobRequest {
  planId: string;
  idempotencyKey: string;
  acknowledgeDowntime: true;
}
export interface CreateJobResponse {
  jobId: string;
  statusUrl: string;
  job: JobView;
}
export interface CurrentJobResponse {
  installationId: string | null;
  job: JobView | null;
}

/** 仅限可信安装清单；任何路径、凭据或命令均不得从 HTTP 请求填充。 */
export interface Installation {
  schemaVersion: 1;
  installationId: string;
  deployment: DeploymentKind;
  platform: Platform;
  stateDir: string;
  ipcDir: string;
  maintenanceFile: string;
  dataDir: string;
  backendHealthUrl: string;
  webHealthUrl: string;
  current: Record<Component, InstalledComponent>;
  database: DatabaseConfig;
  compose?: {
    projectName: string;
    projectDirectory: string;
    files: string[];
    overrideFile: string;
    /** 原始 compose/environment 文件哈希，部署漂移即阻断。 */
    configFiles: Record<string, string>;
    configDigest: string;
    services: { backend: string; web: string; updater: string };
    /** 主机真实路径到执行器内同一绝对路径的绑定；不能使用 /install 冒充 source。 */
    workerMounts: { source: string; target: string; readOnly: boolean }[];
    workerNetwork: string;
    workerImage: string;
  };
  linux?: {
    /** 安装时登记环境/凭据文件摘要，内容只在本地读取且不进入 API。 */
    configFiles: Record<string, string>;
    releasesDir: string;
    backendLink: string;
    webLink: string;
    updaterLink: string;
    units: { backend: string; web: string; updater: string; job: string };
    executableRelativePath: { backend: string; web: string };
  };
}
export type DatabaseConfig =
  | { kind: 'sqlite'; path: string }
  | {
      kind: 'mysql';
      host: string;
      port: number;
      database: string;
      username: string;
      passwordFile: string;
      exclusiveSchema: boolean;
      tls?: {
        ca?: string;
        cert?: string;
        key?: string;
        rejectUnauthorized: boolean;
      };
    };
export interface BackupContext {
  jobId: string;
  database: DatabaseConfig;
  dataDir: string;
  backupDir: string;
  /** worker 已停所有业务写进程后才传 true。 */
  servicesStopped: boolean;
}
export interface BackupSnapshot {
  schemaVersion: 1;
  jobId: string;
  database: DatabaseKind;
  path: string;
  createdAt: string;
  /** 私有恢复清单，不投影到 API。 */
  metadata: Record<string, unknown>;
}
export interface BackupAdapter {
  preflight(context: BackupContext): Promise<Blocker[]>;
  backup(context: BackupContext): Promise<BackupSnapshot>;
  validate(context: BackupContext, snapshot: BackupSnapshot): Promise<void>;
  restore(context: BackupContext, snapshot: BackupSnapshot): Promise<void>;
}
export interface PersistedPlan {
  view: UpdatePlan;
  installationFingerprint: string;
  targets: Record<Component, InstalledComponent>;
  manifestDigests: Record<Component, string>;
}
export interface JobRecord {
  view: JobView;
  idempotencyKey: string;
  requestDigest: string;
  actorId: string;
  plan: PersistedPlan;
  originalInstallation: Installation;
  snapshot?: BackupSnapshot;
  decision?: 'commit_decided' | 'restore_decided';
  /** 操作前意图和操作后证据；中断时不推测危险动作已经完成。 */
  operations: Record<string, 'intent' | 'done'>;
}
export interface DeploymentAdapter {
  preflight(): Promise<Blocker[]>;
  fingerprint(): Promise<string>;
  prepare(plan: PersistedPlan): Promise<void>;
  stopApplications(): Promise<void>;
  switchApplications(plan: PersistedPlan): Promise<void>;
  startApplications(): Promise<void>;
  verify(plan: PersistedPlan, restored?: boolean): Promise<void>;
  updateHelper(plan: PersistedPlan): Promise<void>;
  restoreDeployment(record: JobRecord): Promise<void>;
  commit(plan: PersistedPlan): Promise<void>;
  startWorker(jobId: string): Promise<void>;
  workerAlive(jobId: string): Promise<boolean>;
}
