import { getGraphAccessToken, type OutlookCredentials } from "./token.js";

const GRAPH = "https://graph.microsoft.com/v1.0";

export type GraphMessage = {
  id: string;
  subject: string;
  body: { content: string; contentType: string };
  from: { emailAddress: { address: string; name: string } };
  receivedDateTime: string;
  isRead: boolean;
  conversationId?: string;
};

async function graphFetch(
  creds: OutlookCredentials,
  path: string,
  opts: RequestInit = {},
): Promise<Response> {
  const token = await getGraphAccessToken(creds);
  return fetch(`${GRAPH}${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(opts.headers as Record<string, string>),
    },
  });
}

export async function listUnreadMessages(
  creds: OutlookCredentials,
  mailbox: string,
  top = 20,
): Promise<GraphMessage[]> {
  const params = new URLSearchParams({
    $filter: "isRead eq false",
    $orderby: "receivedDateTime asc",
    $top: String(top),
    $select: "id,subject,body,from,receivedDateTime,isRead,conversationId",
  });
  const res = await graphFetch(
    creds,
    `/users/${encodeURIComponent(mailbox)}/mailfolders/inbox/messages?${params}`,
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`outlook list messages failed ${res.status}: ${text}`);
  }
  const data = (await res.json()) as { value: GraphMessage[] };
  return data.value;
}

export async function markAsRead(
  creds: OutlookCredentials,
  mailbox: string,
  messageId: string,
): Promise<void> {
  const res = await graphFetch(
    creds,
    `/users/${encodeURIComponent(mailbox)}/messages/${messageId}`,
    { method: "PATCH", body: JSON.stringify({ isRead: true }) },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`outlook mark-as-read failed ${res.status}: ${text}`);
  }
}

// Sends the reply immediately.
export async function replyToMessage(
  creds: OutlookCredentials,
  mailbox: string,
  messageId: string,
  replyText: string,
): Promise<void> {
  const res = await graphFetch(
    creds,
    `/users/${encodeURIComponent(mailbox)}/messages/${messageId}/reply`,
    {
      method: "POST",
      body: JSON.stringify({
        message: { body: { contentType: "Text", content: replyText } },
      }),
    },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`outlook reply failed ${res.status}: ${text}`);
  }
}

// Saves a draft reply to the Drafts folder without sending.
export async function createDraftReply(
  creds: OutlookCredentials,
  mailbox: string,
  messageId: string,
  replyText: string,
): Promise<string> {
  const res = await graphFetch(
    creds,
    `/users/${encodeURIComponent(mailbox)}/messages/${messageId}/createReply`,
    {
      method: "POST",
      body: JSON.stringify({
        message: { body: { contentType: "Text", content: replyText } },
      }),
    },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`outlook createReply failed ${res.status}: ${text}`);
  }
  const draft = (await res.json()) as { id: string };
  return draft.id;
}

export async function sendNewMail(
  creds: OutlookCredentials,
  mailbox: string,
  to: string,
  subject: string,
  bodyText: string,
): Promise<void> {
  const res = await graphFetch(creds, `/users/${encodeURIComponent(mailbox)}/sendMail`, {
    method: "POST",
    body: JSON.stringify({
      message: {
        subject,
        body: { contentType: "Text", content: bodyText },
        toRecipients: [{ emailAddress: { address: to } }],
      },
      saveToSentItems: true,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`outlook sendMail failed ${res.status}: ${text}`);
  }
}
