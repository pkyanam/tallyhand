/** Browser-owned controls stay visible to agents without exposing credentials. */
const CONTROLS = {
  account: { path: "/settings", reason: "Manage your signed-in account in the browser" },
  api_keys: { path: "/settings/connect", reason: "Create or revoke credentials through the secure account UI; never paste credentials into tool arguments" },
  users: { path: "/settings/users", reason: "User and role administration requires an authorized administrator in the browser" },
  payments: { path: "/settings", reason: "Connect a payment account through its secure authorization flow; payment execution is not an agent tool" },
  invoice_pdf: { path: "/invoices", reason: "Prefer get_invoice pdfUrl or authenticated GET /api/v1/invoices/{id}/pdf; browser export is optional" },
  offline_data: { path: "/settings", reason: "Open the browser containing the local data and export a backup; hosted tools cannot read another browser's local storage" },
  install_pwa: { path: "/", reason: "Use your browser's Install/Add to Home Screen control" },
  notifications: { path: "/settings", reason: "Browser notification permissions must be granted on your device" },
} as const;


type Interaction = "agent_browser" | "external_consent" | "device_permission";
const DETAILS: Record<keyof typeof CONTROLS, { interaction: Interaction; permission: string; requiresHumanConsent: boolean; bearerApiAvailable: boolean }> = {
  account: { interaction: "agent_browser", permission: "authenticated session", requiresHumanConsent: false, bearerApiAvailable: false },
  api_keys: { interaction: "agent_browser", permission: "authenticated session; credential creation/revocation controls", requiresHumanConsent: false, bearerApiAvailable: false },
  users: { interaction: "agent_browser", permission: "administrator session", requiresHumanConsent: false, bearerApiAvailable: false },
  payments: { interaction: "external_consent", permission: "payment provider authorization", requiresHumanConsent: true, bearerApiAvailable: false },
  invoice_pdf: { interaction: "agent_browser", permission: "tally:read or authenticated session", requiresHumanConsent: false, bearerApiAvailable: true },
  offline_data: { interaction: "agent_browser", permission: "access to the browser containing the local data", requiresHumanConsent: false, bearerApiAvailable: false },
  install_pwa: { interaction: "device_permission", permission: "browser installation confirmation", requiresHumanConsent: true, bearerApiAvailable: false },
  notifications: { interaction: "device_permission", permission: "device notification consent", requiresHumanConsent: true, bearerApiAvailable: false },
};
export const AGENT_CONTROLS = Object.fromEntries(Object.entries(CONTROLS).map(([key, control]) => [key, {
  ...control, ...DETAILS[key as keyof typeof CONTROLS],
  agentCanNavigate: true,
  instructions: "An authorized agent may operate the browser UI within the user's instructions. Existing roles, session requirements, credential handling, and external consent remain enforced.",
}])) as { [K in keyof typeof CONTROLS]: typeof CONTROLS[K] & typeof DETAILS[K] & { agentCanNavigate: boolean; instructions: string } };
