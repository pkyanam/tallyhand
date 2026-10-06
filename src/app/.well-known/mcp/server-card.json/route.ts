import { DISCOVERY_HEADERS, mcpServerCard } from "@/lib/integration-discovery";
export const dynamic = "force-dynamic";
export function GET() {
  return Response.json(mcpServerCard(), { headers: DISCOVERY_HEADERS });
}
