import type { PluginRuntime } from "openclaw/plugin-sdk";

let runtime: PluginRuntime | null = null;

export function setOutlookRuntime(next: PluginRuntime) {
  runtime = next;
}

export function getOutlookRuntime(): PluginRuntime {
  if (!runtime) {
    throw new Error("Outlook runtime not initialized");
  }
  return runtime;
}
