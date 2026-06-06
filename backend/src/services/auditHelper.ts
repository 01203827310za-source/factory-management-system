// ============================================
// Audit Log Helper — fire-and-forget logger
// Wraps prisma.auditLog.create in a safe try-catch
// so a logging failure never breaks a real operation.
// ============================================

import prisma from '../lib/prisma';
import { AuthPayload } from '../middleware/auth';

export async function logAudit(opts: {
  user?: AuthPayload;
  module: string;
  action: 'CREATE' | 'UPDATE' | 'DELETE';
  record_id: string | number;
  before_data?: unknown;
  after_data?: unknown;
  description?: string;
}): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        user_id:     opts.user?.userId ?? 0,
        user_name:   opts.user?.username ?? 'system',
        module:      opts.module,
        action:      opts.action,
        record_id:   String(opts.record_id),
        before_data: opts.before_data ? JSON.stringify(opts.before_data) : null,
        after_data:  opts.after_data  ? JSON.stringify(opts.after_data)  : null,
        description: opts.description ?? '',
      },
    });
  } catch (err) {
    console.error('⚠️  Audit log write failed (non-fatal):', err);
  }
}
