import type { ApiPage, CursorPagination } from '@payment-sim/shared';

/**
 * The template paginated by page/size (OFFSET). Payments are inserted constantly, so offset
 * pages shift under the reader; this envelope carries an opaque keyset cursor instead.
 */
export const PaginatedResponse = {
  success<T>(data: T[], pagination: CursorPagination, message = 'Success'): ApiPage<T> {
    return { success: true, message, data, pagination };
  },
};
