import { PublicInvoiceClient } from "@/components/invoices/public-invoice-client";

export default function PublicInvoicePage({
  params,
}: {
  params: { token: string };
}) {
  return <PublicInvoiceClient token={params.token} />;
}
