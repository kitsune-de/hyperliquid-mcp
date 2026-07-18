/**
 * Thin client over the Hyperliquid public Info API (read-only, no keys).
 * https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint
 */

const INFO_URL = process.env.HL_INFO_URL ?? "https://api.hyperliquid.xyz/info";

export class HlApiError extends Error {}

async function info<T>(payload: Record<string, unknown>): Promise<T> {
  const res = await fetch(INFO_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new HlApiError(`Hyperliquid API ${res.status}: ${body.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

export function assertAddress(address: string): string {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
    throw new HlApiError(`"${address}" is not a valid EVM address (expected 0x + 40 hex chars)`);
  }
  return address.toLowerCase();
}

const num = (v: string | number | null | undefined): number | null =>
  v === null || v === undefined || v === "" ? null : Number(v);

const round = (v: number | null, dp = 6): number | null =>
  v === null || Number.isNaN(v) ? null : Number(v.toFixed(dp));

const iso = (ms: number): string => new Date(ms).toISOString();

// ---------- raw API shapes (only the fields we use) ----------

interface RawAssetMeta {
  name: string;
  szDecimals: number;
  maxLeverage: number;
  isDelisted?: boolean;
}

interface RawAssetCtx {
  funding: string;
  openInterest: string;
  prevDayPx: string;
  dayNtlVlm: string;
  premium: string | null;
  oraclePx: string;
  markPx: string;
  midPx: string | null;
}

interface RawPosition {
  coin: string;
  szi: string;
  entryPx: string;
  positionValue: string;
  unrealizedPnl: string;
  returnOnEquity: string;
  liquidationPx: string | null;
  marginUsed: string;
  leverage: { type: string; value: number };
}

interface RawClearinghouseState {
  assetPositions: { position: RawPosition }[];
  marginSummary: { accountValue: string; totalMarginUsed: string; totalNtlPos: string };
  withdrawable: string;
}

interface RawSpotBalance {
  coin: string;
  total: string;
  hold: string;
  entryNtl: string;
}

interface RawOpenOrder {
  coin: string;
  side: "B" | "A";
  limitPx: string;
  sz: string;
  origSz: string;
  oid: number;
  timestamp: number;
  orderType?: string;
  reduceOnly?: boolean;
  isTrigger?: boolean;
  triggerPx?: string;
  triggerCondition?: string;
}

interface RawFill {
  coin: string;
  px: string;
  sz: string;
  side: "B" | "A";
  dir: string;
  time: number;
  closedPnl: string;
  fee: string;
  feeToken: string;
  hash: string;
  crossed: boolean;
}

interface RawFundingDelta {
  time: number;
  delta: { coin: string; usdc: string; szi: string; fundingRate: string };
}

interface RawCandle {
  t: number;
  o: string;
  h: string;
  l: string;
  c: string;
  v: string;
  n: number;
}

interface RawL2Book {
  coin: string;
  time: number;
  levels: [{ px: string; sz: string; n: number }[], { px: string; sz: string; n: number }[]];
}

// ---------- markets ----------

export interface Market {
  coin: string;
  markPx: number | null;
  midPx: number | null;
  oraclePx: number | null;
  change24hPct: number | null;
  volume24hUsd: number | null;
  openInterestUsd: number | null;
  fundingRate1h: number | null;
  fundingAprPct: number | null;
  premium: number | null;
  maxLeverage: number;
}

export type MarketSort = "volume" | "funding" | "change" | "openInterest";

export async function getMarkets(opts: {
  coin?: string;
  sortBy?: MarketSort;
  limit?: number;
}): Promise<Market[]> {
  const [meta, ctxs] = await info<[{ universe: RawAssetMeta[] }, RawAssetCtx[]]>({
    type: "metaAndAssetCtxs",
  });

  let markets: Market[] = meta.universe
    .map((m, i): Market | null => {
      const ctx = ctxs[i];
      if (!ctx || m.isDelisted) return null;
      const markPx = num(ctx.markPx);
      const prevDayPx = num(ctx.prevDayPx);
      const oi = num(ctx.openInterest);
      const funding = num(ctx.funding);
      return {
        coin: m.name,
        markPx,
        midPx: num(ctx.midPx),
        oraclePx: num(ctx.oraclePx),
        change24hPct:
          markPx !== null && prevDayPx ? round(((markPx - prevDayPx) / prevDayPx) * 100, 2) : null,
        volume24hUsd: round(num(ctx.dayNtlVlm), 0),
        openInterestUsd: oi !== null && markPx !== null ? round(oi * markPx, 0) : null,
        fundingRate1h: funding,
        fundingAprPct: funding !== null ? round(funding * 24 * 365 * 100, 2) : null,
        premium: num(ctx.premium),
        maxLeverage: m.maxLeverage,
      };
    })
    .filter((m): m is Market => m !== null);

  if (opts.coin) {
    const want = opts.coin.toUpperCase();
    markets = markets.filter((m) => m.coin.toUpperCase() === want);
    if (markets.length === 0) {
      throw new HlApiError(`Unknown perp market "${opts.coin}". Use get_markets without a coin to list all.`);
    }
    return markets;
  }

  const sortBy = opts.sortBy ?? "volume";
  const key = (m: Market): number => {
    switch (sortBy) {
      case "funding":
        return Math.abs(m.fundingAprPct ?? 0);
      case "change":
        return Math.abs(m.change24hPct ?? 0);
      case "openInterest":
        return m.openInterestUsd ?? 0;
      default:
        return m.volume24hUsd ?? 0;
    }
  };
  markets.sort((a, b) => key(b) - key(a));
  return markets.slice(0, opts.limit ?? 20);
}

// ---------- prices ----------

export async function getPrices(coins?: string[]): Promise<Record<string, number>> {
  const mids = await info<Record<string, string>>({ type: "allMids" });
  const out: Record<string, number> = {};
  if (coins && coins.length > 0) {
    for (const c of coins) {
      const key = Object.keys(mids).find((k) => k.toUpperCase() === c.toUpperCase());
      if (!key) throw new HlApiError(`No mid price for "${c}"`);
      out[key] = Number(mids[key]);
    }
    return out;
  }
  for (const [k, v] of Object.entries(mids)) {
    if (!k.startsWith("@")) out[k] = Number(v); // skip internal spot-pair ids
  }
  return out;
}

// ---------- order book ----------

export async function getOrderbook(coin: string, depth: number) {
  const book = await info<RawL2Book>({ type: "l2Book", coin: coin.toUpperCase() });
  const side = (levels: { px: string; sz: string; n: number }[]) =>
    levels.slice(0, depth).map((l) => ({ px: Number(l.px), sz: Number(l.sz), orders: l.n }));
  const bids = side(book.levels[0]);
  const asks = side(book.levels[1]);
  const bestBid = bids[0]?.px ?? null;
  const bestAsk = asks[0]?.px ?? null;
  return {
    coin: book.coin,
    time: iso(book.time),
    bestBid,
    bestAsk,
    spreadPct:
      bestBid !== null && bestAsk !== null ? round(((bestAsk - bestBid) / bestAsk) * 100, 4) : null,
    bids,
    asks,
  };
}

// ---------- candles ----------

const INTERVAL_MS: Record<string, number> = {
  "1m": 60_000,
  "3m": 180_000,
  "5m": 300_000,
  "15m": 900_000,
  "30m": 1_800_000,
  "1h": 3_600_000,
  "2h": 7_200_000,
  "4h": 14_400_000,
  "8h": 28_800_000,
  "12h": 43_200_000,
  "1d": 86_400_000,
  "3d": 259_200_000,
  "1w": 604_800_000,
};

export const CANDLE_INTERVALS = Object.keys(INTERVAL_MS);

export async function getCandles(coin: string, interval: string, count: number) {
  const ms = INTERVAL_MS[interval];
  if (!ms) throw new HlApiError(`Bad interval "${interval}". Use one of: ${CANDLE_INTERVALS.join(", ")}`);
  const endTime = Date.now();
  const startTime = endTime - ms * count;
  const raw = await info<RawCandle[]>({
    type: "candleSnapshot",
    req: { coin: coin.toUpperCase(), interval, startTime, endTime },
  });
  return raw.map((c) => ({
    time: iso(c.t),
    open: Number(c.o),
    high: Number(c.h),
    low: Number(c.l),
    close: Number(c.c),
    volume: Number(c.v),
    trades: c.n,
  }));
}

// ---------- account ----------

export async function getAccount(address: string) {
  const user = assertAddress(address);
  const [perps, spot] = await Promise.all([
    info<RawClearinghouseState>({ type: "clearinghouseState", user }),
    info<{ balances: RawSpotBalance[] }>({ type: "spotClearinghouseState", user }),
  ]);

  const positions = perps.assetPositions.map(({ position: p }) => {
    const size = num(p.szi) ?? 0;
    return {
      coin: p.coin,
      side: size >= 0 ? "long" : "short",
      size: Math.abs(size),
      entryPx: num(p.entryPx),
      positionValueUsd: round(num(p.positionValue), 2),
      unrealizedPnlUsd: round(num(p.unrealizedPnl), 2),
      returnOnEquityPct: round((num(p.returnOnEquity) ?? 0) * 100, 2),
      liquidationPx: num(p.liquidationPx),
      leverage: `${p.leverage.value}x ${p.leverage.type}`,
      marginUsedUsd: round(num(p.marginUsed), 2),
    };
  });

  const spotBalances = spot.balances
    .filter((b) => Number(b.total) > 0)
    .map((b) => ({ coin: b.coin, total: Number(b.total), hold: Number(b.hold) }));

  return {
    address: user,
    accountValueUsd: round(num(perps.marginSummary.accountValue), 2),
    totalMarginUsedUsd: round(num(perps.marginSummary.totalMarginUsed), 2),
    totalNotionalUsd: round(num(perps.marginSummary.totalNtlPos), 2),
    withdrawableUsd: round(num(perps.withdrawable), 2),
    perpPositions: positions,
    spotBalances,
  };
}

// ---------- open orders ----------

export async function getOpenOrders(address: string) {
  const user = assertAddress(address);
  const raw = await info<RawOpenOrder[]>({ type: "frontendOpenOrders", user });
  return raw.map((o) => ({
    coin: o.coin,
    side: o.side === "B" ? "buy" : "sell",
    limitPx: Number(o.limitPx),
    size: Number(o.sz),
    originalSize: Number(o.origSz),
    orderType: o.orderType ?? "limit",
    reduceOnly: o.reduceOnly ?? false,
    trigger: o.isTrigger ? { px: num(o.triggerPx ?? null), condition: o.triggerCondition } : null,
    placedAt: iso(o.timestamp),
    oid: o.oid,
  }));
}

// ---------- fills ----------

export async function getRecentFills(address: string, limit: number) {
  const user = assertAddress(address);
  const raw = await info<RawFill[]>({ type: "userFills", user });
  return raw.slice(0, limit).map((f) => {
    const px = Number(f.px);
    const sz = Number(f.sz);
    return {
      time: iso(f.time),
      coin: f.coin,
      direction: f.dir,
      side: f.side === "B" ? "buy" : "sell",
      px,
      size: sz,
      notionalUsd: round(px * sz, 2),
      closedPnlUsd: round(num(f.closedPnl), 2),
      fee: round(num(f.fee), 4),
      feeToken: f.feeToken,
      taker: f.crossed,
      hash: f.hash,
    };
  });
}

// ---------- funding paid/received ----------

export async function getFundingPaid(address: string, hours: number) {
  const user = assertAddress(address);
  const startTime = Date.now() - hours * 3_600_000;
  const raw = await info<RawFundingDelta[]>({ type: "userFunding", user, startTime });

  const byCoin: Record<string, { netUsd: number; payments: number }> = {};
  let totalUsd = 0;
  for (const { delta } of raw) {
    const usd = Number(delta.usdc);
    totalUsd += usd;
    byCoin[delta.coin] ??= { netUsd: 0, payments: 0 };
    byCoin[delta.coin].netUsd += usd;
    byCoin[delta.coin].payments += 1;
  }
  return {
    address: user,
    periodHours: hours,
    note: "positive = received, negative = paid",
    totalNetUsd: round(totalUsd, 4),
    byCoin: Object.fromEntries(
      Object.entries(byCoin)
        .sort(([, a], [, b]) => Math.abs(b.netUsd) - Math.abs(a.netUsd))
        .map(([coin, v]) => [coin, { netUsd: round(v.netUsd, 4), payments: v.payments }]),
    ),
  };
}
