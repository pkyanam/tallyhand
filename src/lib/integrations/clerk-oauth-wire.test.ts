import { afterEach, expect, it, vi } from 'vitest';
import { createClerkClient } from '@clerk/backend';

afterEach(() => vi.unstubAllGlobals());
it('the pinned Clerk SDK sends the explicit BAPI security flags', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
    object: 'oauth_application', id: 'oa_fixture', instance_id: 'ins_fixture',
    name: 'Executor', client_id: 'client_fixture', scopes: 'tally:read',
    redirect_uris: ['https://v2.executor.sh/api/oauth/callback'], public: false,
    consent_screen_enabled: true, pkce_required: true,
    created_at: 1, updated_at: 1,
  }), {status: 200, headers: {'Content-Type':'application/json'}}));
  vi.stubGlobal('fetch', fetch);
  const clerk = createClerkClient({secretKey:'sk_test_synthetic_fixture'});
  const params = {name:'Executor', scopes:'tally:read', public:false,
    redirectUris:['https://v2.executor.sh/api/oauth/callback'],
    consentScreenEnabled:true, pkceRequired:true};
  const result = await clerk.oauthApplications.create(params);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({
    consent_screen_enabled:true, pkce_required:true,
    redirect_uris:params.redirectUris,
  });
  expect(result.pkceRequired).toBe(true);
  expect(result.consentScreenEnabled).toBe(true);
});
