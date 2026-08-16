import { createApp } from './app';
import { env } from './config/env';
import { startSyncScheduler, stopSyncScheduler } from './jobs/syncJob';

const app = createApp();

const server = app.listen(env.PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`✅ Backend listening on http://localhost:${env.PORT}`);
});

startSyncScheduler();

function shutdown(): void {
  stopSyncScheduler();
  server.close(() => process.exit(0));
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
