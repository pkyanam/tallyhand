import { describe, expect, it } from "vitest";
import { buildProgram } from "../src/cli.js";
import { CLI_MCP_PARITY, LOCAL_ONLY_COMMANDS } from "../src/mcp-parity.js";
import type { Command } from "commander";
function leaves(command: Command, prefix = ""): string[] {
  return command.commands.flatMap(child => {
    const name = `${prefix} ${child.name()}`.trim();
    return child.commands.length ? leaves(child, name) : [name];
  });
}
describe("CLI/MCP contract", () => {
  it("accounts for every CLI leaf command", () => {
    for (const name of leaves(buildProgram())) expect(name in CLI_MCP_PARITY || LOCAL_ONLY_COMMANDS.includes(name), name).toBe(true);
  });
});
