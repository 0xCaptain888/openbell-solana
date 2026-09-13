import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  Connection,
  Keypair,
  SystemProgram,
  Transaction
} from '@solana/web3.js';
import { readTransactionProof } from '../src/transaction-proof.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const keypairPath = resolve(root, process.env.OPENBELL_KEYPAIR_PATH || '.secrets/openbell-devnet-keypair.json');
const endpoint = process.env.OPENBELL_SOLANA_RPC_URL || 'https://api.devnet.solana.com';
const lamports = Number(process.env.OPENBELL_TRANSFER_LAMPORTS || 1_000_000);
const existingSignature = process.env.OPENBELL_TX_SIGNATURE || '';

if (!existingSignature && process.env.OPENBELL_ALLOW_BROADCAST !== '1') {
  throw new Error('Broadcast refused. Set OPENBELL_ALLOW_BROADCAST=1 after explicit user approval.');
}
if (!Number.isSafeInteger(lamports) || lamports <= 0 || lamports > 1_000_000) {
  throw new Error('Transfer must be a positive integer of at most 1,000,000 lamports (0.001 SOL).');
}

const secret = JSON.parse(await readFile(keypairPath, 'utf8'));
const payer = Keypair.fromSecretKey(Uint8Array.from(secret));
const connection = new Connection(endpoint, 'confirmed');
const before = await connection.getBalance(payer.publicKey, 'confirmed');
let signature = existingSignature;
if (!signature) {
  const transaction = new Transaction().add(SystemProgram.transfer({
    fromPubkey: payer.publicKey,
    toPubkey: payer.publicKey,
    lamports
  }));
  const latest = await connection.getLatestBlockhash('confirmed');
  transaction.recentBlockhash = latest.blockhash;
  transaction.feePayer = payer.publicKey;
  transaction.sign(payer);
  signature = await connection.sendRawTransaction(transaction.serialize(), { skipPreflight: false });
  let confirmed = false;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const status = (await connection.getSignatureStatuses([signature], { searchTransactionHistory: true })).value[0];
    if (status?.err) throw new Error(`Devnet transaction failed: ${JSON.stringify(status.err)}`);
    if (status?.confirmationStatus === 'confirmed' || status?.confirmationStatus === 'finalized') {
      confirmed = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  if (!confirmed) throw new Error(`Timed out waiting for HTTP confirmation: ${signature}`);
}
const proof = await readTransactionProof({ endpoint, signature, commitment: 'confirmed' });
const after = await connection.getBalance(payer.publicKey, 'confirmed');

const output = {
  proofVersion: 'openbell.devnet-plumbing.v1',
  scope: 'devnet_self_transfer',
  network: 'solana-devnet',
  walletAddress: payer.publicKey.toBase58(),
  recipientAddress: payer.publicKey.toBase58(),
  lamports,
  sol: lamports / 1_000_000_000,
  balanceBeforeLamports: before,
  balanceAfterLamports: after,
  signature,
  explorer: `https://explorer.solana.com/tx/${signature}?cluster=devnet`,
  proof,
  warning: 'This proves Solana signing, broadcast, and independent verification only; it is not a tokenized-stock trade.'
};
await mkdir(resolve(root, 'evidence'), { recursive: true });
await writeFile(resolve(root, 'evidence/devnet-self-transfer-proof.json'), `${JSON.stringify(output, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify(output, null, 2));
