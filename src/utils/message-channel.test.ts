import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ChannelPlugin } from "../channels/plugins/types.js";
import type { PluginRegistry } from "../plugins/registry.js";
import { setActivePluginRegistry } from "../plugins/runtime.js";
import { buildDeliverableChannelOptions, resolveGatewayMessageChannel } from "./message-channel.js";

const createRegistry = (channels: PluginRegistry["channels"]): PluginRegistry => ({
  plugins: [],
  tools: [],
  channels,
  providers: [],
  gatewayHandlers: {},
  httpHandlers: [],
  httpRoutes: [],
  cliRegistrars: [],
  services: [],
  diagnostics: [],
});

const emptyRegistry = createRegistry([]);

const msteamsPlugin = {
  id: "msteams",
  meta: {
    id: "msteams",
    label: "Microsoft Teams",
    selectionLabel: "Microsoft Teams (Bot Framework)",
    docsPath: "/channels/msteams",
    blurb: "Bot Framework; enterprise support.",
    aliases: ["teams"],
  },
  capabilities: { chatTypes: ["direct"] },
  config: {
    listAccountIds: () => [],
    resolveAccount: () => ({}),
  },
} satisfies ChannelPlugin;

describe("message-channel", () => {
  beforeEach(() => {
    setActivePluginRegistry(emptyRegistry);
  });

  afterEach(() => {
    setActivePluginRegistry(emptyRegistry);
  });

  it("normalizes gateway message channels and rejects unknown values", () => {
    expect(resolveGatewayMessageChannel("discord")).toBe("discord");
    expect(resolveGatewayMessageChannel(" imsg ")).toBe("imessage");
    expect(resolveGatewayMessageChannel("web")).toBeUndefined();
    expect(resolveGatewayMessageChannel("nope")).toBeUndefined();
  });

  it("normalizes plugin aliases when registered", () => {
    setActivePluginRegistry(
      createRegistry([{ pluginId: "msteams", plugin: msteamsPlugin, source: "test" }]),
    );
    expect(resolveGatewayMessageChannel("teams")).toBe("msteams");
  });
});

const outlookPlugin = {
  id: "outlook",
  meta: {
    id: "outlook",
    label: "Outlook Email",
    selectionLabel: "Outlook Email (MS Graph)",
    docsPath: "/channels/outlook",
    blurb: "MS Graph.",
    aliases: ["email"],
  },
  capabilities: { chatTypes: ["direct"] },
  config: {
    listAccountIds: () => [],
    resolveAccount: () => ({}),
  },
} satisfies ChannelPlugin;

const noAliasPlugin = {
  id: "custom",
  meta: {
    id: "custom",
    label: "Custom",
    selectionLabel: "Custom",
    docsPath: "/channels/custom",
    blurb: "No aliases.",
  },
  capabilities: { chatTypes: ["direct"] },
  config: {
    listAccountIds: () => [],
    resolveAccount: () => ({}),
  },
} satisfies ChannelPlugin;

describe("buildDeliverableChannelOptions", () => {
  beforeEach(() => {
    setActivePluginRegistry(emptyRegistry);
  });

  afterEach(() => {
    setActivePluginRegistry(emptyRegistry);
  });

  it("contains core channel IDs when no plugins are registered", () => {
    const result = buildDeliverableChannelOptions();
    expect(result).toMatch(/telegram/);
    expect(result).toMatch(/discord/);
    // No parenthetical annotations on core channels
    expect(result).not.toMatch(/\(/);
  });

  it("appends plugin IDs annotated with their first alias", () => {
    setActivePluginRegistry(
      createRegistry([
        { pluginId: "msteams", plugin: msteamsPlugin, source: "test" },
        { pluginId: "outlook", plugin: outlookPlugin, source: "test" },
      ]),
    );
    const result = buildDeliverableChannelOptions();
    expect(result).toMatch(/msteams \(teams\)/);
    expect(result).toMatch(/outlook \(email\)/);
  });

  it("appends plugin ID without annotation when aliases are empty", () => {
    setActivePluginRegistry(
      createRegistry([{ pluginId: "custom", plugin: noAliasPlugin, source: "test" }]),
    );
    const result = buildDeliverableChannelOptions();
    expect(result).toMatch(/\|custom/);
    expect(result).not.toMatch(/custom \(/);
  });
});
