import express, { type Request, type Response, type NextFunction } from 'express';
import { analyticsRouter } from './routes/analytics.js';

export function createApp() {
  const app = express();
  app.use(express.json());

  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', service: 'oracle-analytics-engine' });
  });

  app.use('/api', analyticsRouter);

  // Global fallback error handler (in case a route throws outside asyncHandler)
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    // eslint-disable-next-line no-console
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  });

  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: 'Not found' });
  });

  return app;
}
