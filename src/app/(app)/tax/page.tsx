import { PageHeader } from "@/components/app/page-header";
import { TaxContent } from "@/components/tax/tax-content";

export default function TaxPage() {
  return (
    <>
      <PageHeader
        title="Tax"
        description="Sole-proprietor estimates, set-aside tracking, and quarterly payments."
      />
      <TaxContent />
    </>
  );
}
