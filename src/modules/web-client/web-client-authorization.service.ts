import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Peer, PeerStatus } from '../../common/entities/peer.entity';
import { UserToken } from '../user/entities/user-token.entity';
import {
  RbacAuthorizationService,
  PermissionScope,
} from '../rbac/services/rbac-authorization.service';

export interface WebClientActor {
  id: string;
  jti: string;
}
export type WebClientKind = 'desktop' | 'file';

export function normalizeWebClientTarget(raw: string): string {
  if (typeof raw !== 'string' || raw.length > 256)
    throw new BadRequestException('Invalid target ID');
  const value = raw.trim();
  if (/^[0-9 ]+$/.test(value)) return value.replace(/ /g, '');
  if (
    /^[a-zA-Z](?:[\p{Alphabetic}\p{Mark}\p{Decimal_Number}\p{Connector_Punctuation}-]|\u200c|\u200d){5,15}$/u.test(
      value,
    )
  )
    return value;
  throw new BadRequestException('Invalid target ID');
}

@Injectable()
export class WebClientAuthorizationService {
  constructor(
    private readonly authorization: RbacAuthorizationService,
    @InjectRepository(Peer) private readonly peers: Repository<Peer>,
    @InjectRepository(UserToken) private readonly tokens: Repository<UserToken>,
  ) {}

  async requireScope(actorGuid: string): Promise<PermissionScope> {
    return this.authorization.requirePermission(
      actorGuid,
      'web_client.connect',
    );
  }

  async validate(
    actor: WebClientActor,
    targetId: string,
    kind: WebClientKind,
    peerUuid?: string,
  ): Promise<{ peer: Peer; expiresAt: number }> {
    const expiresAt = await this.validateLogin(actor);
    const scope = await this.requireScope(actor.id);
    // 查询全部重号登记，不能先按权限或状态过滤后把歧义 ID 当唯一。
    const candidates = await this.peers.find({
      where: { id: targetId },
      take: 2,
    });
    const peer = candidates.length === 1 ? candidates[0] : undefined;
    if (
      !peer ||
      peer.id !== targetId ||
      peer.status !== PeerStatus.ACTIVE ||
      (peerUuid && peer.uuid !== peerUuid) ||
      !this.contains(scope, peer)
    )
      throw new ForbiddenException('Web client target is not authorized');
    if (kind === 'file') {
      const files = await this.authorization.requirePermission(
        actor.id,
        'web_client.file_transfer',
      );
      if (!this.contains(files, peer))
        throw new ForbiddenException('Web client target is not authorized');
    }
    return { peer, expiresAt };
  }

  async requireDisconnect(
    actor: WebClientActor,
    peerUuid: string,
  ): Promise<void> {
    await this.validateLogin(actor);
    await this.authorization.assertDeviceAccess(
      actor.id,
      'devices.disconnect',
      peerUuid,
    );
  }

  private async validateLogin(actor: WebClientActor): Promise<number> {
    if (!actor?.id || !actor.jti)
      throw new UnauthorizedException('Login session is unavailable');
    const token = await this.tokens.findOne({
      where: { userGuid: actor.id, jti: actor.jti, isRevoked: false },
    });
    const expiresAt = token?.expiresAt.getTime() ?? 0;
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now())
      throw new UnauthorizedException(
        'Login session has expired or been revoked',
      );
    return expiresAt;
  }

  private contains(scope: PermissionScope, peer: Peer): boolean {
    return (
      scope.global ||
      (!!peer.deviceGroupGuid &&
        scope.deviceGroupGuids.has(peer.deviceGroupGuid))
    );
  }
}
