import type { ChannelPlugin } from "openclaw/plugin-sdk";
import { listUnreadMessages } from "./graph.js";
import { monitorOutlookEmail } from "./monitor.js";
import { outlookOutbound } from "./outbound.js";
import { resolveOutlookChannelConfig, resolveOutlookCredentials } from "./token.js";

export type ResolvedOutlookAccount = {
  mailbox: string;
  appId: string;
  appSecret: string;
  tenantId: string;
};

export const outlookPlugin: ChannelPlugin<ResolvedOutlookAccount> = {
  id: "outlook",
  meta: {
    id: "outlook",
    label: "Outlook Email",
    selectionLabel: "Outlook Email (MS Graph)",
    docsPath: "/channels/outlook",
    docsLabel: "outlook",
    blurb: "MS Graph; app-level mailbox permissions.",
    aliases: ["email"],
    order: 65,
  },
  capabilities: {
    chatTypes: ["direct"],
    polls: false,
    threads: true,
    media: false,
  },
  config: {
    listAccountIds: (cfg) => {
      const oc = resolveOutlookChannelConfig(cfg);
      return oc?.enabled !== false ? ["default"] : [];
    },
    resolveAccount: (cfg) => {
      const oc = resolveOutlookChannelConfig(cfg);
      if (oc?.enabled === false) {
        return undefined as unknown as ResolvedOutlookAccount;
      }
      const creds = resolveOutlookCredentials(oc);
      if (!creds) {
        return undefined as unknown as ResolvedOutlookAccount;
      }
      const mailbox = oc.mailbox?.trim();
      if (!mailbox) {
        return undefined as unknown as ResolvedOutlookAccount;
      }
      return { ...creds, mailbox };
    },
    isConfigured: (_account, cfg) => {
      const oc = resolveOutlookChannelConfig(cfg);
      return Boolean(oc && resolveOutlookCredentials(oc) && oc.mailbox?.trim());
    },
    describeAccount: (_account) => ({
      accountId: "default",
      enabled: true,
    }),
  },
  agentPrompt: {
    messageToolHints: ({ cfg }) => {
      const oc = resolveOutlookChannelConfig(cfg);
      const hints = ["- `channel=outlook` sends email. Set `to` to a recipient email address."];
      if (oc?.draftOnly !== false) {
        hints.push(
          "- outlook is in draft-only mode: sent messages land in Drafts for review. Set channels.outlook.draftOnly=false to send live.",
        );
      }
      return hints;
    },
  },
  outbound: outlookOutbound,
  status: {
    probeAccount: async (params) => {
      const { account } = params;
      if (!account?.appId || !account?.mailbox) {
        return { ok: false, error: "credentials or mailbox missing" };
      }
      try {
        const creds = {
          appId: account.appId,
          appSecret: account.appSecret,
          tenantId: account.tenantId,
        };
        await listUnreadMessages(creds, account.mailbox, 1);
        return { ok: true };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },
  },
  gateway: {
    startAccount: async (ctx) => {
      ctx.setStatus({ accountId: ctx.accountId, status: "running" });
      ctx.log?.info("[outlook] starting monitor");
      await monitorOutlookEmail({ cfg: ctx.cfg, abortSignal: ctx.abortSignal, log: ctx.log });
    },
  },
};
