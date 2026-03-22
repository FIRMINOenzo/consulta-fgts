# Brainstorm: FGTS Consulta Web

## Project Name Proposal: **consulta-fgts**

Clean, self-explanatory, and professional for the end-user company.
Alternative options: `fgts-express`, `saldo-fgts`, `fgts-hub`.

---

## 1. What We're Building

A web application that allows a company (end-user) to:

1. **Log in** to the app (account management)
2. **Upload a CSV** file with customer data (CPFs)
3. **Batch-query FGTS balances** via the V8 Digital API
4. **View and export results** (balance, installments, errors)

### The Two V8 API Integrations

| Step | V8 Endpoint | Method | Details |
|------|-------------|--------|---------|
| Auth | `POST https://api.v8digital.com/oauth/token` | `x-www-form-urlencoded` | OAuth 2.0 password grant, returns JWT (24h TTL) |
| Balance POST | `POST https://bff.v8sistema.com/fgts/balance` | `application/json` | Body: `{documentNumber, provider}` — async, returns `null` |
| Balance Webhook | V8 calls `POST /api/webhooks/v8/balance` | `application/json` | V8 pushes result when ready (success or fail) |

**Providers:** `BMS`, `QI`, `CARTOS` — **default: QI**

---

## 2. Tech Stack

| Layer | Tech | Reason |
|-------|------|--------|
| **Frontend** | HTML + CSS + Vanilla JS | Simple, no build step, fast to develop |
| **Backend** | TypeScript + Express | Lighter than NestJS for this scope; fast to scaffold; enough structure with a clean folder layout |
| **Database** | SQLite (dev) / PostgreSQL (prod) | SQLite = zero config for dev; Postgres for production durability |
| **ORM** | Prisma | Type-safe, great DX with TypeScript, easy migrations |
| **Auth (app)** | JWT + bcrypt | Simple session management for the app's own users |
| **CSV Parsing** | `csv-parse` (npm) | Lightweight, streaming capable |

### Why Express over NestJS

- **Scope is small**: 2 V8 integrations + user auth + CSV upload + results view
- **NestJS overhead**: decorators, modules, providers, DI — overkill for ~5-6 routes
- **Speed**: Express can be structured cleanly without the ceremony
- **Familiarity**: Simpler for anyone maintaining it later

---

## 3. Result Strategy — **Webhooks**

V8's balance check is async — POST returns `null`, results arrive later.
We use **webhooks**: V8 calls our endpoint when a result is ready.

### How it works

```
1. User uploads CSV → batch created
2. App POSTs each CPF to V8 (5 parallel) → items marked "submitted"
3. V8 processes in background...
4. V8 calls POST /api/webhooks/v8/balance with the result
5. App updates the BatchItem → "success" or "fail"
```

### What if V8 never calls back?

The item stays as `"submitted"`. No timeout, no background jobs.
The user can see pending items in the UI and **retry** them whenever they want.
This keeps the system simple — no timers, no sweep jobs, no state machines.

### Webhook endpoint

```
POST /api/webhooks/v8/balance
```

Receives V8's callback payload:
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

Or on failure:
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

### Submit concurrency

| Config | Default | Description |
|--------|---------|-------------|
| `SUBMIT_CONCURRENCY` | `5` | Parallel POSTs when submitting a batch |

### Local development

Use `ngrok` to expose localhost for webhook callbacks during development:
```bash
ngrok http 3000
# Then configure the ngrok URL as webhook in V8
```

---

## 4. Application Architecture

```
┌─────────────────────────────────────────────────┐
│                   FRONTEND                       │
│          (HTML + CSS + Vanilla JS)                │
│                                                   │
│  ┌──────────┐ ┌──────────────┐ ┌──────────────┐ │
│  │  Login   │ │  CSV Upload  │ │   Results    │ │
│  │  Page    │ │  + Status    │ │   Dashboard  │ │
│  └──────────┘ └──────────────┘ └──────────────┘ │
└──────────────────────┬──────────────────────────┘
                       │ HTTP (fetch API)
┌──────────────────────▼──────────────────────────┐
│                   BACKEND                        │
│           (Express + TypeScript)                  │
│                                                   │
│  ┌──────────┐ ┌──────────────┐ ┌──────────────┐ │
│  │ App Auth │ │  CSV Parser  │ │  V8 Service  │ │
│  │ (JWT)    │ │              │ │  (API Client)│ │
│  └──────────┘ └──────────────┘ └──────┬───────┘ │
│                      │                 │          │
│              ┌───────▼───────┐         │          │
│              │   Database    │◄────────┘          │
│              │ (SQLite/PG)   │  Webhook receives  │
│              └───────────────┘  update DB directly │
└──────────────────────┬──────────────────────────┘
                       │ HTTPS            ▲
              ┌────────▼────────┐         │
              │   V8 Digital    │─────────┘
              │   API           │  Webhook callback
              └─────────────────┘
```

---

## 5. User Flow

```
User logs in
    │
    ▼
Dashboard (list of past batches with status badges)
    │
    ▼
Upload CSV ──► CSV parsed + validated ──► Batch created (status: "pending")
    │
    ▼
User clicks "Start"
    │
    ├── For each CPF (5 parallel):
    │     POST /fgts/balance to V8
    │     Mark BatchItem as "submitted"
    │
    ▼
Batch status → "processing"
    │                              ┌──────────────────────────┐
    │                              │  V8 calls our webhook    │
    │                              │  per CPF when ready      │
    │                              │  → update item to        │
    │                              │    "success" or "fail"   │
    │                              └──────────────────────────┘
    ▼
User sees live results: CPF | Name | Status | Balance | Installments | Error
    │
    ├── Items still "submitted" = waiting for V8 (user can retry them)
    │
    ▼
Export results as CSV
```

---

## 6. CSV Input Format

The V8 API only requires `documentNumber` (CPF) to check a balance.
We add `nome` for display/reference in the UI and results export.

### Template

```csv
cpf,nome
12345678900,João Silva
98765432100,Maria Santos
00100200304,Carlos Oliveira
```

### Validation Rules

| Field | Required | Format | Validation |
|-------|----------|--------|------------|
| `cpf` | Yes | 11 digits (no dots/dashes) | Must be exactly 11 numeric chars; CPF checksum validation |
| `nome` | No | Free text | If empty, display "—" in UI |

- Rows with invalid/empty CPF are **rejected** and shown as errors before processing starts
- Duplicate CPFs within the same batch are **deduplicated** (keep first occurrence)
- Provider (`QI` default) is selected **per batch** in the upload form, not per row
- A downloadable **CSV template** will be available in the upload page

---

## 7. Database Schema (Draft)

```
User
├── id          (UUID)
├── email       (unique)
├── password    (bcrypt hash)
├── name
├── role        ("admin" | "user")
├── createdAt

Batch
├── id          (UUID)
├── userId      (FK → User)
├── fileName    (original CSV name)
├── provider    ("BMS" | "QI" | "CARTOS")
├── status      ("pending" | "processing" | "completed")
├── totalItems  (count of CPFs)
├── processed   (count processed so far)
├── createdAt

BatchItem
├── id              (UUID)
├── batchId         (FK → Batch)
├── cpf             (string)
├── customerName    (string, from CSV)
├── status          ("pending" | "submitted" | "success" | "fail")
├── balance         (decimal, nullable)
├── installments    (JSON, nullable)
├── errorMessage    (string, nullable)
├── v8BalanceId     (string, nullable — from V8 response)
├── createdAt
├── updatedAt
```

---

## 8. API Routes (App Backend)

### Auth (App)
| Method | Route | Description |
|--------|-------|-------------|
| POST | `/api/auth/login` | Login, returns app JWT |
| POST | `/api/auth/register` | Create user (admin-only, requires admin JWT) |
| GET | `/api/auth/me` | Get current user |

**Auth model:** Single admin (you) is seeded on first run via env vars.
Admin can register other users. No self-registration.

### Batches
| Method | Route | Description |
|--------|-------|-------------|
| POST | `/api/batches` | Upload CSV + create batch |
| GET | `/api/batches` | List user's batches |
| GET | `/api/batches/:id` | Batch detail + items |
| GET | `/api/batches/:id/export` | Download results as CSV |

### Processing
| Method | Route | Description |
|--------|-------|-------------|
| POST | `/api/batches/:id/start` | Submit all CPFs to V8 |
| POST | `/api/batches/:id/retry` | Re-submit only pending/failed items |

### Webhooks (called by V8, no auth required from our side)
| Method | Route | Description |
|--------|-------|-------------|
| POST | `/api/webhooks/v8/balance` | Receives V8 balance result callback |

---

## 9. Frontend Pages

| Page | Description |
|------|-------------|
| `/login` | Email + password form |
| `/dashboard` | List of batches with status badges |
| `/upload` | CSV upload form + provider selector |
| `/batch/:id` | Results table with progress bar, export button |

All pages: plain HTML served by Express (`express.static`), JS uses `fetch()` for API calls.

---

## 10. Project Structure (Proposed)

```
consulta-fgts/
├── src/
│   ├── server.ts                  # Express app entry
│   ├── config.ts                  # Env vars, constants
│   ├── routes/
│   │   ├── auth.routes.ts
│   │   ├── batch.routes.ts
│   │   └── webhook.routes.ts     # V8 webhook callbacks
│   ├── middleware/
│   │   └── auth.middleware.ts     # JWT verification
│   ├── services/
│   │   ├── v8/
│   │   │   ├── auth.service.ts    # V8 OAuth token management
│   │   │   └── balance.service.ts # Submit balance requests to V8
│   │   ├── batch.service.ts       # CSV parsing + batch orchestration
│   │   └── auth.service.ts        # App user auth (bcrypt + JWT)
│   └── utils/
│       └── csv.ts                 # CSV parse/export helpers
├── prisma/
│   └── schema.prisma
├── public/                        # Static frontend
│   ├── index.html
│   ├── login.html
│   ├── dashboard.html
│   ├── upload.html
│   ├── batch.html
│   ├── css/
│   │   └── style.css
│   └── js/
│       ├── api.js                 # Fetch wrapper + auth headers
│       ├── login.js
│       ├── dashboard.js
│       ├── upload.js
│       └── batch.js
├── .env.example
├── package.json
├── tsconfig.json
└── README.md
```

---

## 11. Key Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| V8 API rate limiting (unknown) | Batch processing throttled/blocked | Concurrency control (3-5 parallel), exponential backoff |
| V8 token expires mid-batch | Requests fail with 401 | Auto-refresh token before expiry (refresh at 23h mark) |
| Large CSV (1000+ CPFs) | Long processing time, timeouts | Background processing with progress tracking |
| CPF data is PII | Legal/compliance risk (LGPD) | Encrypt at rest, don't log CPFs in plain text, access control |
| V8 never sends webhook | BatchItem stays as "submitted" | User can see pending items and retry them manually |

---

## 12. Resolved Decisions

- [x] **CSV columns:** `cpf` (required) + `nome` (optional). Template provided.
- [x] **Default provider:** QI (configurable per batch)
- [x] **User registration:** Admin-only. Admin seeded from env vars on first run.
- [x] **Branding:** None — clean, minimal UI
- [x] **Deployment:** Simple platform (Railway, Render, or similar PaaS — TBD)

## 13. Remaining Open Items

- [ ] V8 API rate limits — test or ask V8 support (`ti@v8digital.online`)
- [ ] Final deployment platform choice

**Data retention:** Keep all results indefinitely for now. Revisit later if storage becomes a concern.

---

## 14. Next Steps

1. **Align on this brainstorm** — confirm or adjust decisions
2. **Write a focused PRD** — detailed specs for each feature
3. **Scaffold the project** — Express + Prisma + static frontend
4. **Implement auth** — both app auth (user login) and V8 auth (OAuth)
5. **Implement CSV upload + batch creation**
6. **Implement V8 balance submit + webhook receiver**
7. **Build frontend pages**
8. **Test end-to-end with real V8 credentials**
