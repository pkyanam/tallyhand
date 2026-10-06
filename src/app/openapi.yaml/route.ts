import { OPENAPI_V1 } from "../api/v1/_lib/openapi-document";
import { DISCOVERY_HEADERS } from "@/lib/integration-discovery";
export const runtime = "nodejs";

export function GET() {
  // YAML 1.2 accepts JSON flow values. Keep top-level keys in block form so
  // discovery clients can recognize the version without parsing a full JSON
  // document. Both representations use the same contract, without truncation.
  const yaml = Object.entries(OPENAPI_V1).map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join("\n") + "\n";
  return new Response(yaml, { headers: { ...DISCOVERY_HEADERS, "Content-Type": "application/yaml; charset=utf-8" } });
}
