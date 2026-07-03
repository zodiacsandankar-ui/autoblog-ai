# Architecture Documentation -- AutoBlog AI

## Table of Contents

1. [System Overview](#system-overview)
2. [Architecture Decisions](#architecture-decisions)
3. [Component Architecture](#component-architecture)
4. [Data Flow](#data-flow)
5. [Database Schema](#database-schema)
6. [Caching Strategy](#caching-strategy)
7. [Scalability Design](#scalability-design)
8. [Observability](#observability)

---

## System Overview

AutoBlog AI follows a **microservices architecture** deployed on **Kubernetes** (Amazon EKS). The system is composed of two primary services (API and Web UI) backed by PostgreSQL for persistence and Redis for caching and job queuing. Content is stored in Amazon S3 and delivered through CloudFront CDN.

### Architectural Principles

1. **Separation of Concerns** -- The API and Web UI are independently deployable services with clear interface boundaries.
2. **Stateless Services** -- Both API and Web are stateless; all state is externalized to PostgreSQL and Redis.
3. **API-First Design** -- All functionality is exposed through a RESTful API consumed by the Web UI and external integrations.
4. **Defense in Depth** -- Security is implemented at every layer: network, application, data, and infrastructure.
5. **Observability by Default** -- All services emit structured logs, metrics, and traces.
6. **Infrastructure as Code** -- All infrastructure is defined in Terraform and Kubernetes manifests.

### Architecture Diagram

```
                                Internet
                                    |
                            [CloudFront CDN]
                                    |
                          [AWS WAF / Shield]
                                    |
                          [Nginx Ingress Controller]
                           /                      \
                     [Web Service]           [API Service]
                     (Next.js :3000)         (Express :3001)
                          |                        |
                     [Redis Cache]            [Redis Cache]
                          |                        |
                     [PostgreSQL]             [PostgreSQL]
                          |                        |
                     [S3 Storage]             [AI Service]
                          |                   (OpenAI API)
                    [CloudFront CDN]
```

---

## Architecture Decisions

### ADR-01: Microservices over Monolith

**Status:** Accepted

**Context:** The platform handles content generation, user management, scheduling, and analytics with different scaling characteristics.

**Decision:** Use a two-service architecture (API + Web) rather than a monolithic application.

**Consequences:**
- Services can be scaled independently based on load patterns.
- Each service can be deployed and updated independently.
- Increased operational complexity in service discovery and communication.

### ADR-02: PostgreSQL over NoSQL

**Status:** Accepted

**Context:** The platform manages highly relational data: users, content, categories, tags, schedules, and analytics. ACID compliance is required.

**Decision:** Use PostgreSQL 16 as the primary database with Prisma ORM.

**Consequences:**
- Relational integrity is maintained across all entities.
- Rich querying capabilities for analytics and reporting.
- Connection pooling required at scale.

### ADR-03: BullMQ for Job Processing

**Status:** Accepted

**Context:** Content generation is a long-running operation that should not block API responses.

**Decision:** Use BullMQ (Redis-backed job queue) for asynchronous content generation.

**Consequences:**
- API remains responsive during content generation.
- Failed jobs can be retried automatically.
- Job progress can be tracked and reported.

### ADR-04: Kubernetes over Serverless

**Status:** Accepted

**Context:** The platform requires consistent performance and long-running job workers.

**Decision:** Deploy on Amazon EKS with node auto-scaling.

**Consequences:**
- Predictable performance for content generation workloads.
- Full control over networking and security policies.
- Higher baseline operational overhead than serverless.

### ADR-05: External Secrets Management

**Status:** Accepted

**Context:** Secrets (API keys, database credentials) must be managed securely.

**Decision:** Use AWS Secrets Manager with the External Secrets Operator for Kubernetes.

**Consequences:**
- Secrets are never stored in version control.
- Automatic rotation of secrets is possible.
- Fine-grained IAM access control to secrets.

---

## Component Architecture

### API Service

The API service is an Express.js application following a layered architecture:

```
API Service (:3001)
├── Routes
│   ├── /auth      -> Authentication routes
│   ├── /users     -> User management routes
│   ├── /content   -> Content CRUD routes
│   ├── /topics    -> Topic management routes
│   ├── /schedule  -> Scheduling routes
│   ├── /analytics -> Analytics routes
│   └── /webhooks  -> Webhook routes
├── Middleware
│   ├── Authentication (JWT verification)
│   ├── Authorization (RBAC enforcement)
│   ├── Rate Limiting (per-user/IP)
│   ├── Validation (Zod schemas)
│   ├── Request Logging (structured JSON)
│   └── Error Handling (global error handler)
├── Services
│   ├── AuthService        -> Password hashing, JWT, OAuth
│   ├── ContentService     -> Blog generation pipeline
│   ├── TopicService       -> Topic research and suggestions
│   ├── SchedulerService   -> Cron-based job scheduling
│   ├── AIService          -> LLM integration and prompt mgmt
│   ├── StorageService     -> S3 file management
│   ├── CacheService       -> Redis cache abstraction
│   └── QueueService       -> BullMQ job management
└── Data Layer
    ├── Prisma ORM         -> Database access
    ├── Redis Client       -> Caching and pub/sub
    └── S3 Client          -> Object storage access
```

### Web Service

The Web UI is a Next.js application with the App Router pattern:

```
Web Service (:3000)
├── Pages/App Router
│   ├── /              -> Landing page
│   ├── /dashboard     -> Main dashboard
│   ├── /content       -> Content management
│   ├── /content/[id]  -> Content editor
│   ├── /topics        -> Topic discovery
│   ├── /calendar      -> Content calendar
│   ├── /analytics     -> Performance analytics
│   ├── /settings      -> User and team settings
│   └── /auth          -> Login/register pages
├── Components
│   ├── Layout components (Navbar, Sidebar, Footer)
│   ├── Content editor (rich text, markdown, preview)
│   ├── Data visualizations (charts, graphs)
│   └── Common UI (buttons, modals, forms, tables)
└── State Management
    ├── React Query   -> Server state (API data)
    ├── Zustand       -> Client state (UI state)
    └── React Context -> Theme, auth state
```

---

## Data Flow

### Content Generation Flow

```
1. User initiates content generation via Web UI
2. API creates a job record (status: PENDING) and returns 202
3. Job is enqueued in BullMQ (Redis-backed queue)
4. Worker picks up the job and processes it:
   a. Topic Research -> AI service identifies angles
   b. Outline Generation -> AI creates structured outline
   c. Content Generation -> AI writes full content
   d. SEO Analysis -> Score and optimize content
   e. Image Generation -> AI creates featured image
   f. Save to Database -> Store content with metadata
   g. Upload to S3 -> Store assets and exports
5. Job marked COMPLETE
6. Webhook / polling notifies the client
```

### API Request Flow

```
Client -> HTTPS -> Route53 -> CloudFront -> WAF -> Nginx Ingress
  -> Auth Check (JWT) -> Rate Limit -> Validation (Zod)
  -> Controller -> Service Layer -> Data Access
  -> JSON Response
```

---

## Database Schema

### Main Entities

- **User** -- User accounts, authentication, roles, and plans
- **Content** -- Blog posts with body, status, SEO metadata, AI model info
- **Topic** -- Research topics with keywords, volume, difficulty
- **Tag** -- Content categorization tags
- **ContentTag** -- Many-to-many relationship between content and tags
- **TeamMember** -- Team membership and roles
- **Schedule** -- Scheduled content generation jobs with cron expressions
- **Analytics** -- Content performance metrics over time

### Key Indexes

- `users.email` -- UNIQUE index for login lookups
- `content.slug` -- UNIQUE index for URL resolution
- `content.userId` -- Index for user content queries
- `content.status` -- Index for status filtering
- `content.publishedAt` -- Index for date-range queries
- `tags.name` -- UNIQUE index for tag lookup

---

## Caching Strategy

### Cache Layers

| Layer | Technology | Purpose | TTL |
|-------|------------|---------|-----|
| Browser Cache | Cache-Control headers | Static assets | 1 year |
| CDN Cache | CloudFront | Content delivery | 1 hour - 30 days |
| App Cache | Redis | API response caching | 5 min - 1 hour |
| DB Cache | PostgreSQL shared buffers | Query results | Internal |

### Redis Usage

- **Session Store** -- User sessions with automatic expiry
- **Rate Limiting** -- Sliding window rate limit counters
- **Job Queue** -- BullMQ job persistence and scheduling
- **Cache** -- Frequently accessed API responses (topics, analytics)
- **Pub/Sub** -- Real-time notifications and WebSocket events

### Cache Invalidation

- **Write-through** -- Cache updated on every write operation
- **Time-based** -- TTL with automatic eviction
- **Event-based** -- Webhook events trigger targeted invalidation
- **Manual** -- Admin API endpoint for manual clearing

---

## Scalability Design

### Horizontal Scaling

- **API Service**: Stateless, HPA based on CPU/memory
- **Web Service**: Stateless, HPA based on CPU/memory
- **PostgreSQL**: Read replicas for read-heavy workloads
- **Redis**: Cluster mode for distributed caching
- **Queue Workers**: Auto-scaled based on queue depth

### Scaling Triggers

| Metric | Service | Action | Threshold |
|--------|---------|--------|-----------|
| CPU > 70% | API/Web | Scale up | 3 min sustained |
| Memory > 80% | API/Web | Scale up | 3 min sustained |
| Queue depth > 100 | Workers | Scale up | Immediate |
| Connections > 80% | PostgreSQL | Read replicas | Manual |

### Database Scaling

- **Read replicas**: Up to 5 replicas for analytics
- **Connection pooling**: Prisma connection pool
- **Sharding**: Future consideration for multi-tenant

---

## Observability

### Metrics (Prometheus)

| Metric | Type | Description |
|--------|------|-------------|
| `http_requests_total` | Counter | Total HTTP requests |
| `http_request_duration_ms` | Histogram | Request latency |
| `http_requests_in_flight` | Gauge | Concurrent requests |
| `job_queue_depth` | Gauge | Pending job count |
| `job_duration_seconds` | Histogram | Job processing time |
| `ai_api_calls_total` | Counter | AI API call count |
| `ai_api_latency_ms` | Histogram | AI API latency |
| `cache_hit_ratio` | Gauge | Cache hit percentage |

### Logging (Structured JSON)

All services output JSON logs with consistent fields: timestamp, level, service, requestId, method, path, userId, duration, statusCode.

### Tracing (OpenTelemetry)

Distributed tracing with trace context propagation across service boundaries, database queries, and AI API calls.

### Dashboards (Grafana)

1. **Service Overview** -- Request rate, error rate, latency
2. **Content Generation** -- Queue depth, generation time, success rate
3. **Database Performance** -- Connection count, query latency
4. **AI Service** -- API calls, token usage, cost tracking
5. **Infrastructure** -- Node health, pod status, resource utilization

---

## Error Handling

### API Error Codes

| HTTP Status | Error Code | Description |
|-------------|------------|-------------|
| 400 | BAD_REQUEST | Invalid request body/parameters |
| 401 | UNAUTHORIZED | Missing or invalid auth |
| 403 | FORBIDDEN | Insufficient permissions |
| 404 | NOT_FOUND | Resource does not exist |
| 409 | CONFLICT | Resource conflict |
| 422 | UNPROCESSABLE_ENTITY | Validation failed |
| 429 | TOO_MANY_REQUESTS | Rate limit exceeded |
| 500 | INTERNAL_ERROR | Server error |
| 503 | SERVICE_UNAVAILABLE | Service temporarily down |

### Retry Strategy

- **Transient failures**: 3 retries, exponential backoff (100ms, 500ms, 2s)
- **Queue jobs**: 5 retries, exponential backoff (1s, 5s, 30s, 2m, 10m)
- **Dead letter queue**: Jobs moved after max retries for manual inspection
