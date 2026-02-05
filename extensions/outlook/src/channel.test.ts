import { describe, expect, it } from "vitest";
import { outlookPlugin } from "./channel.js";

const fullCfg = (overrides: Record<string, unknown> = {}) => ({
  channels: {
    outlook: {
      appId: "app-id",
      appPassword: "app-secret",
      tenantId: "tenant-id",
      mailbox: "helpdesk@example.com",
      ...overrides,
    },
  },
});

describe("outlook plugin – config.listAccountIds", () => {
  it("returns [default] when outlook config is fully populated", () => {
    expect(outlookPlugin.config.listAccountIds(fullCfg())).toEqual(["default"]);
  });

  it("returns [default] when enabled is absent (defaults to enabled)", () => {
    expect(outlookPlugin.config.listAccountIds(fullCfg({ enabled: undefined }))).toEqual([
      "default",
    ]);
  });

  it("returns [default] when enabled is explicitly true", () => {
    expect(outlookPlugin.config.listAccountIds(fullCfg({ enabled: true }))).toEqual(["default"]);
  });

  it("returns [] when enabled is explicitly false", () => {
    expect(outlookPlugin.config.listAccountIds(fullCfg({ enabled: false }))).toEqual([]);
  });

  it("returns [default] when channels.outlook is absent entirely", () => {
    // No outlook key at all – enabled is not false, so default-enabled
    expect(outlookPlugin.config.listAccountIds({ channels: {} })).toEqual(["default"]);
  });
});

describe("outlook plugin – config.resolveAccount", () => {
  it("resolves a full account when all fields are present", () => {
    const account = outlookPlugin.config.resolveAccount(fullCfg());
    expect(account).toEqual({
      appId: "app-id",
      appSecret: "app-secret",
      tenantId: "tenant-id",
      mailbox: "helpdesk@example.com",
    });
  });

  it("returns undefined when enabled is explicitly false", () => {
    expect(outlookPlugin.config.resolveAccount(fullCfg({ enabled: false }))).toBeUndefined();
  });

  it("returns undefined when credentials are missing", () => {
    expect(
      outlookPlugin.config.resolveAccount({ channels: { outlook: { mailbox: "a@b.com" } } }),
    ).toBeUndefined();
  });

  it("returns undefined when mailbox is missing", () => {
    expect(outlookPlugin.config.resolveAccount(fullCfg({ mailbox: undefined }))).toBeUndefined();
  });

  it("returns undefined when mailbox is whitespace-only", () => {
    expect(outlookPlugin.config.resolveAccount(fullCfg({ mailbox: "   " }))).toBeUndefined();
  });
});

describe("outlook plugin – config.isConfigured", () => {
  it("returns true when credentials and mailbox are present", () => {
    expect(outlookPlugin.config.isConfigured!(undefined as unknown as never, fullCfg())).toBe(true);
  });

  it("returns false when credentials are missing", () => {
    expect(
      outlookPlugin.config.isConfigured!(undefined as unknown as never, {
        channels: { outlook: { mailbox: "a@b.com" } },
      }),
    ).toBe(false);
  });

  it("returns false when mailbox is missing", () => {
    expect(
      outlookPlugin.config.isConfigured!(undefined as unknown as never, fullCfg({ mailbox: "" })),
    ).toBe(false);
  });

  it("returns false when outlook config is absent", () => {
    expect(
      outlookPlugin.config.isConfigured!(undefined as unknown as never, { channels: {} }),
    ).toBe(false);
  });
});

describe("outlook plugin – config.describeAccount", () => {
  it("returns the static default snapshot", () => {
    expect(outlookPlugin.config.describeAccount!(undefined as unknown as never)).toEqual({
      accountId: "default",
      enabled: true,
    });
  });
});

describe("outlook plugin – agentPrompt.messageToolHints", () => {
  it("includes the send-email hint always", () => {
    const hints = outlookPlugin.agentPrompt!.messageToolHints!({ cfg: fullCfg() });
    expect(hints[0]).toMatch(/channel=outlook/);
    expect(hints[0]).toMatch(/email/i);
  });

  it("includes draft-only warning when draftOnly is absent (defaults true)", () => {
    const hints = outlookPlugin.agentPrompt!.messageToolHints!({ cfg: fullCfg() });
    expect(hints.length).toBe(2);
    expect(hints[1]).toMatch(/draft-only/i);
  });

  it("includes draft-only warning when draftOnly is explicitly true", () => {
    const hints = outlookPlugin.agentPrompt!.messageToolHints!({
      cfg: fullCfg({ draftOnly: true }),
    });
    expect(hints.length).toBe(2);
    expect(hints[1]).toMatch(/draft-only/i);
  });

  it("omits draft-only warning when draftOnly is false", () => {
    const hints = outlookPlugin.agentPrompt!.messageToolHints!({
      cfg: fullCfg({ draftOnly: false }),
    });
    expect(hints.length).toBe(1);
  });
});
