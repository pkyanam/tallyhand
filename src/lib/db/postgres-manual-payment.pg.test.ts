import { describe,it,expect,beforeAll,beforeEach,afterAll } from "vitest";
import { readFile } from "node:fs/promises";
import { PostgresStorageProvider,type DbLike } from "./postgres-provider";
import type { InvoiceManualPaymentAssertion } from "@/core/entities";

const databaseUrl=process.env.FINANCIAL_TEST_DATABASE_URL;
describe.skipIf(!databaseUrl)("real PostgreSQL manual paid provenance and applied migrations",()=>{
  let pool:import("pg").Pool;
  let admin:import("pg").Pool;
  let schemaName:string;
  let owner:PostgresStorageProvider;
  let foreign:PostgresStorageProvider;
  const input={clientId:"c",invoiceNumber:"1",issueDate:1,dueDate:2,status:"sent" as const,lineItems:[],subtotal:123.45,total:123.45,currency:"JPY"};
  beforeAll(async()=>{
    const {Pool}=await import("pg");
    schemaName=`manual_payment_test_${crypto.randomUUID().replaceAll("-","")}`;
    admin=new Pool({connectionString:databaseUrl,max:1});
    await admin.query(`CREATE SCHEMA ${schemaName}`);
    pool=new Pool({connectionString:databaseUrl,max:5,options:`-c search_path=${schemaName}`});
    for(const file of ["0001_init","0002_approval_dedup","0003_invoice_localization","0004_encrypted_entities","0005_invoice_cloud_links","0006_invoice_manual_payment_assertion"]) await pool.query(await readFile(`drizzle/${file}.sql`,"utf8"));
    const {drizzle}=await import("drizzle-orm/node-postgres");
    const db=drizzle(pool) as unknown as DbLike;
    owner=await PostgresStorageProvider.create(db,"owner");foreign=await PostgresStorageProvider.create(db,"foreign");
  });
  beforeEach(async()=>{await pool.query("TRUNCATE invoices");});
  afterAll(async()=>{await pool?.end();if(admin){await admin.query(`DROP SCHEMA ${schemaName} CASCADE`);await admin.end();}});
  it("atomically records verified actor and original any-currency total with paid flag",async()=>{
    const invoice=await owner.createInvoice(input);
    await Promise.all([owner.markInvoicePaid(invoice.id),owner.markInvoicePaid(invoice.id)]);
    const paid=(await owner.getInvoice(invoice.id))!;
    expect(paid.status).toBe("paid");expect(paid.manualPaymentAssertion).toMatchObject({source:"manual",actorId:"owner",total:123.45,currency:"JPY"});
    expect(paid.manualPaymentAssertion?.recordedAt).toBe(paid.updatedAt);
    await owner.markInvoicePaid(invoice.id);expect((await owner.getInvoice(invoice.id))?.manualPaymentAssertion).toEqual(paid.manualPaymentAssertion);
    const raw=(await pool.query("SELECT status,manual_payment_assertion FROM invoices WHERE id=$1",[invoice.id])).rows[0];
    expect(raw.status).toBe("paid");expect(raw.manual_payment_assertion).toEqual(paid.manualPaymentAssertion);
  });
  it("preserves historical paid unknown attribution and enforces tenant scope",async()=>{
    const historical=await owner.createInvoice({...input,status:"paid"});
    await owner.markInvoicePaid(historical.id);expect((await owner.getInvoice(historical.id))?.manualPaymentAssertion).toBeUndefined();
    const pending=await owner.createInvoice({...input,invoiceNumber:"2",currency:undefined});
    await foreign.markInvoicePaid(pending.id);expect((await owner.getInvoice(pending.id))?.status).toBe("sent");
    await owner.markInvoicePaid(pending.id);expect((await owner.getInvoice(pending.id))?.manualPaymentAssertion?.currency).toBe("USD");
  });
  it("rejects generic create/update provenance spoofing and preserves true assertion",async()=>{
    const forged:InvoiceManualPaymentAssertion={source:"manual",recordedAt:1,actorId:"attacker",total:1,currency:"USD"};
    const invoice=await owner.createInvoice({...input,manualPaymentAssertion:forged} as typeof input & {manualPaymentAssertion:InvoiceManualPaymentAssertion});
    expect(invoice.manualPaymentAssertion).toBeUndefined();
    await owner.updateInvoice(invoice.id,{manualPaymentAssertion:forged});expect((await owner.getInvoice(invoice.id))?.manualPaymentAssertion).toBeUndefined();
    await owner.markInvoicePaid(invoice.id);const actual=(await owner.getInvoice(invoice.id))!.manualPaymentAssertion;
    await owner.updateInvoice(invoice.id,{manualPaymentAssertion:forged});expect((await owner.getInvoice(invoice.id))?.manualPaymentAssertion).toEqual(actual);
  });
  it("rolls back the entire paid action on database write failure",async()=>{
    const invoice=await owner.createInvoice(input);
    await pool.query(`CREATE FUNCTION reject_manual_paid() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.status='paid' THEN RAISE EXCEPTION 'injected manual paid failure'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER fail_manual_paid BEFORE UPDATE ON invoices FOR EACH ROW EXECUTE FUNCTION reject_manual_paid();`);
    try{await expect(owner.markInvoicePaid(invoice.id)).rejects.toThrow();}
    finally{await pool.query("DROP TRIGGER fail_manual_paid ON invoices;DROP FUNCTION reject_manual_paid()");}
    const persisted=(await owner.getInvoice(invoice.id))!;expect(persisted.status).toBe("sent");expect(persisted.manualPaymentAssertion).toBeUndefined();
  });
});
