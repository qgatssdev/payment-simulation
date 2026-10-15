import {
  CreatePaymentDto,
  HEADERS,
  PaymentIdParamDto,
  UpdatePaymentStatusDto,
} from '@payment-sim/shared';
import { Router } from 'express';
import { endpoint } from '../../../libs/common/http/endpoint';
import {
  readIdempotencyKey,
  readIfMatchVersion,
  versionETag,
} from '../../../libs/common/http/headers';
import { BaseResponse } from '../../../libs/core/base/base.response';
import { toPaymentView } from '../mappers/payment.mapper';
import { IdempotencyKeyRequiredError } from '../payment.errors';
import type { PaymentService } from '../services/payment.service';

export function createPaymentController(payments: PaymentService): Router {
  const router = Router();

  router.post(
    '/payments',
    endpoint({ body: CreatePaymentDto }, async ({ body }, req, res) => {
      const idempotencyKey = readIdempotencyKey(req);
      if (!idempotencyKey) throw new IdempotencyKeyRequiredError();

      const outcome = await payments.create(body, idempotencyKey);
      const view = outcome.body.data;
      res
        .status(outcome.statusCode)
        .location(`${req.baseUrl}/payments/${view.id}`)
        .setHeader(HEADERS.ETAG, versionETag(view.version));
      if (outcome.replayed) res.setHeader(HEADERS.IDEMPOTENT_REPLAYED, 'true');
      res.json(outcome.body);
    }),
  );

  router.get(
    '/payments/:id',
    endpoint({ params: PaymentIdParamDto }, async ({ params }, _req, res) => {
      const payment = await payments.get(params.id);
      // With our ETag set, Express answers a matching If-None-Match with 304 by itself.
      res.setHeader(HEADERS.ETAG, versionETag(payment.version));
      res.json(BaseResponse.success(toPaymentView(payment)));
    }),
  );

  router.patch(
    '/payments/:id/status',
    endpoint(
      { params: PaymentIdParamDto, body: UpdatePaymentStatusDto },
      async ({ params, body }, req, res) => {
        const payment = await payments.updateStatus(
          params.id,
          body,
          readIfMatchVersion(req),
        );
        res.setHeader(HEADERS.ETAG, versionETag(payment.version));
        res.json(
          BaseResponse.success(toPaymentView(payment), `Payment ${payment.status}`),
        );
      },
    ),
  );

  return router;
}
