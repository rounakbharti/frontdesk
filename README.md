# Frontdesk AI — Human-in-the-Loop Supervisor

> **Engineering Assessment** — Frontdesk  
> A production-structured, horizontally-scalable system where AI agents escalate unknown questions to human supervisors, follow up with callers, and learn new knowledge automatically.

---

## Architecture at a Glance

```
CALL INGRESS          CORE SERVICES                     WORKERS              DATA STORES
──────────            ────────────────────────────────  ─────────────────    ──────────────
Call Event API  ─►  Agent Service                      Timeout Worker  ──►  Redis
                      ├── NLU Adapter (Python/FastAPI)  Audit Worker    ──►  PostgreSQL
                      ├── Help Request Service    ─────────────────────────  Elasticsearch
                      ├── Notification Service  ◄── EVENT BUS (Kafka)
                      └── KB Service            ──►  KB Indexer ──────────►  ES + FAISS

SUPERVISOR UI (Next.js) ◄── WebSocket ◄── Notification Service
```

**Full architecture:** see [`ARCHITECTURE.md`](./ARCHITECTURE.md) and [`system_architecture.png`](./system_architecture.png).

---

## Tech Stack (100% Free & Self-Hosted)

| Layer | Technology |
|---|---|
| Backend Services | Node.js 20 + TypeScript + Fastify |
| NLU / Embeddings | Python 3.11 + FastAPI + sentence-transformers |
| Vector Index | FAISS (CPU) |
| Frontend | Next.js 14 + React + TypeScript |
| Primary DB | PostgreSQL 16 |
| Cache / Locks / TTLs | Redis 7 |
| Event Bus | Apache Kafka 7.6 (self-hosted via Confluent images) |
| Full-text + KB Search | Elasticsearch 8.12 |
| Tracing | OpenTelemetry + Jaeger |
| Metrics | Prometheus + Grafana |
| Local Orchestration | Docker Compose |
| CI | GitHub Actions |

---

## Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) ≥ 4.x (with Compose v2)
- [Node.js](https://nodejs.org/) ≥ 20.x
- [pnpm](https://pnpm.io/) ≥ 9.x — `npm install -g pnpm`
- [Python](https://www.python.org/) ≥ 3.11 (for NLU adapter local dev)
- **RAM:** minimum 6 GB free for the full stack (ES is the heaviest consumer)

---

## Quick Start

```bash
# 1. Clone and enter the repo
git clone https://github.com/<your-org>/frontdesk-ai.git
cd frontdesk-ai

# 2. Copy environment config (edit values if needed)
cp .env.example .env

# 3. Start the full infrastructure stack
./dev.sh up                     # Linux/macOS
.\dev.ps1 up                    # Windows PowerShell

# 4. Verify all services are healthy
./dev.sh ps

# 5. Install Node dependencies (all workspaces)
pnpm install

# 6. Start with Observability stack (Jaeger + Prometheus + Kibana)
./dev.sh up observability
```

### Service Endpoints (after boot)

| Service | URL |
|---|---|
| Agent Service | http://localhost:4001 |
| Help Request Service | http://localhost:4002 |
| NLU Adapter | http://localhost:4003 |
| Notification Service | http://localhost:4004 |
| KB Service | http://localhost:4005 |
| Supervisor UI | http://localhost:3000 |
| Elasticsearch | http://localhost:9200 |
| Kibana (optional) | http://localhost:5601 |
| Jaeger UI (optional) | http://localhost:16686 |
| Prometheus (optional) | http://localhost:9090 |

---

## Dev Commands

```bash
./dev.sh up                  # Start core infra (Kafka, Postgres, Redis, ES)
./dev.sh up observability    # Start with Jaeger + Prometheus + Kibana
./dev.sh down                # Stop all containers
./dev.sh logs [service]      # Tail logs (optional: specific service name)
./dev.sh ps                  # Show container status
./dev.sh reset               # ⚠️ Destroy all volumes (destructive!)
./dev.sh shell <service>     # Open shell inside container
```

---

## Monorepo Layout

```
/
├── services/
│   ├── agent/               # TypeScript — call event receiver, NLU orchestration
│   ├── help-request/        # TypeScript — help_request lifecycle + Kafka + Redis
│   ├── nlu-adapter/         # Python (FastAPI) — NLU mock + sentence-transformers
│   ├── notification/        # TypeScript — Kafka consumer + WebSocket broadcaster
│   └── kb/                  # TypeScript — KB search (ES) + learn endpoint
│
├── workers/
│   ├── timeout-worker/      # TypeScript — Redis TTL polling, marks expired requests
│   ├── audit-worker/        # TypeScript — Kafka → audit_log writes
│   └── kb-indexer/          # TypeScript — kb.learn events → ES + FAISS indexing
│
├── web/
│   └── supervisor-ui/       # Next.js — Pending list, resolve form, KB viewer
│
├── packages/
│   └── types/               # Shared Zod schemas + TypeScript types (event contracts)
│
├── infra/
│   └── docker/
│       ├── docker-compose.yml
│       ├── postgres/init/   # SQL extensions init
│       └── prometheus/      # Prometheus scrape config
│
├── tests/                   # Integration test suite
├── .github/workflows/       # CI — lint, test, build
├── dev.sh                   # Linux/macOS dev helper
├── dev.ps1                  # Windows dev helper
├── .env.example             # Environment variable template
├── README.md
└── ARCHITECTURE.md
```

---

## Environment Variables

See [`.env.example`](./.env.example) for the full list. Key variables:

| Variable | Default | Description |
|---|---|---|
| `NLU_MODE` | `mock` | `mock` (deterministic) or `local_model` (sentence-transformers) |
| `AGENT_CONFIDENCE_THRESHOLD` | `0.7` | Below this → escalate to supervisor |
| `HELP_REQ_TIMEOUT_SECS` | `600` | Seconds before unresolved → timed_out |
| `MAX_NLU_CONCURRENCY` | `4` | Concurrent NLU requests |
| `POSTGRES_URL` | see `.env.example` | PostgreSQL connection string |
| `REDIS_URL` | `redis://localhost:6379` | Redis connection string |
| `KAFKA_BROKER` | `localhost:9092` | Kafka bootstrap broker |
| `ELASTICSEARCH_URL` | `http://localhost:9200` | Elasticsearch endpoint |

---

## NLU Modes

### Default: `NLU_MODE=mock`
Deterministic rule-based NLU. Used in CI and demos. No model download required.

### Optional: `NLU_MODE=local_model`
Uses `sentence-transformers/all-MiniLM-L6-v2` for embeddings + FAISS for similarity search.

```bash
# In .env, change:
NLU_MODE=local_model

# The NLU adapter auto-detects if the model can be loaded.
# Falls back to mock if model loading fails.
```

> **Note:** First run downloads ~90MB model. Requires ~2GB RAM. CPU-only (no GPU needed).

---

## Running Tests

```bash
# All unit tests (mock NLU — CI-safe)
pnpm test

# Integration tests (requires local infra running)
./dev.sh up
pnpm test:integration

# Single service
pnpm --filter @frontdesk/help-request test
```

---

## The Help Request Lifecycle

```
Call Event received
       │
       ▼
Agent queries NLU Adapter
       │
       ├── confidence ≥ 0.7 ──► Answer caller directly (simulate via webhook/log)
       │
       └── confidence < 0.7
               │
               ▼
          Create help_request (status=pending)
          Publish help_request.created to Kafka
          Add to Redis sorted set (TTL = expiry score)
               │
               ├── Supervisor resolves (via UI)
               │         │
               │         ▼
               │    status=resolved
               │    Publish supervisor.answered
               │    Notification: text back caller
               │    Publish kb.learn → indexer creates KB entry
               │
               └── TTL expires (timeout-worker polls Redis)
                         │
                         ▼
                    status=unresolved
                    Publish help_request.timed_out
                    Audit log appended
```

---

## Implementation Steps

| Step | Branch | Status |
|---|---|---|
| 0 — Bootstrap | `feature/step-00-bootstrap` | ✅ Complete |
| 1 — Help Request Service | `feature/step-01-help-request` | 🔜 Next |
| 2 — Agent + Simulator | `feature/step-02-agent` | ⏳ Pending |
| 3 — NLU Adapter | `feature/step-03-nlu` | ⏳ Pending |
| 4 — Notification + UI | `feature/step-04-notify-ui` | ⏳ Pending |
| 5 — KB Service + Learn | `feature/step-05-kb` | ⏳ Pending |
| 6 — Timeout + Workers | `feature/step-06-workers-timeouts` | ⏳ Pending |
| 7 — Observability + CI | `feature/step-07-observability-ci` | ⏳ Pending |
| 8 — Docs + Demo | `feature/step-08-docs-demo` | ⏳ Pending |

---

## Design Decisions

### Help Request Modeling
The `help_requests` table uses **optimistic locking** (`version INT`) to safely handle concurrent supervisor resolutions. A `ttl_expires_at` column drives the Redis sorted set used by the timeout worker — avoidinga DB poll entirely.

### Knowledge Base Updates
On resolution, a **candidate KB entry** is created (`active=false`). The `kb-indexer` worker asynchronously computes embeddings (sentence-transformers → FAISS) and indexes into Elasticsearch. This decouples the supervisor response path from compute-heavy ML work.

### Supervisor Timeout Strategy
The timeout worker polls a Redis **sorted set** (`ZRANGEBYSCORE`) — O(log N + M) per poll — then applies **SELECT FOR UPDATE** (Postgres) to atomically transition status. Events are published to Kafka after commit. This design scales horizontally because multiple timeout workers can process different score ranges without double-firing.

### Scaling from 10/day to 1,000/day
- Kafka partitioning (4 partitions per topic) allows horizontal consumer scaling
- Agent and Help Request services are stateless — scale with K8s replicas
- Redis TTL sorted set handles thousands of concurrent pending requests at O(log N)
- Elasticsearch is cluster-ready (single-node for local, multi-node for prod)
- NLU adapter scales behind a load balancer; FAISS index is read-only at query time

### Modularity
Each domain (agent, help-request, notification, kb) is a separate service with its own database access layer. They communicate only via Kafka events and typed REST contracts defined in `@frontdesk/types`. This enables independent deployment and scaling of each component.

---

## License

MIT — see `LICENSE`.
