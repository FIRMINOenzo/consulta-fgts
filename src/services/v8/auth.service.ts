import { config } from '../../config';

const TOKEN_URL = 'https://api.v8digital.com/oauth/token';
const REFRESH_MARGIN_MS = 60 * 60 * 1000; // Refresh 1h before expiry

interface TokenCache {
  accessToken: string;
  expiresAt: number; // Unix timestamp in ms
}

let tokenCache: TokenCache | null = null;

export function _resetCache() {
  tokenCache = null;
}

export function _getCache(): TokenCache | null {
  return tokenCache;
}

export async function getToken(): Promise<string> {
  if (tokenCache && Date.now() < tokenCache.expiresAt - REFRESH_MARGIN_MS) {
    return tokenCache.accessToken;
  }

  return fetchToken();
}

export async function forceRefresh(): Promise<string> {
  tokenCache = null;
  return fetchToken();
}

async function fetchToken(): Promise<string> {
  const body = new URLSearchParams({
    grant_type: 'password',
    client_id: config.v8.clientId,
    client_secret: config.v8.clientSecret,
    username: config.v8.username,
    password: config.v8.password,
  });

  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`V8 auth failed (${response.status}): ${text}`);
  }

  const data = await response.json();

  if (!data.access_token) {
    throw new Error('V8 auth response missing access_token');
  }

  const expiresInMs = (data.expires_in ?? 86400) * 1000;
  tokenCache = {
    accessToken: data.access_token,
    expiresAt: Date.now() + expiresInMs,
  };

  return tokenCache.accessToken;
}
