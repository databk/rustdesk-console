import { Equals, IsUUID } from 'class-validator';
export class CreateSystemUpdatePlanDto {}
export class CreateSystemUpdateJobDto {
  @IsUUID('4') planId: string;
  @IsUUID('4') idempotencyKey: string;
  @Equals(true) acknowledgeDowntime: true;
}
