/**
 * Prometheus metrics route delivering system and fleet telemetry in text/plain format.
 * Secured by default with adminAuthMiddleware unless explicitly made public via PEC_METRICS_PUBLIC=true.
 */

import { Router, Request, Response, RequestHandler } from "express";
import { renderPrometheusMetrics } from "../metrics.js";

export interface MetricsRouterOptions {
  adminAuthMiddleware?: RequestHandler;
  allowPublic?: boolean;
}

export function createMetricsRouter(options?: MetricsRouterOptions): Router {
  const router = Router();
  const allowPublic = options?.allowPublic === true || process.env.PEC_METRICS_PUBLIC === "true";

  if (!allowPublic) {
    if (options?.adminAuthMiddleware) {
      router.use(["/metrics", "/api/metrics"], options.adminAuthMiddleware);
    } else {
      router.use(["/metrics", "/api/metrics"], (_req: Request, res: Response) => {
        res.status(401).json({
          ok: false,
          error: "Unauthorized: admin access required for metrics",
        });
      });
    }
  }

  router.get(["/metrics", "/api/metrics"], (_req: Request, res: Response) => {
    const body = renderPrometheusMetrics();
    res.setHeader("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.status(200).send(body);
  });

  return router;
}
