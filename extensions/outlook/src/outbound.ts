import type { ChannelOutboundAdapter } from "openclaw/plugin-sdk";
import { sendNewMail } from "./graph.js";
import { resolveOutlookChannelConfig, resolveOutlookCredentials } from "./token.js";

export const outlookOutbound: ChannelOutboundAdapter = {
  deliveryMode: "direct",
  textChunkLimit: 32_000,
  sendText: async (ctx) => {
    const oc = resolveOutlookChannelConfig(ctx.cfg);
    const creds = resolveOutlookCredentials(oc);
    if (!creds) throw new Error("outlook credentials not configured");
    const mailbox = oc?.mailbox?.trim();
    if (!mailbox) throw new Error("outlook mailbox not configured");

    // ctx.to is the recipient email address; subject defaults to "Message from OpenClaw".
    await sendNewMail(creds, mailbox, ctx.to, "Message from OpenClaw", ctx.text);
    return { channel: "outlook" as const, messageId: "sent" };
  },
};
