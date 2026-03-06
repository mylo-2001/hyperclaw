/**
 * src/agent/extraction-tools.ts
 * PDF and spreadsheet structured extraction (OpenClaw-style).
 * Optional deps: pdf-parse, xlsx
 */

import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import type { Tool } from './inference';

function safeRequire(id: string): any {
  try { return require(id); } catch { return null; }
}

export function getExtractionTools(): Tool[] {
  return [
    {
      name: 'extract_pdf',
      description: 'Extract text and structure from a PDF file. Returns full text content. Use for documents, forms, reports.',
      input_schema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path to PDF file (absolute or ~)' }
        },
        required: ['path']
      },
      handler: async (input) => {
        const filePath = (input.path as string).replace(/^~/, os.homedir());
        if (!(await fs.pathExists(filePath))) return `Error: File not found: ${filePath}`;

        const pdfParse = safeRequire('pdf-parse');
        if (!pdfParse) return 'Error: pdf-parse not installed. Run: npm install pdf-parse';

        try {
          const buf = await fs.readFile(filePath);
          const data = await pdfParse(buf);
          const text = (data.text || '').trim().slice(0, 50000);
          return `Pages: ${data.numpages || '?'}\n\n${text || '(no extractable text)'}`;
        } catch (e: any) {
          return `Error: ${e.message}`;
        }
      }
    },
    {
      name: 'extract_spreadsheet',
      description: 'Extract data from Excel (.xlsx, .xls) or CSV. Returns sheet names and cell content as structured text.',
      input_schema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path to spreadsheet (xlsx, xls, csv)' }
        },
        required: ['path']
      },
      handler: async (input) => {
        const filePath = (input.path as string).replace(/^~/, os.homedir());
        if (!(await fs.pathExists(filePath))) return `Error: File not found: ${filePath}`;

        const ext = path.extname(filePath).toLowerCase();
        if (ext === '.csv') {
          const content = await fs.readFile(filePath, 'utf8');
          return content.slice(0, 50000);
        }

        const XLSX = safeRequire('xlsx');
        if (!XLSX) return 'Error: xlsx not installed. Run: npm install xlsx';

        try {
          const buf = await fs.readFile(filePath);
          const wb = XLSX.read(buf, { type: 'buffer' });
          const parts: string[] = [];
          for (const name of wb.SheetNames) {
            const sheet = wb.Sheets[name];
            const arr = XLSX.utils.sheet_to_csv(sheet);
            parts.push(`Sheet: ${name}\n${arr.slice(0, 20000)}`);
          }
          return parts.join('\n\n---\n\n').slice(0, 50000);
        } catch (e: any) {
          return `Error: ${e.message}`;
        }
      }
    }
  ];
}
