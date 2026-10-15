import { Router } from 'express';
import { BaseResponse } from '../../../libs/core/base/base.response';
import type { HealthService } from '../services/health.service';

/**
 * Mounted at the root, outside /api/v1 and its rate limiter, so platform probes are never
 * versioned away or throttled.
 */
export function createHealthController(health: HealthService): Router {
  const router = Router();

  router.get('/health', (_req, res) => {
    res.json(BaseResponse.success(health.liveness(), 'Alive'));
  });

  router.get('/ready', async (_req, res) => {
    const report = await health.readiness();
    res.status(report.ready ? 200 : 503).json({
      success: report.ready,
      message: report.ready ? 'Ready' : 'Not ready',
      data: report,
    });
  });

  return router;
}
