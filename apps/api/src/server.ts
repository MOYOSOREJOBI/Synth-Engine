import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import Database from 'better-sqlite3';
import argon2 from 'argon2';
import { AuthPayloadSchema, CloudPatchUpsertSchema } from '@pulsesynth/shared';
import { z } from 'zod';

const db = new Database(process.env.DB_FILE ?? 'pulsesynth.db');
db.exec(`
create table if not exists users (id integer primary key, email text unique not null, passhash text not null, created_at text default current_timestamp);
create table if not exists patches (id integer primary key, owner integer not null, name text not null, shared integer default 0, data text not null, updated_at text default current_timestamp);
create index if not exists idx_patch_owner on patches(owner);
create index if not exists idx_patch_updated on patches(updated_at);
`);

const app = Fastify({ logger: true, bodyLimit: 64 * 1024 });
await app.register(cors, { origin: process.env.CORS_ORIGIN ?? 'http://localhost:5173' });
await app.register(jwt, { secret: process.env.JWT_SECRET ?? 'dev-secret' });
await app.register(rateLimit, { max: 150, timeWindow: '1 minute' });

app.addHook('onSend', async (_req, reply) => {
  reply.header('x-content-type-options', 'nosniff');
  reply.header('x-frame-options', 'DENY');
  reply.header('referrer-policy', 'same-origin');
});

const auth = async (req: any) => req.jwtVerify();

app.get('/healthz', async () => ({ ok: true }));
app.get('/readyz', async () => ({ ready: true }));
app.get('/version', async () => ({ version: '0.2.0' }));

app.post('/v1/auth/signup', async (req) => {
  const { email, password } = AuthPayloadSchema.parse(req.body);
  const hash = await argon2.hash(password);
  const result = db.prepare('insert into users (email, passhash) values (?, ?)').run(email, hash);
  return { token: app.jwt.sign({ sub: result.lastInsertRowid, email }) };
});
app.post('/v1/auth/login', async (req) => {
  const { email, password } = AuthPayloadSchema.parse(req.body);
  const user = db.prepare('select * from users where email = ?').get(email) as any;
  if (!user || !(await argon2.verify(user.passhash, password))) throw app.httpErrors.unauthorized();
  return { token: app.jwt.sign({ sub: user.id, email }) };
});
app.get('/v1/me', { preHandler: [auth] }, async (req: any) => ({ id: req.user.sub, email: req.user.email }));

app.post('/v1/patches', { preHandler: [auth] }, async (req: any) => {
  const { name, shared, patch } = CloudPatchUpsertSchema.parse(req.body);
  const result = db.prepare('insert into patches (owner, name, shared, data) values (?, ?, ?, ?)').run(req.user.sub, name, shared ? 1 : 0, JSON.stringify(patch));
  return { id: result.lastInsertRowid };
});
app.get('/v1/patches', { preHandler: [auth] }, async (req: any) => db.prepare('select id,name,shared,updated_at from patches where owner=? order by updated_at desc').all(req.user.sub));
app.get('/v1/patches/:id', async (req: any) => {
  const id = z.coerce.number().parse(req.params.id);
  const patch = db.prepare('select * from patches where id=?').get(id) as any;
  if (!patch) throw app.httpErrors.notFound();

  if (!patch.shared) {
    const authHeader = req.headers.authorization;
    if (!authHeader) throw app.httpErrors.forbidden();
    const payload = await app.jwt.verify<{ sub: number }>(authHeader.replace('Bearer ', ''));
    if (Number(payload.sub) !== Number(patch.owner)) throw app.httpErrors.forbidden();
  }
  return { id: patch.id, name: patch.name, shared: !!patch.shared, patch: JSON.parse(patch.data) };
});
app.patch('/v1/patches/:id', { preHandler: [auth] }, async (req: any) => {
  const id = z.coerce.number().parse(req.params.id);
  const old = db.prepare('select * from patches where id=?').get(id) as any;
  if (!old || Number(old.owner) !== Number(req.user.sub)) throw app.httpErrors.forbidden();

  const body = CloudPatchUpsertSchema.partial().parse(req.body);
  db.prepare('update patches set name=?, shared=?, data=?, updated_at=current_timestamp where id=?').run(
    body.name ?? old.name,
    body.shared == null ? old.shared : (body.shared ? 1 : 0),
    body.patch ? JSON.stringify(body.patch) : old.data,
    id
  );
  return { ok: true };
});
app.post('/v1/patches/:id/share', { preHandler: [auth] }, async (req: any) => {
  const id = z.coerce.number().parse(req.params.id);
  const old = db.prepare('select id,owner,shared from patches where id=?').get(id) as any;
  if (!old || Number(old.owner) !== Number(req.user.sub)) throw app.httpErrors.forbidden();
  const nextShared = old.shared ? 0 : 1;
  db.prepare('update patches set shared=?, updated_at=current_timestamp where id=?').run(nextShared, id);
  return { id, shared: !!nextShared };
});
app.delete('/v1/patches/:id', { preHandler: [auth] }, async (req: any) => {
  const id = z.coerce.number().parse(req.params.id);
  db.prepare('delete from patches where id=? and owner=?').run(id, req.user.sub);
  return { ok: true };
});

app.listen({ port: Number(process.env.PORT ?? 8787), host: '0.0.0.0' });
