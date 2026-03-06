/**
 * src/canvas/a2ui-protocol.ts
 * A2UI v0.8 protocol — convert HyperClaw canvas to A2UI JSONL messages.
 * See: https://a2ui.org/specification/v0.8-a2ui/
 * Message types: beginRendering, surfaceUpdate, dataModelUpdate, deleteSurface.
 */

import type { CanvasState, CanvasComponent } from './renderer';

/** A2UI component type mapping (flat, ID-referenced). */
export interface A2UISurface {
  id: string;
  type: string;
  parentId?: string;
  children?: string[];
  props?: Record<string, unknown>;
  data?: unknown;
}

/** A2UI beginRendering message. */
export interface A2UIBeginRendering {
  type: 'beginRendering';
  surfaceId: string;
  surfaces: A2UISurface[];
  dataModel?: Record<string, unknown>;
}

/** A2UI surfaceUpdate message (add/update components). */
export interface A2UISurfaceUpdate {
  type: 'surfaceUpdate';
  surfaceId: string;
  surfaces: A2UISurface[];
}

/** A2UI dataModelUpdate message (data-only update). */
export interface A2UIDataModelUpdate {
  type: 'dataModelUpdate';
  surfaceId: string;
  updates: Record<string, unknown>;
}

/** A2UI deleteSurface message. */
export interface A2UIDeleteSurface {
  type: 'deleteSurface';
  surfaceId: string;
  surfaceIds: string[];
}

export type A2UIMessage = A2UIBeginRendering | A2UISurfaceUpdate | A2UIDataModelUpdate | A2UIDeleteSurface;

/** Map HyperClaw component type to A2UI-compatible type. */
function toA2UIType(t: string): string {
  const map: Record<string, string> = {
    chart: 'chart',
    table: 'table',
    form: 'form',
    markdown: 'markdown',
    image: 'image',
    custom: 'custom',
    script: 'script'
  };
  return map[t] || 'custom';
}

/** Convert a CanvasComponent to A2UI surface. */
function componentToSurface(c: CanvasComponent): A2UISurface {
  return {
    id: c.id,
    type: toA2UIType(c.type),
    props: {
      title: c.title,
      width: c.width || 'half'
    },
    data: c.data
  };
}

/** Generate beginRendering from canvas state (full sync). */
export function toBeginRendering(canvas: CanvasState): A2UIBeginRendering {
  const surfaces: A2UISurface[] = canvas.components.map(componentToSurface);
  const dataModel: Record<string, unknown> = {};
  for (const c of canvas.components) {
    if (c.data != null) dataModel[c.id] = c.data;
  }
  return {
    type: 'beginRendering',
    surfaceId: canvas.id,
    surfaces,
    dataModel: Object.keys(dataModel).length ? dataModel : undefined
  };
}

/** Generate surfaceUpdate for newly added component. */
export function toSurfaceUpdate(canvasId: string, component: CanvasComponent): A2UISurfaceUpdate {
  return {
    type: 'surfaceUpdate',
    surfaceId: canvasId,
    surfaces: [componentToSurface(component)]
  };
}

/** Generate dataModelUpdate when component data changes. */
export function toDataModelUpdate(canvasId: string, componentId: string, data: unknown): A2UIDataModelUpdate {
  return {
    type: 'dataModelUpdate',
    surfaceId: canvasId,
    updates: { [componentId]: data }
  };
}

/** Generate deleteSurface for removed components. */
export function toDeleteSurface(canvasId: string, componentIds: string[]): A2UIDeleteSurface {
  return {
    type: 'deleteSurface',
    surfaceId: canvasId,
    surfaceIds: componentIds
  };
}

/** Serialize A2UI messages to JSONL (one message per line). */
export function toJSONL(messages: A2UIMessage[]): string {
  return messages.map(m => JSON.stringify(m)).join('\n');
}
