/**
 * tally — CLI for Tallyhand.
 * Human-friendly tables by default, `--json` for scripts and agents.
 * `tally mcp` launches the MCP server over stdio.
 */
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
  handleProjectsList,
  handleProjectsCreate,
  handleUnbilled,
  handleInvoiceDraft,
  handleInvoiceList,
  handleInvoiceShow,
  handleRecurringList,
  handleRecurringCreate,
  handleRecurringRun,
  handleRetainerList,
  handleRetainerCreate,
  handleExpenseAdd,
  handleExport,
  handleDoctor,
} from "./commands.js";
import { runMcpServer } from "./mcp.js";
/* ------------------------------------------------------------------ */
/* program                                                             */
/* ------------------------------------------------------------------ */

function ctx(cmd: Command): { api: TallyhandClient; out: Out } {
  const g = cmd.optsWithGlobals();
  const cfg = resolveConfig({ apiUrl: g.apiUrl, token: g.token });
  return { api: new TallyhandClient(cfg), out: { json: !!g.json } };
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
    .option("--json", "machine-readable JSON output");

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
    .action(wrap(async (cmd, opts) => {
      const { api, out } = ctx(cmd);
      await handleInvoiceDraft(api, opts, out);
    }));
  invoice
    .command("list")
    .description("List invoices")
    .option("--status <draft|sent|paid>", "filter by status")
    .option("--client <id>", "filter by client")
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
    .command("send")
    .description("Mark an invoice sent")
    .argument("<id>", "invoice id")
    .action(wrap(async (cmd, id) => {
      const { api, out } = ctx(cmd);
      needAuth(api);
      const inv = await api.sendInvoice(id);
      emit(out.json, inv, () => console.log(`Invoice ${inv.invoiceNumber ?? id} sent.`));
    }));
  invoice
    .command("paid")
    .description("Mark an invoice paid")
    .argument("<id>", "invoice id")
    .action(wrap(async (cmd, id) => {
      const { api, out } = ctx(cmd);
      needAuth(api);
      const inv = await api.markInvoicePaid(id);
      emit(out.json, inv, () => console.log(`Invoice ${inv.invoiceNumber ?? id} marked paid.`));
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
    .description("Create a recurring schedule")
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
    .action(wrap(async (cmd, opts) => {
      const { api, out } = ctx(cmd);
      await handleRecurringRun(api, opts, out);
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
    .action(wrap(async (cmd) => {
      const { api } = ctx(cmd);
      await handleDoctor(api);
    }));

  program
    .command("mcp")
    .description("Start the MCP server over stdio (for AI agents)")
    .action(wrap(async (cmd) => {
      const { api } = ctx(cmd);
      await runMcpServer(api);
    }));

  return program;
}

const entry = process.argv[1] ?? "";
if (entry.endsWith("/dist/cli.js") || entry.endsWith("dist\\cli.js") || entry.endsWith("/src/cli.ts")) {
  buildProgram().parseAsync(process.argv).catch(fail);
}
