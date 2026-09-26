import { beforeEach, describe, expect, it, vi } from "vitest";
import { PluginRegistry } from "@/plugins/registry";
import type {
  DomainHookPayloads,
  Plugin,
  PluginContext,
} from "@/plugins/types";
import type { Task } from "@/core/entities";

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "tsk_test",
    projectId: "prj_test",
    name: "Test task",
    startAt: 1000,
    endAt: 2000,
    durationMinutes: 60,
    tags: [],
    isBilled: false,
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides,
  };
}

function makePlugin(
  name = "test-plugin",
  overrides: Partial<Plugin> = {},
): Plugin {
  return {
    manifest: { name, version: "0.1.0", description: "test" },
    activate: () => {},
    ...overrides,
  };
}

describe("PluginRegistry", () => {
  let registry: PluginRegistry;

  beforeEach(() => {
    registry = new PluginRegistry();
  });

  it("registers a plugin, calls activate with a context, and lists it", () => {
    const activate = vi.fn();
    registry.register(makePlugin("my-plugin", { activate }));
    expect(activate).toHaveBeenCalledTimes(1);
    const ctx = activate.mock.calls[0][0] as PluginContext;
    expect(ctx.manifest.name).toBe("my-plugin");
    expect(registry.list()).toEqual([
      { name: "my-plugin", version: "0.1.0", description: "test" },
    ]);
  });

  it("throws on duplicate registration", () => {
    registry.register(makePlugin("dup"));
    expect(() => registry.register(makePlugin("dup"))).toThrow(
      /already registered/,
    );
  });

  it("throws when the manifest has no name", () => {
    expect(() =>
      registry.register({
        manifest: { name: "", version: "0.0.0", description: "" },
        activate: () => {},
      }),
    ).toThrow(/must include a name/);
  });

  it("emit is a no-op when no plugins are registered", async () => {
    await expect(
      registry.emit("onTaskCreated", makeTask()),
    ).resolves.toBeUndefined();
  });

  it("dispatches domain hooks to subscribers with payloads", async () => {
    const seen: Task[] = [];
    registry.register(
      makePlugin("listener", {
        activate: (ctx) => {
          ctx.hooks.on("onTaskCreated", (task) => {
            seen.push(task);
          });
        },
      }),
    );
    const task = makeTask({ id: "tsk_1" });
    await registry.emit("onTaskCreated", task);
    expect(seen).toEqual([task]);
  });

  it("supports async handlers and multiple subscribers", async () => {
    const order: string[] = [];
    registry.register(
      makePlugin("a", {
        activate: (ctx) => {
          ctx.hooks.on("onInvoicePaid", async (invoice) => {
            order.push(`a:${invoice.id}`);
          });
        },
      }),
    );
    registry.register(
      makePlugin("b", {
        activate: (ctx) => {
          ctx.hooks.on("onInvoicePaid", (invoice) => {
            order.push(`b:${invoice.id}`);
          });
        },
      }),
    );
    await registry.emit("onInvoicePaid", {
      id: "inv_1",
    } as unknown as DomainHookPayloads["onInvoicePaid"]);
    expect(order).toEqual(["a:inv_1", "b:inv_1"]);
  });

  it("a throwing handler is logged and does not break dispatch", async () => {
    const after: string[] = [];
    registry.register(
      makePlugin("bad", {
        activate: (ctx) => {
          ctx.hooks.on("onTaskCreated", () => {
            throw new Error("boom");
          });
        },
      }),
    );
    registry.register(
      makePlugin("good", {
        activate: (ctx) => {
          ctx.hooks.on("onTaskCreated", () => {
            after.push("ran");
          });
        },
      }),
    );
    await expect(
      registry.emit("onTaskCreated", makeTask()),
    ).resolves.toBeUndefined();
    expect(after).toEqual(["ran"]);
  });

  it("the unsubscribe function removes the handler", async () => {
    let calls = 0;
    let unsub: (() => void) | undefined;
    registry.register(
      makePlugin("unsub", {
        activate: (ctx) => {
          unsub = ctx.hooks.on("onTaskCreated", () => {
            calls += 1;
          });
        },
      }),
    );
    await registry.emit("onTaskCreated", makeTask());
    expect(calls).toBe(1);
    unsub!();
    await registry.emit("onTaskCreated", makeTask());
    expect(calls).toBe(1);
  });

  it("unregister calls deactivate and removes hooks, slots, settings, jobs", async () => {
    const deactivate = vi.fn();
    let calls = 0;
    registry.register(
      makePlugin("full", {
        deactivate,
        activate: (ctx) => {
          ctx.hooks.on("onTaskCreated", () => {
            calls += 1;
          });
          ctx.ui.registerSlot({
            slot: "dashboard.widget",
            id: "full.widget",
            component: null,
          });
          ctx.settings.registerSection({
            id: "full.settings",
            title: "Full",
            fields: [],
          });
          ctx.jobs.registerJob({ id: "full.job", run: () => {} });
        },
      }),
    );
    expect(registry.getSlots("dashboard.widget")).toHaveLength(1);
    expect(registry.getSettingsSections()).toHaveLength(1);
    expect(registry.getJobs()).toHaveLength(1);

    registry.unregister("full");
    expect(deactivate).toHaveBeenCalledTimes(1);
    expect(registry.list()).toHaveLength(0);
    expect(registry.getSlots("dashboard.widget")).toHaveLength(0);
    expect(registry.getSettingsSections()).toHaveLength(0);
    expect(registry.getJobs()).toHaveLength(0);

    await registry.emit("onTaskCreated", makeTask());
    expect(calls).toBe(0);
  });

  it("unregistering an unknown plugin is a no-op", () => {
    expect(() => registry.unregister("nope")).not.toThrow();
  });

  it("a throwing activate leaves no half-registered state", () => {
    expect(() =>
      registry.register(
        makePlugin("broken", {
          activate: () => {
            throw new Error("activate failed");
          },
        }),
      ),
    ).toThrow(/activate failed/);
    expect(registry.list()).toHaveLength(0);
  });
});
