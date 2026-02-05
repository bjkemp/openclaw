export type OutlookCredentials = {
  appId: string;
  appSecret: string;
  tenantId: string;
};

export type OutlookChannelConfig = {
  enabled?: boolean;
  appId?: string;
  appPassword?: string;
  tenantId?: string;
  mailbox?: string;
  pollIntervalMs?: number;
  /** When true (default), replies are saved as drafts instead of sent. */
  draftOnly?: boolean;
};

export function resolveOutlookChannelConfig(cfg: {
  channels?: Record<string, unknown>;
}): OutlookChannelConfig | undefined {
  return cfg.channels?.outlook as OutlookChannelConfig | undefined;
}

export function resolveOutlookCredentials(
  oc: OutlookChannelConfig | undefined,
): OutlookCredentials | undefined {
  const appId = oc?.appId?.trim() || process.env.OUTLOOK_APP_ID?.trim();
  const appSecret = oc?.appPassword?.trim() || process.env.OUTLOOK_APP_SECRET?.trim();
  const tenantId = oc?.tenantId?.trim() || process.env.OUTLOOK_TENANT_ID?.trim();
  if (!appId || !appSecret || !tenantId) return undefined;
  return { appId, appSecret, tenantId };
}

// Simple in-process token cache; client_credentials tokens are typically valid for 3600s.
let tokenCache: { token: string; expiresAt: number } | null = null;

export async function getGraphAccessToken(creds: OutlookCredentials): Promise<string> {
  const now = Date.now();
  // Refresh 60 s before actual expiry to avoid races.
  if (tokenCache && tokenCache.expiresAt > now + 60_000) {
    return tokenCache.token;
  }

  const url = `https://login.microsoftonline.com/${creds.tenantId}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: creds.appId,
    client_secret: creds.appSecret,
    scope: "https://graph.microsoft.com/.default",
  });

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`outlook token request failed ${res.status}: ${text}`);
  }

  const data = (await res.json()) as { access_token: string; expires_in: number };
  tokenCache = { token: data.access_token, expiresAt: now + data.expires_in * 1000 };
  return data.access_token;
}
