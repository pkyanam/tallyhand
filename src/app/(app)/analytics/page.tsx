import { PageHeader } from "@/components/app/page-header";
import { AnalyticsContent } from "@/components/analytics/analytics-content";

export default function AnalyticsPage() {
  return (
    <>
      <PageHeader
        title="Analytics"
        description="Rates, utilization, revenue, and client profitability."
      />
      <AnalyticsContent />
    </>
  );
}
