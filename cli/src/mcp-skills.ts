/** Static, content-addressed Skills extension catalog (draft SEP-2640). */
import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { AGENT_SKILLS } from "./agent-skills.generated.js";
export function registerAgentSkills(server: McpServer) {
  server.server.registerCapabilities({ extensions: { "io.modelcontextprotocol/skills": {} } });
  const catalog = AGENT_SKILLS.map(({ uri, frontmatter, resources }) => ({ uri, frontmatter: { ...frontmatter }, resources: resources.map(resource => ({ ...resource })) }));
  const entry = z.object({ uri: z.string(), frontmatter: z.object({ name: z.string(), description: z.string() }), resources: z.array(z.object({ uri: z.string(), digest: z.string() })) });
  server.server.setRequestHandler("skills/list", { params: z.object({ cursor: z.string().optional() }).default({}), result: z.object({ skills: z.array(entry) }) }, async ({ cursor }) => {
    if (cursor) throw new Error("Invalid skill cursor");
    return { skills: catalog };
  });
  server.server.setRequestHandler("skills/get", { params: z.object({ uri: z.string() }), result: z.object({ skill: entry }) }, async ({ uri }) => {
    const skill = catalog.find(item => item.uri === uri); if (!skill) throw new Error("Unknown skill");
    return { skill };
  });
  for (const skill of AGENT_SKILLS) server.registerResource(`skill-${skill.frontmatter.name}`, skill.uri, { mimeType: "text/markdown", description: skill.frontmatter.description }, async uri => ({ contents: [{ uri: uri.href, mimeType: "text/markdown", text: skill.text }] }));
}
