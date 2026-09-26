/**
 * Next.js server startup hook: register first-party plugins once per
 * server process (portal payment handlers, background jobs, ...).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { registerBuiltinPlugins } = await import("./src/plugins/builtin");
    registerBuiltinPlugins();
  }
}
