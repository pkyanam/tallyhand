import { PublicInvoiceClient } from "@/components/invoices/public-invoice-client";
import { LOCAL_USER_ID, tryResolveUserId } from "@/lib/auth/session";

export default async function PublicInvoicePage({
  params,
}: {
  params: { token: string };
}) {
  const userId = await tryResolveUserId();
  const cloudMode = userId !== null && userId !== LOCAL_USER_ID;
  return <PublicInvoiceClient token={params.token} cloudMode={cloudMode} />;
}
