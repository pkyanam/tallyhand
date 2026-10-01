/** CLI adapters for the expanded workspace controls. Same schemas and API as MCP. */
import type { Command } from "commander";
import { TallyhandClient, resolveConfig } from "./client.js";
import { extensionEntityNames, extensionModels } from "./extension-models.js";
import { fail } from "./commands.js";
const parse = (s: string) => { try { return JSON.parse(s); } catch { throw new Error("Expected valid JSON"); } };
export function registerExtensionCommands(program: Command) {
  function action(cmd: Command, fn: (api: TallyhandClient, options: any, args: any[]) => Promise<unknown>) {
    cmd.action(async (...args: any[]) => {
      const command = args[args.length - 1] as Command;
      const options = command.optsWithGlobals();
      try {
        const cfg = resolveConfig({ apiUrl: options.apiUrl, token: options.token });
        if (!cfg.token) throw new Error("Sign in with tally login first");
        console.log(JSON.stringify(await fn(new TallyhandClient({ ...cfg, timing: !!options.timing }), options, args), null, options.json ? undefined : 2));
      } catch (error) { fail(error); }
    });
  }
  for (const entity of extensionEntityNames) {
    const group = program.command(entity).description(extensionModels[entity].description);
    action(group.command("list").option("--limit <n>", "page size", "50").option("--cursor <cursor>").option("--client <id>").option("--project <id>").option("--include-archived"), (api, o) => api.extensionList(entity, { limit: Number(o.limit), cursor: o.cursor, clientId: o.client, projectId: o.project, includeArchived: o.includeArchived }));
    action(group.command("show <id>"), (api, _, a) => api.extensionGet(entity, a[0]));
    action(group.command("create").requiredOption("--input <json>"), (api, o) => api.extensionCreate(entity, extensionModels[entity].schema.parse(parse(o.input))));
    action(group.command("update <id>").requiredOption("--patch <json>"), (api, o, a) => api.extensionUpdate(entity, a[0], extensionModels[entity].schema.partial().parse(parse(o.patch))));
    action(group.command("delete <id>").option("--confirm", "perform deletion; otherwise preview"), (api, o, a) => api.extensionDelete(entity, a[0], !o.confirm));
    action(group.command("bulk").requiredOption("--items <json>"), (api, o) => { const items = parse(o.items); if (!Array.isArray(items) || items.length < 1 || items.length > 200) throw new Error("Provide 1–200 items"); return api.extensionBulk(entity, items.map(i => extensionModels[entity].schema.parse(i))); });
  }
  action(program.command("profile"), api => api.profile());
  action(program.command("capabilities"), api => api.capabilities());
  action(program.command("control <name>"), (api, _, a) => api.controlLink(a[0]));
  const share = program.command("share");
  action(share.command("list"), api => api.listShares());
  action(share.command("create").requiredOption("--input <json>").option("--confirm-public-sharing", "approve public access to this target"), (api, o) => { if (!o.confirmPublicSharing) throw new Error("Requires --confirm-public-sharing after approving the target and audience"); return api.createShare({ ...parse(o.input), confirmPublicSharing: true }); });
  action(share.command("revoke <id>").option("--confirm"), (api, o, a) => { if (!o.confirm) throw new Error("Requires --confirm to revoke access"); return api.revokeShare(a[0]); });
  action(share.command("approvals <id>"), (api, _, a) => api.shareApprovals(a[0]));
  const reminders = program.command("reminders");
  action(reminders.command("preview").option("--invoice-ids <json>"), (api, o) => api.dunning({ dryRun: true, invoiceIds: o.invoiceIds ? parse(o.invoiceIds) : undefined }));
  action(reminders.command("run").requiredOption("--invoice-ids <json>").option("--confirm"), (api, o) => { const ids = parse(o.invoiceIds); if (!o.confirm || !Array.isArray(ids) || ids.length === 0 || ids.some(i => typeof i !== "string")) throw new Error("Preview first, then supply invoice IDs and --confirm"); return api.dunning({ dryRun: false, invoiceIds: ids }); });
}
