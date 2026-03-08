/**
 * src/services/knowledge-graph.ts
 * OpenClaw-style knowledge graph — entities, relationships, cross-channel context.
 * Complements MEMORY.md with structured, queryable memory.
 */

import fs from 'fs-extra';
import path from 'path';
import { getHyperClawDir } from '../infra/paths';

const getKgFile = () => path.join(getHyperClawDir(), 'knowledge-graph.json');

export type EntityType = 'person' | 'project' | 'preference' | 'fact' | 'topic' | 'event';
export type RelationType = 'knows' | 'works_on' | 'prefers' | 'related_to' | 'occurred_at' | 'belongs_to';

export interface Entity {
  id: string;
  type: EntityType;
  label: string;
  props: Record<string, string | number | boolean>;
  createdAt: string;
  updatedAt?: string;
}

export interface Relation {
  from: string;
  to: string;
  type: RelationType;
  props?: Record<string, string>;
  createdAt: string;
}

export interface KnowledgeGraph {
  entities: Entity[];
  relations: Relation[];
  version: number;
}

const DEFAULT_GRAPH: KnowledgeGraph = {
  entities: [],
  relations: [],
  version: 1
};

async function load(): Promise<KnowledgeGraph> {
  try {
    const data = await fs.readJson(getKgFile());
    return { ...DEFAULT_GRAPH, ...data };
  } catch {
    return { ...DEFAULT_GRAPH };
  }
}

async function save(graph: KnowledgeGraph): Promise<void> {
  const f = getKgFile();
  await fs.ensureDir(path.dirname(f));
  await fs.writeJson(f, graph, { spaces: 2 });
}

function slug(label: string, type: string): string {
  const base = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40);
  return `${type}_${base}_${Date.now().toString(36)}`;
}

/** Add entity. */
export async function addEntity(
  type: EntityType,
  label: string,
  props: Record<string, string | number | boolean> = {}
): Promise<string> {
  const graph = await load();
  const id = slug(label, type);
  const now = new Date().toISOString();
  const entity: Entity = {
    id,
    type,
    label,
    props,
    createdAt: now,
    updatedAt: now
  };
  const idx = graph.entities.findIndex(e => e.id === id);
  if (idx >= 0) {
    graph.entities[idx] = { ...entity, createdAt: graph.entities[idx].createdAt };
  } else {
    graph.entities.push(entity);
  }
  await save(graph);
  return id;
}

/** Add relation. */
export async function addRelation(fromId: string, toId: string, type: RelationType, props?: Record<string, string>): Promise<void> {
  const graph = await load();
  const now = new Date().toISOString();
  const rel: Relation = { from: fromId, to: toId, type, props, createdAt: now };
  const exists = graph.relations.some(r =>
    r.from === fromId && r.to === toId && r.type === type
  );
  if (!exists) graph.relations.push(rel);
  await save(graph);
}

/** Add fact (convenience). */
export async function addFact(fact: string, tags?: string[]): Promise<string> {
  return addEntity('fact', fact.slice(0, 200), {
    fullText: fact,
    tags: tags?.join(',') ?? ''
  });
}

/** Add preference. */
export async function addPreference(topic: string, value: string): Promise<string> {
  const topicId = await addEntity('topic', topic);
  const prefId = await addEntity('preference', `${topic}: ${value}`, { topic, value });
  await addRelation(prefId, topicId, 'belongs_to');
  return prefId;
}

/** Add project. */
export async function addProject(name: string, description?: string): Promise<string> {
  return addEntity('project', name, { description: description ?? '' });
}

/** Query memory for context (semantic-ish: type + label/props match). */
export async function queryMemory(query: {
  types?: EntityType[];
  tags?: string[];
  limit?: number;
}): Promise<string> {
  const graph = await load();
  const { types = [], tags = [], limit = 20 } = query;

  let entities = graph.entities;

  if (types.length > 0) {
    entities = entities.filter(e => types.includes(e.type));
  }

  if (tags.length > 0) {
    entities = entities.filter(e => {
      const t = String(e.props.tags || '').split(',');
      return tags.some(tag => t.some(x => x.toLowerCase().includes(tag.toLowerCase())));
    });
  }

  entities = entities
    .sort((a, b) => new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime())
    .slice(0, limit);

  if (entities.length === 0) return '';

  const lines = entities.map(e => {
    const d = e.updatedAt || e.createdAt;
    return `- [${e.type}] ${e.label} (${d.slice(0, 10)})`;
  });
  return lines.join('\n');
}

/** Get full context string for injection into prompts. */
export async function getContextSummary(limit = 30): Promise<string> {
  const facts = await queryMemory({ types: ['fact', 'preference', 'project'], limit });
  if (!facts) return '';
  return `## Knowledge Graph Context\n${facts}`;
}
