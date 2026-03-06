/**
 * src/agent/vision-tools.ts
 * Image understanding via vision models (analyze_image).
 */

import type { Tool } from './inference';

export interface VisionToolsOptions {
  apiKey?: string;
  provider?: 'anthropic' | 'openrouter';
}

export function getVisionTools(opts: VisionToolsOptions = {}): Tool[] {
  const { apiKey = '', provider = 'anthropic' } = opts;

  return [
    {
      name: 'analyze_image',
      description: 'Analyze an image using a vision model. Describe scenes, receipts, documents, photos. Supports file path, URL, or data URI.',
      input_schema: {
        type: 'object',
        properties: {
          image: { type: 'string', description: 'Image path (~/path), URL (https://...), or data:image/...;base64,...' },
          prompt: { type: 'string', description: 'What to describe or extract (e.g. "Describe this scene", "List items on this receipt")' }
        },
        required: ['image']
      },
      handler: async (input) => {
        if (!apiKey) return 'Error: No API key configured for vision. Set provider.apiKey or run hyperclaw auth add.';
        const image = (input.image as string)?.trim();
        const prompt = (input.prompt as string)?.trim() || 'Describe this image concisely.';
        if (!image) return 'Error: image is required';
        try {
          const { analyzeImage } = await import('../../../../src/services/vision');
          return await analyzeImage(image, prompt, apiKey, provider);
        } catch (e: any) {
          return `Error: ${e.message}`;
        }
      }
    }
  ];
}
