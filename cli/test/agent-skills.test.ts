import { it, expect } from "vitest";
import { createHash } from "node:crypto";
import { AGENT_SKILLS } from "../src/agent-skills.generated.js";
it("ships five bounded skills with exact content hashes", () => {
  expect(AGENT_SKILLS).toHaveLength(5);
  for (const skill of AGENT_SKILLS) {
    expect(skill.uri).toBe(`skill://tallyhand/${skill.frontmatter.name}/SKILL.md`);
    expect(skill.resources[0].digest).toBe(`sha256:${createHash("sha256").update(skill.text).digest("hex")}`);
    expect(Buffer.byteLength(skill.text)).toBeLessThan(256 * 1024);
    expect(skill.text).toContain(`name: ${skill.frontmatter.name}`);
    expect(skill.text).toContain(`description: ${JSON.stringify(skill.frontmatter.description)}`);
  }
});
