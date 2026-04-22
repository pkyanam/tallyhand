import { Suspense } from "react";
import { NewInvoiceContent } from "@/components/invoices/new-invoice";

export default function NewInvoicePage() {
  return (
    <Suspense fallback={null}>
      <NewInvoiceContent />
    </Suspense>
  );
}
