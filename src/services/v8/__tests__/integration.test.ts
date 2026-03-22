import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../config', () => ({
  config: {
    v8: {
      clientId: 'int-client-id',
      clientSecret: 'int-client-secret',
      username: 'int-user',
      password: 'int-pass',
    },
  },
}));

import { getToken, forceRefresh, _resetCache } from '../auth.service';
import { submitBalance } from '../balance.service';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('V8 Integration: Auth + Balance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetCache();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches token then submits balance in a single flow', async () => {
    // First call: auth token request
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ access_token: 'integration-token', expires_in: 86400 }),
      text: async () => '{}',
    });

    // Second call: balance submission
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => 'null',
    });

    await submitBalance('12345678900', 'QI', 'https://example.com/webhook');

    expect(mockFetch).toHaveBeenCalledTimes(2);

    // Verify auth call
    const authCall = mockFetch.mock.calls[0];
    expect(authCall[0]).toBe('https://api.v8digital.com/oauth/token');

    // Verify balance call uses the token from auth
    const balanceCall = mockFetch.mock.calls[1];
    expect(balanceCall[0]).toBe('https://bff.v8sistema.com/fgts/balance');
    expect(balanceCall[1].headers.Authorization).toBe('Bearer integration-token');
  });

  it('reuses cached token for multiple balance submissions', async () => {
    // One auth call
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ access_token: 'cached-token', expires_in: 86400 }),
      text: async () => '{}',
    });

    // Two balance calls
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, text: async () => 'null' });
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, text: async () => 'null' });

    await submitBalance('11111111111', 'QI', 'https://example.com/webhook');
    await submitBalance('22222222222', 'BMS', 'https://example.com/webhook');

    // 1 auth + 2 balance = 3 total
    expect(mockFetch).toHaveBeenCalledTimes(3);

    // Both balance calls use same cached token
    expect(mockFetch.mock.calls[1][1].headers.Authorization).toBe('Bearer cached-token');
    expect(mockFetch.mock.calls[2][1].headers.Authorization).toBe('Bearer cached-token');
  });

  it('handles 401 on balance by refreshing token and retrying', async () => {
    // Initial auth
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ access_token: 'expired-token', expires_in: 86400 }),
      text: async () => '{}',
    });

    // Balance returns 401
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => 'Unauthorized',
    });

    // Force refresh gets new token
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ access_token: 'new-token', expires_in: 86400 }),
      text: async () => '{}',
    });

    // Retry balance succeeds
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => 'null',
    });

    await submitBalance('12345678900', 'QI', 'https://example.com/webhook');

    expect(mockFetch).toHaveBeenCalledTimes(4);

    // Last balance call uses refreshed token
    const retryCall = mockFetch.mock.calls[3];
    expect(retryCall[1].headers.Authorization).toBe('Bearer new-token');
  });

  it('propagates auth failure to balance caller', async () => {
    // Auth fails
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: async () => 'invalid_grant',
    });

    await expect(
      submitBalance('12345678900', 'QI', 'https://example.com/webhook')
    ).rejects.toThrow('V8 auth failed (400): invalid_grant');

    // Only 1 call (auth), no balance call attempted
    expect(mockFetch).toHaveBeenCalledOnce();
  });
});
