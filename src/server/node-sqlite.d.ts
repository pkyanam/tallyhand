/**
 * Minimal ambient types for the `node:sqlite` built-in (DatabaseSync).
 *
 * The project's `@types/node` is v20, which predates the `node:sqlite`
 * typings (added for Node 22.5+). The runtime here is Node 24, where the
 * module exists — this declaration only covers the surface the server
 * track uses, so `next build` typechecking passes without bumping the
 * @types/node major. If @types/node is ever upgraded past v22, delete
 * this file and rely on the bundled typings.
 */
declare module "node:sqlite" {
  type SQLiteValue = string | number | bigint | null | Uint8Array;

  interface StatementSync {
    get(...params: SQLiteValue[]): unknown;
    all(...params: SQLiteValue[]): unknown[];
    run(...params: SQLiteValue[]): {
      changes: number | bigint;
      lastInsertRowid: number | bigint;
    };
    iterate(...params: SQLiteValue[]): IterableIterator<unknown>;
  }

  export class DatabaseSync {
    constructor(path: string);
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
    close(): void;
  }
}
