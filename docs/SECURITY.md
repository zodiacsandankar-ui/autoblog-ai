# Security Documentation -- AutoBlog AI

## Table of Contents

1. [Authentication Flow](#authentication-flow)
2. [Authorization and RBAC Model](#authorization-and-rbac-model)
3. [Encryption Strategy](#encryption-strategy)
4. [Secrets Management](#secrets-management)
5. [OWASP Top 10 Mitigations](#owasp-top-10-mitigations)
6. [GDPR Compliance](#gdpr-compliance)
7. [Incident Response Plan](#incident-response-plan)
8. [Security Scanning](#security-scanning)
9. [Network Security](#network-security)
10. [Audit Logging](#audit-logging)
11. [Vulnerability Disclosure](#vulnerability-disclosure)

---

## Authentication Flow

### JWT-Based Authentication

AutoBlog AI uses a dual-token JWT authentication system:

```
                    ┌──────────────┐
                    │   Client     │
                    └──────┬───────┘
                           │
                    POST /auth/login
                    { email, password }
                           │
                           ▼
                   ┌───────────────┐
                   │  Validation   │
                   │  (Zod schema) │
                   └───────┬───────┘
                           │
                           ▼
                   ┌───────────────┐
                   │  Rate Limit   │
                   │  Check        │
                   │  5/min per IP │
                   └───────┬───────┘
                           │
                           ▼
                   ┌───────────────┐
                   │  Password     │
                   │  Verify       │
                   │  (bcrypt)     │
                   └───────┬───────┘
                           │
                    ┌──────┴──────┐
                    │  MFA Check  │
                    │  (optional) │
                    └──────┬──────┘
                           │
            ┌──────────────┴──────────────┐
            │                             │
    ┌───────▼────────┐          ┌─────────▼────────┐
    │ Generate Access │          │ Generate Refresh │
    │ Token (JWT)    │          │ Token (JWT)      │
    │ 15 min expiry  │          │ 7 day expiry     │
    └───────┬────────┘          └─────────┬────────┘
            │                             │
            └──────────────┬──────────────┘
                           │
                           ▼
                   ┌───────────────┐
                   │  Response     │
                   │  { accessToken │
                   │    refreshToken│
                   │    user }     │
                   └───────────────┘
```

### Token Specification

**Access Token**
- Algorithm: RS256 (asymmetric) or HS256
- Expiry: 15 minutes
- Contains: `sub` (userId), `role`, `iat`, `exp`
- Stored: In-memory (client-side), not localStorage
- Sent: `Authorization: Bearer <token>`

**Refresh Token**
- Algorithm: HS256
- Expiry: 7 days
- Contains: `sub` (userId), `tokenVersion`, `iat`, `exp`
- Stored: HTTP-only, Secure, SameSite=Strict cookie
- Rotation: New refresh token issued on each use

### Token Lifecycle

```
1. User logs in -> Receives access + refresh tokens
2. Access token expires after 15 minutes
3. Client calls POST /auth/refresh with refresh token
4. Server validates refresh token and issues new access token
5. If refresh token is expired or revoked, user must re-authenticate
6. On logout, refresh token is immediately revoked
```

### MFA Support

- TOTP-based (Time-based One-Time Password)
- Recovery codes provided on setup (10 codes, single-use)
- Enforce MFA toggle in user settings
- Backup: SMS-based codes as alternative

---

## Authorization and RBAC Model

### Roles

| Role | Description | Permissions |
|------|-------------|-------------|
| `admin` | Full system access | All permissions |
| `editor` | Content management | CRUD content, manage topics, view analytics |
| `author` | Content creation | Create/edit own content, view analytics |
| `viewer` | Read-only access | View published content, view analytics |
| `api` | Programmatic access | API-specific permissions via API keys |

### Permission Matrix

| Resource | admin | editor | author | viewer | api |
|----------|-------|--------|--------|--------|-----|
| User management | CRUD | R | R | R | - |
| Content create/update | CRUD | CRUD | CRUD* | - | CRUD* |
| Content publish | Yes | Yes | No | - | Yes |
| Content delete | Yes | Yes | Own only | - | - |
| Topic management | CRUD | CRUD | R | R | CRUD |
| Schedule management | CRUD | CRUD | CRUD* | - | CRUD |
| Analytics | All | All | Own | Limited | All |
| Team management | CRUD | R | - | - | - |
| System configuration | CRUD | - | - | - | - |

* Own content only

### Permission Enforcement

Permissions are enforced at three levels:

1. **API Gateway** -- JWT validation and role extraction (middleware)
2. **Service Layer** -- Business logic authorization checks
3. **Database Level** -- Row-level security (RLS) policies

---

## Encryption Strategy

### Data at Rest

| Data Type | Encryption Method | Key Management |
|-----------|------------------|----------------|
| Database | AES-256 (RDS encryption) | AWS KMS |
| S3 Content | AES-256 (SSE-S3) | AWS S3 managed |
| Backups | AES-256 | AWS KMS |
| Redis | Encryption at rest | AWS KMS (ElastiCache) |

### Data in Transit

| Connection | Protocol | Cipher |
|------------|----------|--------|
| Client -> API | TLS 1.3 | TLS_AES_128_GCM_SHA256 |
| Client -> Web | TLS 1.3 | TLS_AES_128_GCM_SHA256 |
| API -> Database | TLS 1.2+ | ECDHE-RSA-AES128-GCM-SHA256 |
| API -> Redis | TLS 1.2+ (in-transit encryption) | ECDHE-RSA-AES128-GCM-SHA256 |
| API -> AI Provider | TLS 1.3 | TLS_AES_128_GCM_SHA256 |
| API -> S3 | TLS 1.2+ | AWS SigV4 + TLS |

### Password Hashing

- Algorithm: bcrypt
- Cost factor: 12 (adjustable for future hardware)
- Salt: Auto-generated per password
- Pepper: Application-level secret key

### API Key Hashing

- Generated: `ab_` prefix + 64 chars (base62)
- Stored: SHA-256 hash (one-way)
- Displayed once at creation only

---

## Secrets Management

### Architecture

```
┌─────────────┐     ┌────────────────────┐     ┌─────────────────┐
│  Pod        │────▶│  External Secrets  │────▶│  AWS Secrets    │
│  (app)      │     │  Operator          │     │  Manager        │
└─────────────┘     └────────────────────┘     └─────────────────┘
       │                      │                        │
       ▼                      ▼                        ▼
┌─────────────┐     ┌────────────────────┐     ┌─────────────────┐
│  Secret     │     │  SecretStore       │     │  KMS Encryption │
│  (in-mem)   │     │  (CRD)             │     │  Key            │
└─────────────┘     └────────────────────┘     └─────────────────┘
```

### Secrets Classification

| Classification | Examples | Storage | Access |
|----------------|----------|---------|--------|
| Critical | Database passwords, JWT secrets | AWS Secrets Manager | Service accounts only |
| High | API keys, OAuth tokens | AWS Secrets Manager | Service + specific users |
| Medium | Third-party service keys | Kubernetes Secrets | Service accounts |
| Low | Feature flags, non-sensitive config | ConfigMap | All services |

### Secret Rotation

| Secret | Rotation Period | Method |
|--------|----------------|--------|
| Database password | 90 days | AWS Secrets Manager auto-rotation |
| JWT secret | 90 days | Manual rotation with overlap period |
| AI API key | As needed | Manual update |
| Redis auth token | 90 days | AWS Secrets Manager auto-rotation |
| API keys | 180 days | Regenerate via admin UI |

### Prohibited Practices

- No secrets in environment files committed to git
- No secrets in Docker image layers
- No secrets in application logs
- No secrets in error messages returned to clients
- No hardcoded credentials in source code

---

## OWASP Top 10 Mitigations

### A01: Broken Access Control
- JWT with role-based access for every endpoint
- Row-level security in database
- Automatic permission check middleware on all routes
- CORS configured per-origin

### A02: Cryptographic Failures
- TLS 1.2+ for all external communication
- Strong ciphers only (no RC4, DES, 3DES)
- HSTS with preload (max-age=31536000)
- Passwords hashed with bcrypt (cost 12)
- Sensitive data encrypted at rest

### A03: Injection
- Prisma ORM prevents SQL injection
- Zod schemas validate all input
- Prepared statements for all database queries
- HTML sanitization for user-generated content
- Content Security Policy headers

### A04: Insecure Design
- Regular security reviews in development lifecycle
- Rate limiting on all public endpoints
- Parameterized queries throughout
- Security requirements in user stories

### A05: Security Misconfiguration
- Infrastructure as Code (Terraform) prevents drift
- Kubernetes security contexts with read-only root filesystem
- Container running as non-root user
- Automated security scanning in CI/CD

### A06: Vulnerable Components
- Weekly npm audit in CI/CD
- Trivy container scanning
- Dependabot automated PRs for vulnerable deps
- Regular update cadence for base images

### A07: Identification and Authentication Failures
- Account lockout after 5 failed attempts (15 min)
- MFA support for all accounts
- Session invalidation on password change
- Refresh token rotation
- Bruteforce protection on login endpoints

### A08: Software and Data Integrity Failures
- Docker image signing with Cosign
- SBOM generation for all builds
- Dependency lock files (package-lock.json)
- Signed git commits (verified)

### A09: Security Logging and Monitoring Failures
- Structured JSON logging for all services
- Centralized log aggregation (CloudWatch)
- Real-time alerting on security events
- Audit trail for all sensitive operations

### A10: Server-Side Request Forgery
- URL validation and allowlisting
- No direct user-controlled URLs to internal services
- Network policies restrict pod-to-pod communication

---

## GDPR Compliance

### Data Subject Rights

| Right | Implementation |
|-------|----------------|
| Right to be informed | Privacy policy, in-app notices |
| Right of access | Account data export endpoint |
| Right to rectification | Profile editing in settings |
| Right to erasure | Account deletion with data purge |
| Right to restrict processing | Privacy settings controls |
| Right to data portability | JSON/CSV export of all data |
| Right to object | Opt-out mechanisms for marketing |
| Rights related to automated decisions | AI content generation transparency |

### Data Processing Records

All data processing activities are documented:
- Purpose of processing
- Data categories involved
- Retention periods
- Third-party processors (OpenAI, AWS, etc.)
- Cross-border transfer mechanisms

### Data Retention

| Data Category | Retention | Deletion Method |
|---------------|-----------|-----------------|
| User accounts | Until deletion request | Hard delete after 30-day grace |
| Content | Indefinite (or account deletion) | Anonymization |
| Analytics | 24 months | Aggregation, then deletion |
| Logs | 90 days | Automatic rotation |
| Backups | 30 days, then monthly for 12 months | Deletion |
| Session data | 7 days | Automatic expiry |

### Data Processing Agreement (DPA)

DPA available for enterprise customers covering:
- Data Processing Addendum
- Sub-processor list
- Technical and organizational measures (TOMs)
- Data breach notification procedures

---

## Incident Response Plan

### Incident Severity Levels

| Level | Description | Response Time | Escalation |
|-------|-------------|---------------|------------|
| SEV-1 | Data breach, service outage | < 15 min | CTO, Security team |
| SEV-2 | Partial outage, degraded performance | < 1 hour | Engineering lead |
| SEV-3 | Minor issues, no user impact | < 24 hours | Engineering team |
| SEV-4 | Low priority, cosmetic | Next sprint | Product team |

### Incident Response Process

```
Discovery
    │
    ▼
1. Triage ──────────────────────────────────► False positive → Close
    │
    ▼ (Confirmed)
2. Containment
    ├── Isolate affected systems
    ├── Revoke compromised credentials
    └── Block malicious IPs
    │
    ▼
3. Investigation
    ├── Analyze logs and traces
    ├── Determine root cause
    ├── Assess data impact
    └── Document findings
    │
    ▼
4. Remediation
    ├── Apply security patches
    ├── Rotate all affected secrets
    ├── Restore from clean backup
    └── Verify system integrity
    │
    ▼
5. Recovery
    ├── Restore services
    ├── Monitor for recurrence
    └── Communicate resolution
    │
    ▼
6. Post-Mortem
    ├── Root cause analysis
    ├── Action items and owners
    ├── Update runbooks
    └── Report to stakeholders
```

### Communication Plan

- **Internal**: Slack #security channel, PagerDuty escalation
- **Customers**: Status page, email notification for data breaches
- **Regulatory**: DPA notification within 72 hours (GDPR)
- **Public**: Blog post after resolution for significant incidents

### Incident Response Team

| Role | Responsibility | Backup |
|------|----------------|--------|
| Incident Commander | Overall coordination | CTO |
| Security Lead | Technical investigation | Security engineer |
| Engineering Lead | Service restoration | Senior engineer |
| Communications Lead | Internal/external comms | Product manager |
| Legal Counsel | Regulatory compliance | External counsel |

---

## Security Scanning

### Automated Scanning

| Scan Type | Frequency | Tool | Action on Finding |
|-----------|-----------|------|-------------------|
| SAST | Every commit | CodeQL | Block PR on high/critical |
| Dependency scan | Weekly | npm audit | Create issue |
| Container scan | Weekly | Trivy | Block deployment on critical |
| Secret scan | Every commit | Gitleaks | Block commit |
| DAST | Monthly | OWASP ZAP | Create issue |
| Penetration test | Quarterly | External vendor | Remediate within SLA |

### Security Headers

All responses include:

```
Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
X-XSS-Protection: 1; mode=block
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=()
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'
```

---

## Network Security

### Kubernetes Network Policies

- **Default-deny**: All ingress/egress blocked by default
- **API**: Ingress from ingress-nginx and web; egress to database, cache, and internet
- **Web**: Ingress from ingress-nginx; egress to API and internet
- **Database**: Ingress from API only; egress to internet for updates
- **Cache**: Ingress from API only; egress to internet for replication

### AWS Security Groups

- **EKS Cluster**: Minimal inbound, all outbound
- **RDS**: Inbound from EKS security group only (port 5432)
- **ElastiCache**: Inbound from EKS security group only (port 6379)
- **Bastion**: Inbound from office IPs only (if required)

### WAF Rules

- Rate-based blocking (> 1000 requests/5 min per IP)
- SQL injection protection
- Cross-site scripting protection
- Known bad bot blocking
- IP reputation lists

---

## Audit Logging

### Events Logged

| Category | Events | Retention |
|----------|--------|-----------|
| Authentication | Login, logout, failed login, MFA events | 90 days |
| Authorization | Permission changes, role changes | 90 days |
| Content | Content create, update, delete, publish | 90 days |
| User management | Account creation, deletion, email change | 90 days |
| Configuration | Settings changes, feature flag toggles | 90 days |
| API usage | All API requests (summary) | 30 days |
| Security events | Rate limit triggers, blocked requests | 90 days |

### Log Format

```json
{
  "timestamp": "2026-07-03T10:30:00.000Z",
  "eventId": "evt_abc123",
  "eventType": "user.login",
  "actor": {
    "id": "user_xyz",
    "email": "user@example.com",
    "ip": "203.0.113.1",
    "userAgent": "Mozilla/5.0..."
  },
  "resource": {
    "type": "session",
    "id": "sess_abc123"
  },
  "action": "create",
  "result": "success",
  "metadata": {
    "mfaUsed": true,
    "authMethod": "password"
  }
}
```

---

## Vulnerability Disclosure

We encourage responsible disclosure of security vulnerabilities.

### Reporting Process

1. **DO NOT** file a public GitHub issue
2. Email security@autoblog.ai with:
   - Description of the vulnerability
   - Steps to reproduce
   - Affected versions
   - Potential impact
3. You will receive an acknowledgement within 48 hours
4. We will work with you on a timeline for resolution
5. Credit will be given in our security acknowledgements

### Scope

- In-scope: The autoblog-ai application and its source code
- Out-of-scope: Third-party services, social engineering, physical attacks

### Commitment

- We will respond to all valid reports within 48 hours
- We will keep you informed of progress toward resolution
- We will not pursue legal action for good-faith research
- We will credit researchers in our security disclosures
