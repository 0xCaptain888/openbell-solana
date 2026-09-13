const DEFAULT_QUOTE_URL = 'https://api.jup.ag/swap/v1/quote';

export async function fetchJupiterQuote({
  inputMint,
  outputMint,
  amount,
  slippageBps = 100,
  endpoint = DEFAULT_QUOTE_URL,
  apiKey = process.env.JUPITER_API_KEY
}) {
  if (!inputMint || !outputMint) throw new Error('inputMint and outputMint are required');
  if (!Number.isSafeInteger(Number(amount)) || Number(amount) <= 0) {
    throw new Error('amount must be a positive integer in base units');
  }
  const url = new URL(endpoint);
  url.search = new URLSearchParams({
    inputMint,
    outputMint,
    amount: String(amount),
    slippageBps: String(slippageBps),
    restrictIntermediateTokens: 'true'
  }).toString();
  const headers = { accept: 'application/json' };
  if (apiKey) headers['x-api-key'] = apiKey;
  let response;
  try {
    response = await fetch(url, { headers });
  } catch (error) {
    return {
      provider: 'jupiter',
      status: 'UNAVAILABLE',
      error: error instanceof Error ? error.message : String(error),
      inputMint,
      outputMint,
      amount: Number(amount)
    };
  }
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { body = { raw: text }; }
  if (!response.ok) {
    return {
      provider: 'jupiter',
      status: 'NO_ROUTE',
      httpStatus: response.status,
      error: body?.error ?? body?.message ?? `HTTP ${response.status}`,
      inputMint,
      outputMint,
      amount: Number(amount)
    };
  }
  return {
    provider: 'jupiter',
    status: body?.outAmount ? 'QUOTED' : 'NO_ROUTE',
    inputMint,
    outputMint,
    amount: Number(amount),
    outAmount: body?.outAmount ?? null,
    priceImpactPct: body?.priceImpactPct ?? null,
    contextSlot: body?.contextSlot ?? null,
    routePlan: body?.routePlan ?? [],
    raw: body
  };
}

export { DEFAULT_QUOTE_URL };
