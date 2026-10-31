import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { makeApp, loginAs, PASSWORDS } from './helpers';

const resetToken = (body: string) => /token=([a-f0-9]+)/.exec(body)![1];

describe('sign up', () => {
  it('rejects a weak password with the rule that failed', async () => {
    const { app } = await makeApp();
    const res = await request(app).post('/api/auth/signup').send({ name: 'A', email: 'a@x.test', password: 'weakpass' });
    expect(res.status).toBe(400);
    expect(res.body.fields.password).toContain('Use more than eight characters.');
  });
  it('rejects an email already used, ignoring case', async () => {
    const { app } = await makeApp();
    await request(app).post('/api/auth/signup').send({ name: 'A', email: 'ann@x.test', password: PASSWORDS.customer });
    const res = await request(app).post('/api/auth/signup').send({ name: 'B', email: 'ANN@x.test', password: PASSWORDS.customer });
    expect(res.status).toBe(409);
  });
  it('creates a customer account and record, and signs in', async () => {
    const { app, db } = await makeApp();
    const agent = request.agent(app);
    const res = await agent.post('/api/auth/signup').send({ name: 'Ann', email: 'ann@x.test', password: PASSWORDS.customer });
    expect(res.status).toBe(201);
    const me = await agent.get('/api/auth/me');
    expect(me.body.user).toMatchObject({ email: 'ann@x.test', role: 'customer' });
    expect(me.body.user.customerId).toBeTypeOf('number');
    expect(await db.prepare('SELECT count(*) n FROM customers').get()).toEqual({ n: 1 });
  });
});

describe('sign in', () => {
  it('keeps the session over plain http when running in production (localhost or a LAN address)', async () => {
    const { app } = await makeApp();
    const before = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const agent = await loginAs(app, 'admin');
      expect((await agent.get('/api/auth/me')).status).toBe(200);
    } finally {
      process.env.NODE_ENV = before;
    }
  });
  it('rejects a wrong password', async () => {
    const { app } = await makeApp();
    const res = await request(app).post('/api/auth/login').send({ email: 'admin@brightloop.test', password: 'Wrong!pass1' });
    expect(res.status).toBe(401);
  });
  it('signs out', async () => {
    const { app } = await makeApp();
    const agent = await loginAs(app, 'admin');
    await agent.post('/api/auth/logout');
    expect((await agent.get('/api/auth/me')).status).toBe(401);
  });
});

describe('password reset', () => {
  it('answers the same for an unknown email and sends nothing', async () => {
    const { app, db } = await makeApp();
    const res = await request(app).post('/api/auth/forgot').send({ email: 'nobody@x.test' });
    expect(res.status).toBe(200);
    expect(await db.prepare('SELECT count(*) n FROM outbox').get()).toEqual({ n: 0 });
  });
  it('emails a single-use link that ends old sessions', async () => {
    const { app, db } = await makeApp();
    const old = await loginAs(app, 'staff');
    await request(app).post('/api/auth/forgot').send({ email: 'STAFF@brightloop.test' });
    const mail = await db.prepare('SELECT to_email, body FROM outbox').get() as { to_email: string; body: string };
    expect(mail.to_email).toBe('staff@brightloop.test');
    const token = resetToken(mail.body);
    const ok = await request(app).post('/api/auth/reset').send({ token, password: 'Brand!new1' });
    expect(ok.status).toBe(200);
    expect((await request(app).post('/api/auth/reset').send({ token, password: 'Brand!new2' })).status).toBe(400);
    expect((await old.get('/api/auth/me')).status).toBe(401);
    const login = await request(app).post('/api/auth/login').send({ email: 'staff@brightloop.test', password: 'Brand!new1' });
    expect(login.status).toBe(200);
  });
  it('rejects an expired link', async () => {
    const { app, db } = await makeApp();
    await request(app).post('/api/auth/forgot').send({ email: 'staff@brightloop.test' });
    const token = resetToken((await db.prepare('SELECT body FROM outbox').get() as { body: string }).body);
    await db.prepare("UPDATE password_resets SET expires_at = '2000-01-01T00:00:00.000Z'").run();
    expect((await request(app).post('/api/auth/reset').send({ token, password: 'Brand!new1' })).status).toBe(400);
  });
  it('applies the password rules on reset', async () => {
    const { app, db } = await makeApp();
    await request(app).post('/api/auth/forgot').send({ email: 'staff@brightloop.test' });
    const token = resetToken((await db.prepare('SELECT body FROM outbox').get() as { body: string }).body);
    expect((await request(app).post('/api/auth/reset').send({ token, password: 'short' })).status).toBe(400);
  });
});

describe('staff accounts', () => {
  it('only an admin can add staff', async () => {
    const { app } = await makeApp();
    const staff = await loginAs(app, 'staff');
    expect((await staff.post('/api/users').send({ name: 'S2', email: 's2@b.test', password: 'Staff!pass2' })).status).toBe(403);
    const admin = await loginAs(app, 'admin');
    const res = await admin.post('/api/users').send({ name: 'S2', email: 's2@b.test', password: 'Staff!pass2' });
    expect(res.status).toBe(201);
    expect(res.body.role).toBe('staff');
  });
  it('requires sign-in for the API', async () => {
    const { app } = await makeApp();
    expect((await request(app).get('/api/users')).status).toBe(401);
  });
});
