import dotenv from 'dotenv';
dotenv.config();

function required(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  databaseUrl: required('DATABASE_URL'),
  jwtSecret: required('JWT_SECRET'),

  admin: {
    email: required('ADMIN_EMAIL'),
    password: required('ADMIN_PASSWORD'),
    name: required('ADMIN_NAME'),
  },

  v8: {
    clientId: required('V8_CLIENT_ID'),
    clientSecret: required('V8_CLIENT_SECRET'),
    username: required('V8_USERNAME'),
    password: required('V8_PASSWORD'),
  },

  submitConcurrency: parseInt(process.env.SUBMIT_CONCURRENCY || '5', 10),
  webhookBaseUrl: required('WEBHOOK_BASE_URL'),
};
