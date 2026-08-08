import { Router } from 'express';
import { authRouter } from './auth';
import { usersRouter } from './users';
import { projectsRouter } from './projects';

export const apiRouter = Router();

apiRouter.use('/auth', authRouter);
apiRouter.use('/users', usersRouter);
apiRouter.use('/projects', projectsRouter);

// Resultado esperado en src/app.ts (cuando ./users y ./projects existan):
//      import { apiRouter } from './routes';
//      app.use('/api', apiRouter);
//      // eliminar el `app.use('/api/auth', authRouter)` que está ahora.