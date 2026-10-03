import { clientInput, connectionMetadata, createClient, IntegrationError, listClients } from '@/lib/integrations/oauth-clients';
import { integrationFailure, integrationSession, reply } from '@/lib/integrations/session-gate';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(req: Request) {
  try { const userId = await integrationSession(req); return reply({ data: await listClients(userId), metadata: connectionMetadata() }); }
  catch (error) { return integrationFailure(error); }
}
export async function POST(req: Request) {
  try {
    const userId = await integrationSession(req);
    const text = await req.text();
    if (Buffer.byteLength(text) > 16384) throw new IntegrationError(413, 'too_large', 'Client configuration is too large.');
    const parsed = clientInput.safeParse(JSON.parse(text));
    if (!parsed.success) return reply({ error: { code: 'invalid_client', message: 'Check the OAuth client fields.', details: parsed.error.issues.map(i => ({ field: i.path.join('.'), reason: i.message })) } }, 400);
    return reply({ data: await createClient(userId, parsed.data) }, 201);
  } catch (error) { if (error instanceof SyntaxError) return reply({ error: { code: 'bad_request', message: 'Expected JSON.' } }, 400); return integrationFailure(error); }
}
