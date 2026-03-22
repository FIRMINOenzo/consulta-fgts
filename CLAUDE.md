# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**consulta-fgts** — A web app for companies to batch-query FGTS (Brazilian retirement fund) balances via the V8 Digital API. Users upload a CSV of CPFs, the app submits them to V8, and results arrive asynchronously via webhooks.

## Tech Stack

- **Backend:** TypeScript + Express.js
- **Database:** SQLite (dev) / PostgreSQL (prod) via Prisma ORM
- **Frontend:** HTML + CSS + Vanilla JS (no build step, served via `express.static`)
- **Auth:** JWT + bcrypt (admin seeds from env vars, no self-registration)
- **CSV:** `csv-parse` for parsing

## Architecture

The app uses an **async webhook pattern** — no polling, no background jobs:
1. App POSTs each CPF to V8 Digital API (5 concurrent via `SUBMIT_CONCURRENCY`)
2. V8 processes asynchronously and calls back `POST /api/webhooks/v8/balance`
3. Webhook handler updates the BatchItem in the database

Two V8 API endpoints:
- **Auth:** `POST https://api.v8digital.com/oauth/token` (OAuth 2.0, JWT with 24h TTL)
- **Balance:** `POST https://bff.v8sistema.com/fgts/balance` (async, returns null)

Providers: `BMS`, `QI`, `CARTOS` — default is `QI`.

## Project Structure

```
src/
├── server.ts              # Express entry point
├── config.ts              # Env vars, constants
├── routes/                # auth, batch, webhook routes
├── middleware/             # JWT auth middleware
├── services/
│   ├── v8/                # V8 OAuth + balance API client
│   ├── batch.service.ts   # CSV parsing + batch orchestration
│   └── auth.service.ts    # App user auth (bcrypt + JWT)
└── utils/csv.ts           # CSV parse/export helpers
prisma/schema.prisma       # DB schema (User, Batch, BatchItem)
public/                    # Static frontend (HTML/CSS/JS)
```

## Key Domain Concepts

- **Batch** — A CSV upload containing CPFs. Statuses: `pending → processing → completed`
- **BatchItem** — A single CPF query. Statuses: `pending → submitted → success|fail`
- Items stuck as `submitted` (V8 never called back) can be retried manually by the user

## Build & Development Commands

```bash
npm install --registry https://registry.npmjs.org   # Install dependencies (always use public registry)
npx prisma migrate dev             # Run database migrations
npx prisma generate                # Generate Prisma client
npm run dev                        # Start dev server (ts-node or tsx)
npm run build                      # Compile TypeScript
npm start                          # Start production server
npm test                           # Run tests (vitest)
```

**npm registry:** Always use `--registry https://registry.npmjs.org` when running `npm install` to avoid auth issues with private registries.

For webhook testing in local dev, use `ngrok http 3000` and configure the ngrok URL in V8.

## Important Constraints

- CPF is PII under LGPD — never log CPFs in plain text
- V8 token expires in 24h — auto-refresh before expiry
- Webhook endpoint (`/api/webhooks/v8/balance`) requires no auth (called by V8 externally)
- CSV input: `cpf` (required, 11 digits with checksum validation), `nome` (optional)
- Duplicate CPFs within a batch are deduplicated (keep first)
