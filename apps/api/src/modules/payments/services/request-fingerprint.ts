import { createHash } from 'node:crypto';
import type { CreatePaymentDto } from '@payment-sim/shared';
import { detectCardBrand } from '@payment-sim/shared';

/**
 * Fingerprint of a create-payment request, stored with its idempotency key to detect a key
 * reused for a different request. Built from the validated DTO, so formatting differences
 * (whitespace, key order, card spacing, email case) do not count as a different request.
 *
 * The full card number and CVC are deliberately excluded: an unsalted hash of a 16-digit PAN
 * is trivially brute-forced, so storing one would amount to storing the card. Brand, last4 and
 * expiry are distinctive enough to catch an accidental key reuse.
 */
export function fingerprintCreatePayment(dto: CreatePaymentDto): string {
  const material = {
    amount: dto.amount,
    currency: dto.currency,
    customerEmail: dto.customerEmail,
    description: dto.description ?? null,
    card: {
      brand: detectCardBrand(dto.card.number),
      last4: dto.card.number.slice(-4),
      expMonth: dto.card.expMonth,
      expYear: dto.card.expYear,
      holderName: dto.card.holderName ?? null,
    },
  };
  return createHash('sha256').update(JSON.stringify(material)).digest('hex');
}
