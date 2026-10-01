import Link from "next/link";
import { PageHeader } from "@/components/app/page-header";
import { ProjectsContent } from "@/components/projects/projects-content";
import { Button } from "@/components/ui/button";

export default function ProjectsPage() {
  return <>
    <PageHeader title="Projects" description="See your work across clients, start tracking, and find hours ready to bill."
      actions={<Button asChild variant="outline"><Link href="/clients">Manage clients & projects</Link></Button>} />
    <ProjectsContent />
  </>;
}
