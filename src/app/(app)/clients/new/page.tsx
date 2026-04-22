"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ClientForm } from "@/components/clients/client-form";
import { clientRepo } from "@/lib/db/repos";

export default function NewClientPage() {
  const router = useRouter();

  return (
    <>
      <PageHeader
        title="New client"
        description="Create a client to start tracking time and sending invoices."
        actions={
          <Button asChild variant="ghost">
            <Link href="/clients">
              <ArrowLeft className="mr-1 h-4 w-4" />
              Back
            </Link>
          </Button>
        }
      />
      <Card>
        <CardContent className="pt-6">
          <ClientForm
            submitLabel="Create client"
            onCancel={() => router.push("/clients")}
            onSubmit={async (values) => {
              const created = await clientRepo.create({
                name: values.name,
                email: values.email || undefined,
                address: values.address || undefined,
                defaultRate: values.defaultRate,
                notes: values.notes || undefined,
              });
              router.push(`/clients/${created.id}`);
            }}
          />
        </CardContent>
      </Card>
    </>
  );
}
