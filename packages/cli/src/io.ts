/** Everything the CLI needs from the outside world, so tests can replace it. */
export interface Io {
  out: (text: string) => void;
  err: (text: string) => void;
  env: Record<string, string | undefined>;
  readFile: (path: string) => Promise<string>;
  fetch: typeof fetch;
}
