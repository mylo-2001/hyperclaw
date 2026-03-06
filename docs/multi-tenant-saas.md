# Multi-Tenant SaaS Engine

Infrastructure for managed multi-tenant deployment. Used when running HyperClaw as a cloud service.

## Components

| Component | Path | Purpose |
|-----------|------|---------|
| **Tenant isolation** | `src/infra/tenant.ts` | Per-tenant config, workspace, paths |
| **Auth** | `src/infra/developer-keys.ts`, `jwt-auth.ts` | Developer keys + JWT with tenantId |
| **Rate limiting** | `src/infra/rate-limiter.ts` | Per-tenant in-memory limits |
| **Queue** | `src/services/agent-queue.ts` | Job queue for agent runs |
| **Billing** | `src/services/billing.ts` | Tenant usage summary, Stripe placeholder |

## Tenant Isolation

- `getTenantBaseDir(tenantId)` → `~/.hyperclaw/tenants/{id}/`
- `getTenantConfigPath(tenantId)` → tenant `hyperclaw.json`
- `getTenantWorkspaceDir(tenantId)` → SOUL, MEMORY, AGENTS
- `registerTenant()`, `listTenants()`, `getTenant()`

## Auth

- **Developer keys**: `createDeveloperKey(name, { tenantId })` — keys scoped to tenant
- **validateDeveloperKey(bearer)** returns `{ valid, tenantId }`
- **JWT**: `verifyJwt(token)`, `getTenantIdFromJwt(bearer)` — set `HYPERCLAW_JWT_SECRET`

## Rate Limiting

- `checkRateLimit(tenantId, 'api', { limit: 100, windowSeconds: 60 })` → boolean
- `getRemaining()`, `resetRateLimit()`

## Queue

- `enqueueAgentJob(tenantId, message, { sessionId, source })` → job id
- `getJob(id)`, `listJobs(tenantId)`
- `setAgentJobHandler(handler)` — wire to `runAgentEngine`

## Billing

- `getTenantBillingSummary(tenantId)` — usage from tenant costs dir
- `handleStripeWebhook(payload, signature)` — set `STRIPE_WEBHOOK_SECRET`
- `createCheckoutSession(tenantId)` — requires Stripe SDK

## Env Vars

| Var | Purpose |
|-----|---------|
| `HYPERCLAW_JWT_SECRET` | JWT HMAC verification |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signature |
| `STRIPE_SECRET_KEY` | Stripe API (for checkout) |
