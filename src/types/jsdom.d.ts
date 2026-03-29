declare module 'jsdom' {
  export class JSDOM {
    constructor(input?: string | Buffer | ArrayBufferView, options?: unknown);
    readonly window: Window & {
      NodeFilter: typeof NodeFilter;
    };
    serialize(): string;
  }
}
