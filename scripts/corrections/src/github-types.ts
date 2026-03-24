/**
 * Lightweight type aliases for github-script callback parameters.
 * These avoid importing the full Octokit generic soup while still
 * giving us useful autocomplete and type checking.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type GitHub = any;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Context = any;

export interface Core {
  info(message: string): void;
  warning(message: string): void;
  error(message: string): void;
  setFailed(message: string): void;
  setOutput(name: string, value: string): void;
}
