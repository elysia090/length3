export type SearchBootstrapResult =
  | { kind: 'ready' }
  | { kind: 'unavailable'; message: string }
  | { kind: 'error'; message: string };
