/** Clerk holds grants/secrets; private user metadata holds only ownership IDs.
 * Never infer ownership from client names or expose instance-wide client lists.
 */
import { createClerkClient } from '@clerk/backend';
import { z } from 'zod';
import { oauthConfig } from '@/lib/auth/oauth';

export const CLIENT_SCOPES = ['tally:read', 'tally:write', 'tally:manage', 'offline_access'] as const;
export const EXECUTOR_CALLBACK = 'https://v2.executor.sh/api/oauth/callback';
export function validRedirect(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && !u.username && !u.password && !u.hash && !value.includes('*') &&
      !['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
  } catch { return false; }
}
export const clientInput = z.object({
  name: z.string().trim().min(1).max(80),
  redirectUris: z.array(z.string().max(2048).refine(validRedirect, 'Use an exact HTTPS callback without credentials, fragments or wildcards')).min(1).max(5),
  scopes: z.array(z.enum(CLIENT_SCOPES)).min(1).max(4).refine(s => s.includes('tally:read'), 'tally:read is required'),
  public: z.boolean().default(false),
}).strict();
export class IntegrationError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
type Client = ReturnType<typeof createClerkClient>;
type Application = Awaited<ReturnType<Client['oauthApplications']['get']>>;
const KEY = 'tallyhandOAuthClientsV1';
function clerk() { return createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY }); }
function ids(metadata: Record<string, unknown>): string[] {
  const map = metadata[KEY];
  return map && typeof map === 'object' && !Array.isArray(map)
    ? Object.entries(map).filter(([id, v]) => /^(?:oa|oauthapp)_[A-Za-z0-9]+$/.test(id) && v === true).map(([id]) => id) : [];
}
function view(app: Application) {
  return { id: app.id, name: app.name, clientId: app.clientId, redirectUris: app.redirectUris,
    scopes: app.scopes.split(/\s+/).filter(Boolean), public: app.isPublic,
    pkceRequired: app.pkceRequired, consentScreenEnabled: app.consentScreenEnabled,
    createdAt: app.createdAt, authorizeUrl: app.authorizeUrl, tokenUrl: app.tokenFetchUrl };
}
async function owned(c: Client, userId: string, id: string) {
  if (!ids((await c.users.getUser(userId)).privateMetadata).includes(id))
    throw new IntegrationError(404, 'not_found', 'OAuth client not found');
}
export async function listClients(userId: string) {
  const c = clerk();
  const ownedIds = ids((await c.users.getUser(userId)).privateMetadata);
  const result = await Promise.all(ownedIds.map(async id => {
    try { return view(await c.oauthApplications.get(id)); }
    catch (e) { if ((e as {status?: number}).status === 404) return null; throw e; }
  }));
  return result.filter(v => v !== null);
}
export async function createClient(userId: string, input: z.infer<typeof clientInput>) {
  const c = clerk();
  if (ids((await c.users.getUser(userId)).privateMetadata).length >= 10)
    throw new IntegrationError(409, 'client_limit', 'Remove an unused client before creating another (limit 10).');
  // Clerk BAPI supports these flags although backend SDK 3.21.1 omits them
  // from CreateOAuthApplicationParams. Its serializer forwards camelCase keys.
  // Explicit per-client requirements avoid relying on inherited instance flags.
  // https://github.com/clerk/clerk-sdk-php/blob/main/docs/Models/Operations/CreateOAuthApplicationRequestBody.md
  const params = { ...input, scopes: [...new Set(input.scopes)].join(' '),
    consentScreenEnabled: true, pkceRequired: true };
  const app = await c.oauthApplications.create(params);
  try {
    // Fail closed if provider instance settings cannot guarantee safe consent.
    const missing = [
      ...(!app.consentScreenEnabled ? ['consent screen is not enabled'] : []),
      ...(!app.pkceRequired ? ['explicit client PKCE requirement was not confirmed'] : []),
      ...input.scopes.filter(s => !app.scopes.split(/\s+/).includes(s)).map(s => `scope ${s} was not assigned`),
    ];
    if (missing.length)
      throw new IntegrationError(503, 'provider_configuration', `OAuth client registration could not be verified: ${missing.join('; ')}. No client credentials were saved. Contact the deployment administrator.`);
    // Deep-merge a unique key, not a read/replace array: simultaneous creates do not drop ownership.
    await c.users.updateUserMetadata(userId, { privateMetadata: { [KEY]: { [app.id]: true } } });
  } catch (e) {
    await c.oauthApplications.delete(app.id).catch(() => undefined);
    throw e;
  }
  return { ...view(app), ...(app.clientSecret ? { clientSecret: app.clientSecret } : {}) };
}
export async function removeClient(userId: string, id: string) {
  const c = clerk(); await owned(c, userId, id);
  try { await c.oauthApplications.delete(id); }
  catch (e) { if ((e as {status?: number}).status !== 404) throw e; }
  await c.users.updateUserMetadata(userId, { privateMetadata: { [KEY]: { [id]: null } } });
}
export async function rotateClientSecret(userId: string, id: string) {
  const c = clerk(); await owned(c, userId, id);
  const app = await c.oauthApplications.get(id);
  if (app.isPublic) throw new IntegrationError(400, 'public_client', 'Public clients use PKCE and do not have a client secret.');
  const rotated = await c.oauthApplications.rotateSecret(id);
  return { ...view(rotated), clientSecret: rotated.clientSecret };
}
export function connectionMetadata() {
  const config = oauthConfig();
  return { issuer: config.issuer, resource: config.resource, scopes: CLIENT_SCOPES,
    executorCallback: EXECUTOR_CALLBACK, maxClients: 10 };
}
