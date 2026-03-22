import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { authenticate, requireAdmin } from '../auth.middleware';

vi.mock('../../config', () => ({
  config: { jwtSecret: 'test-secret' },
}));

function mockRes() {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
  return res;
}

describe('authenticate', () => {
  let next: NextFunction;

  beforeEach(() => {
    next = vi.fn() as unknown as NextFunction;
  });

  it('returns 401 when no Authorization header', () => {
    const req = { headers: {} } as Request;
    const res = mockRes();

    authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Authentication required' });
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 when header is not Bearer', () => {
    const req = { headers: { authorization: 'Basic abc' } } as Request;
    const res = mockRes();

    authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 when token is invalid', () => {
    const req = { headers: { authorization: 'Bearer invalid-token' } } as Request;
    const res = mockRes();

    authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid or expired token' });
    expect(next).not.toHaveBeenCalled();
  });

  it('sets req.user and calls next on valid token', () => {
    const payload = { id: 'u1', email: 'a@b.com', role: 'user' };
    const token = jwt.sign(payload, 'test-secret');
    const req = { headers: { authorization: `Bearer ${token}` } } as Request;
    const res = mockRes();

    authenticate(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.user).toMatchObject(payload);
  });
});

describe('requireAdmin', () => {
  let next: NextFunction;

  beforeEach(() => {
    next = vi.fn() as unknown as NextFunction;
  });

  it('returns 403 when no user on request', () => {
    const req = {} as Request;
    const res = mockRes();

    requireAdmin(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'Admin access required' });
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 403 when user role is not admin', () => {
    const req = { user: { id: 'u1', email: 'a@b.com', role: 'user' } } as Request;
    const res = mockRes();

    requireAdmin(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('calls next when user is admin', () => {
    const req = { user: { id: 'u1', email: 'a@b.com', role: 'admin' } } as Request;
    const res = mockRes();

    requireAdmin(req, res, next);

    expect(next).toHaveBeenCalled();
  });
});
