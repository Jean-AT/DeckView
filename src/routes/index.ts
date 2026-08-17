import { Router } from 'express';
import { authRouter } from './auth';
import { usersRouter } from './users';
import { projectsRouter } from './projects';
import { credentialsRouter } from './credentials';
import { ticketsRouter } from './tickets';
import { webhooksRouter } from './webhooks';
import { auditLogsRouter } from './auditLogs';

export const apiRouter = Router();

apiRouter.use('/auth', authRouter);
apiRouter.use('/users', usersRouter);
apiRouter.use('/projects', projectsRouter);
apiRouter.use('/projects/:projectId/credentials', credentialsRouter);
apiRouter.use('/tickets', ticketsRouter);
apiRouter.use('/webhooks', webhooksRouter);
apiRouter.use('/audit-logs', auditLogsRouter);

// Resultado esperado en src/app.ts (cuando ./users y ./projects existan):
//      import { apiRouter } from './routes';
//      app.use('/api', apiRouter);
//      // eliminar el `app.use('/api/auth', authRouter)` que está ahora.