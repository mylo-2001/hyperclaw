/**
 * src/infra/tenant.ts
 * Multi-tenant isolation: config, workspace, paths per tenant (org/user).
 */

import path from 'path';
import fs from 'fs-extra';
import { getHyperClawDir } from '../../packages/shared/src/paths';

export interface Tenant {
  id: string;
  name: string;
  /** org_xxx or user_xxx */
  type: 'org' | 'user';
  createdAt: string;
  metadata?: Record<string, unknown>;
}

/** Base dir for all tenant data. Default: ~/.hyperclaw/tenants */
export function getTenantsBaseDir(): string {
  const base = getHyperClawDir();
  return path.join(base, 'tenants');
}

/** Tenant-specific base dir: ~/.hyperclaw/tenants/{tenantId} */
export function getTenantBaseDir(tenantId: string): string {
  const safe = tenantId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(getTenantsBaseDir(), safe);
}

/** Config path for tenant: .../tenants/{id}/hyperclaw.json */
export function getTenantConfigPath(tenantId: string): string {
  return path.join(getTenantBaseDir(tenantId), 'hyperclaw.json');
}

/** Workspace dir for tenant (SOUL, MEMORY, AGENTS): .../tenants/{id}/workspace */
export function getTenantWorkspaceDir(tenantId: string): string {
  return path.join(getTenantBaseDir(tenantId), 'workspace');
}

/** Ensure tenant dirs exist. */
export async function ensureTenantDirs(tenantId: string): Promise<void> {
  const base = getTenantBaseDir(tenantId);
  await fs.ensureDir(base);
  await fs.ensureDir(getTenantWorkspaceDir(tenantId));
  await fs.ensureDir(path.join(base, 'costs'));
  await fs.ensureDir(path.join(base, 'traces'));
}

/** Load tenant metadata from tenants.json. */
export async function getTenant(tenantId: string): Promise<Tenant | null> {
  const fp = path.join(getTenantsBaseDir(), 'tenants.json');
  if (!(await fs.pathExists(fp))) return null;
  const data = await fs.readJson(fp).catch(() => ({}));
  const tenants = (data.tenants || []) as Tenant[];
  return tenants.find((t) => t.id === tenantId) ?? null;
}

/** List all tenants. */
export async function listTenants(): Promise<Tenant[]> {
  const fp = path.join(getTenantsBaseDir(), 'tenants.json');
  if (!(await fs.pathExists(fp))) return [];
  const data = await fs.readJson(fp).catch(() => ({}));
  return (data.tenants || []) as Tenant[];
}

/** Register a tenant. */
export async function registerTenant(tenant: Omit<Tenant, 'createdAt'>): Promise<void> {
  const fp = path.join(getTenantsBaseDir(), 'tenants.json');
  await fs.ensureDir(path.dirname(fp));
  const data = await fs.readJson(fp).catch(() => ({ tenants: [] }));
  const tenants = (data.tenants || []) as Tenant[];
  if (tenants.some((t) => t.id === tenant.id)) return;
  tenants.push({ ...tenant, createdAt: new Date().toISOString() });
  await fs.writeJson(fp, { tenants, updatedAt: new Date().toISOString() }, { spaces: 2 });
  await ensureTenantDirs(tenant.id);
}
