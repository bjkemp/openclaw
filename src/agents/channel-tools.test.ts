import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChannelPlugin } from "../channels/plugins/types.js";
import type { OpenClawConfig } from "../config/config.js";
import { setActivePluginRegistry } from "../plugins/runtime.js";
import { defaultRuntime } from "../runtime.js";
import { createTestRegistry } from "../test-utils/channel-plugins.js";
import {
  __testing,
  listAllChannelSupportedActions,
  resolveDeliverableMessageToolHints,
} from "./channel-tools.js";

describe("channel tools", () => {
  const errorSpy = vi.spyOn(defaultRuntime, "error").mockImplementation(() => undefined);

  beforeEach(() => {
    const plugin: ChannelPlugin = {
      id: "test",
      meta: {
        id: "test",
        label: "Test",
        selectionLabel: "Test",
        docsPath: "/channels/test",
        blurb: "test plugin",
      },
      capabilities: { chatTypes: ["direct"] },
      config: {
        listAccountIds: () => [],
        resolveAccount: () => ({}),
      },
      actions: {
        listActions: () => {
          throw new Error("boom");
        },
      },
    };

    __testing.resetLoggedListActionErrors();
    errorSpy.mockClear();
    setActivePluginRegistry(createTestRegistry([{ pluginId: "test", source: "test", plugin }]));
  });

  afterEach(() => {
    setActivePluginRegistry(createTestRegistry([]));
    errorSpy.mockClear();
  });

  it("skips crashing plugins and logs once", () => {
    const cfg = {} as OpenClawConfig;
    expect(listAllChannelSupportedActions({ cfg })).toEqual([]);
    expect(errorSpy).toHaveBeenCalledTimes(1);

    expect(listAllChannelSupportedActions({ cfg })).toEqual([]);
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });
});

function makePlugin(id: string, overrides: Partial<ChannelPlugin> = {}): ChannelPlugin {
  return {
    id,
    meta: {
      id,
      label: id,
      selectionLabel: id,
      docsPath: `/channels/${id}`,
      blurb: `${id} stub`,
    },
    capabilities: { chatTypes: ["direct"] },
    config: {
      listAccountIds: () => ["default"],
      resolveAccount: () => ({}),
    },
    ...overrides,
  };
}

describe("resolveDeliverableMessageToolHints", () => {
  afterEach(() => {
    setActivePluginRegistry(createTestRegistry([]));
  });

  it("returns empty when no plugins have agentPrompt", () => {
    setActivePluginRegistry(
      createTestRegistry([{ pluginId: "plain", plugin: makePlugin("plain"), source: "test" }]),
    );
    expect(resolveDeliverableMessageToolHints({ cfg: {} as OpenClawConfig })).toEqual([]);
  });

  it("collects hints from plugins that have accounts and agentPrompt", () => {
    const plugin = makePlugin("outlook", {
      agentPrompt: {
        messageToolHints: () => ["- use channel=outlook to send email."],
      },
    });
    setActivePluginRegistry(createTestRegistry([{ pluginId: "outlook", plugin, source: "test" }]));
    const hints = resolveDeliverableMessageToolHints({ cfg: {} as OpenClawConfig });
    expect(hints).toEqual(["- use channel=outlook to send email."]);
  });

  it("excludes the runtime channel specified by excludeChannel", () => {
    const outlook = makePlugin("outlook", {
      agentPrompt: {
        messageToolHints: () => ["- outlook hint"],
      },
    });
    const teams = makePlugin("msteams", {
      agentPrompt: {
        messageToolHints: () => ["- teams hint"],
      },
    });
    setActivePluginRegistry(
      createTestRegistry([
        { pluginId: "outlook", plugin: outlook, source: "test" },
        { pluginId: "msteams", plugin: teams, source: "test" },
      ]),
    );
    const hints = resolveDeliverableMessageToolHints({
      cfg: {} as OpenClawConfig,
      excludeChannel: "msteams",
    });
    expect(hints).toEqual(["- outlook hint"]);
  });

  it("skips plugins whose listAccountIds returns empty", () => {
    const plugin = makePlugin("empty", {
      config: {
        listAccountIds: () => [],
        resolveAccount: () => ({}),
      },
      agentPrompt: {
        messageToolHints: () => ["- should not appear"],
      },
    });
    setActivePluginRegistry(createTestRegistry([{ pluginId: "empty", plugin, source: "test" }]));
    expect(resolveDeliverableMessageToolHints({ cfg: {} as OpenClawConfig })).toEqual([]);
  });

  it("trims and filters blank hint strings", () => {
    const plugin = makePlugin("noisy", {
      agentPrompt: {
        messageToolHints: () => ["  - real hint  ", "  ", "", "- another"],
      },
    });
    setActivePluginRegistry(createTestRegistry([{ pluginId: "noisy", plugin, source: "test" }]));
    expect(resolveDeliverableMessageToolHints({ cfg: {} as OpenClawConfig })).toEqual([
      "- real hint",
      "- another",
    ]);
  });
});
