/** Browser-owned controls stay visible to agents without exposing credentials. */
export const AGENT_CONTROLS = {
  account: { path: "/settings", reason: "Manage your signed-in account in the browser" },
  api_keys: { path: "/settings/connect", reason: "Create or revoke credentials through the secure account UI; never paste credentials into tool arguments" },
  users: { path: "/settings/users", reason: "User and role administration requires an authorized administrator in the browser" },
  payments: { path: "/settings", reason: "Connect a payment account through its secure authorization flow; payment execution is not an agent tool" },
  invoice_pdf: { path: "/invoices", reason: "Prefer get_invoice pdfUrl or authenticated GET /api/v1/invoices/{id}/pdf; browser export is optional" },
  offline_data: { path: "/settings", reason: "Open the browser containing the local data and export a backup; hosted tools cannot read another browser's local storage" },
  install_pwa: { path: "/", reason: "Use your browser's Install/Add to Home Screen control" },
  notifications: { path: "/settings", reason: "Browser notification permissions must be granted on your device" },
} as const;
