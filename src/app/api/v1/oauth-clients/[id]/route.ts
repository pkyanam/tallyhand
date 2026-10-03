import { removeClient, rotateClientSecret } from '@/lib/integrations/oauth-clients';
import { integrationFailure, integrationSession, reply } from '@/lib/integrations/session-gate';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  try { const userId = await integrationSession(req); await removeClient(userId, params.id); return reply({ data: { removed: true } }); }
  catch (error) { return integrationFailure(error); }
}
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try { const userId = await integrationSession(req); return reply({ data: await rotateClientSecret(userId, params.id) }); }
  catch (error) { return integrationFailure(error); }
}
