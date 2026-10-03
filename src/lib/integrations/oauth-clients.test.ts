import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ getUser: vi.fn(), updateUserMetadata: vi.fn(), create: vi.fn(), get: vi.fn(), delete: vi.fn(), rotateSecret: vi.fn() }));
vi.mock('@clerk/backend', () => ({ createClerkClient: () => ({ users: mocks, oauthApplications: mocks }) }));
import { clientInput, createClient, listClients, removeClient, rotateClientSecret, validRedirect } from './oauth-clients';
const app = { id: 'oa_fixture', name: 'Executor', clientId: 'client_fixture', scopes: 'tally:read tally:write tally:manage offline_access', redirectUris: ['https://v2.executor.sh/api/oauth/callback'], isPublic: false, consentScreenEnabled: true, pkceRequired: true, createdAt: 1, clientSecret: 'synthetic-secret', authorizeUrl: 'https://issuer.example/authorize', tokenFetchUrl: 'https://issuer.example/token' };
beforeEach(() => { vi.resetAllMocks(); mocks.getUser.mockResolvedValue({ privateMetadata: { tallyhandOAuthClientsV1: { oa_fixture: true } } }); mocks.create.mockResolvedValue(app); mocks.get.mockResolvedValue(app); mocks.updateUserMetadata.mockResolvedValue({}); mocks.delete.mockResolvedValue({}); mocks.rotateSecret.mockResolvedValue(app); });
describe('OAuth registration', () => {
 it('validates the exact Executor callback and all workspace scopes', () => { expect(clientInput.parse({ name: 'Executor', redirectUris: app.redirectUris, scopes: app.scopes.split(' ') }).scopes).toHaveLength(4); });
 it.each(['http://example.com/callback','https://example.com/*','https://user:pass@example.com/cb','https://example.com/cb#fragment','javascript:alert(1)','https://localhost/cb'])('rejects unsafe callback %s', value => { expect(validRedirect(value)).toBe(false); });
 it('rejects undeclared scopes and missing base permission', () => { expect(clientInput.safeParse({ name:'test',redirectUris:app.redirectUris,scopes:['private_metadata'] }).success).toBe(false); expect(clientInput.safeParse({name:'test',redirectUris:app.redirectUris,scopes:['tally:write']}).success).toBe(false); });
 it('never returns secrets in the client list', async () => { const out = await listClients('user_a'); expect(JSON.stringify(out)).not.toContain('synthetic-secret'); expect(mocks.get).toHaveBeenCalledWith('oa_fixture'); });
 it('returns secret once at creation and stores only ownership', async () => { expect((await createClient('user_a', clientInput.parse({name:'Executor',redirectUris:app.redirectUris,scopes:app.scopes.split(' ')}))).clientSecret).toBe('synthetic-secret'); expect(mocks.updateUserMetadata).toHaveBeenCalledWith('user_a', {privateMetadata:{tallyhandOAuthClientsV1:{oa_fixture:true}}}); });
 it.each(['consentScreenEnabled','pkceRequired'])('cleans up registration without %s', async field => { mocks.create.mockResolvedValue({...app,[field]:false}); await expect(createClient('user_a',{name:'test',redirectUris:app.redirectUris,scopes:['tally:read'],public:false})).rejects.toMatchObject({code:'provider_configuration'}); expect(mocks.delete).toHaveBeenCalledWith(app.id); expect(mocks.updateUserMetadata).not.toHaveBeenCalled(); });
 it('cleans up when ownership cannot persist', async () => { mocks.updateUserMetadata.mockRejectedValue(new Error('fixture')); await expect(createClient('user_a',{name:'test',redirectUris:app.redirectUris,scopes:['tally:read'],public:false})).rejects.toThrow(); expect(mocks.delete).toHaveBeenCalledWith(app.id); });
 it('rejects another user’s client before contacting provider', async () => { await expect(removeClient('user_a','oauthapp_other')).rejects.toMatchObject({status:404}); await expect(rotateClientSecret('user_a','oauthapp_other')).rejects.toMatchObject({status:404}); expect(mocks.delete).not.toHaveBeenCalled(); expect(mocks.rotateSecret).not.toHaveBeenCalled(); });
 it('deletes only owned registrations and clears ownership key', async () => { await removeClient('user_a',app.id); expect(mocks.updateUserMetadata).toHaveBeenCalledWith('user_a',{privateMetadata:{tallyhandOAuthClientsV1:{oa_fixture:null}}}); });
 it('rejects secret rotation for public clients', async () => { mocks.get.mockResolvedValue({...app,isPublic:true}); await expect(rotateClientSecret('user_a',app.id)).rejects.toMatchObject({code:'public_client'}); });
});

it('explicitly requests consent and PKCE from Clerk', async () => {
 await createClient('user_a', {name:'Executor',redirectUris:app.redirectUris,scopes:['tally:read','offline_access'],public:false});
 expect(mocks.create).toHaveBeenCalledWith({name:'Executor',redirectUris:app.redirectUris,scopes:'tally:read offline_access',public:false,consentScreenEnabled:true,pkceRequired:true});
});
it('reports the missing scope without exposing credentials', async () => {
 mocks.create.mockResolvedValue({...app,scopes:'tally:read'});
 await expect(createClient('user_a',{name:'Executor',redirectUris:app.redirectUris,scopes:['tally:read','tally:write'],public:false})).rejects.toMatchObject({message:expect.stringContaining('scope tally:write was not assigned')});
 expect(mocks.delete).toHaveBeenCalledWith(app.id);
});
it('retains legacy ownership IDs while ignoring unrelated metadata keys', async () => {
 mocks.getUser.mockResolvedValue({privateMetadata:{tallyhandOAuthClientsV1:{oauthapp_legacy:true,oa_fixture:true,other:true,oa_revoked:null}}});
 await listClients('user_a');
 expect(mocks.get.mock.calls.map(call=>call[0])).toEqual(['oauthapp_legacy','oa_fixture']);
});
