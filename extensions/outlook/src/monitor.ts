import type { OpenClawConfig } from "openclaw/plugin-sdk";
import {
  listUnreadMessages,
  markAsRead,
  replyToMessage,
  createDraftReply,
  type GraphMessage,
} from "./graph.js";
import { getOutlookRuntime } from "./runtime.js";
import {
  resolveOutlookChannelConfig,
  resolveOutlookCredentials,
  type OutlookCredentials,
} from "./token.js";

interface MonitorParams {
  cfg: OpenClawConfig;
  abortSignal: AbortSignal;
  log?: {
    info: (msg: string) => void;
    error: (msg: string) => void;
    debug?: (msg: string) => void;
  };
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

async function processMessage(
  cfg: OpenClawConfig,
  creds: OutlookCredentials,
  mailbox: string,
  msg: GraphMessage,
  draftOnly: boolean,
  log: MonitorParams["log"],
): Promise<void> {
  const core = getOutlookRuntime();
  const senderAddress = msg.from?.emailAddress?.address ?? "unknown";
  const senderName = msg.from?.emailAddress?.name || senderAddress;
  const text = msg.body?.content?.trim() || "(empty)";
  // One session per sender address so conversation context persists.
  const sessionKey = `outlook:${senderAddress.toLowerCase()}`;

  log?.debug?.(`[outlook] processing id=${msg.id} from=${senderAddress}`);

  // Mark as read immediately so the next poll cycle skips it even if dispatch is slow.
  await markAsRead(creds, mailbox, msg.id);

  const ctxPayload = core.channel.reply.finalizeInboundContext({
    Body: text,
    RawBody: text,
    CommandBody: text,
    From: senderAddress,
    To: mailbox,
    SessionKey: sessionKey,
    AccountId: "default",
    ChatType: "direct",
    ConversationLabel: senderName,
    SenderName: senderName,
    SenderId: senderAddress,
    Provider: "outlook",
    Surface: "outlook",
    MessageSid: msg.id,
    Timestamp: new Date(msg.receivedDateTime).getTime(),
    WasMentioned: true,
    CommandAuthorized: true,
    OriginatingChannel: "outlook",
    OriginatingTo: mailbox,
  });

  // Buffer all text chunks; flush as a single email on "final".
  const replyBuffer: string[] = [];

  const { dispatcher, replyOptions, markDispatchIdle } =
    core.channel.reply.createReplyDispatcherWithTyping({
      deliver: async (payload, { kind }) => {
        if (payload.text) replyBuffer.push(payload.text);
        if (kind === "final" && replyBuffer.length > 0) {
          const replyText = replyBuffer.join("\n\n");
          replyBuffer.length = 0;
          if (draftOnly) {
            // Save as draft — user reviews and sends manually from Outlook.
            const draftId = await createDraftReply(creds, mailbox, msg.id, replyText);
            log?.info(
              `[outlook] draft created id=${draftId} for message=${msg.id} (${replyText.length} chars)`,
            );
          } else {
            await replyToMessage(creds, mailbox, msg.id, replyText);
            log?.info(`[outlook] replied to id=${msg.id} (${replyText.length} chars)`);
          }
        }
      },
    });

  try {
    await core.channel.reply.dispatchReplyFromConfig({
      ctx: ctxPayload,
      cfg,
      dispatcher,
      replyOptions,
    });
  } catch (err) {
    log?.error(`[outlook] dispatch failed for id=${msg.id}: ${String(err)}`);
  } finally {
    markDispatchIdle();
  }
}

export async function monitorOutlookEmail(params: MonitorParams): Promise<void> {
  const { cfg, abortSignal, log } = params;
  const oc = resolveOutlookChannelConfig(cfg);
  const creds = resolveOutlookCredentials(oc);
  if (!creds) {
    log?.error("[outlook] credentials missing — need appId, appPassword, tenantId");
    return;
  }
  const mailbox = oc?.mailbox?.trim();
  if (!mailbox) {
    log?.error("[outlook] mailbox not configured");
    return;
  }
  const pollMs = oc?.pollIntervalMs ?? 15_000;
  // Safety default: replies go to Drafts until explicitly set to false.
  const draftOnly = oc?.draftOnly !== false;

  log?.info(
    `[outlook] monitor started — mailbox=${mailbox} pollMs=${pollMs} draftOnly=${draftOnly}`,
  );

  while (!abortSignal.aborted) {
    try {
      const messages = await listUnreadMessages(creds, mailbox);
      for (const msg of messages) {
        if (abortSignal.aborted) break;
        await processMessage(cfg, creds, mailbox, msg, draftOnly, log);
      }
    } catch (err) {
      if (abortSignal.aborted) break;
      log?.error(`[outlook] poll cycle error: ${String(err)}`);
    }
    try {
      await sleep(pollMs, abortSignal);
    } catch {
      break; // aborted
    }
  }

  log?.info("[outlook] monitor stopped");
}
