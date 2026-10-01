import { PageHeader } from "@/components/app/page-header";
import { DashboardContent } from "@/components/dashboard/dashboard-content";
import { ManualEntryDialog } from "@/components/app/manual-entry-dialog";

export default function DashboardPage() {
  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Your work, your time, at a glance."
        actions={<ManualEntryDialog />}
      />
      <DashboardContent />
    </>
  );
}
