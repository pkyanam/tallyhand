import { DISCOVERY_HEADERS, integrationDiscovery } from "@/lib/integration-discovery";
export const dynamic = "force-dynamic";
export function GET() {
  return Response.json(integrationDiscovery(), { headers: DISCOVERY_HEADERS });
}
