const DEFAULT_RPC = 'https://api.devnet.solana.com';

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

export async function readDevnetSnapshot({ endpoint = DEFAULT_RPC, address }) {
  if (!address) throw new Error('Wallet address is required');
  const [balance, slot, version] = await Promise.all([
    rpcCall(endpoint, 'getBalance', [address, { commitment: 'confirmed' }]),
    rpcCall(endpoint, 'getSlot', [{ commitment: 'confirmed' }]),
    rpcCall(endpoint, 'getVersion')
  ]);
  return {
    network: 'solana-devnet',
    address,
    slot,
    balanceLamports: balance.value,
    balanceSOL: balance.value / 1_000_000_000,
    solanaCore: version['solana-core'],
    rpc: endpoint.includes('alchemy.com') ? 'alchemy-devnet' : 'public-devnet'
  };
}

export { DEFAULT_RPC };
