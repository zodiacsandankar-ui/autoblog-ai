# AutoBlog AI

**AI-powered automated blog content generation platform**

AutoBlog AI is a production-grade platform that leverages artificial intelligence to automatically research, generate, edit, and publish blog content. It combines the power of large language models with a robust microservices architecture to deliver scalable, SEO-optimized blogging at scale.

---

## Features

- **AI Content Generation** -- Automatically generates high-quality blog posts using GPT-4o and other LLMs, with customizable tones, styles, and formats.
- **Smart Topic Research** -- AI-powered topic discovery and keyword research with competitor analysis and trend detection.
- **Automated Scheduling** -- Schedule content generation and publishing with a flexible cron-based scheduler.
- **SEO Optimization** -- Built-in SEO analysis, keyword optimization, meta tag generation, and readability scoring.
- **Multi-format Output** -- Supports Markdown, HTML, and rich text formats with automatic formatting.
- **Image Generation** -- AI-generated featured images and inline illustrations using DALL-E/Stable Diffusion.
- **Content Calendar** -- Visual calendar for planning, scheduling, and managing content pipelines.
- **Team Collaboration** -- Multi-user support with role-based access control and editorial workflows.
- **Version Control** -- Full content versioning with diff tracking and rollback capabilities.
- **Analytics Dashboard** -- Real-time metrics on content performance, engagement, and audience growth.
- **API-first Design** -- Comprehensive REST API for integration with existing tools and workflows.
- **Webhook Integrations** -- Trigger actions on content publish, update, or custom events.

---

## Architecture

```
                                  ┌─────────────────────────┐
                                  │     CloudFront CDN      │
                                  │   cdn.autoblog.ai      │
                                  └───────────┬─────────────┘
                                              │
                                  ┌───────────▼─────────────┐
                                  │   Nginx Ingress         │
                                  │   (autoblog.ai)         │
                                  └──────┬──────────┬───────┘
                                         │          │
                              ┌──────────▼──┐  ┌───▼──────────┐
                              │  Web UI     │  │  API Server  │
                              │  :3000      │  │  :3001       │
                              │  Next.js    │  │  Express.js  │
                              └──────┬──────┘  └───┬──────────┘
                                     │              │
                              ┌──────▼──────────────▼──────────┐
                              │       Redis (Cache/Queue)      │
                              │   Session Cache | Job Queue    │
                              └───────────────────────────────┘
                                              │
                              ┌───────────────▼────────────────┐
                              │     PostgreSQL (Primary DB)    │
                              │    Content | Users | Metadata  │
                              └───────────────────────────────┘
                                              │
                              ┌───────────────▼────────────────┐
                              │    S3 (Object Storage)         │
                              │  Images | Assets | Backups    │
                              └───────────────────────────────┘
                                              │
                              ┌───────────────▼────────────────┐
                              │     AI Service (LLM API)       │
                              │   OpenAI | Anthropic | Custom  │
                              └───────────────────────────────┘

  ┌─────────────────────────────────────────────────────────────────────┐
  │                        Infrastructure Layer                         │
  │  AWS EKS  │  RDS PostgreSQL  │  ElastiCache Redis  │  S3  │  CDN  │
  └─────────────────────────────────────────────────────────────────────┘
```

---

## Tech Stack

### Frontend
| Technology | Purpose |
|------------|---------|
| Next.js 14 | React framework with SSR and App Router |
| TypeScript | Type-safe JavaScript |
| Tailwind CSS | Utility-first CSS framework |
| shadcn/ui | Component library |
| React Query | Server state management |
| Zod | Schema validation |

### Backend
| Technology | Purpose |
|------------|---------|
| Node.js 20 | Runtime environment |
| Express.js | HTTP framework |
| TypeScript | Type-safe JavaScript |
| Prisma ORM | Database access |
| BullMQ | Job queue and scheduling |
| JWT | Authentication tokens |

### AI/ML
| Technology | Purpose |
|------------|---------|
| OpenAI GPT-4o | Content generation |
| Anthropic Claude | Content refinement |
| LangChain | LLM orchestration |
| Transformers.js | On-device NLP tasks |

### Infrastructure
| Technology | Purpose |
|------------|---------|
| Kubernetes (EKS) | Container orchestration |
| Docker | Container runtime |
| PostgreSQL 16 | Primary database |
| Redis 7 | Caching and queues |
| Terraform | Infrastructure as code |
| Helm | Kubernetes package management |
| GitHub Actions | CI/CD pipelines |

### Monitoring
| Technology | Purpose |
|------------|---------|
| Prometheus | Metrics collection |
| Grafana | Visualization and dashboards |
| Sentry | Error tracking |
| DataDog | APM and logs |
| CloudWatch | AWS monitoring |

---

## Quick Start

### Prerequisites

- Node.js 18+ (recommended: 20)
- Docker and Docker Compose
- Git

### Development Setup

```bash
# Clone the repository
git clone https://github.com/autoblog-ai/autoblog-ai.git
cd autoblog-ai

# Copy environment variables
cp .env.example .env

# Install dependencies
npm install

# Start development services (PostgreSQL, Redis)
docker compose up -d db redis

# Run database migrations
npm run migrate:up

# Seed development data
npm run seed

# Start development servers
npm run dev
```

The application will be available at:
- **Web UI**: http://localhost:3000
- **API**: http://localhost:3001
- **API Docs**: http://localhost:3001/api-docs

### Using Docker Compose (Full Stack)

```bash
# Build and start all services
docker compose up --build

# Run in background
docker compose up -d

# View logs
docker compose logs -f

# Stop all services
docker compose down
```

---

## Environment Variables

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `NODE_ENV` | Runtime environment | Yes | `development` |
| `DATABASE_URL` | PostgreSQL connection string | Yes | - |
| `REDIS_URL` | Redis connection string | Yes | - |
| `AI_API_KEY` | LLM provider API key | Yes | - |
| `AI_PROVIDER` | LLM provider name | No | `openai` |
| `AI_MODEL` | LLM model name | No | `gpt-4o` |
| `JWT_SECRET` | JWT signing secret | Yes | - |
| `JWT_REFRESH_SECRET` | JWT refresh token secret | Yes | - |
| `API_PORT` | API server port | No | `3001` |
| `WEB_PORT` | Web server port | No | `3000` |
| `STORAGE_ACCESS_KEY_ID` | S3 access key | Yes (production) | - |
| `STORAGE_SECRET_ACCESS_KEY` | S3 secret key | Yes (production) | - |
| `STORAGE_BUCKET` | S3 bucket name | Yes (production) | `autoblog-ai-content` |
| `SENTRY_DSN` | Sentry error tracking DSN | No | - |
| `CORS_ORIGIN` | Allowed CORS origin | No | `http://localhost:3000` |
| `LOG_LEVEL` | Logging level | No | `debug` |
| `METRICS_ENABLED` | Enable Prometheus metrics | No | `true` |

---

## Project Structure

```
autoblog-ai/
├── .github/
│   └── workflows/
│       ├── ci.yml              # CI pipeline
│       ├── deploy.yml          # Deploy pipeline
│       └── security.yml        # Security scanning
├── k8s/
│   ├── namespace.yaml
│   ├── configmap.yaml
│   ├── secrets.yaml
│   ├── api-deployment.yaml
│   ├── api-service.yaml
│   ├── api-hpa.yaml
│   ├── web-deployment.yaml
│   ├── web-service.yaml
│   ├── web-hpa.yaml
│   ├── postgres-statefulset.yaml
│   ├── postgres-service.yaml
│   ├── redis-deployment.yaml
│   ├── redis-service.yaml
│   ├── ingress.yaml
│   ├── network-policy.yaml
│   └── helm/autoblog/
│       ├── Chart.yaml
│       ├── values.yaml
│       └── values-production.yaml
├── terraform/
│   ├── main.tf
│   ├── variables.tf
│   ├── outputs.tf
│   ├── providers.tf
│   └── terraform.tfvars.example
├── docs/
│   ├── README.md
│   ├── ARCHITECTURE.md
│   ├── DEPLOYMENT.md
│   ├── SECURITY.md
│   └── API.md
├── src/
│   ├── api/                    # API server code
│   ├── web/                    # Web UI code
│   └── shared/                 # Shared types and utilities
├── docker-compose.yml
├── Dockerfile
├── package.json
└── tsconfig.json
```

---

## Available Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start development servers |
| `npm run build` | Build for production |
| `npm run start` | Start production servers |
| `npm run test` | Run all tests |
| `npm run test:unit` | Run unit tests |
| `npm run test:integration` | Run integration tests |
| `npm run test:e2e` | Run end-to-end tests |
| `npm run test:coverage` | Run tests with coverage |
| `npm run lint` | Lint codebase |
| `npm run format` | Format code with Prettier |
| `npm run migrate:up` | Run database migrations |
| `npm run migrate:down` | Rollback database migrations |
| `npm run seed` | Seed development data |
| `npm run docker:build` | Build Docker image |

---

## Testing

```bash
# Run all tests
npm test

# Run with coverage
npm run test:coverage

# Run specific test file
npx jest src/api/__tests__/content.test.ts

# Watch mode
npm run test -- --watch
```

---

## Contributing

We welcome contributions! Please follow these steps:

1. **Fork** the repository
2. **Create a feature branch**: `git checkout -b feature/amazing-feature`
3. **Commit your changes**: `git commit -m 'Add amazing feature'`
4. **Push to the branch**: `git push origin feature/amazing-feature`
5. **Open a Pull Request**

### Development Guidelines

- Follow the existing code style and conventions
- Write tests for new features and bug fixes
- Update documentation for API changes
- Keep pull requests focused on a single concern
- Use conventional commit messages (`feat:`, `fix:`, `docs:`, etc.)

### Code Style

- TypeScript strict mode is enforced
- ESLint with recommended rulesets
- Prettier for consistent formatting
- Husky pre-commit hooks for linting and testing

---

## License

Distributed under the MIT License. See `LICENSE` for more information.

---

## Support

- **Documentation**: https://docs.autoblog.ai
- **Issue Tracker**: https://github.com/autoblog-ai/autoblog-ai/issues
- **Discord Community**: https://discord.gg/autoblog-ai
- **Email**: support@autoblog.ai

---

## Acknowledgments

- OpenAI for GPT-4o and their developer platform
- The Next.js team for the amazing React framework
- The Kubernetes community for container orchestration
- All open-source contributors whose libraries make this possible
