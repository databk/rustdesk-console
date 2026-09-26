import { IsString, IsOptional } from 'class-validator';

/** Create Nexus login session DTO */
export class NexusLoginDto {
  @IsOptional()
  @IsString()
  callbackUrl?: string;
}

/** Nexus login session response */
export interface NexusLoginResponse {
  login_id: string;
  auth_url: string;
  expires_in: number;
}

/** Nexus login status response */
export interface NexusAuthStatusResponse {
  state: 'pending' | 'completed' | 'failed';
  nexus_username?: string;
  expires_in?: number;
  error?: string;
}

/** Nexus binding status response */
export interface NexusBindStatusResponse {
  bound: boolean;
  nexus_username?: string;
  expired?: boolean;
}
