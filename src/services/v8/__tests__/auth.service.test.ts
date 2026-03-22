import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../config', () => ({
  config: {
    v8: {
      clientId: 'test-client-id',
      clientSecret: 'test-client-secret',
      username: 'test-user',
      password: 'test-pass',
    },
  },
}));

import { getToken, forceRefresh, _resetCache, _getCache } from '../auth.service';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function mockTokenResponse(token: string, expiresIn = 86400, status = 200) {
  mockFetch.mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: async () => ({ access_token: token, expires_in: expiresIn }),
    text: async () => JSON.stringify({ access_token: token, expires_in: expiresIn }),
  });
}

function mockErrorResponse(status: number, body: string) {
  mockFetch.mockResolvedValueOnce({
    ok: false,
    status,
    text: async () => body,
  });
}

describe('V8 Auth Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetCache();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getToken', () => {
    it('fetches a new token when cache is empty', async () => {
      mockTokenResponse('token-abc');

      const token = await getToken();

      expect(token).toBe('token-abc');
      expect(mockFetch).toHaveBeenCalledOnce();
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.v8digital.com/oauth/token',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        })
      );
    });

    it('sends correct credentials in request body', async () => {
      mockTokenResponse('token-abc');

      await getToken();

      const call = mockFetch.mock.calls[0];
      const body = call[1].body as string;
      expect(body).toContain('grant_type=password');
      expect(body).toContain('client_id=test-client-id');
      expect(body).toContain('client_secret=test-client-secret');
      expect(body).toContain('username=test-user');
      expect(body).toContain('password=test-pass');
    });

    it('returns cached token on subsequent calls', async () => {
      mockTokenResponse('token-abc');

      const token1 = await getToken();
      const token2 = await getToken();

      expect(token1).toBe('token-abc');
      expect(token2).toBe('token-abc');
      expect(mockFetch).toHaveBeenCalledOnce();
    });

    it('refreshes token when close to expiry', async () => {
      // First call: token that expires in 30 minutes (within 1h margin)
      mockTokenResponse('token-old', 1800);
      await getToken();

      // Advance time so token is within refresh margin
      const cache = _getCache();
      expect(cache).not.toBeNull();

      // Second call: should fetch new token since 30min < 1h margin
      mockTokenResponse('token-new');
      const token = await getToken();

      expect(token).toBe('token-new');
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('throws on non-OK response', async () => {
      mockErrorResponse(400, 'invalid_grant');

      await expect(getToken()).rejects.toThrow('V8 auth failed (400): invalid_grant');
    });

    it('throws when response has no access_token', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ token_type: 'bearer' }),
        text: async () => '{}',
      });

      await expect(getToken()).rejects.toThrow('V8 auth response missing access_token');
    });

    it('uses default 24h expiry when expires_in is missing', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ access_token: 'token-no-expiry' }),
        text: async () => '{}',
      });

      const token = await getToken();
      expect(token).toBe('token-no-expiry');

      const cache = _getCache();
      expect(cache).not.toBeNull();
      // Should be roughly 24h from now (86400s)
      const expectedExpiry = Date.now() + 86400 * 1000;
      expect(cache!.expiresAt).toBeGreaterThan(expectedExpiry - 5000);
      expect(cache!.expiresAt).toBeLessThan(expectedExpiry + 5000);
    });
  });

  describe('forceRefresh', () => {
    it('clears cache and fetches new token', async () => {
      mockTokenResponse('token-old');
      await getToken();

      mockTokenResponse('token-new');
      const token = await forceRefresh();

      expect(token).toBe('token-new');
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('works when cache is already empty', async () => {
      mockTokenResponse('token-fresh');

      const token = await forceRefresh();

      expect(token).toBe('token-fresh');
      expect(mockFetch).toHaveBeenCalledOnce();
    });
  });
});
