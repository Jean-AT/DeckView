import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';

export interface AuditLogEntry {
  userId?: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  details?: Record<string, unknown>;
}

class AuditService {
  async log(entry: AuditLogEntry): Promise<void> {
    await prisma.auditLog.create({
      data: {
        userId: entry.userId ?? null,
        action: entry.action,
        resourceType: entry.resourceType,
        resourceId: entry.resourceId ?? null,
        details: entry.details as Prisma.InputJsonValue | undefined,
      },
    });
  }
}

export const audit = new AuditService();