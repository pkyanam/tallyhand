"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ExpenseForm } from "@/components/expenses/expense-form";
import { expenseRepo } from "@/lib/db/repos";

export default function NewExpensePage() {
  const router = useRouter();

  return (
    <>
      <PageHeader
        title="New expense"
        description="Add an amount, date, and category. Client and project are optional."
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
            submitLabel="Save expense"
            onCancel={() => router.push("/expenses")}
            onSubmit={async (values) => {
              await expenseRepo.create({
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
