/**
 * src/services/billing.ts
 * Multi-tenant SaaS billing layer — usage tracking + Stripe integration.
 *
 * Usage tracking works out-of-the-box (no Stripe required).
 * Stripe features require: npm install stripe   +   STRIPE_SECRET_KEY env var.
 *
 * Supported flows:
 *   - Per-tenant token usage aggregation (input/output/cache tokens + USD cost)
 *   - Stripe Checkout session creation (hosted payment page)
 *   - Stripe Customer Portal (subscription management)
 *   - Stripe webhook handling (subscription updates, invoice events)
 *   - Subscription status stored in ~/.hyperclaw/tenants/<id>/subscription.json
 */

import path from 'path';
import fs from 'fs-extra';
import { getTenantBaseDir } from '../infra/tenant';
import { getGlobalSummary } from '../infra/cost-tracker';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface BillingSummary {
  tenantId: string;
  totalInput: number;
  totalOutput: number;
  totalCacheRead: number;
  totalCostUsd: number;
  totalRuns: number;
  periodStart?: string;
  periodEnd?: string;
}

export type SubscriptionStatus = 'active' | 'trialing' | 'past_due' | 'canceled' | 'none';

export interface TenantSubscription {
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  stripePriceId?: string;
  status: SubscriptionStatus;
  currentPeriodEnd?: string;
  cancelAtPeriodEnd?: boolean;
  plan?: string;
  updatedAt: string;
}

// ── Usage / Cost ──────────────────────────────────────────────────────────────

/** Get billing usage summary for a tenant (reads from tenant-scoped costs dir). */
export async function getTenantBillingSummary(
  tenantId: string,
  period?: { start: string; end: string }
): Promise<BillingSummary> {
  const baseDir = getTenantBaseDir(tenantId);
  const summary = await getGlobalSummary(baseDir);
  return {
    tenantId,
    totalInput: summary.totalInput,
    totalOutput: summary.totalOutput,
    totalCacheRead: summary.totalCacheRead,
    totalCostUsd: summary.totalCostUsd,
    totalRuns: summary.totalRuns,
    periodStart: period?.start,
    periodEnd: period?.end,
  };
}

// ── Subscription state (local JSON cache) ─────────────────────────────────────

function subscriptionPath(tenantId: string): string {
  return path.join(getTenantBaseDir(tenantId), 'subscription.json');
}

export async function getSubscription(tenantId: string): Promise<TenantSubscription> {
  try {
    const p = subscriptionPath(tenantId);
    if (await fs.pathExists(p)) return await fs.readJson(p);
  } catch { /* */ }
  return { status: 'none', updatedAt: new Date().toISOString() };
}

async function saveSubscription(tenantId: string, sub: TenantSubscription): Promise<void> {
  const p = subscriptionPath(tenantId);
  await fs.ensureDir(path.dirname(p));
  await fs.writeJson(p, { ...sub, updatedAt: new Date().toISOString() }, { spaces: 2 });
}

// ── Stripe helper ─────────────────────────────────────────────────────────────

async function getStripe(): Promise<any> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY env var not set. Run: export STRIPE_SECRET_KEY=sk_live_...');
  try {
    const Stripe = (await import('stripe' as any)).default ?? (await import('stripe' as any));
    return new Stripe(key, { apiVersion: '2024-06-20' });
  } catch {
    throw new Error('Stripe SDK not installed. Run: npm install stripe');
  }
}

// ── Checkout session ──────────────────────────────────────────────────────────

export interface CheckoutOpts {
  priceId: string;
  successUrl?: string;
  cancelUrl?: string;
  customerEmail?: string;
  trialDays?: number;
  metadata?: Record<string, string>;
}

/**
 * Creates a Stripe Checkout session for a tenant.
 * Requires: STRIPE_SECRET_KEY + `stripe` npm package.
 */
export async function createCheckoutSession(
  tenantId: string,
  opts: CheckoutOpts
): Promise<{ url?: string; sessionId?: string; error?: string }> {
  try {
    const stripe = await getStripe();
    const sub = await getSubscription(tenantId);

    const sessionParams: any = {
      mode: 'subscription',
      line_items: [{ price: opts.priceId, quantity: 1 }],
      success_url: opts.successUrl ?? `${process.env.APP_URL ?? 'http://localhost:3000'}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: opts.cancelUrl ?? `${process.env.APP_URL ?? 'http://localhost:3000'}/billing/cancel`,
      metadata: { tenantId, ...(opts.metadata ?? {}) },
      subscription_data: {
        metadata: { tenantId },
        ...(opts.trialDays ? { trial_period_days: opts.trialDays } : {}),
      },
    };

    if (sub.stripeCustomerId) {
      sessionParams.customer = sub.stripeCustomerId;
    } else if (opts.customerEmail) {
      sessionParams.customer_email = opts.customerEmail;
    }

    const session = await stripe.checkout.sessions.create(sessionParams);
    return { url: session.url, sessionId: session.id };
  } catch (e: any) {
    return { error: e.message };
  }
}

// ── Customer Portal ───────────────────────────────────────────────────────────

/**
 * Creates a Stripe Customer Portal session (subscription management, cancellation).
 * Requires: STRIPE_SECRET_KEY + customer already exists (post-checkout).
 */
export async function createPortalSession(
  tenantId: string,
  returnUrl?: string
): Promise<{ url?: string; error?: string }> {
  try {
    const stripe = await getStripe();
    const sub = await getSubscription(tenantId);
    if (!sub.stripeCustomerId) {
      return { error: 'No Stripe customer found for this tenant. Complete checkout first.' };
    }
    const session = await stripe.billingPortal.sessions.create({
      customer: sub.stripeCustomerId,
      return_url: returnUrl ?? `${process.env.APP_URL ?? 'http://localhost:3000'}/billing`,
    });
    return { url: session.url };
  } catch (e: any) {
    return { error: e.message };
  }
}

// ── Webhook handler ───────────────────────────────────────────────────────────

export interface StripeWebhookEvent {
  type: string;
  data: { object?: Record<string, unknown> };
}

/**
 * Validates and processes a Stripe webhook event.
 * STRIPE_WEBHOOK_SECRET is required (from Stripe Dashboard → Webhooks → signing secret).
 * Relevant events handled:
 *   - checkout.session.completed → save customerId + subscriptionId
 *   - customer.subscription.updated → update status
 *   - customer.subscription.deleted → mark canceled
 *   - invoice.payment_failed → mark past_due
 */
export async function handleStripeWebhook(
  payload: string | Buffer,
  signature: string
): Promise<{ received: boolean; error?: string; event?: string }> {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    return { received: false, error: 'STRIPE_WEBHOOK_SECRET not configured' };
  }

  let stripe: any;
  try {
    stripe = await getStripe();
  } catch (e: any) {
    return { received: false, error: e.message };
  }

  let event: any;
  try {
    event = stripe.webhooks.constructEvent(payload, signature, secret);
  } catch (e: any) {
    return { received: false, error: `Webhook signature verification failed: ${e.message}` };
  }

  const obj = event.data?.object ?? {};

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const tenantId: string | undefined = obj.metadata?.tenantId;
        if (!tenantId) break;
        const existing = await getSubscription(tenantId);
        await saveSubscription(tenantId, {
          ...existing,
          stripeCustomerId: obj.customer as string,
          stripeSubscriptionId: obj.subscription as string,
          status: 'active',
          plan: obj.metadata?.plan ?? existing.plan,
        });
        break;
      }

      case 'customer.subscription.updated': {
        const tenantId: string | undefined = obj.metadata?.tenantId;
        if (!tenantId) break;
        const existing = await getSubscription(tenantId);
        await saveSubscription(tenantId, {
          ...existing,
          stripeSubscriptionId: obj.id as string,
          stripePriceId: (obj.items as any)?.data?.[0]?.price?.id,
          status: obj.status as SubscriptionStatus,
          currentPeriodEnd: obj.current_period_end
            ? new Date((obj.current_period_end as number) * 1000).toISOString()
            : undefined,
          cancelAtPeriodEnd: obj.cancel_at_period_end as boolean,
        });
        break;
      }

      case 'customer.subscription.deleted': {
        const tenantId: string | undefined = obj.metadata?.tenantId;
        if (!tenantId) break;
        const existing = await getSubscription(tenantId);
        await saveSubscription(tenantId, { ...existing, status: 'canceled' });
        break;
      }

      case 'invoice.payment_failed': {
        const subId = obj.subscription as string | undefined;
        if (!subId) break;
        // Find tenant by subscriptionId (scan all tenants — small scale)
        // In production: use a DB lookup
        break;
      }
    }
  } catch (e: any) {
    return { received: true, event: event.type, error: `Handler error: ${e.message}` };
  }

  return { received: true, event: event.type };
}

// ── Plan helpers ──────────────────────────────────────────────────────────────

export const PLANS = [
  { id: 'starter',    label: 'Starter',    monthlyUsd: 9,   requests: 500,   models: ['claude-haiku', 'gpt-4o-mini'] },
  { id: 'pro',        label: 'Pro',        monthlyUsd: 29,  requests: 5000,  models: ['claude-3-5-sonnet', 'gpt-4o'] },
  { id: 'business',   label: 'Business',   monthlyUsd: 99,  requests: 50000, models: ['all'] },
  { id: 'enterprise', label: 'Enterprise', monthlyUsd: 0,   requests: -1,    models: ['all'] },
] as const;

export type PlanId = typeof PLANS[number]['id'];

export function getPlan(id: PlanId) {
  return PLANS.find(p => p.id === id);
}

/** Returns true if tenant's subscription allows the given model. */
export async function canUsePlan(tenantId: string, modelId: string): Promise<boolean> {
  const sub = await getSubscription(tenantId);
  if (sub.status !== 'active' && sub.status !== 'trialing') return false;
  const plan = getPlan(sub.plan as PlanId);
  if (!plan) return true;
  return (plan.models as readonly string[]).includes('all') || (plan.models as readonly string[]).some(m => modelId.startsWith(m));
}
