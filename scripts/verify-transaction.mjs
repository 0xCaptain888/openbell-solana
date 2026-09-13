import { readTransactionProof } from '../src/transaction-proof.mjs';

const endpoint = process.env.OPENBELL_SOLANA_RPC_URL || 'https://api.devnet.solana.com';
const signature = process.env.OPENBELL_TX_SIGNATURE;
if (!signature) {
  console.error('Set OPENBELL_TX_SIGNATURE to an already-broadcast Solana transaction signature.');
  process.exit(2);
}
console.log(JSON.stringify(await readTransactionProof({ endpoint, signature }), null, 2));
