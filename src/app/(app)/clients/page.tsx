import Link from "next/link";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { ClientsList } from "@/components/clients/clients-list";

export default function ClientsPage() {
  return (
    <>
      <PageHeader
        title="Clients"
        description="People and companies you bill. Create clients first — projects live under them."
        actions={
          <Button asChild>
            <Link href="/clients/new">
              <Plus className="mr-1 h-4 w-4" />
              New client
            </Link>
          </Button>
        }
      />
      <ClientsList />
    </>
  );
}
