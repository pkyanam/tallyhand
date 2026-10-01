import { it, expect } from "vitest";
import { mkdtempSync, readFileSync, statSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFileConfig } from "../src/client.js";
it("preserves existing config while atomically updating a key", () => {
  const dir = mkdtempSync(join(tmpdir(), "tally-config-"));
  try {
    const path = join(dir, "nested", "config.json");
    writeFileConfig({ apiUrl: "https://example.com", token: "fixture" }, path);
    writeFileConfig({ apiUrl: "https://tallyhand.xyz" }, path);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ apiUrl: "https://tallyhand.xyz", token: "fixture" });
    if (process.platform !== "win32") expect(statSync(path).mode & 0o777).toBe(0o600);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
