/**
 * tally — CLI for Tallyhand.
 * Human-friendly tables by default, `--json` for scripts and agents.
 * `tally mcp` launches the MCP server over stdio.
 */
import { readFileSync, writeFileSync, statSync } from "node:fs";
import { Command } from "commander";
import {
  TallyhandClient,
  resolveConfig,
  readFileConfig,
  writeFileConfig,
  CONFIG_PATH,
} from "./client.js";
import { emit } from "./format.js";
import {
  VERSION,
  type Out,
  fail,
  needAuth,
  handleTimerStart,
  handleTimerStop,
  handleTimerStatus,
  handleLog,
  handleClientsList,
  handleClientsCreate,
  handleClientShow,
  handleClientUpdate,
  handleClientDelete,
  handleProjectsList,
  handleProjectsCreate,
  handleProjectShow,
  handleProjectUpdate,
  handleProjectDelete,
  handleTasksList,
  handleTasksBulk,
  handleTaskShow,
  handleTaskUpdate,
  handleTaskDelete,
  handleUnbilled,
  handleInvoiceDraft,
  handleInvoiceList,
  handleInvoiceShow,
  handleInvoiceUpdate,
  handleInvoiceDelete,
  handleRecurringList,
  handleRecurringCreate,
  handleRecurringShow,
  handleRecurringUpdate,
  handleRecurringDelete,
  handleRecurringRun,
  handleRetainerList,
  handleRetainerCreate,
  handleRetainerShow,
  handleRetainerUpdate,
  handleRetainerDelete,
  handleExpenseAdd,
  handleExpensesList,
  handleExpensesBulk,
  handleExpenseShow,
  handleExpenseUpdate,
  handleExpenseDelete,
  handleSettingsShow,
  handleSettingsSet,
  handleReportRevenue,
  handleExport,
  handleDoctor,
} from "./commands.js";
import { registerExtensionCommands } from "./extension-commands.js";
import { runMcpServer } from "./mcp.js";
/* ------------------------------------------------------------------ */
/* program                                                             */
/* ------------------------------------------------------------------ */

function ctx(cmd: Command): { api: TallyhandClient; out: Out } {
  const g = cmd.optsWithGlobals();
  const cfg = resolveConfig({ apiUrl: g.apiUrl, token: g.token });
  return { api: new TallyhandClient({ ...cfg, timing: !!g.timing }), out: { json: !!g.json } };
}

const wrap =
  (fn: (...args: any[]) => Promise<void>) =>
  (...args: any[]): Promise<void> => {
    const cmd = args[args.length - 1] as Command;
    return fn(cmd, ...args.slice(0, -1)).catch(fail);
  };

export function buildProgram(): Command {
  const program = new Command();
  program
    .name("tally")
    .description("Tallyhand CLI — time tracking and invoicing from the terminal.")
    .version(VERSION)
    .option("--api-url <url>", "Tallyhand server URL (default http://localhost:3000)")
    .option("--token <token>", "API token")
    .option("--json", "machine-readable JSON output")
    .option("--timing", "write request timings to stderr (never prints credentials)");

  const timer = program.command("timer").description("Run a live timer");
  timer
    .command("start")
    .description("Start a timer on a project")
    .requiredOption("--project <id>", "project id")
    .option("--note <text>", "entry name/note")
    .option("--tags <a,b>", "comma-separated tags")
    .action(wrap(async (cmd, opts) => {
      const { api, out } = ctx(cmd);
      await handleTimerStart(api, opts, out);
    }));
  timer
    .command("stop")
    .description("Stop the running timer")
    .option("--id <id>", "stop a specific timer when several run")
    .option("--note <text>", "note to attach")
    .action(wrap(async (cmd, opts) => {
      const { api, out } = ctx(cmd);
      await handleTimerStop(api, opts, out);
    }));
  timer
    .command("status")
    .description("Show the running timer")
    .action(wrap(async (cmd) => {
      const { api, out } = ctx(cmd);
      await handleTimerStatus(api, out);
    }));

  program
    .command("log")
    .description("Log a completed time entry")
    .requiredOption("--project <id>", "project id")
    .requiredOption("--minutes <n>", "duration in minutes")
    .option("--date <YYYY-MM-DD>", "day of the entry (default today)")
    .option("--note <text>", "entry name/note")
    .option("--tags <a,b>", "comma-separated tags")
    .action(wrap(async (cmd, opts) => {
      const { api, out } = ctx(cmd);
      await handleLog(api, opts, out);
    }));

  const clients = program.command("clients").description("Manage clients");
  clients
    .command("list")
    .description("List clients")
    .option("--archived", "include archived clients")
    .action(wrap(async (cmd, opts) => {
      const { api, out } = ctx(cmd);
      await handleClientsList(api, opts, out);
    }));
  clients
    .command("create")
    .description("Create a client")
    .requiredOption("--name <name>", "client name")
    .option("--email <email>", "contact email")
    .option("--rate <dollars>", "default hourly rate")
    .action(wrap(async (cmd, opts) => {
      const { api, out } = ctx(cmd);
      await handleClientsCreate(api, opts, out);
    }));
  clients
    .command("show")
    .description("Show one client")
    .argument("<id>", "client id")
    .action(wrap(async (cmd, id) => {
      const { api, out } = ctx(cmd);
      await handleClientShow(api, id, out);
    }));
  clients
    .command("update")
    .description("Update a client")
    .argument("<id>", "client id")
    .option("--name <name>", "new name")
    .option("--email <email>", "contact email")
    .option("--rate <dollars>", "default hourly rate")
    .option("--notes <text>", "notes")
    .option("--archived", "archive the client")
    .option("--no-archived", "unarchive the client")
    .action(wrap(async (cmd, id, opts) => {
      const { api, out } = ctx(cmd);
      await handleClientUpdate(api, { id, ...opts }, out);
    }));
  clients
    .command("delete")
    .description("Delete a client (refused when projects/invoices exist)")
    .argument("<id>", "client id")
    .option("--dry-run", "show what would be deleted without deleting")
    .action(wrap(async (cmd, id, opts) => {
      const { api, out } = ctx(cmd);
      await handleClientDelete(api, { id, dryRun: opts.dryRun }, out);
    }));

  const projects = program.command("projects").description("Manage projects");
  projects
    .command("list")
    .description("List projects")
    .option("--client <id>", "filter by client")
    .action(wrap(async (cmd, opts) => {
      const { api, out } = ctx(cmd);
      await handleProjectsList(api, opts, out);
    }));
  projects
    .command("create")
    .description("Create a project")
    .requiredOption("--client <id>", "client id")
    .requiredOption("--name <name>", "project name")
    .option("--rate <dollars>", "hourly rate override")
    .action(wrap(async (cmd, opts) => {
      const { api, out } = ctx(cmd);
      await handleProjectsCreate(api, opts, out);
    }));
  projects
    .command("show")
    .description("Show one project")
    .argument("<id>", "project id")
    .action(wrap(async (cmd, id) => {
      const { api, out } = ctx(cmd);
      await handleProjectShow(api, id, out);
    }));
  projects
    .command("update")
    .description("Update a project")
    .argument("<id>", "project id")
    .option("--name <name>", "new name")
    .option("--client <id>", "move to another client")
    .option("--rate <dollars>", "hourly rate override")
    .option("--archived", "archive the project")
    .option("--no-archived", "unarchive the project")
    .action(wrap(async (cmd, id, opts) => {
      const { api, out } = ctx(cmd);
      await handleProjectUpdate(api, { id, ...opts }, out);
    }));
  projects
    .command("delete")
    .description("Delete a project (refused when tasks/expenses exist)")
    .argument("<id>", "project id")
    .option("--dry-run", "show what would be deleted without deleting")
    .action(wrap(async (cmd, id, opts) => {
      const { api, out } = ctx(cmd);
      await handleProjectDelete(api, { id, dryRun: opts.dryRun }, out);
    }));

  const tasks = program.command("tasks").description("Manage time entries");
  tasks
    .command("list")
    .description("List time entries")
    .option("--project <id>", "filter by project")
    .option("--client <id>", "filter by client")
    .option("--billed", "only billed entries")
    .option("--unbilled", "only unbilled entries")
    .option("--from <YYYY-MM-DD>", "entries on/after this day")
    .option("--to <YYYY-MM-DD>", "entries on/before this day")
    .action(wrap(async (cmd, opts) => {
      const { api, out } = ctx(cmd);
      await handleTasksList(api, opts, out);
    }));
  tasks
    .command("show")
    .description("Show one time entry")
    .argument("<id>", "task id")
    .action(wrap(async (cmd, id) => {
      const { api, out } = ctx(cmd);
      await handleTaskShow(api, id, out);
    }));
  tasks
    .command("update")
    .description("Update a time entry")
    .argument("<id>", "task id")
    .option("--minutes <n>", "set duration in minutes")
    .option("--date <YYYY-MM-DD>", "move the entry to this day (keeps duration)")
    .option("--note <text>", "set the note")
    .option("--project <id>", "move to another project")
    .option("--billed", "mark billed")
    .option("--unbilled", "mark unbilled")
    .action(wrap(async (cmd, id, opts) => {
      const { api, out } = ctx(cmd);
      await handleTaskUpdate(api, { id, ...opts }, out);
    }));
  tasks
    .command("delete")
    .description("Delete a time entry (refused when billed)")
    .argument("<id>", "task id")
    .option("--dry-run", "show what would be deleted without deleting")
    .action(wrap(async (cmd, id, opts) => {
      const { api, out } = ctx(cmd);
      await handleTaskDelete(api, { id, dryRun: opts.dryRun }, out);
    }));
  tasks
    .command("bulk")
    .description("Log many time entries at once (validated batch, up to 200)")
    .requiredOption("--items <json>", 'JSON array, e.g. \'[{"projectId":"p1","minutes":60,"date":"2026-09-20","note":"Review"}]\'')
    .action(wrap(async (cmd, opts) => {
      const { api, out } = ctx(cmd);
      await handleTasksBulk(api, opts, out);
    }));

  program
    .command("unbilled")
    .description("Show unbilled work grouped by client/project")
    .option("--client <id>", "filter by client")
    .option("--project <id>", "filter by project")
    .action(wrap(async (cmd, opts) => {
      const { api, out } = ctx(cmd);
      await handleUnbilled(api, opts, out);
    }));

  const invoice = program.command("invoice").description("Draft and manage invoices");
  invoice
    .command("draft")
    .description("Create a draft invoice (nothing is billed until send)")
    .option("--client <id>", "client id (builds from unbilled work)")
    .option("--project <id>", "scope unbilled work to a project")
    .option("--items <json>", 'explicit line items, e.g. \'[{"description":"X","quantity":1,"rate":100}]\'')
    .option("--currency <code>", "ISO currency code, e.g. USD (server falls back to settings)")
    .option("--tax-region <US|EU>", "tax-jurisdiction behavior")
    .option("--tax-rate <pct>", "per-line tax rate 0–100 applied to lines without one")
    .option("--payment-method <text>", "payment method text, e.g. \"Bank transfer\"")
    .option("--payment-url <url>", "URL the client can pay at")
    .option("--qr", "render a payment QR code on the PDF")
    .option("--qr-description <text>", "text shown under the payment QR code")
    .option("--amount-in-words", "print the total amount in words on the PDF")
    .option("--template <default|stripe>", "PDF template variant")
    .option("--invoice-type <label>", 'document type label, e.g. "Proforma invoice"')
    .action(wrap(async (cmd, opts) => {
      const { api, out } = ctx(cmd);
      await handleInvoiceDraft(api, opts, out);
    }));
  invoice
    .command("list")
    .description("List invoices")
    .option("--status <draft|sent|paid>", "filter by status")
    .option("--client <id>", "filter by client")
    .option("--overdue", "only sent invoices past their due date")
    .action(wrap(async (cmd, opts) => {
      const { api, out } = ctx(cmd);
      await handleInvoiceList(api, opts, out);
    }));
  invoice
    .command("show")
    .description("Show an invoice with line items")
    .argument("<id>", "invoice id")
    .action(wrap(async (cmd, id) => {
      const { api, out } = ctx(cmd);
      await handleInvoiceShow(api, id, out);
    }));
  invoice
    .command("update")
    .description("Update a draft invoice (notes, due date, number, localization, payment)")
    .argument("<id>", "invoice id")
    .option("--notes <text>", "notes")
    .option("--due-date <YYYY-MM-DD>", "due date")
    .option("--number <n>", "invoice number")
    .option("--currency <code>", "ISO currency code, e.g. USD")
    .option("--tax-region <US|EU>", "tax-jurisdiction behavior")
    .option("--payment-method <text>", "payment method text")
    .option("--payment-url <url>", "URL the client can pay at")
    .option("--qr", "render a payment QR code on the PDF")
    .option("--qr-description <text>", "text shown under the payment QR code")
    .option("--amount-in-words", "print the total amount in words on the PDF")
    .option("--template <default|stripe>", "PDF template variant")
    .option("--invoice-type <label>", "document type label")
    .action(wrap(async (cmd, id, opts) => {
      const { api, out } = ctx(cmd);
      await handleInvoiceUpdate(api, { id, ...opts }, out);
    }));
  invoice
    .command("delete")
    .description("Delete a draft invoice (refused once sent/paid)")
    .argument("<id>", "invoice id")
    .option("--dry-run", "show what would be deleted without deleting")
    .action(wrap(async (cmd, id, opts) => {
      const { api, out } = ctx(cmd);
      await handleInvoiceDelete(api, { id, dryRun: opts.dryRun }, out);
    }));
  invoice
    .command("send")
    .description("Mark an invoice sent (marks source tasks/expenses billed)")
    .argument("<id>", "invoice id")
    .option("--dry-run", "preview the billed-marking without mutating")
    .action(wrap(async (cmd, id, opts) => {
      const { api, out } = ctx(cmd);
      needAuth(api);
      const inv = await api.sendInvoice(id, { dryRun: opts.dryRun });
      emit(out.json, inv, () => {
        if (inv?.dryRun) {
          const n = inv.wouldMarkBilled.taskIds.length + inv.wouldMarkBilled.expenseIds.length;
          console.log(`Dry run — would send invoice ${inv.invoiceNumber} and mark ${n} source item(s) billed.`);
        } else {
          console.log(`Invoice ${inv.invoiceNumber ?? id} sent.`);
        }
      });
    }));
  invoice
    .command("paid")
    .description("Mark an invoice paid")
    .argument("<id>", "invoice id")
    .option("--dry-run", "preview without mutating")
    .action(wrap(async (cmd, id, opts) => {
      const { api, out } = ctx(cmd);
      needAuth(api);
      const inv = await api.markInvoicePaid(id, { dryRun: opts.dryRun });
      emit(out.json, inv, () => {
        if (inv?.dryRun) console.log(`Dry run — would mark invoice ${inv.invoiceNumber} paid.`);
        else console.log(`Invoice ${inv.invoiceNumber ?? id} marked paid.`);
      });
    }));

  const recurring = program.command("recurring").description("Recurring invoice schedules");
  recurring
    .command("list")
    .description("List schedules")
    .option("--status <status>", "filter by status (active|paused|ended)")
    .action(wrap(async (cmd, opts) => {
      const { api, out } = ctx(cmd);
      await handleRecurringList(api, opts, out);
    }));
  recurring
    .command("create")
    .description("Create a recurring draft schedule")
    .option("--dry-run", "validate without creating a schedule")
    .requiredOption("--client <id>", "client id")
    .requiredOption("--name <name>", "schedule name")
    .requiredOption("--frequency <weekly|monthly|quarterly|yearly>", "how often")
    .option("--interval <n>", "every N periods (default 1)")
    .option("--mode <fixed|unbilled>", "fixed line items or bill unbilled work (default fixed)")
    .option("--project <id>", "project scope")
    .option("--line-items <json>", 'fixed-mode items, e.g. \'[{"description":"Retainer","quantity":1,"rate":2000}]\'')
    .option("--start <YYYY-MM-DD>", "first run date (default today)")
    .option("--ends-after <n>", "stop after N occurrences")
    .action(wrap(async (cmd, opts) => {
      const { api, out } = ctx(cmd);
      await handleRecurringCreate(api, opts, out);
    }));
  recurring
    .command("run")
    .description("Run due schedules now (or one schedule with --id)")
    .option("--id <scheduleId>", "run a single schedule")
    .option("--dry-run", "preview due schedules without creating invoices")
    .action(wrap(async (cmd, opts) => {
      const { api, out } = ctx(cmd);
      await handleRecurringRun(api, opts, out);
    }));
  recurring
    .command("show")
    .description("Show one schedule")
    .argument("<id>", "schedule id")
    .action(wrap(async (cmd, id) => {
      const { api, out } = ctx(cmd);
      await handleRecurringShow(api, id, out);
    }));
  recurring
    .command("update")
    .description("Update a schedule (name, status, notes)")
    .argument("<id>", "schedule id")
    .option("--name <name>", "new name")
    .option("--status <active|paused|ended>", "new status")
    .option("--notes <text>", "notes")
    .action(wrap(async (cmd, id, opts) => {
      const { api, out } = ctx(cmd);
      await handleRecurringUpdate(api, { id, ...opts }, out);
    }));
  recurring
    .command("delete")
    .description("Delete a schedule")
    .argument("<id>", "schedule id")
    .option("--dry-run", "show what would be deleted without deleting")
    .action(wrap(async (cmd, id, opts) => {
      const { api, out } = ctx(cmd);
      await handleRecurringDelete(api, { id, dryRun: opts.dryRun }, out);
    }));

  const retainer = program.command("retainer").description("Client retainers");
  retainer
    .command("list")
    .description("List retainers")
    .option("--client <id>", "filter by client")
    .action(wrap(async (cmd, opts) => {
      const { api, out } = ctx(cmd);
      await handleRetainerList(api, opts, out);
    }));
  retainer
    .command("create")
    .description("Create a retainer")
    .requiredOption("--client <id>", "client id")
    .requiredOption("--name <name>", "retainer name")
    .requiredOption("--type <prepaid-hours|monthly-fee>", "retainer type")
    .option("--hours <n>", "total prepaid hours")
    .option("--amount-cents <n>", "amount in cents (e.g. 600000 = $6,000)")
    .option("--start <YYYY-MM-DD>", "start date (default today)")
    .action(wrap(async (cmd, opts) => {
      const { api, out } = ctx(cmd);
      await handleRetainerCreate(api, opts, out);
    }));
  retainer
    .command("show")
    .description("Show one retainer")
    .argument("<id>", "retainer id")
    .action(wrap(async (cmd, id) => {
      const { api, out } = ctx(cmd);
      await handleRetainerShow(api, id, out);
    }));
  retainer
    .command("update")
    .description("Update a retainer (name, status, notes)")
    .argument("<id>", "retainer id")
    .option("--name <name>", "new name")
    .option("--status <active|paused|depleted|ended>", "new status")
    .option("--notes <text>", "notes")
    .action(wrap(async (cmd, id, opts) => {
      const { api, out } = ctx(cmd);
      await handleRetainerUpdate(api, { id, ...opts }, out);
    }));
  retainer
    .command("delete")
    .description("Delete a retainer")
    .argument("<id>", "retainer id")
    .option("--dry-run", "show what would be deleted without deleting")
    .action(wrap(async (cmd, id, opts) => {
      const { api, out } = ctx(cmd);
      await handleRetainerDelete(api, { id, dryRun: opts.dryRun }, out);
    }));

  const expense = program.command("expense").description("Track expenses");
  expense
    .command("add")
    .description("Log an expense")
    .requiredOption("--amount <dollars>", "amount in dollars")
    .requiredOption("--category <category>", "expense category")
    .option("--client <id>", "client id")
    .option("--project <id>", "project id")
    .option("--date <YYYY-MM-DD>", "expense date (default today)")
    .option("--note <text>", "note")
    .action(wrap(async (cmd, opts) => {
      const { api, out } = ctx(cmd);
      await handleExpenseAdd(api, opts, out);
    }));
  expense
    .command("list")
    .description("List expenses")
    .option("--client <id>", "filter by client")
    .option("--project <id>", "filter by project")
    .option("--category <category>", "filter by category")
    .option("--billed", "only billed expenses")
    .option("--unbilled", "only unbilled expenses")
    .option("--from <YYYY-MM-DD>", "expenses on/after this day")
    .option("--to <YYYY-MM-DD>", "expenses on/before this day")
    .action(wrap(async (cmd, opts) => {
      const { api, out } = ctx(cmd);
      await handleExpensesList(api, opts, out);
    }));
  expense
    .command("show")
    .description("Show one expense")
    .argument("<id>", "expense id")
    .action(wrap(async (cmd, id) => {
      const { api, out } = ctx(cmd);
      await handleExpenseShow(api, id, out);
    }));
  expense
    .command("update")
    .description("Update an expense")
    .argument("<id>", "expense id")
    .option("--amount <dollars>", "new amount")
    .option("--category <category>", "new category")
    .option("--note <text>", "note")
    .option("--date <YYYY-MM-DD>", "expense date")
    .option("--client <id>", "client id")
    .option("--project <id>", "project id")
    .action(wrap(async (cmd, id, opts) => {
      const { api, out } = ctx(cmd);
      await handleExpenseUpdate(api, { id, ...opts }, out);
    }));
  expense
    .command("delete")
    .description("Delete an expense (refused when billed)")
    .argument("<id>", "expense id")
    .option("--dry-run", "show what would be deleted without deleting")
    .action(wrap(async (cmd, id, opts) => {
      const { api, out } = ctx(cmd);
      await handleExpenseDelete(api, { id, dryRun: opts.dryRun }, out);
    }));
  expense
    .command("bulk")
    .description("Log many expenses at once (validated batch, up to 200)")
    .requiredOption("--items <json>", 'JSON array, e.g. \'[{"amount":42.5,"category":"travel","date":"2026-09-20"}]\'')
    .action(wrap(async (cmd, opts) => {
      const { api, out } = ctx(cmd);
      await handleExpensesBulk(api, opts, out);
    }));

  const settings = program.command("settings").description("Server settings");
  settings
    .command("show")
    .description("Show server settings")
    .action(wrap(async (cmd) => {
      const { api, out } = ctx(cmd);
      await handleSettingsShow(api, out);
    }));
  settings
    .command("set")
    .description("Patch server settings with a JSON object")
    .option("--dry-run", "validate without saving changes")
    .requiredOption("--patch <json>", "e.g. '{\"invoice\":{\"paymentTermsDays\":30}}'")
    .action(wrap(async (cmd, opts) => {
      const { api, out } = ctx(cmd);
      await handleSettingsSet(api, opts, out);
    }));

  const report = program.command("report").description("Summaries and reports");
  report
    .command("revenue")
    .description("Monthly revenue summary (paid invoices issued that month)")
    .requiredOption("--month <YYYY-MM>", "month, e.g. 2026-09")
    .option("--client <id>", "scope to one client")
    .action(wrap(async (cmd, opts) => {
      const { api, out } = ctx(cmd);
      await handleReportRevenue(api, opts, out);
    }));

  program
    .command("export")
    .description("Export entities as JSON or CSV")
    .requiredOption("--entity <clients|projects|tasks|expenses|invoices|all>", "what to export")
    .option("--format <json|csv>", "output format (default json)")
    .option("--out <file>", "write to file instead of stdout")
    .action(wrap(async (cmd, opts) => {
      const { api } = ctx(cmd);
      await handleExport(api, opts, { json: true });
    }));

  const data = program.command("data").description("Atomic cloud backup/import/reset (Convex; affects only your account)");
  data.command("export").requiredOption("--out <path>", "new backup file; existing files are never overwritten")
    .action(wrap(async (cmd, opts) => {
      const { api, out } = ctx(cmd); needAuth(api);
      const backup = await api.backup();
      writeFileSync(opts.out, JSON.stringify(backup.bundle, null, 2) + "\n", { flag: "wx", mode: 0o600 });
      emit(out.json, { saved: opts.out, revision: backup.revision }, () => console.log(`Backup saved to ${opts.out}`));
    }));
  data.command("import").requiredOption("--file <path>", "tallyhand.v1 backup (up to 4 MiB and 2,000 records)")
    .requiredOption("--backup-out <path>", "save current cloud data to a NEW file before replacing")
    .requiredOption("--confirm <phrase>", "must be REPLACE CLOUD DATA; replaces data/settings and revokes shares")
    .action(wrap(async (cmd, opts) => {
      if (opts.confirm !== "REPLACE CLOUD DATA") throw new Error("Required confirmation: REPLACE CLOUD DATA");
      if (statSync(opts.file).size > 4 * 1024 * 1024) throw new Error("Backup exceeds 4 MiB; nothing changed.");
      const bundle = JSON.parse(readFileSync(opts.file, "utf8"));
      const { api, out } = ctx(cmd); needAuth(api);
      const current = await api.backup();
      writeFileSync(opts.backupOut, JSON.stringify(current.bundle, null, 2) + "\n", { flag: "wx", mode: 0o600 });
      const result = await api.replaceData({ action: "import", expectedRevision: current.revision, confirmation: opts.confirm, bundle });
      emit(out.json, result, () => console.log("Cloud import complete; previous data saved in " + opts.backupOut));
    }));
  data.command("reset").requiredOption("--backup-out <path>", "save current cloud data to a NEW file before resetting")
    .requiredOption("--confirm <phrase>", "must be RESET CLOUD DATA; keeps login and API tokens")
    .action(wrap(async (cmd, opts) => {
      if (opts.confirm !== "RESET CLOUD DATA") throw new Error("Required confirmation: RESET CLOUD DATA");
      const { api, out } = ctx(cmd); needAuth(api);
      const current = await api.backup();
      writeFileSync(opts.backupOut, JSON.stringify(current.bundle, null, 2) + "\n", { flag: "wx", mode: 0o600 });
      const result = await api.replaceData({ action: "reset", expectedRevision: current.revision, confirmation: opts.confirm });
      emit(out.json, result, () => console.log("Cloud reset complete; previous data saved in " + opts.backupOut));
    }));

  program.command("login").description("Save a personal API key using hidden terminal input")
    .action(wrap(async () => { const { login } = await import("./login.js"); await login(); }));

  program.command("setup-check").description("Verify public setup docs, installer, and OAuth discovery")
    .action(wrap(async (cmd) => { const { checkSetup } = await import("./setup-check.js"); await checkSetup(resolveConfig({ apiUrl: cmd.optsWithGlobals().apiUrl }).baseUrl); }));

  const config = program.command("config").description("Manage CLI config");
  config
    .command("set")
    .description("Set a config key (api-url | token)")
    .argument("<key>", "api-url or token")
    .argument("<value>", "value")
    .action((key: string, value: string) => {
      if (key !== "api-url" && key !== "token") {
        console.error('Error: key must be "api-url" or "token".');
        process.exit(1);
      }
      writeFileConfig(key === "api-url" ? { apiUrl: value } : { token: value });
      if (key === "token")
        console.error(
          `Warning: the token is stored in plaintext at ${CONFIG_PATH}.`,
        );
      console.log(`Set ${key}.`);
    });
  config
    .command("show")
    .description("Show current config (token masked)")
    .action(() => {
      const file = readFileConfig();
      const envUrl = process.env.TALLYHAND_API_URL;
      const envToken = process.env.TALLYHAND_API_TOKEN;
      const mask = (t?: string) =>
        t ? `****${t.slice(-4)}` : "(not set)";
      console.log(`api-url: ${envUrl ?? file.apiUrl ?? "http://localhost:3000 (default)"}`);
      console.log(`token:   ${envToken ? mask(envToken) + " (env)" : mask(file.token) + (file.token ? " (file)" : "")}`);
      console.log(`file:    ${CONFIG_PATH}`);
    });

  program
    .command("doctor")
    .description("Check server reachability and auth")
    .option("--benchmark", "time five read-only settings requests")
    .action(wrap(async (cmd, opts) => {
      const { api } = ctx(cmd);
      await handleDoctor(api, opts);
    }));

  const mcp = program
    .command("mcp")
    .description("Start the MCP server over stdio (for AI agents)")
    .action(wrap(async (cmd) => {
      const { api } = ctx(cmd);
      await runMcpServer(api);
    }));

  mcp.command("check").description("Read-only MCP protocol and feature verification")
    .option("--transport <http|stdio>", "transport to verify", "http")
    .option("--protocol <modern|legacy>", "wire protocol era", "modern")
    .option("--workspace", "also verify authenticated workspace resources and prompts")
    .action(wrap(async (cmd, opts) => {
      if (!["http", "stdio"].includes(opts.transport) || !["modern", "legacy"].includes(opts.protocol)) throw new Error("Invalid transport or protocol");
      const { checkMcp } = await import("./mcp-check.js");
      const g = cmd.optsWithGlobals();
      await checkMcp(resolveConfig({ apiUrl: g.apiUrl, token: g.token }), opts);
    }));
  mcp.command("oauth-check").description("Verify read-only OAuth consent without saving tokens")
    .action(wrap(async (cmd) => {
      const { checkOAuth } = await import("./oauth-check.js");
      await checkOAuth(resolveConfig({ apiUrl: cmd.optsWithGlobals().apiUrl }).baseUrl);
    }));
  registerExtensionCommands(program);
  return program;
}

/**
 * Decide whether this module was launched as the CLI entry point.
 *
 * Classic `node dist/cli.js` / `tsx src/cli.ts`: argv[1] is the script path.
 * Single-file binaries (`bun build --compile`, Node SEA, pkg): argv[0] is the
 * binary itself and argv[1] is already the first user argument (a flag, a
 * subcommand, or empty) — never a script path. Without the second branch a
 * packaged binary would exit silently having run nothing.
 */
export function shouldAutoRun(argv1: string | undefined): boolean {
  const entry = argv1 ?? "";
  const launchedAsScript =
    entry.endsWith("/dist/cli.js") ||
    entry.endsWith("dist\\cli.js") ||
    entry.endsWith("/src/cli.ts");
  const launchedAsBinary = !/\.[cm]?[jt]s$/i.test(entry);
  return launchedAsScript || launchedAsBinary;
}

if (shouldAutoRun(process.argv[1])) {
  buildProgram().parseAsync(process.argv).catch(fail);
}
