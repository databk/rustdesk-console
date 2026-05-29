import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import * as client from 'openid-client';
import { OidcProvider } from '../entities/oidc-provider.entity';
import { OidcService } from './oidc.service';
import {
  CreateOidcProviderDto,
  UpdateOidcProviderDto,
  OidcProviderQueryDto,
} from '../dto/oidc-provider.dto';

@Injectable()
export class OidcAdminService {
  private readonly logger = new Logger(OidcAdminService.name);

  constructor(
    @InjectRepository(OidcProvider)
    private providerRepository: Repository<OidcProvider>,
    private readonly oidcService: OidcService,
  ) {}

  async findAll(query: OidcProviderQueryDto) {
    const { current, pageSize, name } = query;
    const skip = (current - 1) * pageSize;

    const queryBuilder = this.providerRepository
      .createQueryBuilder('provider')
      .orderBy('provider.priority', 'ASC')
      .addOrderBy('provider.name', 'ASC')
      .skip(skip)
      .take(pageSize);

    if (name) {
      queryBuilder.andWhere('provider.name LIKE :name', {
        name: `%${name}%`,
      });
    }

    const [data, total] = await queryBuilder.getManyAndCount();
    return { data, total };
  }

  async findOne(guid: string): Promise<OidcProvider> {
    const provider = await this.providerRepository
      .createQueryBuilder('provider')
      .where('provider.guid = :guid', { guid })
      .addSelect('provider.clientSecret')
      .getOne();

    if (!provider) {
      throw new NotFoundException(`OIDC 提供商 "${guid}" 不存在`);
    }

    return provider;
  }

  async create(dto: CreateOidcProviderDto): Promise<OidcProvider> {
    const existing = await this.providerRepository.findOne({
      where: { name: dto.name },
    });

    if (existing) {
      throw new BadRequestException(`OIDC 提供商名称 "${dto.name}" 已存在`);
    }

    const provider = new OidcProvider();
    provider.guid = uuidv4();
    provider.name = dto.name;
    provider.issuer = dto.issuer;
    provider.clientId = dto.clientId;
    provider.clientSecret = (dto.clientSecret || null) as string;
    provider.scope = dto.scope || 'openid email profile';
    provider.authorizationEndpoint = (dto.authorizationEndpoint ||
      null) as string;
    provider.tokenEndpoint = (dto.tokenEndpoint || null) as string;
    provider.userinfoEndpoint = (dto.userinfoEndpoint || null) as string;
    provider.jwksUri = (dto.jwksUri || null) as string;
    provider.enabled = dto.enabled !== undefined ? dto.enabled : true;
    provider.priority = dto.priority || 0;

    await this.providerRepository.save(provider);
    this.logger.log(`OIDC 提供商创建成功: ${dto.name}`);
    return provider;
  }

  async update(
    guid: string,
    dto: UpdateOidcProviderDto,
  ): Promise<OidcProvider> {
    const provider = await this.providerRepository.findOne({
      where: { guid },
    });

    if (!provider) {
      throw new NotFoundException(`OIDC 提供商 "${guid}" 不存在`);
    }

    if (dto.name && dto.name !== provider.name) {
      const existing = await this.providerRepository.findOne({
        where: { name: dto.name },
      });
      if (existing) {
        throw new BadRequestException(`OIDC 提供商名称 "${dto.name}" 已存在`);
      }
    }

    const oldIssuer = provider.issuer;

    Object.assign(provider, {
      ...(dto.name !== undefined && { name: dto.name }),
      ...(dto.issuer !== undefined && { issuer: dto.issuer }),
      ...(dto.clientId !== undefined && { clientId: dto.clientId }),
      ...(dto.clientSecret !== undefined && { clientSecret: dto.clientSecret }),
      ...(dto.scope !== undefined && { scope: dto.scope }),
      ...(dto.authorizationEndpoint !== undefined && {
        authorizationEndpoint: dto.authorizationEndpoint,
      }),
      ...(dto.tokenEndpoint !== undefined && {
        tokenEndpoint: dto.tokenEndpoint,
      }),
      ...(dto.userinfoEndpoint !== undefined && {
        userinfoEndpoint: dto.userinfoEndpoint,
      }),
      ...(dto.jwksUri !== undefined && { jwksUri: dto.jwksUri }),
      ...(dto.enabled !== undefined && { enabled: dto.enabled }),
      ...(dto.priority !== undefined && { priority: dto.priority }),
    });

    await this.providerRepository.save(provider);

    if (dto.issuer !== undefined && dto.issuer !== oldIssuer) {
      this.oidcService.clearConfigCache(oldIssuer);
    }
    this.oidcService.clearConfigCache(provider.issuer);

    this.logger.log(`OIDC 提供商更新成功: ${provider.name}`);
    return provider;
  }

  async remove(guid: string): Promise<void> {
    const provider = await this.providerRepository.findOne({
      where: { guid },
    });

    if (!provider) {
      throw new NotFoundException(`OIDC 提供商 "${guid}" 不存在`);
    }

    this.oidcService.clearConfigCache(provider.issuer);
    await this.providerRepository.remove(provider);
    this.logger.log(`OIDC 提供商删除成功: ${provider.name}`);
  }

  async toggle(guid: string, enabled: boolean): Promise<OidcProvider> {
    const provider = await this.providerRepository.findOne({
      where: { guid },
    });

    if (!provider) {
      throw new NotFoundException(`OIDC 提供商 "${guid}" 不存在`);
    }

    provider.enabled = enabled;
    await this.providerRepository.save(provider);
    this.logger.log(
      `OIDC 提供商 ${provider.name} 已${enabled ? '启用' : '禁用'}`,
    );
    return provider;
  }

  async testConnection(guid: string): Promise<{
    success: boolean;
    message: string;
    endpoints?: Record<string, string>;
  }> {
    const provider = await this.providerRepository
      .createQueryBuilder('provider')
      .where('provider.guid = :guid', { guid })
      .addSelect('provider.clientSecret')
      .getOne();

    if (!provider) {
      throw new NotFoundException(`OIDC 提供商 "${guid}" 不存在`);
    }

    try {
      const config = await client.discovery(
        new URL(provider.issuer),
        provider.clientId,
        provider.clientSecret || undefined,
      );

      const metadata = config.serverMetadata();
      const endpoints: Record<string, string> = {};

      if (metadata.authorization_endpoint) {
        endpoints.authorization_endpoint = metadata.authorization_endpoint;
      }
      if (metadata.token_endpoint) {
        endpoints.token_endpoint = metadata.token_endpoint;
      }
      if (metadata.userinfo_endpoint) {
        endpoints.userinfo_endpoint = metadata.userinfo_endpoint;
      }
      if (metadata.jwks_uri) {
        endpoints.jwks_uri = metadata.jwks_uri;
      }

      this.oidcService.clearConfigCache(provider.issuer);

      return {
        success: true,
        message: `Discovery 验证成功，已发现 ${Object.keys(endpoints).length} 个端点`,
        endpoints,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `OIDC Discovery 测试失败 for ${provider.name}: ${message}`,
      );
      return {
        success: false,
        message: `Discovery 验证失败: ${message}`,
      };
    }
  }
}
