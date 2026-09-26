import type {
  BackgroundJob,
  DomainHookHandler,
  DomainHookName,
  DomainHookPayloads,
  Plugin,
  PluginContext,
  PluginManifest,
  PluginSettingsSection,
  SlotDefinition,
} from "./types";

type AnyHookHandler = (payload: never) => void | Promise<void>;

interface HookEntry {
  pluginName: string;
  handler: AnyHookHandler;
}

interface SlotEntry extends SlotDefinition {
  pluginName: string;
}

interface SettingsEntry extends PluginSettingsSection {
  pluginName: string;
}

interface JobEntry extends BackgroundJob {
  pluginName: string;
}

/**
 * PluginRegistry — owns plugin lifecycle and extension points.
 *
 * - `register(plugin)`: runs `activate(ctx)`; throws on duplicate names or
 *   when `activate` throws (leaving no half-registered state).
 * - `unregister(name)`: runs `deactivate()` and removes everything the
 *   plugin registered (hooks, slots, settings sections, jobs).
 * - `emit(name, payload)`: **@internal** — called by the domain layer
 *   (repos) to notify plugins. Never called by plugins themselves.
 *   A throwing handler is logged and does not break the domain operation.
 */
export class PluginRegistry {
  private plugins = new Map<string, Plugin>();
  private hookHandlers = new Map<DomainHookName, Set<HookEntry>>();
  private slots: SlotEntry[] = [];
  private settingsSections: SettingsEntry[] = [];
  private jobs: JobEntry[] = [];

  register(plugin: Plugin): void {
    const name = plugin.manifest?.name;
    if (!name) {
      throw new Error("Plugin manifest must include a name.");
    }
    if (this.plugins.has(name)) {
      throw new Error(`Plugin "${name}" is already registered.`);
    }
    const ctx = this.createContext(plugin.manifest);
    try {
      const result = plugin.activate(ctx);
      if (result instanceof Promise) {
        result.catch((err: unknown) => {
          // eslint-disable-next-line no-console
          console.error(`[plugins] async activate failed for "${name}":`, err);
        });
      }
    } catch (err) {
      this.removePluginArtifacts(name);
      throw err;
    }
    this.plugins.set(name, plugin);
  }

  unregister(name: string): void {
    const plugin = this.plugins.get(name);
    if (!plugin) return;
    try {
      const result = plugin.deactivate?.();
      if (result instanceof Promise) {
        result.catch((err: unknown) => {
          // eslint-disable-next-line no-console
          console.error(`[plugins] async deactivate failed for "${name}":`, err);
        });
      }
    } finally {
      this.removePluginArtifacts(name);
      this.plugins.delete(name);
    }
  }

  list(): PluginManifest[] {
    return Array.from(this.plugins.values()).map((p) => p.manifest);
  }

  get(name: string): Plugin | undefined {
    return this.plugins.get(name);
  }

  /** @internal domain-layer event dispatch. */
  async emit<K extends DomainHookName>(
    name: K,
    payload: DomainHookPayloads[K],
  ): Promise<void> {
    const entries = this.hookHandlers.get(name);
    if (!entries || entries.size === 0) return;
    for (const entry of Array.from(entries)) {
      try {
        await entry.handler(payload as never);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(
          `[plugins] hook "${name}" handler from "${entry.pluginName}" threw:`,
          err,
        );
      }
    }
  }

  // -- read-only views for host UI ---------------------------------------
  getSlots(slot: string): SlotDefinition[] {
    return this.slots
      .filter((s) => s.slot === slot)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      .map((s) => ({
        slot: s.slot,
        id: s.id,
        component: s.component,
        order: s.order,
      }));
  }

  getSettingsSections(): PluginSettingsSection[] {
    return this.settingsSections.map((s) => ({
      id: s.id,
      title: s.title,
      description: s.description,
      fields: s.fields,
    }));
  }

  getJobs(): BackgroundJob[] {
    return this.jobs.map((j) => ({
      id: j.id,
      run: j.run,
      intervalMs: j.intervalMs,
    }));
  }

  // -- internals ----------------------------------------------------------
  private createContext(manifest: PluginManifest): PluginContext {
    const pluginName = manifest.name;
    const trackHook = <K extends DomainHookName>(
      hookName: K,
      handler: DomainHookHandler<K>,
    ): (() => void) => {
      const entry: HookEntry = {
        pluginName,
        handler: handler as AnyHookHandler,
      };
      let set = this.hookHandlers.get(hookName);
      if (!set) {
        set = new Set();
        this.hookHandlers.set(hookName, set);
      }
      set.add(entry);
      return () => {
        set.delete(entry);
      };
    };

    return {
      manifest,
      hooks: {
        on: (name, handler) => trackHook(name, handler),
      },
      ui: {
        registerSlot: (def) => {
          const entry: SlotEntry = { ...def, pluginName };
          this.slots.push(entry);
          return () => {
            this.slots = this.slots.filter((s) => s !== entry);
          };
        },
        getSlots: (slot) => this.getSlots(slot),
      },
      settings: {
        registerSection: (section) => {
          const entry: SettingsEntry = { ...section, pluginName };
          this.settingsSections.push(entry);
          return () => {
            this.settingsSections = this.settingsSections.filter(
              (s) => s !== entry,
            );
          };
        },
        getSections: () => this.getSettingsSections(),
      },
      jobs: {
        registerJob: (job) => {
          const entry: JobEntry = { ...job, pluginName };
          this.jobs.push(entry);
          return () => {
            this.jobs = this.jobs.filter((j) => j !== entry);
          };
        },
        getJobs: () => this.getJobs(),
      },
    };
  }

  private removePluginArtifacts(pluginName: string): void {
    for (const set of Array.from(this.hookHandlers.values())) {
      for (const entry of Array.from(set)) {
        if (entry.pluginName === pluginName) set.delete(entry);
      }
    }
    this.slots = this.slots.filter((s) => s.pluginName !== pluginName);
    this.settingsSections = this.settingsSections.filter(
      (s) => s.pluginName !== pluginName,
    );
    this.jobs = this.jobs.filter((j) => j.pluginName !== pluginName);
  }
}

/**
 * The app-wide registry. The domain layer (`src/lib/db/repos.ts`,
 * `src/lib/invoice-helpers.ts`) dispatches domain events through it.
 * No plugins are registered by default, so all hooks are no-ops until
 * a plugin is added.
 */
export const pluginRegistry = new PluginRegistry();
