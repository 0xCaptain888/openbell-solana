import { readDevnetSnapshot } from '../src/live-rpc.mjs';

const address = process.env.OPENBELL_WALLET_ADDRESS || '2oWxc6Tw4tYukaYoFVPzEB3D7LK95ccFQmNwALuoPgSm';
const endpoint = process.env.OPENBELL_SOLANA_RPC_URL || 'https://api.devnet.solana.com';
const snapshot = await readDevnetSnapshot({ endpoint, address });
console.log(JSON.stringify(snapshot, null, 2));
