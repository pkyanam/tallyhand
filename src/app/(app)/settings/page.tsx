import { effectiveAuth } from "@/lib/mode";
import { SettingsContent } from "@/components/settings/settings-content";

export default function SettingsPage() {
  return <SettingsContent authMode={effectiveAuth()} />;
}
