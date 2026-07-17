import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class AddressBookInfoDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  password?: string;
}

export class CreateAddressBookProfileDto {
  @IsString()
  @MaxLength(255)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  password?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => AddressBookInfoDto)
  info?: AddressBookInfoDto;
}

export class UpdateAddressBookProfileDto {
  @IsUUID('4')
  guid: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;

  @IsOptional()
  @IsString()
  owner?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  password?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => AddressBookInfoDto)
  info?: AddressBookInfoDto;
}

export class UpdateCustomAddressBookProfileDto {
  @IsUUID('4')
  guid: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}

export class DeleteAddressBooksDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsUUID('4', { each: true })
  guids: string[];
}
