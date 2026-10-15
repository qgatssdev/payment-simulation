import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import type { PaymentStatus } from '../payment-status';
import { CLIENT_SETTABLE_STATUSES } from '../state-machine';
import { trimString } from './transforms';

export class UpdatePaymentStatusDto {
  @IsIn(CLIENT_SETTABLE_STATUSES, {
    message: `status must be one of: ${CLIENT_SETTABLE_STATUSES.join(', ')}`,
  })
  status!: PaymentStatus;

  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MaxLength(500)
  reason?: string;
}
