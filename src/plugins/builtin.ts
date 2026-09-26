/**
 * First-party (built-in) plugins, registered once at server startup via
 * `instrumentation.ts`. These ship with Tallyhand itself — as opposed to
 * third-party plugins loaded from elsewhere.
 *
 * Registration is idempotent: re-calling skips plugins that are already
 * registered (dev hot-reloads, tests).
 */

import { pluginRegistry } from "./registry";
import { stripePlugin, STRIPE_PLUGIN_NAME } from "./stripe";

export function registerBuiltinPlugins(): void {
  if (!pluginRegistry.get(STRIPE_PLUGIN_NAME)) {
    pluginRegistry.register(stripePlugin);
  }
}
