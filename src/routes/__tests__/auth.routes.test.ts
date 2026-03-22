import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import app, { prisma } from '../../app';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-jwt-secret-change-in-production';

function adminToken() {
  return jwt.sign({ id: 'admin-id', email: 'admin@test.com', role: 'admin' }, JWT_SECRET);
}

function userToken(id = 'user-id') {
  return jwt.sign({ id, email: 'user@test.com', role: 'user' }, JWT_SECRET);
}

beforeAll(async () => {
  // Ensure clean DB state
  await prisma.batchItem.deleteMany();
  await prisma.batch.deleteMany();
  await prisma.user.deleteMany();
});

afterAll(async () => {
  await prisma.batchItem.deleteMany();
  await prisma.batch.deleteMany();
  await prisma.user.deleteMany();
  await prisma.$disconnect();
});

describe('POST /api/auth/login', () => {
  beforeEach(async () => {
    await prisma.user.deleteMany();
    const hashed = await bcrypt.hash('correct-password', 10);
    await prisma.user.create({
      data: {
        id: 'login-user',
        email: 'login@test.com',
        password: hashed,
        name: 'Login User',
        role: 'user',
      },
    });
  });

  it('returns 400 when email or password missing', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'a@b.com' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Email and password are required');
  });

  it('returns 401 on wrong email', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'wrong@test.com', password: 'correct-password' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid credentials');
  });

  it('returns 401 on wrong password', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'login@test.com', password: 'wrong' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid credentials');
  });

  it('returns token and user on valid credentials', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'login@test.com', password: 'correct-password' });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
    expect(res.body.user.email).toBe('login@test.com');
    expect(res.body.user).not.toHaveProperty('password');
  });
});

describe('POST /api/auth/register', () => {
  beforeEach(async () => {
    await prisma.user.deleteMany();
    const hashed = await bcrypt.hash('admin-pass', 10);
    await prisma.user.create({
      data: {
        id: 'admin-id',
        email: 'admin@test.com',
        password: hashed,
        name: 'Admin',
        role: 'admin',
      },
    });
  });

  it('returns 401 without auth token', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'new@test.com', password: 'pass', name: 'New' });
    expect(res.status).toBe(401);
  });

  it('returns 403 when non-admin tries to register', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .set('Authorization', `Bearer ${userToken()}`)
      .send({ email: 'new@test.com', password: 'pass', name: 'New' });
    expect(res.status).toBe(403);
  });

  it('returns 400 when required fields missing', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ email: 'new@test.com' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Email, password, and name are required');
  });

  it('returns 400 on invalid role', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ email: 'new@test.com', password: 'pass', name: 'New', role: 'superadmin' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Role must be "admin" or "user"');
  });

  it('creates user when admin provides valid data', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ email: 'new@test.com', password: 'pass123', name: 'New User' });
    expect(res.status).toBe(201);
    expect(res.body.email).toBe('new@test.com');
    expect(res.body.role).toBe('user');
    expect(res.body).not.toHaveProperty('password');
  });

  it('returns 400 on duplicate email', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .set('Authorization', `Bearer ${adminToken()}`)
      .send({ email: 'admin@test.com', password: 'pass', name: 'Dup' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Email already registered');
  });
});

describe('GET /api/auth/me', () => {
  beforeEach(async () => {
    await prisma.user.deleteMany();
    const hashed = await bcrypt.hash('pass', 10);
    await prisma.user.create({
      data: {
        id: 'me-user',
        email: 'me@test.com',
        password: hashed,
        name: 'Me User',
        role: 'user',
      },
    });
  });

  it('returns 401 without token', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  it('returns current user profile', async () => {
    const token = jwt.sign({ id: 'me-user', email: 'me@test.com', role: 'user' }, JWT_SECRET);
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.email).toBe('me@test.com');
    expect(res.body.name).toBe('Me User');
    expect(res.body).not.toHaveProperty('password');
  });
});
