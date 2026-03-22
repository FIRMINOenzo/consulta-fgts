import { getToken, forceRefresh } from './auth.service';

const BALANCE_URL = 'https://bff.v8sistema.com/fgts/balance';

export async function submitBalance(
  cpf: string,
  provider: string,
  webhookUrl: string
): Promise<void> {
  const makeRequest = async (token: string) => {
    return fetch(BALANCE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        documentNumber: cpf,
        provider: provider.toLowerCase(),
        webhookUrl,
      }),
    });
  };

  let token = await getToken();
  let response = await makeRequest(token);

  // On 401, refresh token and retry once
  if (response.status === 401) {
    token = await forceRefresh();
    response = await makeRequest(token);
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`V8 balance submission failed (${response.status}): ${text}`);
  }
}
