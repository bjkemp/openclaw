import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";
import { outlookPlugin } from "./src/channel.js";
import { setOutlookRuntime } from "./src/runtime.js";

const plugin = {
  id: "outlook",
  name: "Outlook Email",
  description: "Outlook email channel plugin (MS Graph)",
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi) {
    setOutlookRuntime(api.runtime);
    api.registerChannel({ plugin: outlookPlugin });
  },
};

export default plugin;
