import { PageHeader } from "@/components/app/page-header";
import { Card, CardContent } from "@/components/ui/card";

export default function ExpensesPage() {
  return (
    <>
      <PageHeader
        title="Expenses"
        description="Track expenses and attach them to invoices. Built in Stage 4."
      />
      <Card>
        <CardContent className="p-10 text-center text-sm text-muted-foreground">
          Expenses land in Stage 4.
        </CardContent>
      </Card>
    </>
  );
}
