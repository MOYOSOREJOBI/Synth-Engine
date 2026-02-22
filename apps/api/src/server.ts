import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import Database from 'better-sqlite3';
import argon2 from 'argon2';
import { z } from 'zod';

const db = new Database(process.env.DB_FILE ?? 'pulsesynth.db');
db.exec('create table if not exists users (id integer primary key, email text unique, passhash text); create table if not exists patches (id integer primary key, owner integer, name text, shared integer default 0, data text)');

const app = Fastify({ logger: true, bodyLimit: 32_768 });
await app.register(cors, { origin: process.env.CORS_ORIGIN ?? 'http://localhost:5173' });
await app.register(jwt, { secret: process.env.JWT_SECRET ?? 'dev-secret' });
await app.register(rateLimit, { max: 120, timeWindow: '1 minute' });

app.get('/healthz', async () => ({ ok: true }));
app.get('/readyz', async () => ({ ready: true }));

const authSchema = z.object({ email: z.string().email(), password: z.string().min(8) });
app.post('/v1/auth/signup', async (req, reply) => {
  const { email, password } = authSchema.parse(req.body);
  const hash = await argon2.hash(password);
  const result = db.prepare('insert into users (email, passhash) values (?, ?)').run(email, hash);
  return { token: app.jwt.sign({ sub: result.lastInsertRowid }) };
});
app.post('/v1/auth/login', async (req) => {
  const { email, password } = authSchema.parse(req.body);
  const user = db.prepare('select * from users where email=?').get(email) as any;
  if (!user || !(await argon2.verify(user.passhash, password))) throw app.httpErrors.unauthorized();
  return { token: app.jwt.sign({ sub: user.id }) };
});
app.get('/v1/me', { preHandler: [async (r) => r.jwtVerify()] }, async (req: any) => ({ id: req.user.sub }));

const patchSchema = z.object({ name: z.string().min(1), shared: z.boolean().default(false), patch: z.any() });
app.post('/v1/patches', { preHandler: [async (r) => r.jwtVerify()] }, async (req: any) => {
  const { name, shared, patch } = patchSchema.parse(req.body);
  const result = db.prepare('insert into patches (owner, name, shared, data) values (?, ?, ?, ?)').run(req.user.sub, name, shared ? 1 : 0, JSON.stringify(patch));
  return { id: result.lastInsertRowid };
});
app.get('/v1/patches', { preHandler: [async (r) => r.jwtVerify()] }, async (req: any) => db.prepare('select id,name,shared from patches where owner=?').all(req.user.sub));
app.get('/v1/patches/:id', async (req: any) => {
  const patch = db.prepare('select * from patches where id=?').get(req.params.id) as any;
  if (!patch) throw app.httpErrors.notFound();
  return { id: patch.id, name: patch.name, shared: !!patch.shared, patch: JSON.parse(patch.data) };
});
app.patch('/v1/patches/:id', { preHandler: [async (r) => r.jwtVerify()] }, async (req: any) => {
  const { name, shared, patch } = patchSchema.partial().parse(req.body);
  const old = db.prepare('select * from patches where id=?').get(req.params.id) as any;
  if (!old || old.owner !== req.user.sub) throw app.httpErrors.forbidden();
  db.prepare('update patches set name=?, shared=?, data=? where id=?').run(name ?? old.name, shared == null ? old.shared : (shared ? 1 : 0), patch ? JSON.stringify(patch) : old.data, req.params.id);
  return { ok: true };
});
app.delete('/v1/patches/:id', { preHandler: [async (r) => r.jwtVerify()] }, async (req: any) => {
  db.prepare('delete from patches where id=? and owner=?').run(req.params.id, req.user.sub);
  return { ok: true };
});

app.listen({ port: Number(process.env.PORT ?? 8787), host: '0.0.0.0' });
