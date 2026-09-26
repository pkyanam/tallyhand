import { describe, it, expect } from "vitest";
import { shouldAutoRun } from "../src/cli.js";

describe("shouldAutoRun", () => {
  it("runs for classic node script invocations", () => {
    expect(shouldAutoRun("/app/dist/cli.js")).toBe(true);
    expect(shouldAutoRun("C:\\tallyhand\\dist\\cli.js")).toBe(true);
    expect(shouldAutoRun("/app/src/cli.ts")).toBe(true);
  });

  it("runs for single-file binaries where argv[1] is a user argument", () => {
    expect(shouldAutoRun("--help")).toBe(true);
    expect(shouldAutoRun("clients")).toBe(true);
    expect(shouldAutoRun(undefined)).toBe(true);
    expect(shouldAutoRun("")).toBe(true);
  });

  it("does not run when imported with an unrelated script path", () => {
    expect(shouldAutoRun("/tmp/other.mjs")).toBe(false);
    expect(shouldAutoRun("/app/dist/mcp.js")).toBe(false);
  });
});
