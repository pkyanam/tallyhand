import { PageHeader } from "@/components/app/page-header";
import { Card, CardContent } from "@/components/ui/card";

export default function InvoicesPage() {
  return (
    <>
      <PageHeader
        title="Invoices"
        description="Draft, send, and track invoices. Built in Stage 3."
      />
      <Card>
        <CardContent className="p-10 text-center text-sm text-muted-foreground">
          Invoicing lands in Stage 3.
        </CardContent>
      </Card>
    </>
  );
}
