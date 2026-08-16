import cron, { type ScheduledTask } from 'node-cron';
import { env } from '../config/env';
import { syncService } from '../services/syncService';

let task: ScheduledTask | null = null;

export function startSyncScheduler(): void {
  if (task) return;

  if (!cron.validate(env.SYNC_CRON_SCHEDULE)) {
    throw new Error(`Invalid SYNC_CRON_SCHEDULE: ${env.SYNC_CRON_SCHEDULE}`);
  }

  task = cron.schedule(env.SYNC_CRON_SCHEDULE, async () => {
    const results = await syncService.syncAll();
    for (const result of results) {
      if (result.status === 'ok') {
        // eslint-disable-next-line no-console
        console.log(`[sync] ${result.count} deployments sincronizados`);
      } else if (result.status !== 'skipped') {
        // eslint-disable-next-line no-console
        console.warn(`[sync] ${result.status}: ${result.error ?? ''}`);
      }
    }
  });

  // eslint-disable-next-line no-console
  console.log(`[sync] Scheduler iniciado (cron: ${env.SYNC_CRON_SCHEDULE})`);
}

export function stopSyncScheduler(): void {
  if (task) {
    void task.stop();
    task = null;
  }
}
