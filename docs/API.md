# API Documentation -- AutoBlog AI

## Table of Contents

1. [Overview](#overview)
2. [Authentication](#authentication)
3. [Rate Limiting](#rate-limiting)
4. [Error Codes](#error-codes)
5. [Pagination](#pagination)
6. [Content Endpoints](#content-endpoints)
7. [Topic Endpoints](#topic-endpoints)
8. [User Endpoints](#user-endpoints)
9. [Auth Endpoints](#auth-endpoints)
10. [Schedule Endpoints](#schedule-endpoints)
11. [Analytics Endpoints](#analytics-endpoints)
12. [Webhook Endpoints](#webhook-endpoints)
13. [Admin Endpoints](#admin-endpoints)

---

## Overview

### Base URL

```
Production: https://api.autoblog.ai/v1
Staging:    https://staging.autoblog.ai/api/v1
Local:      http://localhost:3001/v1
```

### Content Type

All requests and responses use `application/json` unless otherwise specified.

### API Versioning

The API is versioned via URL path prefix (`/v1`). Breaking changes will result in a new version number. The previous version will be supported for at least 6 months after deprecation notice.

### Common Headers

| Header | Description | Required |
|--------|-------------|----------|
| `Authorization` | Bearer token (`Bearer <token>`) | Yes (for authenticated routes) |
| `X-Request-Id` | Idempotency key for POST/PUT/PATCH | No |
| `X-Api-Key` | API key for programmatic access | Yes (for API key auth) |
| `Accept-Language` | Language preference (en, es, fr, etc.) | No |

### Standard Response Format

```json
{
  "success": true,
  "data": { ... },
  "meta": {
    "requestId": "req_abc123",
    "timestamp": "2026-07-03T10:30:00.000Z"
  }
}
```

### Error Response Format

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "The request body contains invalid fields",
    "details": [
      {
        "field": "title",
        "message": "Title must be between 3 and 200 characters",
        "code": "STRING_MIN_LENGTH"
      }
    ]
  },
  "meta": {
    "requestId": "req_abc123",
    "timestamp": "2026-07-03T10:30:00.000Z"
  }
}
```

---

## Authentication

### Register a new user

Creates a new user account and returns access and refresh tokens.

```
POST /auth/register
```

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "SecureP@ss123",
  "username": "johndoe",
  "displayName": "John Doe"
}
```

**Response (201):**
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "user_abc123",
      "email": "user@example.com",
      "username": "johndoe",
      "displayName": "John Doe",
      "role": "author",
      "emailVerified": false,
      "createdAt": "2026-07-03T10:30:00.000Z"
    },
    "accessToken": "eyJhbGciOiJSUzI1NiIs...",
    "refreshToken": "eyJhbGciOiJIUzI1NiIs...",
    "expiresIn": 900
  }
}
```

### Log in

Authenticates a user and returns tokens.

```
POST /auth/login
```

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "SecureP@ss123"
}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "user": { ... },
    "accessToken": "eyJhbGciOiJSUzI1NiIs...",
    "refreshToken": "eyJhbGciOiJIUzI1NiIs...",
    "expiresIn": 900
  }
}
```

### Refresh token

Obtains a new access token using a refresh token.

```
POST /auth/refresh
```

**Request Cookie:** `refreshToken=<token>`

**Response (200):**
```json
{
  "success": true,
  "data": {
    "accessToken": "eyJhbGciOiJSUzI1NiIs...",
    "expiresIn": 900
  }
}
```

### Log out

Revokes the current refresh token.

```
POST /auth/logout
```

**Authorization:** Bearer token required.

**Response (200):**
```json
{
  "success": true,
  "data": {
    "message": "Logged out successfully"
  }
}
```

### Get current user

Returns the authenticated user's profile.

```
GET /auth/me
```

**Authorization:** Bearer token required.

**Response (200):**
```json
{
  "success": true,
  "data": {
    "id": "user_abc123",
    "email": "user@example.com",
    "username": "johndoe",
    "displayName": "John Doe",
    "avatarUrl": "https://cdn.autoblog.ai/avatars/user_abc123.jpg",
    "role": "author",
    "plan": "pro",
    "emailVerified": true,
    "mfaEnabled": false,
    "createdAt": "2026-07-03T10:30:00.000Z",
    "updatedAt": "2026-07-03T12:00:00.000Z"
  }
}
```

### Request password reset

```
POST /auth/forgot-password
```

**Request Body:**
```json
{
  "email": "user@example.com"
}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "message": "If the email exists, a reset link has been sent"
  }
}
```

### Reset password

```
POST /auth/reset-password
```

**Request Body:**
```json
{
  "token": "reset_token_abc123",
  "password": "NewSecureP@ss456"
}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "message": "Password has been reset successfully"
  }
}
```

---

## Rate Limiting

### Limits

| Endpoint Group | Rate Limit | Burst | Window |
|----------------|------------|-------|--------|
| Public (unauthenticated) | 20 requests | 30 | 1 minute |
| Authenticated | 100 requests | 150 | 1 minute |
| Authenticated (pro plan) | 500 requests | 750 | 1 minute |
| Auth endpoints | 5 requests | 10 | 1 minute |
| Content generation | 10 requests | 15 | 1 minute |

### Headers

Rate limit information is included in response headers:

```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 87
X-RateLimit-Reset: 1688382600
Retry-After: 45
```

### Exceeding Limits

When rate limit is exceeded, the API returns:

```json
{
  "success": false,
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "Too many requests. Please try again in 45 seconds.",
    "details": {
      "retryAfter": 45,
      "limit": 100,
      "windowMs": 60000
    }
  }
}
```

Status Code: **429 Too Many Requests**

---

## Error Codes

### HTTP Status Codes

| Code | Description |
|------|-------------|
| 200 | Success |
| 201 | Created |
| 202 | Accepted (async operation) |
| 204 | No content |
| 400 | Bad request |
| 401 | Unauthorized |
| 403 | Forbidden |
| 404 | Not found |
| 409 | Conflict |
| 422 | Unprocessable entity |
| 429 | Too many requests |
| 500 | Internal server error |
| 502 | Bad gateway |
| 503 | Service unavailable |

### API Error Codes

| Error Code | HTTP Status | Description |
|------------|-------------|-------------|
| `VALIDATION_ERROR` | 422 | Request validation failed |
| `UNAUTHORIZED` | 401 | Missing or invalid authentication |
| `TOKEN_EXPIRED` | 401 | Access token has expired |
| `TOKEN_INVALID` | 401 | Token is malformed or invalid |
| `INSUFFICIENT_PERMISSIONS` | 403 | User lacks required role |
| `RESOURCE_NOT_FOUND` | 404 | Requested resource does not exist |
| `RESOURCE_CONFLICT` | 409 | Resource already exists (e.g., duplicate slug) |
| `RATE_LIMIT_EXCEEDED` | 429 | Too many requests |
| `CONTENT_GENERATION_FAILED` | 500 | AI content generation failed |
| `AI_SERVICE_UNAVAILABLE` | 503 | AI provider is unreachable |
| `QUOTA_EXCEEDED` | 403 | User has exceeded plan quota |
| `INVALID_FILE_TYPE` | 422 | Uploaded file type not allowed |
| `FILE_TOO_LARGE` | 422 | Uploaded file exceeds size limit |
| `INTERNAL_ERROR` | 500 | Unexpected error |
| `SERVICE_UNAVAILABLE` | 503 | Service temporarily unavailable |

---

## Pagination

### Request Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `page` | integer | 1 | Page number (1-indexed) |
| `limit` | integer | 20 | Items per page (max 100) |
| `sort` | string | `createdAt` | Field to sort by |
| `order` | string | `desc` | Sort order (`asc` or `desc`) |
| `search` | string | - | Search query |
| `filter` | string | - | Filter expression (see below) |

### Filter Expression Syntax

```
GET /content?filter=status==published,createdAt>=2026-01-01
```

Supported operators: `==`, `!=`, `>`, `>=`, `<`, `<=`, `in`, `contains`

### Response Format

```json
{
  "success": true,
  "data": [ ... ],
  "meta": {
    "pagination": {
      "page": 1,
      "limit": 20,
      "totalItems": 156,
      "totalPages": 8,
      "hasNextPage": true,
      "hasPreviousPage": false
    },
    "requestId": "req_abc123",
    "timestamp": "2026-07-03T10:30:00.000Z"
  }
}
```

---

## Content Endpoints

### List content

```
GET /content
```

**Authorization:** Bearer token required.

**Query Parameters:**
- `status` - Filter by status: `draft`, `published`, `scheduled`, `archived`
- `userId` - Filter by author
- `tag` - Filter by tag slug
- `search` - Search in title and excerpt
- `from` - Start date (ISO 8601)
- `to` - End date (ISO 8601)

**Response (200):**
```json
{
  "success": true,
  "data": [
    {
      "id": "content_abc123",
      "title": "How AI is Transforming Content Marketing in 2026",
      "slug": "ai-transforming-content-marketing-2026",
      "excerpt": "Discover how artificial intelligence is reshaping...",
      "status": "published",
      "contentType": "markdown",
      "author": {
        "id": "user_abc123",
        "displayName": "John Doe",
        "avatarUrl": "https://cdn.autoblog.ai/avatars/user_abc123.jpg"
      },
      "tags": [
        { "id": "tag_abc", "name": "AI", "slug": "ai" },
        { "id": "tag_def", "name": "Marketing", "slug": "marketing" }
      ],
      "wordCount": 1520,
      "seoScore": 87,
      "publishedAt": "2026-07-02T10:00:00.000Z",
      "createdAt": "2026-07-01T08:00:00.000Z",
      "updatedAt": "2026-07-02T10:00:00.000Z"
    }
  ],
  "meta": { "pagination": { ... } }
}
```

### Get content by ID

```
GET /content/:id
```

**Authorization:** Bearer token required.

**Response (200):**
```json
{
  "success": true,
  "data": {
    "id": "content_abc123",
    "title": "How AI is Transforming Content Marketing in 2026",
    "slug": "ai-transforming-content-marketing-2026",
    "excerpt": "Discover how artificial intelligence is reshaping...",
    "body": {
      "markdown": "# How AI is Transforming Content Marketing...\n\n...",
      "html": "<h1>How AI is Transforming Content Marketing...</h1>...",
      "plainText": "How AI is Transforming Content Marketing..."
    },
    "status": "published",
    "contentType": "markdown",
    "featuredImageUrl": "https://cdn.autoblog.ai/content/abc123/featured.jpg",
    "author": { ... },
    "tags": [ ... ],
    "seo": {
      "metaTitle": "How AI is Transforming Content Marketing in 2026",
      "metaDescription": "Discover how AI is reshaping content marketing...",
      "focusKeyword": "AI content marketing",
      "slug": "ai-transforming-content-marketing-2026",
      "score": 87,
      "readabilityScore": 92
    },
    "aiMetadata": {
      "model": "gpt-4o",
      "promptTokens": 450,
      "completionTokens": 1250,
      "totalCost": 0.0034,
      "generatedAt": "2026-07-01T08:30:00.000Z"
    },
    "wordCount": 1520,
    "publishedAt": "2026-07-02T10:00:00.000Z",
    "createdAt": "2026-07-01T08:00:00.000Z",
    "updatedAt": "2026-07-02T10:00:00.000Z"
  }
}
```

### Create content

```
POST /content
```

**Authorization:** Bearer token required.

**Request Body:**
```json
{
  "title": "How AI is Transforming Content Marketing in 2026",
  "body": "# Content here...",
  "contentType": "markdown",
  "tags": ["AI", "Marketing"],
  "status": "draft",
  "seo": {
    "metaTitle": "...",
    "metaDescription": "...",
    "focusKeyword": "AI content marketing"
  },
  "featuredImageUrl": "https://example.com/image.jpg",
  "scheduledAt": "2026-07-05T10:00:00.000Z"
}
```

**Response (201):** Full content object.

### Update content

```
PUT /content/:id
```

**Authorization:** Bearer token required (author or editor+).

**Request Body:** Partial content object (same fields as create).

**Response (200):** Updated content object.

### Delete content

```
DELETE /content/:id
```

**Authorization:** Bearer token required (author of content or admin).

**Response (204):** No content.

### Generate content with AI

Initiates async content generation via AI.

```
POST /content/generate
```

**Authorization:** Bearer token required.

**Request Body:**
```json
{
  "topic": "AI in content marketing",
  "tone": "professional",
  "wordCount": 1500,
  "language": "en",
  "includeImages": true,
  "generateSEO": true,
  "outline": [
    "Introduction",
    "Current State of Content Marketing",
    "How AI is Changing the Game",
    "Practical Applications",
    "Future Outlook",
    "Conclusion"
  ],
  "keywords": ["AI marketing", "content automation", "NLP"],
  "referenceUrls": ["https://example.com/source1"]
}
```

**Response (202):**
```json
{
  "success": true,
  "data": {
    "jobId": "job_abc123",
    "status": "queued",
    "estimatedDuration": 45000
  }
}
```

### Get generation status

```
GET /content/generate/:jobId
```

**Authorization:** Bearer token required.

**Response (200):**
```json
{
  "success": true,
  "data": {
    "jobId": "job_abc123",
    "status": "processing",
    "progress": 45,
    "stage": "writing_content",
    "contentId": null,
    "estimatedDuration": 45000
  }
}
```

### Publish content

```
POST /content/:id/publish
```

**Authorization:** Bearer token required (editor+).

**Request Body:**
```json
{
  "scheduledAt": null
}
```

**Response (200):** Published content object.

### Archive content

```
POST /content/:id/archive
```

**Authorization:** Bearer token required (editor+).

**Response (200):** Archived content object.

### Duplicate content

```
POST /content/:id/duplicate
```

**Authorization:** Bearer token required (author+).

**Response (201):** Duplicated content object (title appended with "(Copy)").

---

## Topic Endpoints

### List topics

```
GET /topics
```

**Authorization:** Bearer token required.

**Query Parameters:**
- `search` - Search in name and description
- `category` - Filter by category
- `minVolume` - Minimum search volume
- `maxDifficulty` - Maximum difficulty score

### Generate topic suggestions

```
POST /topics/suggest
```

**Authorization:** Bearer token required.

**Request Body:**
```json
{
  "niche": "technology",
  "count": 10,
  "includeVolumes": true,
  "language": "en"
}
```

### Get topic details

```
GET /topics/:id
```

---

## User Endpoints

### List users (admin only)

```
GET /users
```

### Get user by ID

```
GET /users/:id
```

### Update user

```
PUT /users/:id
```

### Update user role (admin only)

```
PUT /users/:id/role
```

### Delete user (admin only)

```
DELETE /users/:id
```

### Get user content

```
GET /users/:id/content
```

### Get user analytics

```
GET /users/:id/analytics
```

---

## Schedule Endpoints

### List schedules

```
GET /schedules
```

### Create schedule

```
POST /schedules
```

**Request Body:**
```json
{
  "name": "Weekly Tech Posts",
  "cronExpression": "0 8 * * 1",
  "topics": ["AI", "Cloud Computing", "DevOps"],
  "config": {
    "wordCount": 1500,
    "tone": "professional",
    "includeImages": true
  },
  "isActive": true
}
```

### Update schedule

```
PUT /schedules/:id
```

### Delete schedule

```
DELETE /schedules/:id
```

### Pause/Resume schedule

```
POST /schedules/:id/toggle
```

---

## Analytics Endpoints

### Get content analytics

```
GET /analytics/content/:id
```

### Get dashboard summary

```
GET /analytics/dashboard
```

### Get trend data

```
GET /analytics/trends
```

**Query Parameters:**
- `from` - Start date
- `to` - End date
- `granularity` - `day`, `week`, `month`

### Get top-performing content

```
GET /analytics/top-content
```

**Query Parameters:**
- `metric` - `views`, `engagement`, `shares`
- `limit` - Number of results (default 10)

---

## Webhook Endpoints

### List webhooks

```
GET /webhooks
```

### Create webhook

```
POST /webhooks
```

**Request Body:**
```json
{
  "url": "https://example.com/webhook",
  "events": ["content.published", "content.updated"],
  "secret": "whsec_abc123",
  "isActive": true
}
```

### Update webhook

```
PUT /webhooks/:id
```

### Delete webhook

```
DELETE /webhooks/:id
```

### Test webhook

```
POST /webhooks/:id/test
```

### Webhook Events

| Event | Description |
|-------|-------------|
| `content.created` | New content created |
| `content.updated` | Content updated |
| `content.published` | Content published |
| `content.archived` | Content archived |
| `content.deleted` | Content deleted |
| `content.generation.completed` | AI generation completed |
| `content.generation.failed` | AI generation failed |
| `schedule.executed` | Scheduled generation executed |
| `user.registered` | New user registered |

---

## Admin Endpoints

### Get system health

```
GET /admin/health
```

### Get system metrics

```
GET /admin/metrics
```

**Authorization:** Admin only.

### Clear cache

```
POST /admin/cache/clear
```

**Authorization:** Admin only.

**Request Body:**
```json
{
  "pattern": "content:*"
}
```

### List background jobs

```
GET /admin/jobs
```

**Authorization:** Admin only.

### Retry failed job

```
POST /admin/jobs/:id/retry
```

**Authorization:** Admin only.

### Get system configuration

```
GET /admin/config
```

**Authorization:** Admin only.

### Update system configuration

```
PUT /admin/config
```

**Authorization:** Admin only.

---

## API Keys (Programmatic Access)

### Create API Key

```
POST /admin/api-keys
```

**Authorization:** Admin only.

**Request Body:**
```json
{
  "name": "CI/CD Integration",
  "permissions": ["content:read", "content:write"],
  "expiresAt": "2027-07-03T00:00:00.000Z"
}
```

**Response (201):**
```json
{
  "success": true,
  "data": {
    "id": "ak_abc123",
    "name": "CI/CD Integration",
    "key": "ab_abc123def456...",
    "permissions": ["content:read", "content:write"],
    "createdAt": "2026-07-03T10:30:00.000Z",
    "expiresAt": "2027-07-03T00:00:00.000Z"
  }
}
```

**Note:** The full API key is displayed only once at creation.

### List API Keys

```
GET /admin/api-keys
```

### Revoke API Key

```
DELETE /admin/api-keys/:id
```

---

## SDK Examples

### cURL

```bash
# Authenticate
curl -X POST https://api.autoblog.ai/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "user@example.com", "password": "SecureP@ss123"}'

# List content
curl -X GET https://api.autoblog.ai/v1/content \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json"

# Generate content
curl -X POST https://api.autoblog.ai/v1/content/generate \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"topic": "AI in marketing", "wordCount": 1000}'
```

### JavaScript/TypeScript

```typescript
const API_BASE = "https://api.autoblog.ai/v1";

async function generateContent(topic: string, token: string) {
  const response = await fetch(`${API_BASE}/content/generate`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      topic,
      wordCount: 1500,
      tone: "professional",
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error.message);
  }

  return response.json();
}
```

### Python

```python
import requests

API_BASE = "https://api.autoblog.ai/v1"

def generate_content(topic: str, token: str) -> dict:
    response = requests.post(
        f"{API_BASE}/content/generate",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        json={
            "topic": topic,
            "wordCount": 1500,
            "tone": "professional",
        },
    )
    response.raise_for_status()
    return response.json()
```
