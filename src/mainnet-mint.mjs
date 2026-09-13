import { Connection, PublicKey } from '@solana/web3.js';

const TOKEN_2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';

export async function readMainnetMint({ endpoint, mint, commitment = 'confirmed' }) {
  if (!endpoint) throw new Error('Mainnet RPC endpoint is required');
  if (!mint) throw new Error('Mint address is required');
  const connection = new Connection(endpoint, commitment);
  const publicKey = new PublicKey(mint);
  const account = await connection.getParsedAccountInfo(publicKey, commitment);
  const value = account.value;
  if (!value) return { network: 'solana-mainnet', mint, found: false };
  const parsed = value.data?.parsed;
  const info = parsed?.info ?? {};
  const extensions = Array.isArray(info.extensions) ? info.extensions : [];
  const metadata = extensions.find((entry) => entry.extension === 'tokenMetadata')?.state ?? null;
  const scaled = extensions.find((entry) => entry.extension === 'scaledUiAmountConfig')?.state ?? null;
  return {
    network: 'solana-mainnet',
    mint,
    found: true,
    owner: value.owner.toBase58(),
    isToken2022: value.owner.toBase58() === TOKEN_2022_PROGRAM,
    type: parsed?.type ?? null,
    decimals: info.decimals ?? null,
    supply: info.supply ?? null,
    mintAuthority: info.mintAuthority ?? null,
    freezeAuthority: info.freezeAuthority ?? null,
    tokenMetadata: metadata,
    scaledUiAmount: scaled,
    observedAt: new Date().toISOString()
  };
}

export { TOKEN_2022_PROGRAM };
