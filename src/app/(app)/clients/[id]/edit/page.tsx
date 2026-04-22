"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ClientForm } from "@/components/clients/client-form";
import { clientRepo } from "@/lib/db/repos";

export default function EditClientPage({
  params,
}: {
  params: { id: string };
}) {
  const router = useRouter();
  const client = useLiveQuery(() => clientRepo.get(params.id), [params.id]);

  if (client === undefined) {
    return <div className="text-sm text-muted-foreground">Loading…</div>;
  }
  if (!client) {
    return (
      <Card>
        <CardContent className="p-10 text-center">
          <h2 className="text-lg font-semibold">Client not found</h2>
          <Button asChild className="mt-4">
            <Link href="/clients">
              <ArrowLeft className="mr-1 h-4 w-4" />
              Back to clients
            </Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <PageHeader
        title={`Edit ${client.name}`}
        actions={
          <Button asChild variant="ghost">
            <Link href={`/clients/${client.id}`}>
              <ArrowLeft className="mr-1 h-4 w-4" />
              Back
            </Link>
          </Button>
        }
      />
      <Card>
        <CardContent className="pt-6">
          <ClientForm
            defaultValues={client}
            submitLabel="Save changes"
            onCancel={() => router.push(`/clients/${client.id}`)}
            onSubmit={async (values) => {
              await clientRepo.update(client.id, {
                name: values.name,
                email: values.email || undefined,
                address: values.address || undefined,
                defaultRate: values.defaultRate,
                notes: values.notes || undefined,
              });
              router.push(`/clients/${client.id}`);
            }}
          />
        </CardContent>
      </Card>
    </>
  );
}
