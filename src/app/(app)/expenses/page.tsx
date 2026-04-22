import Link from "next/link";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { ExpensesList } from "@/components/expenses/expenses-list";

export default function ExpensesPage() {
  return (
    <>
      <PageHeader
        title="Expenses"
        description="Log costs and attach receipts. Expenses also appear on the Ledger."
        actions={
          <Button asChild>
            <Link href="/expenses/new">
              <Plus className="mr-1 h-4 w-4" />
              New expense
            </Link>
          </Button>
        }
      />
      <ExpensesList />
    </>
  );
}
