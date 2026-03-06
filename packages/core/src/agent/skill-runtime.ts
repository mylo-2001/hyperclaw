/**
 * src/agent/skill-runtime.ts
 * Skills as execution runtime: execution contracts, isolated invoke.
 * OpenClaw-level skill execution.
 */

import type { LoadedSkill } from './skill-loader';
import type { Tool } from './inference';

/** Execution contract: parsed from skill content. */
export interface SkillExecutionContract {
  skillId: string;
  inputSchema?: {
    properties: Record<string, { type: string; description?: string }>;
    required?: string[];
  };
  /** Hint for how to invoke (e.g. "prompt", "subagent") */
  invokeMode?: 'prompt' | 'subagent';
}

/** Extract execution contract from skill content. Parses ## Execution or ## Invoke blocks. */
export function extractExecutionContract(skill: LoadedSkill): SkillExecutionContract | null {
  const content = skill.content || '';
  const execMatch = content.match(/##\s*(?:Execution|Invoke)\s*\n+([\s\S]*?)(?=\n## |\n# |$)/i);
  if (!execMatch) return null;

  const block = execMatch[1].trim();
  const contract: SkillExecutionContract = { skillId: skill.id, invokeMode: 'prompt' };

  const schemaMatch = block.match(/input\s*:\s*\{([^}]+)\}/i) || block.match(/params\s*:\s*\{([^}]+)\}/i);
  if (schemaMatch) {
    const props: Record<string, { type: string; description?: string }> = {};
    const parts = schemaMatch[1].split(/,\s*/);
    for (const p of parts) {
      const [key, typeDesc] = p.split(/\s*:\s*/).map(s => s.trim());
      if (key) props[key] = { type: typeDesc || 'string', description: '' };
    }
    contract.inputSchema = { properties: props, required: Object.keys(props) };
  }

  if (block.toLowerCase().includes('subagent') || block.toLowerCase().includes('full run')) {
    contract.invokeMode = 'subagent';
  }

  return contract;
}

/** Invoke a skill with params. Runs as focused prompt or subagent call. */
export async function invokeSkill(
  skillId: string,
  params: Record<string, unknown>,
  opts?: { skills?: LoadedSkill[] }
): Promise<string> {
  const { loadSkills } = await import('./skill-loader');
  const skills = opts?.skills ?? await loadSkills();
  const skill = skills.find(s => s.id === skillId);
  if (!skill) return `Error: Skill "${skillId}" not found.`;

  const contract = extractExecutionContract(skill);
  const inputStr = Object.entries(params)
    .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`)
    .join(', ');

  const { runAgentEngine } = await import('./engine');
  const prompt = `Execute the skill "${skillId}" with these inputs: ${inputStr}\n\nFollow the skill instructions exactly. Output only the result.`;
  const result = await runAgentEngine(prompt, {});
  return result.text;
}

/** Build tools for skill invocation. Agent can call invoke_skill(skillId, params). */
export function getSkillInvokeTools(skills: LoadedSkill[]): Tool[] {
  const invokable = skills.filter(s => extractExecutionContract(s) || s.capabilities);
  if (invokable.length === 0) return [];

  const descriptions = invokable.map(s => `- ${s.id}: ${s.capabilities || s.title || 'no description'}`).join('\n');

  return [
    {
      name: 'invoke_skill',
      description: `Invoke a loaded skill by id. Available: ${invokable.map(s => s.id).join(', ')}. Use when the user wants to run a specific capability.`,
      input_schema: {
        type: 'object',
        properties: {
          skill_id: { type: 'string', description: `Skill id. Options: ${invokable.map(s => s.id).join(', ')}` },
          params: { type: 'object', description: 'Optional key-value params for the skill' }
        },
        required: ['skill_id']
      },
      handler: async (input: Record<string, unknown>) => {
        const id = String(input.skill_id || '').trim();
        const params = (typeof input.params === 'object' && input.params !== null ? input.params : {}) as Record<string, unknown>;
        if (!id) return 'Error: skill_id is required.';
        return invokeSkill(id, params);
      }
    }
  ];
}
