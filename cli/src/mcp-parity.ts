/** Public business-feature contract. Local credential/process controls stay local. */
export const CLI_MCP_PARITY: Record<string, string> = {
  "timer start": "timer_start", "timer stop": "timer_stop", "timer status": "timer_status", log: "log_time", unbilled: "list_unbilled",
  "clients list": "list_clients", "clients create": "create_client", "clients show": "get_client", "clients update": "update_client", "clients delete": "delete_client",
  "projects list": "list_projects", "projects create": "create_project", "projects show": "get_project", "projects update": "update_project", "projects delete": "delete_project",
  "tasks list": "list_tasks", "tasks show": "get_task", "tasks update": "update_task", "tasks delete": "delete_task", "tasks bulk": "bulk_log_time",
  "invoice draft": "create_invoice_draft", "invoice list": "list_invoices", "invoice show": "get_invoice", "invoice update": "update_invoice", "invoice delete": "delete_invoice", "invoice send": "send_invoice", "invoice paid": "mark_invoice_paid",
  "recurring list": "list_recurring_schedules", "recurring create": "create_recurring_schedule", "recurring show": "get_recurring_schedule", "recurring update": "update_recurring_schedule", "recurring delete": "delete_recurring_schedule", "recurring run": "run_recurring_schedules",
  "retainer list": "list_retainers", "retainer create": "create_retainer", "retainer show": "get_retainer", "retainer update": "update_retainer", "retainer delete": "delete_retainer",
  "expense add": "log_expense", "expense list": "list_expenses", "expense show": "get_expense", "expense update": "update_expense", "expense delete": "delete_expense", "expense bulk": "bulk_log_expenses",
  "settings show": "get_settings", "settings set": "update_settings", "report revenue": "revenue_summary", export: "export_data",
  "data export": "export_workspace_backup", "data import": "import_workspace", "data reset": "reset_workspace",
};
export const LOCAL_ONLY_COMMANDS = ["setup-check", "login", "config set", "config show", "doctor", "mcp", "mcp check", "mcp oauth-check"];
