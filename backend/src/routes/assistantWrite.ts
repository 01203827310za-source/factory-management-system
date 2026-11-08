/**
 * Assistant write bridge — two-step, GET-only (the assistant can only send GET requests).
 *
 * Disabled unless ASSISTANT_WRITE_KEY is set (min 32 chars). Key: header `x-write-key` or `?key=`.
 * Every change runs through the SAME API routes the screens use (stock, collections, audit log),
 * signed in as the in-app user named by ASSISTANT_USERNAME (default "claude"), so that user's
 * permissions apply and the audit log records the change under that user. Nothing is ever deleted.
 *
 *   1) GET /api/assistant-write/propose?op=<op>&data=<json>[&id=<record id>][&season_id=<id>]
 *        -> nothing is written. Returns a preview and a one-time `token` (valid 30 min).
 *   2) GET /api/assistant-write/confirm?token=<token>
 *        -> runs the change once. Re-sending the same token never runs it again.
 *
 * ops: sale.create, sale.update, expense.create, expense.update
 */
import { Router, Request, Response, NextFunction } from 'express';
import { createHmac, randomUUID, timingSafeEqual } from 'crypto';
import http from 'http';
import jwt from 'jsonwebtoken';
import prisma from '../lib/prisma';
import { getEffectivePermissionKeys } from '../services/rbacService';

const router = Router();

const OPS: Record<string, { method: 'POST' | 'PUT'; path: string; needsId: boolean; table: 'sale' | 'expenseRevenue' }> = {
  'sale.create':    { method: 'POST', path: '/api/sales',    needsId: false, table: 'sale' },
  'sale.update':    { method: 'PUT',  path: '/api/sales',    needsId: true,  table: 'sale' },
  'expense.create': { method: 'POST', path: '/api/expenses', needsId: false, table: 'expenseRevenue' },
  'expense.update': { method: 'PUT',  path: '/api/expenses', needsId: true,  table: 'expenseRevenue' },
};
const TOKEN_TTL_MS = 30 * 60 * 1000;
const AUDIT_MODULE = 'AssistantWrite';

const key = () => process.env.ASSISTANT_WRITE_KEY || '';

function requireWriteKey(req: Request, res: Response, next: NextFunction) {
  const expected = key();
  if (expected.length < 32) return res.status(404).json({ message: 'Not found' });
  const a = Buffer.from(String(req.header('x-write-key') || req.query.key || ''));
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return res.status(401).json({ message: 'Invalid key' });
  res.setHeader('Cache-Control', 'no-store');
  next();
}
router.use(requireWriteKey);
router.use((req, res, next) => (req.method === 'GET' ? next() : res.status(405).json({ message: 'GET only' })));

type Payload = { op: string; id: number | null; season_id: number | null; data: Record<string, unknown>; nonce: string; exp: number };

const sign = (body: string) => createHmac('sha256', key()).update(body).digest('base64url');

function makeToken(p: Payload) {
  const body = Buffer.from(JSON.stringify(p)).toString('base64url');
  return `${body}.${sign(body)}`;
}

function readToken(token: string): Payload | null {
  const [body, mac] = token.split('.');
  if (!body || !mac) return null;
  const a = Buffer.from(mac);
  const b = Buffer.from(sign(body));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try { return JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Payload; } catch { return null; }
}

async function assistantUser() {
  const username = process.env.ASSISTANT_USERNAME || 'claude';
  const user = await prisma.user.findUnique({ where: { username } });
  if (!user || !user.is_active) return null;
  return user;
}

function callApi(method: string, path: string, token: string, body: unknown, seasonId: number | null) {
  const payload = JSON.stringify(body);
  const headers: Record<string, string | number> = {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
    authorization: `Bearer ${token}`,
  };
  if (seasonId) headers['x-season-id'] = seasonId;
  return new Promise<{ status: number; body: unknown }>((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: Number(process.env.PORT || 3001), method, path, headers }, res => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', c => (raw += c));
      res.on('end', () => {
        let parsed: unknown = raw;
        try { parsed = JSON.parse(raw); } catch { /* keep text */ }
        resolve({ status: res.statusCode || 0, body: parsed });
      });
    });
    req.on('error', reject);
    req.end(payload);
  });
}

// Step 1 — preview only, writes nothing.
router.get('/propose', async (req, res, next) => {
  try {
    const op = String(req.query.op || '');
    const def = OPS[op];
    if (!def) return res.status(400).json({ message: 'Unknown op', ops: Object.keys(OPS) });

    let data: Record<string, unknown>;
    try { data = JSON.parse(String(req.query.data || '{}')); } catch { return res.status(400).json({ message: 'data must be JSON' }); }
    if (!data || typeof data !== 'object' || Array.isArray(data)) return res.status(400).json({ message: 'data must be a JSON object' });
    for (const k of ['id', 'season_id', 'season']) delete data[k];

    const id = def.needsId ? Number(req.query.id) : null;
    if (def.needsId && !(Number.isInteger(id) && (id as number) > 0)) return res.status(400).json({ message: 'id is required' });

    const seasonRaw = Number(req.query.season_id);
    const season_id = Number.isInteger(seasonRaw) && seasonRaw > 0 ? seasonRaw : null;

    let current: Record<string, unknown> | null = null;
    if (id) {
      current = await (prisma as any)[def.table].findUnique({ where: { id } });
      if (!current) return res.status(404).json({ message: 'Record not found' });
    }
    if (!(await assistantUser())) return res.status(409).json({ message: 'Assistant user is missing or inactive' });

    const changes = current
      ? Object.fromEntries(Object.entries(data).map(([k, v]) => [k, { from: current![k], to: v }]))
      : data;

    const token = makeToken({ op, id, season_id, data, nonce: randomUUID(), exp: Date.now() + TOKEN_TTL_MS });
    return res.json({ op, id, season_id, changes, expires_in_minutes: TOKEN_TTL_MS / 60000, token });
  } catch (err) { next(err); }
});

// Step 2 — runs once per token.
const running = new Set<string>();
router.get('/confirm', async (req, res, next) => {
  const p = readToken(String(req.query.token || ''));
  if (!p) return res.status(400).json({ message: 'Invalid token' });
  if (Date.now() > p.exp) return res.status(410).json({ message: 'Token expired — propose again' });
  const def = OPS[p.op];
  if (!def) return res.status(400).json({ message: 'Unknown op' });
  if (running.has(p.nonce)) return res.status(409).json({ message: 'Already running' });
  running.add(p.nonce);
  try {
    const prior = await prisma.auditLog.findFirst({ where: { module: AUDIT_MODULE, record_id: p.nonce } });
    if (prior) return res.status(409).json({ message: 'Already used', result: prior.description });

    const user = await assistantUser();
    if (!user) return res.status(409).json({ message: 'Assistant user is missing or inactive' });

    // Claim the token before running, so a repeat can never run it twice.
    const claim = await prisma.auditLog.create({
      data: { user_id: user.id, user_name: user.username, module: AUDIT_MODULE, action: def.method === 'POST' ? 'CREATE' : 'UPDATE',
              record_id: p.nonce, after_data: JSON.stringify({ op: p.op, id: p.id, data: p.data }), description: 'started' },
    });

    const token = jwt.sign(
      { userId: user.id, username: user.username, role: user.role, permissions: await getEffectivePermissionKeys(user.id) },
      process.env.JWT_SECRET!,
      { expiresIn: '2m' },
    );
    const path = def.needsId ? `${def.path}/${p.id}` : def.path;
    const result = await callApi(def.method, path, token, p.data, p.season_id);

    await prisma.auditLog.update({ where: { id: claim.id }, data: { description: `HTTP ${result.status}` } });
    return res.status(result.status >= 200 && result.status < 300 ? 200 : 422).json({ op: p.op, status: result.status, result: result.body });
  } catch (err) { next(err); } finally { running.delete(p.nonce); }
});

export default router;
