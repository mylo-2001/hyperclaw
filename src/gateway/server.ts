/**
 * src/gateway/server.ts — re-exports from @hyperclaw/gateway package.
 * Provides startGateway that injects default deps (infra, channels, hooks).
 */
export {
  GatewayServer,
  getActiveServer,
  type GatewayConfig,
  type Session,
  type SessionStoreLike
} from '../../packages/gateway/src/server';
import { startGateway as startGatewayWithDeps } from '../../packages/gateway/src/server';
import { createDefaultGatewayDeps } from './deps-provider';

/** Start gateway with default deps (paths, channels, hooks, etc.). */
export async function startGateway(opts?: { daemonMode?: boolean }): Promise<import('../../packages/gateway/src/server').GatewayServer> {
  const deps = await createDefaultGatewayDeps();
  return startGatewayWithDeps({ ...opts, deps });
}
