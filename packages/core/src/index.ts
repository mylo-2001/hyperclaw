/**
 * @hyperclaw/core — AI agent engine, inference, session, memory (public API).
 * Implementation in packages/core/src/agent/.
 */

// ─── Paths (from shared)
export { getHyperClawDir, getConfigPath, getEnvFilePath } from '../../shared/src/index';

// ─── Engine (single entry point)
export {
  runAgentEngine,
  loadWorkspaceContext,
  loadSkillsContext,
  resolveTools,
  type AgentEngineOptions,
  type AgentEngineResult
} from './agent/engine';

// ─── Inference types & engine
export type {
  Tool,
  InferenceMessage,
  InferenceOptions,
  InferenceResult,
  ContentBlock
} from './agent/inference';
export { InferenceEngine, getBuiltinTools } from './agent/inference';

// ─── Session store (persistent state, working memory, agent state)
export type {
  SessionState,
  SessionStore,
  WorkingMemorySlot,
  AgentState
} from './agent/session-store';
export { createFileSessionStore } from './agent/session-store';

// ─── Orchestrator (multi-step, retry, checkpointing)
export type { PlanStep, OrchestratorCheckpoint, OrchestratorOptions } from './agent/orchestrator';
export { runMultiStep, runMultiStepParallel, runWithPlan, planSteps } from './agent/orchestrator';

// ─── Skill runtime (execution contracts, invoke)
export type { SkillExecutionContract } from './agent/skill-runtime';
export {
  extractExecutionContract,
  invokeSkill,
  getSkillInvokeTools
} from './agent/skill-runtime';

// ─── Memory (extract, append, read)
export type { ChatTurn, ExtractedFact } from './agent/memory-auto';
export {
  readMemory,
  appendMemory,
  extractFactsLocally,
  saveMemoryDirect,
  AutoMemory
} from './agent/memory-auto';

// ─── Skills (load, context, capabilities)
export type { LoadedSkill, SkillValidationResult, SkillLifecycleHooks } from './agent/skill-loader';
export {
  loadSkills,
  buildSkillsContext,
  getSkillCapabilities,
  reloadSkills,
  validateSkill
} from './agent/skill-loader';

// ─── Pi RPC (gateway integration)
export type { PiRPCRequest, PiRPCResponse, PiRPCSendParams, PiRPCSendResult, PiRPCChatsListResult } from './agent/pi-rpc';
export { createPiRPCHandler } from './agent/pi-rpc';

// ─── Tools (CLI tools command, etc.)
export { getSessionsTools } from './agent/sessions-tools';
export type { ISessionServer } from './agent/sessions-tools';
export {
  getPCAccessTools,
  loadPCAccessConfig,
  showPCAccessStatus,
  savePCAccessConfig
} from './agent/pc-access';
export { getBrowserTools } from './agent/browser-tools';
export { getExtractionTools } from './agent/extraction-tools';
export { getWebsiteWatchTools } from './agent/website-watch-tools';
export { getVisionTools } from './agent/vision-tools';

// ─── Runner (CLI chat command)
export { runAgent } from './agent/runner';

// ─── ACP (thread management)
export { ACPThreadManager } from './agent/acp';

// ─── Memory CLI helpers
export { searchMemory, showMemory, clearMemory } from './agent/memory-auto';

// ─── Surface parity (bot, OpenClaw compatibility)
export { formatAgentResponse, getAgentHelp } from './agent/surface-parity';
