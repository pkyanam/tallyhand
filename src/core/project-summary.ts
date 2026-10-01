import type { Client, Invoice, Project, Task } from "./entities";

export interface ProjectSummary {
  project: Project;
  client?: Client;
  archived: boolean;
  trackedMinutes: number;
  readyToInvoiceMinutes: number;
  reservedMinutes: number;
  lastActivityAt: number | null;
}

/** Draft invoice lines reserve time too; don't encourage billing it twice. */
export function summarizeProjects(projects: Project[], clients: Client[], tasks: Task[], invoices: Invoice[]): ProjectSummary[] {
  const clientsById = new Map(clients.map((client) => [client.id, client]));
  const reserved = new Set(invoices.flatMap((invoice) => invoice.lineItems
    .filter((line) => line.sourceType === "task" && line.sourceId)
    .map((line) => line.sourceId!)));
  const byProject = new Map<string, Task[]>();
  for (const task of tasks) {
    const rows = byProject.get(task.projectId) ?? [];
    rows.push(task);
    byProject.set(task.projectId, rows);
  }
  return projects.map((project) => {
    const client = clientsById.get(project.clientId);
    let trackedMinutes = 0, readyToInvoiceMinutes = 0, reservedMinutes = 0;
    let lastActivityAt: number | null = null;
    for (const task of byProject.get(project.id) ?? []) {
      if (Number.isFinite(task.startAt)) lastActivityAt = Math.max(lastActivityAt ?? task.startAt, task.startAt);
      if (task.endAt <= 0 || !Number.isFinite(task.durationMinutes) || task.durationMinutes <= 0) continue;
      trackedMinutes += task.durationMinutes;
      if (task.isBilled) continue;
      if (task.invoiceId || reserved.has(task.id)) reservedMinutes += task.durationMinutes;
      else readyToInvoiceMinutes += task.durationMinutes;
    }
    return { project, client, archived: project.archived || client?.archived === true,
      trackedMinutes, readyToInvoiceMinutes, reservedMinutes, lastActivityAt };
  }).sort((a, b) => (b.lastActivityAt ?? 0) - (a.lastActivityAt ?? 0) || a.project.name.localeCompare(b.project.name));
}
