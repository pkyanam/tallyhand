/** Publish OpenAI's top-level auth descriptor through the SDK's public handler API.
 * SDK 2.2 keeps only its known descriptor fields in the default tools/list handler.
 * Tallyhand registers Zod schemas and a fixed catalog before connecting a transport.
 */
import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

export class TallyhandMcpServer extends McpServer {
  private readonly catalog: Array<() => Record<string, unknown>> = [];

  constructor(...args: ConstructorParameters<typeof McpServer>) {
    super(...args);
    const register = this.registerTool.bind(this);
    this.registerTool = ((name: string, config: any, callback: any) => {
      const registered = register(name, config, callback);
      this.catalog.push(() => ({
        name,
        title: registered.title,
        description: registered.description,
        inputSchema: registered.inputSchema ? z.toJSONSchema(registered.inputSchema as z.ZodType, { io: "input" }) : { type: "object", properties: {} },
        ...(registered.outputSchema ? { outputSchema: z.toJSONSchema(registered.outputSchema as z.ZodType, { io: "output" }) } : {}),
        annotations: registered.annotations,
        icons: registered.icons,
        execution: registered.execution,
        _meta: registered._meta,
        securitySchemes: registered._meta?.securitySchemes,
        enabled: registered.enabled,
      }));
      return registered;
    }) as typeof this.registerTool;
  }

  installToolCatalog(): void {
    this.server.setRequestHandler("tools/list", () => ({
      tools: this.catalog.map(read => read()).filter(tool => tool.enabled).map(({ enabled: _enabled, ...tool }) => tool as any),
    }));
  }
}
