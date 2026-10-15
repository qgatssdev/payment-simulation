import { Router } from 'express';
import type { OpenAPIObject } from 'openapi3-ts/oas31';
import swaggerUi from 'swagger-ui-express';

/** Swagger UI at /docs and the raw document at /docs/openapi.json (for codegen and tests). */
export function createDocsController(document: OpenAPIObject): Router {
  const router = Router();

  router.get('/docs/openapi.json', (_req, res) => {
    res.json(document);
  });
  router.use(
    '/docs',
    swaggerUi.serve,
    swaggerUi.setup(document, {
      customSiteTitle: 'Payment Simulation API',
      swaggerOptions: { displayRequestDuration: true, tryItOutEnabled: true },
    }),
  );

  return router;
}
