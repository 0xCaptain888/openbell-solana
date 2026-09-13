import { fetchJupiterQuote } from '../src/jupiter-quote.mjs';

function send(res, status, body) {
  res.status(status).setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.setHeader('access-control-allow-origin', process.env.ALLOWED_ORIGIN || '*');
  return res.json(body);
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return send(res, 405, { error: 'method_not_allowed' });
  const url = new URL(req.url || '/', 'http://localhost');
  const inputMint = url.searchParams.get('inputMint');
  const outputMint = url.searchParams.get('outputMint');
  const amount = url.searchParams.get('amount');
  if (!inputMint || !outputMint || !amount) {
    return send(res, 400, { error: 'inputMint, outputMint, and amount are required' });
  }
  try {
    const result = await fetchJupiterQuote({
      inputMint,
      outputMint,
      amount,
      slippageBps: Number(url.searchParams.get('slippageBps') || 100),
      endpoint: process.env.JUPITER_QUOTE_URL,
      apiKey: process.env.JUPITER_API_KEY
    });
    const { raw: _raw, ...safe } = result;
    const status = result.status === 'QUOTED' ? 200 : result.status === 'NO_ROUTE' ? 422 : 503;
    return send(res, status, safe);
  } catch (error) {
    return send(res, 400, { error: error instanceof Error ? error.message : String(error) });
  }
}
