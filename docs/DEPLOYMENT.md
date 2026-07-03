# Deployment Guide -- AutoBlog AI

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Local Development with Docker Compose](#local-development-with-docker-compose)
3. [Production Deployment on Kubernetes](#production-deployment-on-kubernetes)
4. [Helm Chart Deployment](#helm-chart-deployment)
5. [Infrastructure Provisioning with Terraform](#infrastructure-provisioning-with-terraform)
6. [CI/CD Pipeline](#cicd-pipeline)
7. [Database Migrations](#database-migrations)
8. [Monitoring Setup](#monitoring-setup)
9. [Backup and Disaster Recovery](#backup-and-disaster-recovery)
10. [Scaling Guide](#scaling-guide)
11. [Troubleshooting](#troubleshooting)

---

## Prerequisites

### Local Development
- Node.js 18+ (recommended: 20)
- Docker and Docker Compose v2+
- Git
- npm or yarn

### Production Deployment
- AWS CLI v2 configured with appropriate credentials
- kubectl v1.28+
- Helm v3.14+
- Terraform v1.7+
- Access to GitHub Container Registry (GHCR)
- Domain name with DNS management

### Required Access Tokens
- OpenAI API key (or other AI provider)
- GitHub Personal Access Token with `packages:write` scope
- AWS IAM credentials with sufficient permissions

---

## Local Development with Docker Compose

### Quick Start

```bash
# Clone the repository
git clone https://github.com/autoblog-ai/autoblog-ai.git
cd autoblog-ai

# Copy environment file
cp .env.example .env
# Edit .env with your API keys

# Start all services
docker compose up -d

# View logs
docker compose logs -f

# Run migrations
docker compose exec api npm run migrate:up

# Seed development data
docker compose exec api npm run seed
```

### Docker Compose Services

```yaml
services:
  postgres:
    image: postgres:16-alpine
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"

  api:
    build:
      context: .
      dockerfile: Dockerfile
      target: development
    ports:
      - "3001:3001"
    depends_on:
      - postgres
      - redis
    environment:
      - DATABASE_URL=postgresql://autoblog:password@postgres:5432/autoblog
      - REDIS_URL=redis://redis:6379

  web:
    build:
      context: .
      dockerfile: Dockerfile
      target: development
    ports:
      - "3000:3000"
    depends_on:
      - api
    environment:
      - API_BASE_URL=http://api:3001
```

### Development URLs

| Service | URL |
|---------|-----|
| Web Application | http://localhost:3000 |
| API Server | http://localhost:3001 |
| API Documentation | http://localhost:3001/api-docs |
| PostgreSQL | localhost:5432 |
| Redis | localhost:6379 |

---

## Production Deployment on Kubernetes

### Prerequisites

```bash
# Verify tools
aws --version
kubectl version --client
helm version
terraform version

# Configure kubectl for EKS
aws eks update-kubeconfig --region us-east-1 --name autoblog-ai-eks

# Verify cluster connectivity
kubectl get nodes
kubectl get namespaces
```

### Manual Deployment (using raw manifests)

```bash
# Create namespace and apply base resources
kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/configmap.yaml
kubectl apply -f k8s/secrets.yaml

# Deploy database and cache
kubectl apply -f k8s/postgres-statefulset.yaml
kubectl apply -f k8s/postgres-service.yaml
kubectl apply -f k8s/redis-deployment.yaml
kubectl apply -f k8s/redis-service.yaml

# Deploy application
kubectl apply -f k8s/api-deployment.yaml
kubectl apply -f k8s/api-service.yaml
kubectl apply -f k8s/api-hpa.yaml
kubectl apply -f k8s/web-deployment.yaml
kubectl apply -f k8s/web-service.yaml
kubectl apply -f k8s/web-hpa.yaml

# Deploy ingress and network policies
kubectl apply -f k8s/ingress.yaml
kubectl apply -f k8s/network-policy.yaml

# Verify deployment
kubectl get all -n autoblog
kubectl rollout status deployment/autoblog-api -n autoblog
kubectl rollout status deployment/autoblog-web -n autoblog
```

### Production Image Update

```bash
# Update image tag
kubectl set image deployment/autoblog-api \
  api=ghcr.io/autoblog-ai/autoblog-ai:${TAG} \
  -n autoblog

kubectl set image deployment/autoblog-web \
  web=ghcr.io/autoblog-ai/autoblog-ai:${TAG} \
  -n autoblog

# Monitor rollout
kubectl rollout status deployment/autoblog-api -n autoblog
kubectl rollout status deployment/autoblog-web -n autoblog

# Rollback if needed
kubectl rollout undo deployment/autoblog-api -n autoblog
kubectl rollout undo deployment/autoblog-web -n autoblog
```

---

## Helm Chart Deployment

### Install Helm Chart

```bash
# Add dependencies
helm repo add bitnami https://charts.bitnami.com/bitnami
helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
helm repo add jetstack https://charts.jetstack.io
helm repo add external-secrets https://charts.external-secrets.io
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm repo update

# Install/upgrade production release
helm upgrade --install autoblog k8s/helm/autoblog \
  --namespace autoblog \
  --create-namespace \
  -f k8s/helm/autoblog/values.yaml \
  -f k8s/helm/autoblog/values-production.yaml \
  --set image.tag=${IMAGE_TAG} \
  --set global.environment=production \
  --wait \
  --timeout 15m
```

### Helm Configuration

```bash
# Dry run to validate
helm upgrade --install autoblog k8s/helm/autoblog \
  --dry-run --debug \
  -f k8s/helm/autoblog/values-production.yaml

# List releases
helm list -n autoblog

# Get release status
helm status autoblog -n autoblog

# Rollback release
helm rollback autoblog 1 -n autoblog

# Uninstall release
helm uninstall autoblog -n autoblog
```

### Custom Values

Create environment-specific value files:

```bash
# staging-values.yaml
cp k8s/helm/autoblog/values-production.yaml k8s/helm/autoblog/values-staging.yaml
# Edit values-staging.yaml with lower resource requests

# Install staging
helm upgrade --install autoblog-staging k8s/helm/autoblog \
  -n autoblog-staging --create-namespace \
  -f k8s/helm/autoblog/values.yaml \
  -f k8s/helm/autoblog/values-staging.yaml
```

---

## Infrastructure Provisioning with Terraform

### Initialize Terraform

```bash
cd terraform

# Initialize with S3 backend
terraform init \
  -backend-config="bucket=autoblog-ai-terraform-state" \
  -backend-config="key=infrastructure/terraform.tfstate" \
  -backend-config="region=us-east-1"

# Or for local development
terraform init -backend=false
terraform init -reconfigure
```

### Provision Infrastructure

```bash
# Create terraform.tfvars from example
cp terraform.tfvars.example terraform.tfvars
# Edit terraform.tfvars with your values

# Plan infrastructure changes
terraform plan -out=tfplan

# Apply changes
terraform apply tfplan

# View outputs
terraform output
terraform output connection_summary
```

### Managing State

```bash
# List state resources
terraform state list

# Show specific resource
terraform state show module.eks_cluster

# Import existing resource
terraform import aws_s3_bucket.content autoblog-ai-content

# Destroy infrastructure (use with caution)
terraform plan -destroy -out=tfdestroy
terraform apply tfdestroy
```

### Infrastructure Modules

The Terraform configuration provisions:

| Module | Resource | Description |
|--------|----------|-------------|
| VPC | networking | VPC with public/private/database subnets across 3 AZs |
| EKS | kubernetes | EKS cluster with managed node groups |
| RDS | postgresql | PostgreSQL 16 with Multi-AZ and automated backups |
| ElastiCache | redis | Redis 7 with replication and automatic failover |
| S3 | storage | Content bucket with versioning and encryption |
| CloudFront | cdn | CDN for static asset delivery |
| Route53 | dns | DNS records for application domains |
| ACM | tls | SSL/TLS certificates for HTTPS |
| Secrets Manager | secrets | Secure credential storage |

---

## CI/CD Pipeline

### GitHub Actions Workflows

The project includes three CI/CD workflows:

1. **CI Pipeline** (`.github/workflows/ci.yml`)
   - Triggered on push/PR to main/develop
   - Lint (ESLint + Prettier + TypeScript check)
   - Test (unit + integration with Postgres/Redis services)
   - Build (application + Docker image)
   - E2E tests
   - Matrix: Node.js 18 and 20
   - Coverage report to Codecov

2. **Deploy Pipeline** (`.github/workflows/deploy.yml`)
   - Triggered on push to main or manual dispatch
   - Build Docker image and push to GHCR
   - Deploy to staging environment
   - Run smoke tests and health checks
   - Manual approval gate for production
   - Deploy to production with automatic rollback on failure

3. **Security Pipeline** (`.github/workflows/security.yml`)
   - Weekly schedule (Monday 06:00 UTC) or manual dispatch
   - npm audit for dependency vulnerabilities
   - CodeQL analysis for code vulnerabilities
   - Trivy container scan for image vulnerabilities
   - Gitleaks secret scanning
   - Dependency review

### Required GitHub Secrets

| Secret Name | Description |
|-------------|-------------|
| `GHCR_TOKEN` | GitHub Container Registry token |
| `KUBE_CONFIG` | Base64-encoded kubeconfig for staging |
| `KUBE_CONFIG_PROD` | Base64-encoded kubeconfig for production |
| `SLACK_WEBHOOK_URL` | Slack webhook for deployment notifications |
| `CODECOV_TOKEN` | Codecov token for coverage reports |
| `SENTRY_AUTH_TOKEN` | Sentry authentication token |

---

## Database Migrations

### Running Migrations

```bash
# Apply all pending migrations
npm run migrate:up

# Rollback last migration
npm run migrate:down

# Create new migration
npx prisma migrate dev --name add_content_versioning

# Reset database (destructive)
npx prisma migrate reset

# View migration status
npx prisma migrate status
```

### Migration Strategy

- All schema changes are version-controlled as Prisma migration files
- Migrations are applied automatically during deployment
- Rollback is supported via `migrate:down`
- Production migrations are run as a separate step before application rollout
- Zero-downtime migrations use the expand-contract pattern:
  1. Expand: Add new columns/tables (backward-compatible)
  2. Migrate: Run data migration in batches
  3. Contract: Remove old columns/tables in a subsequent release

---

## Monitoring Setup

### Prometheus and Grafana

```bash
# Install Prometheus stack via Helm
helm upgrade --install prometheus prometheus-community/kube-prometheus-stack \
  -n monitoring --create-namespace \
  -f k8s/monitoring/prometheus-values.yaml

# Access Grafana
kubectl port-forward -n monitoring svc/prometheus-grafana 3000:80
# Default credentials: admin / prom-operator
```

### Sentry Error Tracking

```bash
# Sentry DSN is configured via environment variable
# SENTRY_DSN=https://your-dsn@sentry.io/project-id

# Errors are automatically captured in API responses
# Source maps are uploaded during build:
npm run sentry:sourcemaps
```

### CloudWatch Alarms

Configured via Terraform for:
- RDS CPU > 80%
- RDS free storage < 5GB
- ElastiCache CPU > 80%
- ElastiCache evictions > 100/minute

---

## Backup and Disaster Recovery

### Database Backups

```bash
# Manual backup
kubectl exec -n autoblog deploy/autoblog-postgres-0 -- \
  pg_dump -U autoblog autoblog > backup_$(date +%Y%m%d).sql

# Automated backups via RDS
# - Automated daily backups with 30-day retention
# - Manual snapshots before major deployments
# - Cross-region backup copy (optional)
```

### Restore Procedures

```bash
# From RDS snapshot
aws rds restore-db-instance-from-db-snapshot \
  --db-instance-identifier autoblog-restored \
  --db-snapshot-identifier autoblog-snapshot-latest

# From SQL dump
kubectl exec -i -n autoblog autoblog-postgres-0 -- \
  psql -U autoblog autoblog < backup.sql
```

### Disaster Recovery Plan

1. **Minor incident** (single pod failure): Kubernetes auto-heals
2. **Node failure**: Auto-scaling group replaces node
3. **AZ outage**: Multi-AZ deployment handles failover automatically
4. **Region failure**: Cross-region failover (manual, 1+ hour RTO)
5. **Data corruption**: Point-in-time recovery from RDS backups

### RPO and RTO

| Scenario | RPO | RTO |
|----------|-----|-----|
| Pod failure | 0 | < 30s |
| Node failure | 0 | < 5 min |
| AZ outage | < 5 min | < 15 min |
| Data corruption | < 5 min | < 1 hour |
| Region failure | < 24 hours | < 4 hours |

---

## Scaling Guide

### Horizontal Scaling

```bash
# Manual scaling
kubectl scale deployment/autoblog-api -n autoblog --replicas=10
kubectl scale deployment/autoblog-web -n autoblog --replicas=10

# Update HPA thresholds
kubectl edit hpa autoblog-api-hpa -n autoblog
```

### Vertical Scaling

```bash
# Update resource requests/limits
kubectl edit deployment/autoblog-api -n autoblog
# Modify resources.requests and resources.limits
```

### EKS Node Scaling

```bash
# Update node group size
aws eks update-nodegroup-config \
  --cluster-name autoblog-ai-eks \
  --nodegroup-name autoblog-ai-ng \
  --scaling-config minSize=5,maxSize=30,desiredSize=5
```

---

## Troubleshooting

### Common Issues

**Pod CrashLoopBackOff**
```bash
# Check pod logs
kubectl logs -n autoblog deployment/autoblog-api --tail=100

# Describe pod for events
kubectl describe pod -n autoblog -l app.kubernetes.io/component=api

# Check resource constraints
kubectl top pod -n autoblog
```

**Database Connection Issues**
```bash
# Test connectivity from pod
kubectl exec -n autoblog deploy/autoblog-api -- \
  npx prisma db execute --stdin <<< "SELECT 1"

# Check if PostgreSQL is running
kubectl get pods -n autoblog -l app.kubernetes.io/component=database

# Check PostgreSQL logs
kubectl logs -n autoblog autoblog-postgres-0 --tail=50
```

**Ingress Issues**
```bash
# Check ingress status
kubectl describe ingress -n autoblog autoblog-ingress

# Verify service endpoints
kubectl get endpoints -n autoblog autoblog-api
kubectl get endpoints -n autoblog autoblog-web

# Check ingress controller logs
kubectl logs -n ingress-nginx deploy/ingress-nginx-controller --tail=50
```

**Image Pull Errors**
```bash
# Verify authentication
kubectl get secrets -n autoblog autoblog-registry-credentials

# Check image exists
aws ecr describe-images --repository-name autoblog-ai --region us-east-1
```

**HPA Not Scaling**
```bash
# Check HPA status
kubectl describe hpa -n autoblog autoblog-api-hpa

# Verify metrics server
kubectl get deployment metrics-server -n kube-system

# Check resource metrics
kubectl top nodes
kubectl top pods -n autoblog
```
