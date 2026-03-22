import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { prisma } from '../app';
import { config } from '../config';

export async function login(email: string, password: string) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    throw new Error('Invalid credentials');
  }

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) {
    throw new Error('Invalid credentials');
  }

  const token = jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    config.jwtSecret,
    { expiresIn: '24h' }
  );

  return {
    token,
    user: { id: user.id, email: user.email, name: user.name, role: user.role },
  };
}

export async function register(
  email: string,
  password: string,
  name: string,
  role: string = 'user'
) {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    throw new Error('Email already registered');
  }

  const hashedPassword = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: { email, password: hashedPassword, name, role },
  });

  return { id: user.id, email: user.email, name: user.name, role: user.role };
}

export async function getMe(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    throw new Error('User not found');
  }

  return { id: user.id, email: user.email, name: user.name, role: user.role };
}
