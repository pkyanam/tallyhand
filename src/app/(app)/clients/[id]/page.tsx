import { ClientDetail } from "@/components/clients/client-detail";

export default function ClientDetailPage({
  params,
}: {
  params: { id: string };
}) {
  return <ClientDetail clientId={params.id} />;
}
