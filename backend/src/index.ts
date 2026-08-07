import { createApp } from './app';
import { env } from './config/env';

const app = createApp();

const server = app.listen(env.PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`✅ Backend listening on http://localhost:${env.PORT}`);
});

function shutdown(): void {
  server.close(() => process.exit(0));
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
