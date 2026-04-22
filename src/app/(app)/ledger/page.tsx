import { Suspense } from "react";
import { PageHeader } from "@/components/app/page-header";
import { ManualEntryDialog } from "@/components/app/manual-entry-dialog";
import { LedgerContent } from "@/components/ledger/ledger-content";

export default function LedgerPage() {
  return (
    <>
      <PageHeader
        title="Ledger"
        description="Unified chronological feed of time and expenses. Filter, edit inline, export, or select rows to invoice."
        actions={<ManualEntryDialog />}
      />
      <Suspense
        fallback={
          <div className="py-12 text-center text-sm text-muted-foreground">
            Loading ledger…
          </div>
        }
      >
        <LedgerContent />
      </Suspense>
    </>
  );
}
