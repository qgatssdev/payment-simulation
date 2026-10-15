import { IsUUID } from 'class-validator';

export class PaymentIdParamDto {
  @IsUUID('4', { message: 'id must be a valid payment id (UUID v4)' })
  id!: string;
}
