import { EditInvoiceContent } from "@/components/invoices/edit-invoice";
import {
  LOCAL_USER_ID,
  tryResolveUserId,
} from "@/lib/auth/session";

export default async function InvoiceDetailPage({
  params,
}: {
  params: { id: string };
}) {
  // Sharing availability follows the authenticated page request directly.
  // It must not depend on whether encrypted sync happens to be available.
  const userId = await tryResolveUserId();
  const cloudSharingEnabled = userId !== null && userId !== LOCAL_USER_ID;
  return (
    <EditInvoiceContent
      invoiceId={params.id}
      cloudSharingEnabled={cloudSharingEnabled}
    />
  );
}
