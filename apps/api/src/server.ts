import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import sensible from '@fastify/sensible';
import Database from 'better-sqlite3';
import argon2 from 'argon2';
import { z } from 'zod';

// ── Database ─────────────────────────────────────────────────────────
const db = new Database(process.env.DB_FILE ?? 'pulsesynth.db');
db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    passhash TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS patches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner INTEGER NOT NULL REFERENCES users(id),
    name TEXT NOT NULL,
    shared INTEGER DEFAULT 0,
    data TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_patches_owner ON patches(owner);
  CREATE INDEX IF NOT EXISTS idx_patches_updated ON patches(updated_at);
`);

// ── App ──────────────────────────────────────────────────────────────
const app = Fastify({ logger: true, bodyLimit: 65536 });
await app.register(sensible);
await app.register(cors, {
  origin: (process.env.CORS_ORIGIN ?? 'http://localhost:5173').split(','),
  credentials: true,
});
await app.register(jwt, { secret: process.env.JWT_SECRET ?? 'dev-secret-change-in-prod' });
await app.register(rateLimit, { max: 120, timeWindow: '1 minute' });

// ── Error handler ────────────────────────────────────────────────────
app.setErrorHandler((err: Error & { validation?: unknown; statusCode?: number }, _request, reply) => {
  if (err.validation) {
    return reply.status(400).send({ error: 'Validation failed', details: err.message });
  }
  if (err.statusCode) {
    return reply.status(err.statusCode).send({ error: err.message });
  }
  app.log.error(err);
  return reply.status(500).send({ error: 'Internal server error' });
});

// ── Health ────────────────────────────────────────────────────────────
app.get('/healthz', async () => ({ ok: true }));
app.get('/readyz', async () => {
  try {
    db.prepare('SELECT 1').get();
    return { ready: true };
  } catch {
    return { ready: false };
  }
});
app.get('/version', async () => ({
  version: '0.1.0',
  node: process.version,
}));

// ── Auth ──────────────────────────────────────────────────────────────
const authSchema = z.object({ email: z.string().email(), password: z.string().min(8) });

app.post('/v1/auth/signup', async (req, reply) => {
  const parsed = authSchema.safeParse(req.body);
  if (!parsed.success) return reply.badRequest(parsed.error.message);
  const { email, password } = parsed.data;
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) return reply.conflict('Email already registered');
  const hash = await argon2.hash(password);
  const result = db.prepare('INSERT INTO users (email, passhash) VALUES (?, ?)').run(email, hash);
  return { token: app.jwt.sign({ sub: Number(result.lastInsertRowid) }) };
});

app.post('/v1/auth/login', async (req, reply) => {
  const parsed = authSchema.safeParse(req.body);
  if (!parsed.success) return reply.badRequest(parsed.error.message);
  const { email, password } = parsed.data;
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email) as { id: number; passhash: string } | undefined;
  if (!user || !(await argon2.verify(user.passhash, password))) {
    return reply.unauthorized('Invalid credentials');
  }
  return { token: app.jwt.sign({ sub: user.id }) };
});

app.get('/v1/me', {
  preHandler: [async (r) => { await r.jwtVerify(); }],
}, async (req) => {
  const user = req.user as { sub: number };
  return { id: user.sub };
});

// ── Patches ──────────────────────────────────────────────────────────
const patchCreateSchema = z.object({
  name: z.string().min(1).max(100),
  shared: z.boolean().default(false),
  patch: z.record(z.unknown()),
});

const patchUpdateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  shared: z.boolean().optional(),
  patch: z.record(z.unknown()).optional(),
});

app.post('/v1/patches', {
  preHandler: [async (r) => { await r.jwtVerify(); }],
}, async (req, reply) => {
  const parsed = patchCreateSchema.safeParse(req.body);
  if (!parsed.success) return reply.badRequest(parsed.error.message);
  const { name, shared, patch } = parsed.data;
  const user = req.user as { sub: number };
  const result = db.prepare(
    'INSERT INTO patches (owner, name, shared, data) VALUES (?, ?, ?, ?)'
  ).run(user.sub, name, shared ? 1 : 0, JSON.stringify(patch));
  return { id: Number(result.lastInsertRowid) };
});

app.get('/v1/patches', {
  preHandler: [async (r) => { await r.jwtVerify(); }],
}, async (req) => {
  const user = req.user as { sub: number };
  return db.prepare(
    'SELECT id, name, shared, updated_at FROM patches WHERE owner = ? ORDER BY updated_at DESC'
  ).all(user.sub);
});

app.get('/v1/patches/:id', async (req, reply) => {
  const { id } = req.params as { id: string };
  const row = db.prepare('SELECT * FROM patches WHERE id = ?').get(Number(id)) as {
    id: number; owner: number; name: string; shared: number; data: string;
  } | undefined;
  if (!row) return reply.notFound();

  let isOwner = false;
  try {
    await req.jwtVerify();
    isOwner = (req.user as { sub: number }).sub === row.owner;
  } catch { /* not authenticated */ }

  if (!row.shared && !isOwner) return reply.forbidden('Patch is private');
  return { id: row.id, name: row.name, shared: !!row.shared, patch: JSON.parse(row.data) };
});

app.patch('/v1/patches/:id', {
  preHandler: [async (r) => { await r.jwtVerify(); }],
}, async (req, reply) => {
  const { id } = req.params as { id: string };
  const parsed = patchUpdateSchema.safeParse(req.body);
  if (!parsed.success) return reply.badRequest(parsed.error.message);
  const { name, shared, patch } = parsed.data;
  const user = req.user as { sub: number };
  const row = db.prepare('SELECT * FROM patches WHERE id = ?').get(Number(id)) as {
    id: number; owner: number; name: string; shared: number; data: string;
  } | undefined;
  if (!row) return reply.notFound();
  if (row.owner !== user.sub) return reply.forbidden();
  db.prepare(
    "UPDATE patches SET name = ?, shared = ?, data = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(
    name ?? row.name,
    shared !== undefined ? (shared ? 1 : 0) : row.shared,
    patch ? JSON.stringify(patch) : row.data,
    Number(id),
  );
  return { ok: true };
});

app.delete('/v1/patches/:id', {
  preHandler: [async (r) => { await r.jwtVerify(); }],
}, async (req, reply) => {
  const { id } = req.params as { id: string };
  const user = req.user as { sub: number };
  const result = db.prepare('DELETE FROM patches WHERE id = ? AND owner = ?').run(Number(id), user.sub);
  if (result.changes === 0) return reply.notFound();
  return { ok: true };
});

// ── Start ────────────────────────────────────────────────────────────
const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? '0.0.0.0';
app.listen({ port, host }, (err) => {
  if (err) {
    app.log.error(err);
    process.exit(1);
  }
});
