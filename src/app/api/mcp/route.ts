/**
 * Remote MCP endpoint — Streamable HTTP (stateless).
 *
 *   POST /api/mcp   JSON-RPC over HTTP (MCP "Streamable HTTP" transport)
 *
 * Single-deployment design: the web app, the REST API (/api/v1), and MCP
 * (/api/mcp) are all served by this one Next.js deployment — e.g.
 * tallyhand.io, tallyhand.io/api, tallyhand.io/api/mcp. Auth is the same
 * `Authorization: Bearer <TALLYHAND_API_TOKEN>` the REST API uses.
 *
 * The MCP tools are defined exactly once, in cli/src/mcp.ts
 * (`createMcpServer`), and shared by both transports:
 *   - stdio: `tally mcp`            (local clients: Claude Code, Claude Desktop)
 *   - HTTP:  this route             (remote clients: any MCP client with a URL + token)
 *
 * Stateless mode (no session IDs): every POST is independent, so the route
 * is safe behind any number of instances or serverless functions. The
 * per-request Api client talks to this deployment's own /api/v1 over HTTP
 * with the caller's Bearer token, so all auth, validation, rate limiting,
 * and business logic is reused — never duplicated.
 */
import { requireApiToken } from "@/server/auth";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createMcpServer } from "../../../../cli/src/mcp.js";
import { TallyhandClient } from "../../../../cli/src/client.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function bearerToken(req: Request): string {
  return (req.headers.get("authorization") ?? "")
    .replace(/^Bearer\s+/i, "")
    .trim();
}

async function handleMcp(req: Request): Promise<Response> {
  const authErr = await requireApiToken(req);
  if (authErr) return authErr;

  // Loop back to this deployment's own REST API. `req.url`'s origin is the
  // address the request arrived on, so this works behind proxies without
  // any extra configuration.
  const origin = new URL(req.url).origin;
  const api = new TallyhandClient({ baseUrl: origin, token: bearerToken(req) });

  const server = createMcpServer(api);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless: no sessions, every request stands alone
  });
  await server.connect(transport);
  // The web-standard transport speaks Request/Response natively — no adapter needed.
  return transport.handleRequest(req);
}

export async function POST(req: Request): Promise<Response> {
  return handleMcp(req);
}

// GET/DELETE reach the transport too: in stateless mode it answers them
// with the appropriate MCP error (no SSE streams / sessions to manage).
export async function GET(req: Request): Promise<Response> {
  return handleMcp(req);
}

export async function DELETE(req: Request): Promise<Response> {
  return handleMcp(req);
}
