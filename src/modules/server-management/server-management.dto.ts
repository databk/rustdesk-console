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
