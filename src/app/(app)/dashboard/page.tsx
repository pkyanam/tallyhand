import { PageHeader } from "@/components/app/page-header";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function DashboardPage() {
  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Your week at a glance. Stage 1 wires in real data."
      />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Hours this week" value="—" />
        <StatCard label="Unbilled amount" value="—" />
        <StatCard label="Active clients" value="—" />
        <StatCard label="Open invoices" value="—" />
      </div>
      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Recent activity</CardTitle>
          <CardDescription>
            Your most recent tracked time and expenses will show up here.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Nothing tracked yet. Start the timer to log your first task.
        </CardContent>
      </Card>
    </>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-2xl tabular-nums">{value}</CardTitle>
      </CardHeader>
    </Card>
  );
}
