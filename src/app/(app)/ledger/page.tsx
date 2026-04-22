import { PageHeader } from "@/components/app/page-header";
import { Card, CardContent } from "@/components/ui/card";

export default function LedgerPage() {
  return (
    <>
      <PageHeader
        title="Ledger"
        description="Chronological feed of tasks and expenses. Built in Stage 2."
      />
      <Card>
        <CardContent className="p-10 text-center text-sm text-muted-foreground">
          The unified ledger lands in Stage 2. Filters, inline edit, bulk
          select, and export will live here.
        </CardContent>
      </Card>
    </>
  );
}
