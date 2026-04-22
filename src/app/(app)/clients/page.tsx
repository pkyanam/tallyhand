import { PageHeader } from "@/components/app/page-header";
import { Card, CardContent } from "@/components/ui/card";

export default function ClientsPage() {
  return (
    <>
      <PageHeader
        title="Clients"
        description="Manage clients and their projects. Built in Stage 1."
      />
      <Card>
        <CardContent className="p-10 text-center text-sm text-muted-foreground">
          Client CRUD lands in Stage 1.
        </CardContent>
      </Card>
    </>
  );
}
