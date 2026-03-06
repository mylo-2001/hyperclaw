/**
 * @hyperclaw/gateway — Gateway server and manager.
 *
 * Both GatewayManager and GatewayServer live fully inside this package.
 * src/gateway/manager.ts and src/gateway/server.ts are now thin re-exports
 * pointing here for backwards compatibility with existing src/ consumers.
 */
export {
  GatewayManager,
  GATEWAY_DEFAULTS,
  type GatewayConfig,
  type GatewayBind,
  type TailscaleExposure,
  type GatewayRuntime
} from './manager';

export {
  GatewayServer,
  startGateway,
  getActiveServer,
  type Session,
  type SessionStoreLike
} from './server';
