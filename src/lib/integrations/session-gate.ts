import { effectiveAuth } from '@/lib/mode';
import { requireSessionUserId } from '@/lib/auth/session';
import { oauthConfig } from '@/lib/auth/oauth';
import { IntegrationError } from './oauth-clients';
export function reply(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { 'Cache-Control': 'private, no-store', 'Pragma': 'no-cache' } });
}
export async function integrationSession(req: Request): Promise<string> {
  if (effectiveAuth() !== 'clerk' || !oauthConfig().enabled || !process.env.CLERK_SECRET_KEY)
    throw new IntegrationError(503, 'unavailable', 'OAuth client management requires Clerk OAuth on this deployment.');
  if (req.headers.has('authorization')) throw new IntegrationError(403, 'session_required', 'Use an interactive sign-in to manage OAuth clients. API keys and OAuth tokens cannot create or change credentials.');
  if (req.method !== 'GET' && (req.headers.get('origin') !== oauthConfig().origin || req.headers.get('sec-fetch-site') === 'cross-site'))
    throw new IntegrationError(403, 'invalid_origin', 'Open integration settings on this Tallyhand deployment.');
  try { return await requireSessionUserId(); }
  catch { throw new IntegrationError(401, 'unauthorized', 'Sign in to manage integrations.'); }
}
export function integrationFailure(error: unknown) {
  if (error instanceof IntegrationError) return reply({ error: { code: error.code, message: error.message } }, error.status);
  // Provider exceptions can contain secrets. Never serialize or log them.
  return reply({ error: { code: 'provider_unavailable', message: 'Could not complete the OAuth provider request. Check the client list before retrying creation; contact support if this continues.' } }, 503);
}
