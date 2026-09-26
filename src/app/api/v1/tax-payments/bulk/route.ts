import { taxPaymentCrud } from "@/server/track3-crud";

export const runtime = "nodejs";

export const POST = taxPaymentCrud.bulkCreate;
