import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { readMainnetMint } from '../src/mainnet-mint.mjs';

const endpoint = process.env.OPENBELL_MAINNET_RPC_URL;
const mint = process.env.OPENBELL_STOCK_MINT || 'XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp';
const result = await readMainnetMint({ endpoint, mint });
await mkdir(resolve('evidence'), { recursive: true });
await writeFile(resolve('evidence/mainnet-aaplx-mint.json'), `${JSON.stringify({
  ...result,
  source: 'Solana Mainnet getParsedAccountInfo',
  warning: 'Read-only observation. No mainnet transaction was signed or broadcast.'
}, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
