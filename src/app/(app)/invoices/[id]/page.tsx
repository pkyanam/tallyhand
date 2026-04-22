import { EditInvoiceContent } from "@/components/invoices/edit-invoice";

export default function InvoiceDetailPage({
  params,
}: {
  params: { id: string };
}) {
  return <EditInvoiceContent invoiceId={params.id} />;
}
