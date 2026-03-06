# @hyperclaw/core

AI agent engine, inference, session store, memory — public API boundary.

**Agent package.** Implementation in `packages/core/src/agent/`. Re-exports engine, inference, session, memory, skills, orchestrator, skill-runtime.

## Usage

```ts
import {
  runAgentEngine,
  loadWorkspaceContext,
  resolveTools,
  createFileSessionStore,
  readMemory,
  type Tool,
  type AgentEngineOptions
} from '@hyperclaw/core';
// or
import { runAgentEngine } from 'hyperclaw/core';
```

## Exports

- **Engine**: `runAgentEngine`, `loadWorkspaceContext`, `loadSkillsContext`, `resolveTools`
- **Inference**: `Tool`, `InferenceEngine`, `getBuiltinTools`, types
- **Session**: `createFileSessionStore`, `SessionStore`, `SessionState`
- **Memory**: `readMemory`, `appendMemory`, `extractFactsLocally`, `AutoMemory`
- **Skills**: `loadSkills`, `buildSkillsContext`, `getSkillCapabilities`
- **Paths**: `getHyperClawDir`, `getConfigPath`, `getEnvFilePath` (from @hyperclaw/shared)
