"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ExpenseForm } from "@/components/expenses/expense-form";
import { expenseRepo } from "@/lib/db/repos";

export default function EditExpensePage() {
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : "";
  const router = useRouter();

  const expense = useLiveQuery(
    () => (id ? expenseRepo.get(id) : Promise.resolve(undefined)),
    [id],
  );

  if (expense === undefined) {
    return (
      <>
        <PageHeader title="Edit expense" />
        <Card>
          <CardContent className="p-8 text-sm text-muted-foreground">
            Loading…
          </CardContent>
        </Card>
      </>
    );
  }

  if (expense === null) {
    return (
      <>
        <PageHeader title="Expense not found" />
        <Card>
          <CardContent className="p-10 text-center">
            <p className="text-sm text-muted-foreground">
              This expense may have been deleted.
            </p>
            <Button asChild className="mt-4">
              <Link href="/expenses">Back to expenses</Link>
            </Button>
          </CardContent>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Edit expense"
        description="Update the amount, category, or receipt."
        actions={
          <Button asChild variant="ghost">
            <Link href="/expenses">
              <ArrowLeft className="mr-1 h-4 w-4" />
              Back
            </Link>
          </Button>
        }
      />
      <Card>
        <CardContent className="pt-6">
          <ExpenseForm
            key={expense.id}
            defaultValues={expense}
            submitLabel="Save changes"
            onCancel={() => router.push("/expenses")}
            onSubmit={async (values) => {
              await expenseRepo.update(expense.id, {
                amount: values.amount,
                date: values.date,
                category: values.category,
                clientId: values.clientId,
                projectId: values.projectId,
                note: values.note,
                receiptB64: values.receiptB64,
              });
              router.push("/expenses");
            }}
          />
        </CardContent>
      </Card>
    </>
  );
}
