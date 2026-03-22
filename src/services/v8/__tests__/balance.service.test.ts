import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockGetToken = vi.fn();
const mockForceRefresh = vi.fn();

vi.mock('../auth.service', () => ({
  getToken: (...args: unknown[]) => mockGetToken(...args),
  forceRefresh: (...args: unknown[]) => mockForceRefresh(...args),
}));

import { submitBalance } from '../balance.service';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function mockResponse(status: number, body = '') {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
  };
}

describe('V8 Balance Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetToken.mockResolvedValue('valid-token');
    mockForceRefresh.mockResolvedValue('refreshed-token');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('submitBalance', () => {
    it('sends correct payload to V8 balance endpoint', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(200));

      await submitBalance('12345678900', 'QI', 'https://example.com/webhook');

      expect(mockFetch).toHaveBeenCalledOnce();
      expect(mockFetch).toHaveBeenCalledWith(
        'https://bff.v8sistema.com/fgts/balance',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer valid-token',
          },
        })
      );

      const requestBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(requestBody).toEqual({
        documentNumber: '12345678900',
        provider: 'qi',
        webhookUrl: 'https://example.com/webhook',
      });
    });

    it('lowercases the provider', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(200));

      await submitBalance('12345678900', 'BMS', 'https://example.com/webhook');

      const requestBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(requestBody.provider).toBe('bms');
    });

    it('retries once on 401 with refreshed token', async () => {
      mockFetch
        .mockResolvedValueOnce(mockResponse(401, 'Unauthorized'))
        .mockResolvedValueOnce(mockResponse(200));

      await submitBalance('12345678900', 'QI', 'https://example.com/webhook');

      expect(mockForceRefresh).toHaveBeenCalledOnce();
      expect(mockFetch).toHaveBeenCalledTimes(2);

      // Second call should use refreshed token
      const secondCall = mockFetch.mock.calls[1];
      expect(secondCall[1].headers.Authorization).toBe('Bearer refreshed-token');
    });

    it('throws when retry after 401 also fails', async () => {
      mockFetch
        .mockResolvedValueOnce(mockResponse(401, 'Unauthorized'))
        .mockResolvedValueOnce(mockResponse(403, 'Forbidden'));

      await expect(
        submitBalance('12345678900', 'QI', 'https://example.com/webhook')
      ).rejects.toThrow('V8 balance submission failed (403): Forbidden');
    });

    it('throws on non-401 error without retry', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(500, 'Internal Server Error'));

      await expect(
        submitBalance('12345678900', 'QI', 'https://example.com/webhook')
      ).rejects.toThrow('V8 balance submission failed (500): Internal Server Error');

      expect(mockForceRefresh).not.toHaveBeenCalled();
      expect(mockFetch).toHaveBeenCalledOnce();
    });

    it('resolves without error on successful submission', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(200));

      await expect(
        submitBalance('12345678900', 'QI', 'https://example.com/webhook')
      ).resolves.toBeUndefined();
    });

    it('gets token from auth service', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(200));

      await submitBalance('12345678900', 'QI', 'https://example.com/webhook');

      expect(mockGetToken).toHaveBeenCalledOnce();
    });
  });
});
