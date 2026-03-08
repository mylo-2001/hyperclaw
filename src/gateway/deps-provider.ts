/**
 * src/gateway/deps-provider.ts
 * Creates GatewayDeps by wiring src/infra, src/channels, src/hooks, packages/core.
 * Used when starting the gateway from daemon/CLI.
 */

import type { GatewayDeps } from '../../packages/gateway/src/deps';

export async function createDefaultGatewayDeps(): Promise<GatewayDeps> {
  const [paths, envResolve, sessionStore, channelRunner, hookLoader, core, devKeys, pendingApproval, observability, costTracker, tts, nodesRegistry, canvasRenderer, a2ui, daemon] = await Promise.all([
    import('../infra/paths'),
    import('../infra/env-resolve'),
    import('../../packages/core/src/agent/session-store'),
    import('../channels/runner'),
    import('../hooks/loader'),
    import('../../packages/core/src/index'),
    import('../infra/developer-keys'),
    import('../infra/pending-approval'),
    import('../infra/observability'),
    import('../infra/cost-tracker'),
    import('../services/tts-elevenlabs'),
    import('../services/nodes-registry'),
    import('../canvas/renderer'),
    import('../canvas/a2ui-protocol'),
    import('../infra/daemon'),
  ]);

  const createSessionStore = async (baseDir: string) => {
    const store = await sessionStore.createFileSessionStore(baseDir);
    return store as unknown as GatewayDeps['createSessionStore'] extends (b: string) => Promise<infer R> ? R : never;
  };

  const createHookLoader = () => new hookLoader.HookLoader() as unknown as NonNullable<GatewayDeps['createHookLoader']> extends () => infer R ? R : never;

  const getCanvasState = async (): Promise<object> => {
    const renderer = new canvasRenderer.CanvasRenderer();
    const canvas = await renderer.getOrCreate();
    return canvas as object;
  };

  const getCanvasA2UI = async (): Promise<string> => {
    const renderer = new canvasRenderer.CanvasRenderer();
    const canvas = await renderer.getOrCreate();
    const msg = a2ui.toBeginRendering(canvas);
    return a2ui.toJSONL([msg]);
  };

  return {
    getHyperClawDir: paths.getHyperClawDir,
    getConfigPath: paths.getConfigPath,
    resolveGatewayToken: envResolve.resolveGatewayToken,
    validateApiAuth: async (bearer: string) => (await devKeys.validateDeveloperKey(bearer)).valid,
    createSessionStore,
    startChannelRunners: channelRunner.startChannelRunners,
    createHookLoader,
    runAgentEngine: core.runAgentEngine as GatewayDeps['runAgentEngine'],
    createPiRPCHandler: core.createPiRPCHandler as GatewayDeps['createPiRPCHandler'],
    listTraces: observability.listTraces,
    getSessionSummary: costTracker.getSessionSummary,
    getGlobalSummary: costTracker.getGlobalSummary,
    recordUsage: costTracker.recordUsage,
    textToSpeech: tts.textToSpeech as unknown as GatewayDeps['textToSpeech'],
    getPending: pendingApproval.getPending,
    clearPending: pendingApproval.clearPending,
    createRunTracer: observability.createRunTracer as GatewayDeps['createRunTracer'],
    writeTraceToFile: observability.writeTraceToFile as GatewayDeps['writeTraceToFile'],
    NodeRegistry: nodesRegistry.NodeRegistry as GatewayDeps['NodeRegistry'],
    getCanvasState,
    getCanvasA2UI,
    restartDaemon: async () => {
      const dm = new daemon.DaemonManager();
      await dm.restart?.();
    },
  };
}
