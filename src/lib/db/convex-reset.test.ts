/// <reference types="vite/client" />
import { expect, it } from 'vitest';
import { convexTest } from 'convex-test';
import schema from '../../../convex/schema';
import { api } from '../../../convex/_generated/api';
const modules = import.meta.glob('../../../convex/**/*.{ts,js}');
async function fixture() {
 const base = convexTest(schema, modules);
 await base.run(async ctx => {
  for (const userId of ['owner','other']) {
   await ctx.db.insert('apiTokens',{id:`token-${userId}`,userId,name:'fixture',prefix:'thp_test',tokenHash:`hash-${userId}`,createdAt:1});
   await ctx.db.insert('clients',{id:'client',userId,name:'Private client',email:'fixture@example.com',archived:false,createdAt:1,updatedAt:1});
   await ctx.db.insert('projects',{id:'project',userId,clientId:'client',name:'Demo project',archived:false,createdAt:1,updatedAt:1});
   await ctx.db.insert('tasks',{id:'task',userId,projectId:'project',name:'Labor',startAt:0,endAt:60000,durationMinutes:1,tags:[],isBilled:false,createdAt:1,updatedAt:1});
   await ctx.db.insert('expenses',{id:'expense',userId,date:1,amount:10,category:'Other',isBilled:false,createdAt:1,updatedAt:1});
   await ctx.db.insert('invoices',{id:'invoice',userId,clientId:'client',invoiceNumber:'INV-1',issueDate:1,dueDate:2,status:'draft',lineItems:[],subtotal:0,total:0,createdAt:1,updatedAt:1});
   await ctx.db.insert('recurringSchedules',{id:'schedule',userId,clientId:'client',name:'Recurring',mode:'unbilled',frequency:'monthly',interval:1,lineItems:[],startDate:1,nextRunAt:2,occurrences:0,status:'active',createdAt:1,updatedAt:1});
   await ctx.db.insert('retainers',{id:'retainer',userId,clientId:'client',name:'Retainer',type:'hours',amountCents:0,startDate:1,status:'active',createdAt:1,updatedAt:1});
   for(const kind of ['mileage','contract','taxPayment','rateCard'] as const)
    await ctx.db.insert('extensionEntities',{id:kind,userId,kind,data:{id:kind},updatedAt:1});
   await ctx.db.insert('settings',{userId,data:{business:{name:'Old business'}}});
   await ctx.db.insert('shareLinks',{id:`link-${userId}`,userId,type:'invoice',target:{id:'invoice'},expiresAt:9999999999999,createdAt:1,updatedAt:1});
   await ctx.db.insert('timesheetApprovals',{id:`approval-${userId}`,userId,shareLinkId:'link',clientId:'client',weekStartMs:1,approvedAt:2});
  }
 });
 return {base, owner:base.withIdentity({subject:'owner',role:'member'})};
}
it('reset atomically deletes owned keys and data, never another owner; export contains no credentials',async()=>{
 const {base,owner}=await fixture();
 const backup=await owner.query(api.backup.read,{userId:'owner'});
 expect(JSON.stringify(backup)).not.toContain('hash-owner');
 const result=await owner.mutation(api.backup.replace,{userId:'owner',action:'reset',expectedRevision:backup.revision,confirmation:'RESET CLOUD DATA AND API KEYS'});
 expect(result).toMatchObject({complete:true,revokedApiKeys:1});
 await base.run(async ctx=>{
  for(const table of ['apiTokens','clients','projects','tasks','expenses','invoices','recurringSchedules','retainers','shareLinks','timesheetApprovals'] as const){
   const rows=await ctx.db.query(table).collect();
   expect(rows.map(r=>r.userId)).toEqual(['other']);
  }
  expect((await ctx.db.query('extensionEntities').collect()).map(r=>r.userId)).toEqual(['other','other','other','other']);
  const settings=await ctx.db.query('settings').withIndex('by_user',q=>q.eq('userId','owner')).unique();
  expect(settings?.data.business.name).toBe('');
 });
 expect(await owner.query(api.workspace.revision,{userId:'owner'})).toBe(backup.revision+1);
});
it('revision conflict or wrong confirmation preserves credentials and data',async()=>{
 const {base,owner}=await fixture();
 for(const args of [{expectedRevision:99,confirmation:'RESET CLOUD DATA AND API KEYS'},{expectedRevision:0,confirmation:'RESET CLOUD DATA'},{expectedRevision:0,confirmation:'wrong'}])
  await expect(owner.mutation(api.backup.replace,{userId:'owner',action:'reset',...args})).rejects.toThrow();
 expect(await base.run(ctx=>ctx.db.query('apiTokens').collect())).toHaveLength(2);
 expect(await owner.query(api.tally.clientsList,{userId:'owner'})).toHaveLength(1);
});
it('import preserves API keys',async()=>{
 const {base,owner}=await fixture();
 const backup=await owner.query(api.backup.read,{userId:'owner'});
 await owner.mutation(api.backup.replace,{userId:'owner',action:'import',expectedRevision:backup.revision,confirmation:'REPLACE CLOUD DATA',bundle:{...backup.bundle,mileageEntries:[],contracts:[],taxPayments:[],rateCards:[]}});
 expect(await base.run(ctx=>ctx.db.query('apiTokens').collect())).toHaveLength(2);
});
it('cross-account reset is rejected before any deletion',async()=>{
 const {base,owner}=await fixture();
 await expect(owner.mutation(api.backup.replace,{userId:'other',action:'reset',expectedRevision:0,confirmation:'RESET CLOUD DATA AND API KEYS'})).rejects.toThrow();
 expect(await base.run(ctx=>ctx.db.query('apiTokens').collect())).toHaveLength(2);
});
