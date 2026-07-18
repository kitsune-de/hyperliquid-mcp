#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  CANDLE_INTERVALS,
  getAccount,
  getCandles,
  getFundingPaid,
  getMarkets,
  getOpenOrders,
  getOrderbook,
  getPrices,
  getRecentFills,
} from "./hl.js";

const server = new McpServer({ name: "hyperliquid-mcp", version: "0.1.0" });

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

const ok = (data: unknown): ToolResult => ({
  content: [{ type: "text", text: JSON.stringify(data, null, 1) }],
});

const wrap =
  <A>(fn: (args: A) => Promise<unknown>) =>
  async (args: A): Promise<ToolResult> => {
    try {
      return ok(await fn(args));
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    }
  };

const addressSchema = z
  .string()
  .describe("EVM address of the Hyperliquid account, e.g. 0xdfc24b077bc1425ad1dea75bcb6f8158e10df303");

server.registerTool(
  "get_markets",
  {
    title: "Hyperliquid perp markets",
    description:
      "List Hyperliquid perpetual markets with mark price, 24h change, 24h volume, open interest, funding rate (1h and annualized APR) and max leverage. " +
      "Pass `coin` for a single market, or sort/limit the full list.",
    inputSchema: {
      coin: z.string().optional().describe("Single market to fetch, e.g. BTC, ETH, HYPE"),
      sortBy: z
        .enum(["volume", "funding", "change", "openInterest"])
        .optional()
        .describe("Sort key for the list (default: volume). funding/change sort by absolute value"),
      limit: z.number().int().min(1).max(500).optional().describe("Max markets to return (default 20)"),
    },
  },
  wrap(async (args: { coin?: string; sortBy?: "volume" | "funding" | "change" | "openInterest"; limit?: number }) =>
    getMarkets(args),
  ),
);

server.registerTool(
  "get_price",
  {
    title: "Mid prices",
    description:
      "Current mid prices. Pass `coins` for specific perp markets (e.g. [\"BTC\", \"ETH\"]) or omit to get all perp mids at once.",
    inputSchema: {
      coins: z.array(z.string()).optional().describe("Coins to fetch; omit for all perp markets"),
    },
  },
  wrap(async (args: { coins?: string[] }) => getPrices(args.coins)),
);

server.registerTool(
  "get_orderbook",
  {
    title: "Order book snapshot",
    description:
      "L2 order book snapshot for a perp market: best bid/ask, spread, and aggregated levels per side.",
    inputSchema: {
      coin: z.string().describe("Perp market, e.g. BTC"),
      depth: z.number().int().min(1).max(20).optional().describe("Levels per side (default 10)"),
    },
  },
  wrap(async (args: { coin: string; depth?: number }) => getOrderbook(args.coin, args.depth ?? 10)),
);

server.registerTool(
  "get_candles",
  {
    title: "OHLCV candles",
    description: `Historical OHLCV candles for a perp market. Intervals: ${CANDLE_INTERVALS.join(", ")}.`,
    inputSchema: {
      coin: z.string().describe("Perp market, e.g. ETH"),
      interval: z.string().optional().describe("Candle interval (default 1h)"),
      count: z.number().int().min(1).max(500).optional().describe("Number of candles (default 100)"),
    },
  },
  wrap(async (args: { coin: string; interval?: string; count?: number }) =>
    getCandles(args.coin, args.interval ?? "1h", args.count ?? 100),
  ),
);

server.registerTool(
  "get_account",
  {
    title: "Account state",
    description:
      "Full account state for any Hyperliquid address: account value, margin usage, withdrawable, every open perp position " +
      "(side, size, entry, liquidation price, unrealized PnL, leverage) and spot balances. Read-only public data.",
    inputSchema: { address: addressSchema },
  },
  wrap(async (args: { address: string }) => getAccount(args.address)),
);

server.registerTool(
  "get_open_orders",
  {
    title: "Open orders",
    description: "Resting open orders for an address: side, price, size, order type, trigger info.",
    inputSchema: { address: addressSchema },
  },
  wrap(async (args: { address: string }) => getOpenOrders(args.address)),
);

server.registerTool(
  "get_recent_fills",
  {
    title: "Recent fills",
    description:
      "Most recent trade fills for an address: direction (Open Long / Close Short / ...), price, size, notional, closed PnL and fees.",
    inputSchema: {
      address: addressSchema,
      limit: z.number().int().min(1).max(200).optional().describe("Max fills to return (default 20)"),
    },
  },
  wrap(async (args: { address: string; limit?: number }) => getRecentFills(args.address, args.limit ?? 20)),
);

server.registerTool(
  "get_funding_paid",
  {
    title: "Funding paid/received",
    description:
      "Net funding paid or received by an address over the last N hours, broken down by coin. Positive = received, negative = paid.",
    inputSchema: {
      address: addressSchema,
      hours: z.number().int().min(1).max(720).optional().describe("Lookback window in hours (default 24)"),
    },
  },
  wrap(async (args: { address: string; hours?: number }) => getFundingPaid(args.address, args.hours ?? 24)),
);

const transport = new StdioServerTransport();
await server.connect(transport);
