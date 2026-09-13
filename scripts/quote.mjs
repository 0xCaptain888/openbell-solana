import { fetchJupiterQuote } from '../src/jupiter-quote.mjs';

const result = await fetchJupiterQuote({
  inputMint: process.env.OPENBELL_INPUT_MINT || 'So11111111111111111111111111111111111111112',
  outputMint: process.env.OPENBELL_STOCK_MINT || 'XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp',
  amount: process.env.OPENBELL_INPUT_AMOUNT || '10000000'
});
console.log(JSON.stringify(result, null, 2));
