import 'reflect-metadata';
import { Transform, Type } from 'class-transformer';
import {
  IsDefined,
  IsEmail,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { normalizeCardNumber } from '../card';
import type { Currency } from '../currency';
import { SUPPORTED_CURRENCIES } from '../currency';
import { IsLuhnCardNumber, IsNotExpiredCard } from '../validators/card.validators';
import { lowerString, mapString, trimString, upperString } from './transforms';

/** Upper bound in minor units; keeps amounts well inside Number.MAX_SAFE_INTEGER. */
export const MAX_PAYMENT_AMOUNT = 10_000_000_000;

export class CardDto {
  @Transform(mapString(normalizeCardNumber))
  @IsString()
  @Matches(/^\d{12,19}$/, { message: 'card number must be 12 to 19 digits' })
  @IsLuhnCardNumber()
  number!: string;

  @IsInt()
  @Min(1)
  @Max(12)
  expMonth!: number;

  @IsInt()
  @Min(2000)
  @Max(2100)
  @IsNotExpiredCard('expMonth')
  expYear!: number;

  @IsString()
  @Matches(/^\d{3,4}$/, { message: 'cvc must be 3 or 4 digits' })
  cvc!: string;

  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MaxLength(100)
  holderName?: string;
}

export class CreatePaymentDto {
  /** Integer amount in the currency's minor unit (e.g. kobo, cents). */
  @IsInt({ message: 'amount must be an integer in minor units' })
  @Min(1)
  @Max(MAX_PAYMENT_AMOUNT)
  amount!: number;

  @Transform(upperString)
  @IsIn(SUPPORTED_CURRENCIES, {
    message: `currency must be one of: ${SUPPORTED_CURRENCIES.join(', ')}`,
  })
  currency!: Currency;

  // @ValidateNested alone lets `undefined` through, so presence and shape are checked explicitly.
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => CardDto)
  card!: CardDto;

  @Transform(lowerString)
  @IsEmail()
  @MaxLength(254)
  customerEmail!: string;

  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MaxLength(255)
  description?: string;
}
