import type { ApiSuccess } from '@payment-sim/shared';

/** Success envelope, kept from the nest-template so every endpoint answers in one shape. */
export const BaseResponse = {
  success<T>(data: T, message = 'Success'): ApiSuccess<T> {
    return { success: true, message, data };
  },
};
