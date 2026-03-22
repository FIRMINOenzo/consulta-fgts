import { describe, it, expect, vi, beforeEach } from 'vitest';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

vi.mock('../../app', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
  },
}));

vi.mock('../../config', () => ({
  config: { jwtSecret: 'test-secret' },
}));

import { login, register, getMe } from '../auth.service';
import { prisma } from '../../app';

const mockPrisma = prisma as unknown as {
  user: { findUnique: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> };
};

const hashedPassword = bcrypt.hashSync('password123', 10);

const mockUser = {
  id: 'user-1',
  email: 'test@example.com',
  password: hashedPassword,
  name: 'Test User',
  role: 'user',
  createdAt: new Date(),
};

describe('login', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws when email not found', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);

    await expect(login('bad@email.com', 'pass')).rejects.toThrow('Invalid credentials');
  });

  it('throws when password is wrong', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(mockUser);

    await expect(login('test@example.com', 'wrongpass')).rejects.toThrow('Invalid credentials');
  });

  it('returns token and user on valid credentials', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(mockUser);

    const result = await login('test@example.com', 'password123');

    expect(result.token).toBeDefined();
    expect(result.user).toEqual({
      id: 'user-1',
      email: 'test@example.com',
      name: 'Test User',
      role: 'user',
    });
    // Verify password is not in the response
    expect(result.user).not.toHaveProperty('password');
  });

  it('returns a valid JWT', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(mockUser);

    const result = await login('test@example.com', 'password123');
    const decoded = jwt.verify(result.token, 'test-secret') as any;

    expect(decoded.id).toBe('user-1');
    expect(decoded.email).toBe('test@example.com');
    expect(decoded.role).toBe('user');
  });
});

describe('register', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws when email already exists', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(mockUser);

    await expect(
      register('test@example.com', 'pass', 'Name')
    ).rejects.toThrow('Email already registered');
  });

  it('creates user and returns profile without password', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    mockPrisma.user.create.mockResolvedValue({
      id: 'user-2',
      email: 'new@example.com',
      password: 'hashed',
      name: 'New User',
      role: 'user',
    });

    const result = await register('new@example.com', 'pass123', 'New User');

    expect(result).toEqual({
      id: 'user-2',
      email: 'new@example.com',
      name: 'New User',
      role: 'user',
    });
    expect(result).not.toHaveProperty('password');
  });

  it('hashes the password before storing', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    mockPrisma.user.create.mockResolvedValue({
      id: 'user-2',
      email: 'new@example.com',
      password: 'hashed',
      name: 'New User',
      role: 'user',
    });

    await register('new@example.com', 'plaintext', 'New User');

    const createCall = mockPrisma.user.create.mock.calls[0][0];
    expect(createCall.data.password).not.toBe('plaintext');
    expect(createCall.data.password).toMatch(/^\$2[aby]\$/); // bcrypt hash pattern
  });

  it('defaults role to user', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    mockPrisma.user.create.mockResolvedValue({
      id: 'user-2',
      email: 'new@example.com',
      password: 'hashed',
      name: 'New User',
      role: 'user',
    });

    await register('new@example.com', 'pass', 'New User');

    const createCall = mockPrisma.user.create.mock.calls[0][0];
    expect(createCall.data.role).toBe('user');
  });
});

describe('getMe', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws when user not found', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);

    await expect(getMe('nonexistent')).rejects.toThrow('User not found');
  });

  it('returns user profile without password', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(mockUser);

    const result = await getMe('user-1');

    expect(result).toEqual({
      id: 'user-1',
      email: 'test@example.com',
      name: 'Test User',
      role: 'user',
    });
    expect(result).not.toHaveProperty('password');
  });
});
