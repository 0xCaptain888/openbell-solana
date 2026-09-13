import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/jupiter-quote.mjs';

function request(path, method = 'GET') {
  const headers = {};
  let payload;
  const response = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    setHeader(name, value) { headers[name] = value; },
    json(value) { payload = value; return value; }
  };
  return { req: { method, url: path }, res: response, headers, get payload() { return payload; } };
}

test('quote proxy returns a sanitized QUOTED response', async () => {
  const previous = global.fetch;
  global.fetch = async () => new Response(JSON.stringify({ outAmount: '302834', priceImpactPct: '0', contextSlot: 123, routePlan: [{ swapInfo: { label: 'test' } }] }), { status: 200 });
  const call = request('/api/jupiter-quote?inputMint=SOL&outputMint=AAPLx&amount=100');
  await handler(call.req, call.res);
  global.fetch = previous;
  assert.equal(call.res.statusCode, 200);
  assert.equal(call.payload.status, 'QUOTED');
  assert.equal(call.payload.outAmount, '302834');
  assert.equal('raw' in call.payload, false);
});

test('quote proxy maps a provider no-route response to 422', async () => {
  const previous = global.fetch;
  global.fetch = async () => new Response(JSON.stringify({ error: 'Could not find a route' }), { status: 400 });
  const call = request('/api/jupiter-quote?inputMint=SOL&outputMint=AAPLx&amount=100');
  await handler(call.req, call.res);
  global.fetch = previous;
  assert.equal(call.res.statusCode, 422);
  assert.equal(call.payload.status, 'NO_ROUTE');
});

test('quote proxy rejects non-GET requests', async () => {
  const call = request('/api/jupiter-quote', 'POST');
  await handler(call.req, call.res);
  assert.equal(call.res.statusCode, 405);
  assert.equal(call.payload.error, 'method_not_allowed');
});
