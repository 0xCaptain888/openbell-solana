import { createHash } from 'node:crypto';

export const DECISIONS = Object.freeze({ VERIFIED: 'VERIFIED', BLOCKED: 'BLOCKED', FROZEN: 'FROZEN' });

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function hashEvidence(value) {
  return createHash('sha256').update(stable(value)).digest('hex');
}

export function classifyMarket({ underlyingOpen = false, corporateActionPending = false } = {}) {
  if (corporateActionPending) return 'CORPORATE_ACTION_WINDOW';
  return underlyingOpen ? 'UNDERLYING_MARKET_OPEN' : 'UNDERLYING_MARKET_CLOSED';
}

export function evaluateExecution(input) {
  const {
    taskId = `openbell-${Date.now()}`,
    asset = 'AAPLx',
    mint = 'demo-mint',
    issuer = 'demo-issuer',
    underlyingOpen = false,
    referencePrice,
    executablePrice,
    maxPremiumBps = 50,
    quoteAgeSeconds = 0,
    maxQuoteAgeSeconds = 15,
    liquidityUsd = 0,
    minLiquidityUsd = 10000,
    corporateActionPending = false,
    eligible = true,
    routeAvailable = true,
    orderNotionalUsd = 10,
    maxOrderNotionalUsd = 100,
    rawBalance = null,
    uiMultiplier = 1,
    requestedUiAmount = null,
    requestedRawAmount = null,
    route = 'Jupiter / Solana',
    observedAt = new Date().toISOString()
  } = input;

  const premiumBps = referencePrice > 0 && executablePrice != null
    ? Math.round(((executablePrice - referencePrice) / referencePrice) * 10000)
    : null;
  const expectedRawAmount = requestedUiAmount == null ? null : requestedUiAmount / uiMultiplier;
  const rawScaledMatch = requestedRawAmount == null || expectedRawAmount == null
    ? true
    : Math.abs(requestedRawAmount - expectedRawAmount) <= 1e-9;
  const checks = {
    eligible,
    quoteFresh: quoteAgeSeconds <= maxQuoteAgeSeconds,
    premiumWithinPolicy: premiumBps != null && premiumBps <= maxPremiumBps,
    liquidityHealthy: liquidityUsd >= minLiquidityUsd,
    notionalWithinPolicy: orderNotionalUsd <= maxOrderNotionalUsd,
    rawScaledAmountCorrect: rawScaledMatch,
    issuerBound: Boolean(mint && issuer)
  };
  if (!routeAvailable) checks.routeAvailable = false;
  const reasons = [];
  if (!eligible) reasons.push('jurisdiction_not_eligible');
  if (!routeAvailable) reasons.push('no_executable_route');
  if (corporateActionPending) reasons.push('corporate_action_transition');
  if (!checks.quoteFresh) reasons.push('quote_stale');
  if (!checks.premiumWithinPolicy) reasons.push('off_hours_premium_exceeded');
  if (!checks.liquidityHealthy) reasons.push('thin_liquidity');
  if (!checks.notionalWithinPolicy) reasons.push('order_notional_exceeded');
  if (!checks.rawScaledAmountCorrect) reasons.push('scaled_amount_used_as_raw_amount');
  if (!checks.issuerBound) reasons.push('asset_identity_unbound');
  const decision = corporateActionPending
    ? DECISIONS.FROZEN
    : reasons.length > 0 ? DECISIONS.BLOCKED : DECISIONS.VERIFIED;
  const marketState = classifyMarket({ underlyingOpen, corporateActionPending });
  const body = {
    receiptVersion: 'openbell.v1', taskId, decision, asset, mint, issuer,
    marketState, referencePrice, executablePrice, premiumBps, maxPremiumBps,
    quoteAgeSeconds, maxQuoteAgeSeconds, liquidityUsd, minLiquidityUsd,
    orderNotionalUsd, maxOrderNotionalUsd, uiMultiplier, requestedUiAmount,
    requestedRawAmount, expectedRawAmount, route, observedAt, checks, reasons
  };
  return { ...body, evidenceHash: hashEvidence(body) };
}

export const demoFixtures = {
  verified: {
    taskId: 'judge-verified-aaplx', asset: 'AAPLx', mint: 'AAPLx-mainnet-mint', issuer: 'Backed / xStocks',
    underlyingOpen: false, referencePrice: 210, executablePrice: 210.55, maxPremiumBps: 50,
    quoteAgeSeconds: 1.4, liquidityUsd: 250000, minLiquidityUsd: 10000, orderNotionalUsd: 20,
    maxOrderNotionalUsd: 100, requestedUiAmount: 0.05, requestedRawAmount: 0.05, uiMultiplier: 1,
    route: 'Jupiter → Solana settlement', observedAt: '2026-09-13T02:00:00.000Z'
  },
  blocked: {
    taskId: 'judge-blocked-tslax', asset: 'TSLAx', mint: 'TSLAx-mainnet-mint', issuer: 'Backed / xStocks',
    underlyingOpen: false, referencePrice: 350, executablePrice: 361.2, maxPremiumBps: 50,
    quoteAgeSeconds: 2.1, liquidityUsd: 18000, minLiquidityUsd: 10000, orderNotionalUsd: 20,
    maxOrderNotionalUsd: 100, requestedUiAmount: 0.05, requestedRawAmount: 0.05, uiMultiplier: 1,
    route: 'Jupiter → Solana settlement', observedAt: '2026-09-13T02:00:00.000Z'
  },
  frozen: {
    taskId: 'judge-frozen-nvdax', asset: 'NVDAx', mint: 'NVDAx-mainnet-mint', issuer: 'Backed / xStocks',
    underlyingOpen: false, referencePrice: 178, executablePrice: 178.2, maxPremiumBps: 50,
    quoteAgeSeconds: 1.2, liquidityUsd: 190000, minLiquidityUsd: 10000, orderNotionalUsd: 20,
    maxOrderNotionalUsd: 100, corporateActionPending: true, requestedUiAmount: 0.1,
    requestedRawAmount: 0.1, uiMultiplier: 1, route: 'Jupiter → Solana settlement',
    observedAt: '2026-09-13T02:00:00.000Z'
  },
  scaledMismatch: {
    taskId: 'judge-scaled-mismatch', asset: 'AAPLx', mint: 'AAPLx-mainnet-mint', issuer: 'Backed / xStocks',
    underlyingOpen: true, referencePrice: 210, executablePrice: 210.1, maxPremiumBps: 50,
    quoteAgeSeconds: 1, liquidityUsd: 250000, minLiquidityUsd: 10000, orderNotionalUsd: 10,
    maxOrderNotionalUsd: 100, requestedUiAmount: 10.08, requestedRawAmount: 10.08, uiMultiplier: 1.008,
    route: 'Wallet transfer adapter', observedAt: '2026-09-13T14:00:00.000Z'
  }
};
