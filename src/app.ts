import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import { apiRouter } from './routes';

export function createApp(): Express {
  const app = express();

  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.use('/api', apiRouter);

  // 404 en JSON (el frontend siempre espera JSON).
  app.use((_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  // Handler de errores: JSON malformado → 400, resto → 500.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const status = (err as { status?: number }).status ?? 500;
    const message =
      status === 400 ? 'Invalid JSON body' : status === 413 ? 'Payload too large' : 'Internal server error';

    res.status(status).json({ error: message });
  });

  return app;
}
