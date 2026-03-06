/**
 * src/agent/browser-tools.ts
 * Browser control tools — snapshot page DOM, perform actions (click, type, etc.).
 * Uses Puppeteer/Chrome CDP when available. Full implementation.
 */

import type { Tool } from './inference';

const BROWSER_SETUP = 'Browser control requires Puppeteer. Install: npm i puppeteer. Then enable in config: browser.enabled: true';

let sharedBrowser: any = null;
let sharedPage: any = null;

async function getBrowser(): Promise<{ browser: any; page: any } | null> {
  try {
    const puppeteer = await import('puppeteer').catch(() => null);
    if (!puppeteer) return null;
    if (!sharedBrowser || !sharedBrowser.connected) {
      const execPath = process.env.PUPPETEER_EXECUTABLE_PATH;
      sharedBrowser = await puppeteer.default.launch({
        headless: true,
        executablePath: execPath || undefined,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
      });
      sharedPage = await sharedBrowser.newPage();
      await sharedPage.setViewport({ width: 1280, height: 800 });
      await sharedPage.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    }
    return { browser: sharedBrowser, page: sharedPage };
  } catch {
    return null;
  }
}

export function getBrowserTools(): Tool[] {
  return [
    {
      name: 'browser_snapshot',
      description: 'Capture a snapshot of the current browser page (DOM, text, links). Use before interacting. Pass url to navigate first.',
      input_schema: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL to navigate to before snapshot (optional if already on page)' }
        },
        required: []
      },
      handler: async (input: { url?: string }) => {
        const bw = await getBrowser();
        if (!bw) return BROWSER_SETUP;
        const { page } = bw;
        try {
          if (input.url) {
            await page.goto(input.url, { waitUntil: 'domcontentloaded', timeout: 15000 });
          }
          const snapshot = await page.evaluate(() => {
            const text = document.body?.innerText?.slice(0, 12000) || '';
            const links = Array.from(document.querySelectorAll('a[href]')).map((a: any) => ({
              text: (a.textContent || '').trim().slice(0, 80),
              href: a.getAttribute('href')
            })).filter((l: any) => l.href?.startsWith('http')).slice(0, 50);
            const title = document.title || '';
            const url = window.location.href;
            return JSON.stringify({ title, url, text, links });
          });
          return snapshot;
        } catch (e: any) {
          return `Browser snapshot error: ${e.message}`;
        }
      }
    },
    {
      name: 'browser_action',
      description: 'Perform an action in the browser: click, type, scroll, navigate. Use after browser_snapshot.',
      input_schema: {
        type: 'object',
        properties: {
          action: { type: 'string', description: 'Action: click, type, scroll, navigate', enum: ['click', 'type', 'scroll', 'navigate'] },
          selector: { type: 'string', description: 'CSS selector or link text to match (for click/type)' },
          value: { type: 'string', description: 'For type: text to type. For navigate: URL. For scroll: "up" or "down"' }
        },
        required: ['action']
      },
      handler: async (input: Record<string, unknown>) => {
        const action = String(input?.action ?? '');
        const selector = input?.selector as string | undefined;
        const value = input?.value as string | undefined;
        const bw = await getBrowser();
        if (!bw) return BROWSER_SETUP;
        const { page } = bw;
        try {
          switch (action) {
            case 'navigate':
              if (!value) return 'navigate requires value (URL)';
              await page.goto(value, { waitUntil: 'domcontentloaded', timeout: 15000 });
              return `Navigated to ${value}`;
            case 'click':
              if (!selector) return 'click requires selector';
              const sel = selector.trim();
              const isCss = /^[#.\w\[\]="'\s-:>+~]+$/.test(sel) && (sel.includes('#') || sel.includes('.') || sel.includes('[') || /^[a-z][a-z0-9]*$/i.test(sel));
              if (isCss) {
                await page.waitForSelector(sel, { timeout: 5000 });
                await page.click(sel);
                return `Clicked ${sel}`;
              }
              const safe = sel.replace(/["']/g, '').slice(0, 100);
              const xpath = `//a[contains(text(),"${safe}")]`;
              const [el] = await page.$x(xpath);
              if (el) { await (el as any).click(); return `Clicked link "${sel}"`; }
              const btnXpath = `//button[contains(text(),"${safe}")]`;
              const [btn] = await page.$x(btnXpath);
              if (btn) { await (btn as any).click(); return `Clicked button "${sel}"`; }
              throw new Error(`Element not found: ${sel}`);
            case 'type':
              if (!selector) return 'type requires selector';
              await page.waitForSelector(selector, { timeout: 5000 });
              await page.type(selector, value || '');
              return `Typed "${value || ''}" into ${selector}`;
            case 'scroll':
              const dir = (value || 'down').toLowerCase();
              await page.evaluate((d: string) => {
                window.scrollBy(0, d === 'up' ? -400 : 400);
              }, dir);
              return `Scrolled ${dir}`;
            default:
              return `Unknown action: ${action}`;
          }
        } catch (e: any) {
          return `Browser action error: ${e.message}`;
        }
      }
    }
  ];
}
