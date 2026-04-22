import { PageHeader } from "@/components/app/page-header";
import { Card, CardContent } from "@/components/ui/card";

export default function SettingsPage() {
  return (
    <>
      <PageHeader
        title="Settings"
        description="Business info, invoice defaults, data tools. Wired up across Stages 3–5."
      />
      <Card>
        <CardContent className="p-10 text-center text-sm text-muted-foreground">
          Settings pages fill in as the stages land.
        </CardContent>
      </Card>
    </>
  );
}
