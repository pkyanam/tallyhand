/**
 * Minimal type declarations for `@neondatabase/serverless`.
 *
 * The package is a real dependency in package.json (installed at deploy
 * time with `npm install`); this shim only exists so `tsc --noEmit` and
 * editors can typecheck without the package present in this worktree's
 * node_modules (which is symlinked from the main worktree and must not be
 * reinstalled here). It covers exactly the surface we use: the `neon()`
 * tagged-template query function passed to drizzle-orm/neon-http.
 */
declare module "@neondatabase/serverless" {
  export type NeonHttpQueryResult<T = unknown> = T[];

  export type NeonQueryFunction = <T = unknown>(
    strings: TemplateStringsArray,
    ...params: unknown[]
  ) => Promise<NeonHttpQueryResult<T>>;

  export function neon(connectionString: string): NeonQueryFunction;
}
