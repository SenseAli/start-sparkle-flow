/** Minimal typings for `bun:test` (avoid pulling in Bun's global fetch types). */
declare module "bun:test" {
  export function describe(name: string, fn: () => void): void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export function it(name: string, fn: () => any): void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export function expect(actual: any): any;
}
