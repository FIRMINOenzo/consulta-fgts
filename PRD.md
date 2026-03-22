# PRD: consulta-fgts

## Product Requirements Document

**Product:** consulta-fgts — Batch FGTS balance query web app
**Date:** 2026-03-21
**Status:** Ready for implementation

---

## 1. Product Summary

A web application that allows a company to upload a CSV of CPFs, batch-query FGTS balances via the V8 Digital API, and view/export results. Results arrive asynchronously via webhooks — no polling or background jobs.

### Core User Flow

```
Login → Dashboard → Upload CSV → Start Processing → View Results → Export CSV
```

---

## 2. Implementation Phases

### Phase 1: Project Scaffold & Database - DONE

**Goal:** Working Express server with Prisma, database schema, and dev tooling.

#### Steps

1. **Initialize project**
   - `npm init` with project name `consulta-fgts`
   - Install dependencies: `express`, `typescript`, `prisma`, `@prisma/client`, `bcrypt`, `jsonwebtoken`, `csv-parse`, `dotenv`, `cors`, `multer`
   - Dev dependencies: `tsx`, `@types/express`, `@types/bcrypt`, `@types/jsonwebtoken`, `@types/cors`, `@types/multer`

2. **Configure TypeScript**
   - `tsconfig.json` targeting ES2020, strict mode, outDir `dist/`

3. **Create Prisma schema** (`prisma/schema.prisma`)
   - **User:** id (UUID), email (unique), password (bcrypt hash), name, role (`admin`|`user`), createdAt
   - **Batch:** id (UUID), userId (FK→User), fileName, provider (`BMS`|`QI`|`CARTOS`), status (`pending`|`processing`|`completed`), totalItems, processed (default 0), createdAt
   - **BatchItem:** id (UUID), batchId (FK→Batch), cpf, customerName, status (`pending`|`submitted`|`success`|`fail`), balance (Decimal, nullable), installments (JSON, nullable), errorMessage (nullable), v8BalanceId (nullable), createdAt, updatedAt
   - SQLite for dev, PostgreSQL datasource with env switch

4. **Create `src/config.ts`**
   - Load env vars: `PORT`, `DATABASE_URL`, `JWT_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME`, `V8_CLIENT_ID`, `V8_CLIENT_SECRET`, `V8_USERNAME`, `V8_PASSWORD`, `SUBMIT_CONCURRENCY` (default 5), `WEBHOOK_BASE_URL`
   - Export typed config object

5. **Create `src/server.ts`**
   - Express app with JSON body parser, CORS, `express.static('public')`
   - Route mounting (stubs)
   - Admin seed on startup (create admin user from env vars if not exists)
   - Listen on `PORT`

6. **Create `.env.example`** with all required vars

7. **Add npm scripts**
   - `dev`: `tsx watch src/server.ts`
   - `build`: `tsc`
   - `start`: `node dist/server.js`

#### Acceptance Criteria
- [ ] `npm run dev` starts the server
- [ ] `npx prisma migrate dev` creates all 3 tables
- [ ] Admin user is seeded on first startup
- [ ] `.env.example` documents all env vars

---

### Phase 2: Authentication (App Users)

**Goal:** JWT-based login for app users. Admin can register others.

#### Steps

1. **Create `src/services/auth.service.ts`**
   - `login(email, password)` → validates credentials, returns JWT (24h TTL)
   - `register(email, password, name, role)` → creates user with bcrypt-hashed password
   - `getMe(userId)` → returns user profile (no password)

2. **Create `src/middleware/auth.middleware.ts`**
   - Extract Bearer token from `Authorization` header
   - Verify JWT, attach `req.user = { id, email, role }` to request
   - `requireAdmin` middleware variant for admin-only routes

3. **Create `src/routes/auth.routes.ts`**
   - `POST /api/auth/login` → public, returns `{ token, user }`
   - `POST /api/auth/register` → admin-only, creates user
   - `GET /api/auth/me` → authenticated, returns current user

#### Acceptance Criteria
- [ ] Login returns a valid JWT
- [ ] Protected routes reject requests without valid token
- [ ] Admin can register new users
- [ ] Non-admin cannot access register endpoint
- [ ] Passwords are never returned in responses

---

### Phase 3: V8 Digital API Integration

**Goal:** OAuth token management and balance submission to V8.

#### Steps

1. **Create `src/services/v8/auth.service.ts`**
   - `getToken()` → returns cached token if valid, otherwise requests new one
   - POST to `https://api.v8digital.com/oauth/token` with `x-www-form-urlencoded`:
     - `grant_type=password`, `client_id`, `client_secret`, `username`, `password`
   - Cache token in memory, track expiry (refresh at 23h mark)
   - Auto-refresh before expiry

2. **Create `src/services/v8/balance.service.ts`**
   - `submitBalance(cpf, provider, webhookUrl)` → POST to `https://bff.v8sistema.com/fgts/balance`
   - Body: `{ documentNumber, provider, webhookUrl }`
   - Uses V8 auth token in Authorization header
   - Handle 401 → force token refresh and retry once

#### Acceptance Criteria
- [ ] V8 OAuth token is obtained and cached
- [ ] Token auto-refreshes before 24h expiry
- [ ] Balance submission sends correct payload to V8
- [ ] 401 triggers token refresh + single retry

---

### Phase 4: CSV Upload & Batch Creation

**Goal:** Upload CSV, validate CPFs, create batch with items.

#### Steps

1. **Create `src/utils/csv.ts`**
   - `parseCSV(buffer)` → parse CSV with `csv-parse`, return rows
   - `validateCPF(cpf)` → 11-digit check + checksum algorithm
   - `exportCSV(items)` → generate CSV string from batch items for download
   - Deduplication: remove duplicate CPFs (keep first occurrence)

2. **Create `src/services/batch.service.ts`**
   - `createBatch(userId, file, provider)`:
     1. Parse CSV
     2. Validate each row (CPF format + checksum)
     3. Deduplicate CPFs
     4. Create Batch record (status: `pending`)
     5. Create BatchItem records for valid rows
     6. Return batch with validation summary (valid count, rejected rows with reasons)

3. **Create `src/routes/batch.routes.ts`** (partial — upload + list)
   - `POST /api/batches` → authenticated, multipart upload (multer), creates batch
   - `GET /api/batches` → authenticated, list user's batches
   - `GET /api/batches/:id` → authenticated, batch detail + items

#### Acceptance Criteria
- [ ] CSV with valid CPFs creates a batch with items in `pending` status
- [ ] Invalid CPFs are rejected with clear error messages
- [ ] Duplicate CPFs within a batch are deduplicated
- [ ] Batch list returns only the authenticated user's batches
- [ ] CPFs are never logged in plain text

---

### Phase 5: Batch Processing & Webhook Receiver

**Goal:** Submit CPFs to V8, receive webhook callbacks, update items.

#### Steps

1. **Add processing to `src/services/batch.service.ts`**
   - `startBatch(batchId)`:
     1. Set batch status to `processing`
     2. Get all `pending` items
     3. Submit to V8 in parallel (max `SUBMIT_CONCURRENCY` concurrent)
     4. Mark each item as `submitted` after successful POST
     5. Handle submission errors (mark as `fail` with error message)
   - `retryBatch(batchId)`:
     1. Get items with status `submitted` (stuck) or `fail`
     2. Reset to `pending`, then process like startBatch

2. **Add processing routes to `src/routes/batch.routes.ts`**
   - `POST /api/batches/:id/start` → authenticated, starts processing
   - `POST /api/batches/:id/retry` → authenticated, retries pending/failed items

3. **Create `src/routes/webhook.routes.ts`**
   - `POST /api/webhooks/v8/balance` → **no auth** (called by V8)
   - Parse V8 callback payload:
     - On `balance.status.received.success`: update item with balance, installments, v8BalanceId, status `success`
     - On `balance.status.received.fail`: update item with errorMessage, status `fail`
   - Match item by `documentNumber` (CPF) + batch in `processing` status
   - After each webhook: increment batch `processed` count
   - If all items are resolved → set batch status to `completed`

4. **Add CSV export to batch routes**
   - `GET /api/batches/:id/export` → authenticated, download results as CSV
   - Columns: cpf, nome, status, balance, installments (JSON), error

#### Acceptance Criteria
- [ ] Starting a batch submits CPFs to V8 with concurrency limit
- [ ] Items transition: `pending` → `submitted` → `success`/`fail`
- [ ] Webhook correctly updates items on success and failure
- [ ] Batch status becomes `completed` when all items are resolved
- [ ] Retry re-submits only stuck (`submitted`) and `fail` items
- [ ] CSV export contains all result data
- [ ] Webhook endpoint accepts requests without authentication

---

### Phase 6: Frontend — Login & Dashboard

**Goal:** Login page and batch dashboard with status overview.

#### Steps

1. **Create `public/css/style.css`**
   - Clean, minimal design (no branding)
   - Responsive layout
   - Status badges: pending (gray), processing (blue), completed (green)
   - Item badges: pending (gray), submitted (yellow), success (green), fail (red)

2. **Create `public/js/api.js`**
   - Fetch wrapper that adds `Authorization: Bearer <token>` header
   - Token storage in `localStorage`
   - Auto-redirect to login if 401
   - Helper: `api.get(url)`, `api.post(url, body)`, `api.upload(url, formData)`

3. **Create `public/login.html` + `public/js/login.js`**
   - Email + password form
   - On submit: POST to `/api/auth/login`, store token, redirect to dashboard

4. **Create `public/index.html`** (redirects to dashboard or login)

5. **Create `public/dashboard.html` + `public/js/dashboard.js`**
   - Table of batches: file name, provider, status badge, total items, processed count, created date
   - Click row → navigate to batch detail
   - "New Batch" button → navigate to upload page

#### Acceptance Criteria
- [ ] Login stores JWT and redirects to dashboard
- [ ] Invalid credentials show error message
- [ ] Dashboard lists all user batches with correct status badges
- [ ] Clicking a batch navigates to its detail page
- [ ] Unauthenticated users are redirected to login

---

### Phase 7: Frontend — Upload & Batch Detail

**Goal:** CSV upload form and real-time batch results view.

#### Steps

1. **Create `public/upload.html` + `public/js/upload.js`**
   - File input (accept `.csv`)
   - Provider dropdown: QI (default), BMS, CARTOS
   - "Download Template" link (static CSV template)
   - Upload button → POST to `/api/batches` with FormData
   - Show validation results: accepted count, rejected rows with reasons
   - "Start Processing" button → POST to `/api/batches/:id/start`
   - Redirect to batch detail after starting

2. **Create `public/batch.html` + `public/js/batch.js`**
   - Batch header: file name, provider, status, progress bar (processed/total)
   - Results table: CPF (masked: `***.***.***-XX`), name, status badge, balance, installments count, error
   - Auto-refresh: poll `GET /api/batches/:id` every 5 seconds while batch is `processing`
   - "Retry" button (visible when there are stuck/failed items)
   - "Export CSV" button → triggers download
   - Stop polling when batch is `completed`

3. **Create CSV template file**
   - `public/template.csv` with sample rows

#### Acceptance Criteria
- [ ] CSV upload shows validation summary before processing
- [ ] Provider selection defaults to QI
- [ ] Batch detail shows live progress while processing
- [ ] CPFs are displayed masked in the UI (LGPD)
- [ ] Retry button re-processes failed/stuck items
- [ ] Export downloads a CSV with all results
- [ ] Template CSV is downloadable from upload page

---

### Phase 8: Polish & Production Readiness

**Goal:** Error handling, security hardening, and deployment prep.

#### Steps

1. **Error handling**
   - Global Express error handler with consistent JSON error responses
   - V8 API error handling with meaningful messages to the user
   - Validation errors with field-level detail

2. **Security**
   - Rate limiting on auth endpoints (e.g., `express-rate-limit`)
   - Helmet middleware for security headers
   - Input sanitization on all user inputs
   - Ensure no CPF logging anywhere (audit all `console.log` calls)

3. **Production database**
   - PostgreSQL datasource in Prisma schema (env-based switch)
   - Migration strategy for production

4. **Deployment configuration**
   - `Dockerfile` or `Procfile` (depending on platform)
   - Production env var checklist
   - Health check endpoint: `GET /api/health`

5. **Documentation**
   - `README.md` with setup instructions, env vars, and deployment guide

#### Acceptance Criteria
- [ ] All API errors return consistent JSON format
- [ ] Auth endpoints are rate-limited
- [ ] No CPF appears in any log output
- [ ] Health check endpoint returns 200
- [ ] App runs with PostgreSQL in production mode
- [ ] README covers full setup and deployment

---

## 3. Non-Functional Requirements

| Requirement | Target |
|-------------|--------|
| **Response time** | API responses < 500ms (excluding V8 calls) |
| **Concurrency** | Handle 5 simultaneous V8 submissions per batch |
| **Security** | LGPD-compliant CPF handling, no plain-text PII in logs |
| **Browser support** | Modern browsers (Chrome, Firefox, Safari, Edge) |
| **Max CSV size** | 10,000 rows per upload |

---

## 4. Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `PORT` | No | Server port (default: 3000) |
| `DATABASE_URL` | Yes | Prisma database connection string |
| `JWT_SECRET` | Yes | Secret for signing app JWTs |
| `ADMIN_EMAIL` | Yes | Initial admin email (seeded on first run) |
| `ADMIN_PASSWORD` | Yes | Initial admin password |
| `ADMIN_NAME` | Yes | Initial admin display name |
| `V8_CLIENT_ID` | Yes | V8 OAuth client ID |
| `V8_CLIENT_SECRET` | Yes | V8 OAuth client secret |
| `V8_USERNAME` | Yes | V8 OAuth username |
| `V8_PASSWORD` | Yes | V8 OAuth password |
| `SUBMIT_CONCURRENCY` | No | Parallel V8 submissions (default: 5) |
| `WEBHOOK_BASE_URL` | Yes | Public URL for V8 webhooks (e.g., ngrok URL) |

---

## 5. V8 API Reference

### Auth
```
POST https://api.v8digital.com/oauth/token
Content-Type: application/x-www-form-urlencoded

grant_type=password&client_id=...&client_secret=...&username=...&password=...
```
Returns JWT with 24h TTL.

### Balance Submit
```
POST https://bff.v8sistema.com/fgts/balance
Authorization: Bearer <v8_token>
Content-Type: application/json

{ "documentNumber": "12345678900", "provider": "qi", "webhookUrl": "https://your-domain/api/webhooks/v8/balance" }
```
Returns `null` — result arrives via webhook.

### Webhook Callbacks

**Success:**
```json
{
  "type": "balance.status.received.success",
  "documentNumber": "12345678900",
  "provider": "qi",
  "balance": "1638.65",
  "balanceId": "326166dc-...",
  "installments": [{ "dueDate": "2026-09-01", "amount": 210.16 }],
  "timestamp": "2025-09-26T18:47:06.278Z"
}
```

**Failure:**
```json
{
  "type": "balance.status.received.fail",
  "documentNumber": "12345678900",
  "provider": "qi",
  "balanceId": "5f1ddfb2-...",
  "errorMessage": "Instituição Fiduciária não possui autorização...",
  "timestamp": "2025-09-26T18:53:11.553Z"
}
```

---

## 6. Implementation Order Summary

| Phase | What | Depends On |
|-------|------|------------|
| **1** | Scaffold + DB | — |
| **2** | App Auth | Phase 1 |
| **3** | V8 API Client | Phase 1 |
| **4** | CSV + Batch Creation | Phase 2 |
| **5** | Processing + Webhooks | Phase 3, 4 |
| **6** | Frontend: Login + Dashboard | Phase 2 |
| **7** | Frontend: Upload + Batch Detail | Phase 5, 6 |
| **8** | Polish + Deploy | All phases |
