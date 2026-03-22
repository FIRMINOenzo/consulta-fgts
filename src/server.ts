import { config } from './config';
import { prisma } from './app';
import app from './app';
import bcrypt from 'bcrypt';

async function seedAdmin() {
  const existing = await prisma.user.findUnique({
    where: { email: config.admin.email },
  });

  if (!existing) {
    const hashedPassword = await bcrypt.hash(config.admin.password, 10);
    await prisma.user.create({
      data: {
        email: config.admin.email,
        password: hashedPassword,
        name: config.admin.name,
        role: 'admin',
      },
    });
    console.log(`Admin user seeded: ${config.admin.email}`);
  }
}

async function main() {
  await seedAdmin();

  app.listen(config.port, () => {
    console.log(`Server running on port ${config.port}`);
  });
}

main().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
