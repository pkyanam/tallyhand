import { beforeEach, expect, it, vi } from 'vitest';
const m=vi.hoisted(()=>({query:vi.fn(),mutation:vi.fn()}));
vi.mock('../_lib/sync-auth',()=>({requireApiOrSession:async()=>null}));
vi.mock('@/lib/auth/session',()=>({resolveUserId:async()=> 'owner'}));
vi.mock('@/lib/auth/users',()=>({getUserRole:async()=> 'member'}));
vi.mock('@/lib/mode',()=>({parseStorage:()=> 'convex'}));
vi.mock('@/lib/db/convex-client',()=>({createConvexRequestClient:()=>m}));
vi.mock('../_lib/idempotency',()=>({withIdempotency:async(_req:Request,fn:()=>Promise<Response>)=>fn()}));
import { POST } from './route';
const request=(confirmation='RESET CLOUD DATA AND API KEYS')=>new Request('https://example.com/api/v1/data',{method:'POST',body:JSON.stringify({action:'reset',expectedRevision:0,confirmation})});
beforeEach(()=>{vi.resetAllMocks();m.mutation.mockResolvedValue({complete:true,revokedApiKeys:2});});
it('blocks reset on the old backend before any mutation',async()=>{
 m.query.mockResolvedValue({revision:0});
 const response=await POST(request());
 expect(response.status).toBe(503); expect(m.mutation).not.toHaveBeenCalled();
});
it('requires the expanded explicit confirmation',async()=>{
 const response=await POST(request('RESET CLOUD DATA'));
 expect(response.status).toBe(400);expect(m.query).not.toHaveBeenCalled();expect(m.mutation).not.toHaveBeenCalled();
});
it('uses the upgraded backend after explicit confirmation',async()=>{
 m.query.mockResolvedValue({revision:0,resetRevokesApiKeys:true});
 expect((await POST(request())).status).toBe(200);
 expect(m.mutation).toHaveBeenCalledWith('backup:replace',expect.objectContaining({userId:'owner',confirmation:'RESET CLOUD DATA AND API KEYS'}));
});
