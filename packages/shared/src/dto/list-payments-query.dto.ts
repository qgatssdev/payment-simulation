import 'reflect-metadata';
import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import type { Currency } from '../currency';
import { SUPPORTED_CURRENCIES } from '../currency';
import { PaymentStatus } from '../payment-status';
import { trimString, upperString } from './transforms';

export const DEFAULT_PAGE_LIMIT = 20;
export const MAX_PAGE_LIMIT = 100;

export class ListPaymentsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_LIMIT)
  limit?: number;

  /** Opaque cursor returned as `pagination.nextCursor` by the previous page. */
  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @IsEnum(PaymentStatus)
  status?: PaymentStatus;

  @IsOptional()
  @Transform(upperString)
  @IsIn(SUPPORTED_CURRENCIES)
  currency?: Currency;

  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;

  /** Search: a payment id (or its start), or text in the customer email or description. */
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MaxLength(100)
  q?: string;
}
