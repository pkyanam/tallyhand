import { RecurringForm } from "@/components/invoices/recurring-form";

export default function EditRecurringSchedulePage({
  params,
}: {
  params: { id: string };
}) {
  return <RecurringForm scheduleId={params.id} />;
}
