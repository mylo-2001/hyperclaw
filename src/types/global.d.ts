declare module 'irc' {
  export class Client {
    constructor(server: string, nick: string, opts?: Record<string, unknown>);
    on(event: string, fn: (...args: any[]) => void): void;
    say(target: string, text: string): void;
    join(channel: string, fn?: () => void): void;
    disconnect(msg?: string, fn?: () => void): void;
  }
}
declare module 'gradient-string';
declare module 'tail';
