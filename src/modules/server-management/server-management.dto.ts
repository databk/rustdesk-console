import {
  ArrayMaxSize,
  IsArray,
  IsIP,
  IsNotEmpty,
  IsObject,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

export enum RustdeskService {
  HBBS = 'hbbs',
  HBBR = 'hbbr',
}

export enum ServiceAction {
  START = 'start',
  STOP = 'stop',
  RESTART = 'restart',
  APPLY = 'apply',
}

export class ServerConfigDto {
  @IsObject()
  values: Record<string, string>;
}

export class ServerBansDto {
  @IsArray()
  @ArrayMaxSize(10000)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @MaxLength(100, { each: true })
  @Matches(/^\S+$/, { each: true })
  device_ids: string[];

  @IsArray()
  @ArrayMaxSize(10000)
  @IsIP(undefined, { each: true })
  ips: string[];
}
