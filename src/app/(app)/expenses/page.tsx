"use client";

import Link from "next/link";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ExpensesList } from "@/components/expenses/expenses-list";
import { MileageSection } from "@/components/expenses/mileage-section";

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
      <Tabs defaultValue="expenses">
        <TabsList>
          <TabsTrigger value="expenses">Expenses</TabsTrigger>
          <TabsTrigger value="mileage">Mileage</TabsTrigger>
        </TabsList>
        <TabsContent value="expenses" className="mt-4">
          <ExpensesList />
        </TabsContent>
        <TabsContent value="mileage" className="mt-4">
          <MileageSection />
        </TabsContent>
      </Tabs>
    </>
  );
}
