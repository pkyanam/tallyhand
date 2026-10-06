import { DISCOVERY_HEADERS, apiCatalog } from "@/lib/integration-discovery";
export const dynamic = "force-dynamic";
export function GET() {
  return Response.json(apiCatalog(), { headers: {
    ...DISCOVERY_HEADERS,
    "Content-Type": 'application/linkset+json; profile="https://www.rfc-editor.org/info/rfc9727"',
  } });
}
