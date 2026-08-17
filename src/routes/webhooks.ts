import { Router, type Request, type Response } from 'express';
import { env } from '../config/env';
import { webhookService, type WebhookProvider } from '../services/webhookService';
import { audit } from '../services/audit';

export const webhooksRouter = Router();

function verifySecret(req: Request, res: Response): boolean {
  const secret = req.headers['x-webhook-secret'];
  if (typeof secret !== 'string' || secret !== env.WEBHOOK_SECRET) {
    res.status(401).json({ error: 'Invalid webhook secret' });
    return false;
  }
  return true;
}

async function handleWebhook(provider: WebhookProvider, req: Request, res: Response): Promise<void> {
  if (!verifySecret(req, res)) return;

  const result = await webhookService.ingest(provider, req.body);

  await audit.log({
    userId: null,
    action: 'webhook.received',
    resourceType: 'DEPLOYMENT',
    resourceId: result.deploymentId,
    details: { provider, status: result.status },
  });

  if (result.status === 'project_not_found') {
    res.status(404).json({ error: result.error ?? 'Project not found for webhook' });
    return;
  }

  res.status(202).json(result);
}

webhooksRouter.post('/vercel', async (req, res) => {
  await handleWebhook('VERCEL', req, res);
});

webhooksRouter.post('/jenkins', async (req, res) => {
  await handleWebhook('JENKINS', req, res);
});