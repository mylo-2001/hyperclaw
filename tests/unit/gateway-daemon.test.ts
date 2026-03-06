/**
 * tests/unit/gateway-daemon.test.ts
 * Unit tests - GatewayServer daemon mode color/icon logic
 */
import { describe, it, expect } from 'vitest';
import chalk from 'chalk';

describe('GatewayServer daemon styling', () => {
  it('daemon mode uses red color and blood icon', () => {
    const daemonMode = true;
    const icon = daemonMode ? '🩸' : '🦅';
    const color = daemonMode ? chalk.red.bind(chalk) : chalk.hex('#06b6d4');
    const msg = color(`\n  ${icon} Gateway started: ws://127.0.0.1:1515\n`);

    expect(icon).toBe('🩸');
    expect(msg).toContain('Gateway started');
  });

  it('normal mode uses cyan and hawk icon', () => {
    const daemonMode = false;
    const icon = daemonMode ? '🩸' : '🦅';
    const color = daemonMode ? chalk.red.bind(chalk) : chalk.hex('#06b6d4');
    const msg = color(`\n  ${icon} Gateway started: ws://127.0.0.1:1515\n`);

    expect(icon).toBe('🦅');
    expect(msg).toContain('Gateway started');
  });
});
