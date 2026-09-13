async function rpcCall(endpoint, method, params = []) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
  });
  if (!response.ok) throw new Error(`Solana RPC HTTP ${response.status}`);
  const payload = await response.json();
  if (payload.error) throw new Error(`Solana RPC ${payload.error.code}: ${payload.error.message}`);
  return payload.result;
}

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

async function sha256(value) {
  const digest = await import('node:crypto').then(({ createHash }) => createHash('sha256').update(stable(value)).digest('hex'));
  return digest;
}

/** Read-only proof for an already-broadcast Solana transaction. */
export async function readTransactionProof({ endpoint, signature, commitment = 'confirmed' }) {
  if (!endpoint) throw new Error('RPC endpoint is required');
  if (!signature) throw new Error('Transaction signature is required');
  const result = await rpcCall(endpoint, 'getTransaction', [signature, {
    commitment,
    encoding: 'jsonParsed',
    maxSupportedTransactionVersion: 0
  }]);
  if (!result) return { signature, found: false, commitment };
  const meta = result.meta ?? {};
  return {
    signature,
    found: true,
    slot: result.slot,
    blockTime: result.blockTime,
    success: meta.err == null,
    error: meta.err,
    feeLamports: meta.fee,
    preBalances: meta.preBalances ?? [],
    postBalances: meta.postBalances ?? [],
    preTokenBalances: meta.preTokenBalances ?? [],
    postTokenBalances: meta.postTokenBalances ?? [],
    logCount: Array.isArray(meta.logMessages) ? meta.logMessages.length : 0
  };
}

export function assertTransactionProof(proof) {
  if (!proof?.found) throw new Error('Transaction was not found at the selected commitment');
  if (!proof.success) throw new Error(`Transaction failed: ${JSON.stringify(proof.error)}`);
  return proof;
}

/** Attach a verified, already-broadcast transaction to a receipt without signing or broadcasting. */
export async function attachTransactionProof(receipt, proof) {
  assertTransactionProof(proof);
  const body = { ...receipt, transactionProof: {
    signature: proof.signature,
    slot: proof.slot,
    blockTime: proof.blockTime,
    success: proof.success,
    feeLamports: proof.feeLamports,
    preBalances: proof.preBalances,
    postBalances: proof.postBalances,
    preTokenBalances: proof.preTokenBalances,
    postTokenBalances: proof.postTokenBalances
  } };
  return { ...body, evidenceHash: await sha256(body) };
}
