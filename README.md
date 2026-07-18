# hyperliquid-mcp

**Give your AI agent eyes on Hyperliquid.** A tiny, read-only [MCP](https://modelcontextprotocol.io) server that lets Claude (or any MCP-compatible agent) query Hyperliquid perp markets, funding rates, order books, candles — and the positions, fills and funding of **any** address.

- 🔑 **No API keys, no wallets, no signing** — only the public Info API. It cannot trade, ever.
- 📦 **Zero config** — one entry in your MCP config and you're done.
- 🪶 **Tiny** — two source files, two dependencies (MCP SDK + zod).

## Quick start

### Claude Code

```bash
claude mcp add hyperliquid -- npx -y hyperliquid-mcp
```

### Claude Desktop / Cursor / any MCP client

```json
{
  "mcpServers": {
    "hyperliquid": {
      "command": "npx",
      "args": ["-y", "hyperliquid-mcp"]
    }
  }
}
```

### From source

```bash
git clone https://github.com/kitsune-de/hyperliquid-mcp
cd hyperliquid-mcp && npm install && npm run build
# then point your MCP client at: node /path/to/hyperliquid-mcp/dist/index.js
```

## What you can ask

> *"What are the most extreme funding rates on Hyperliquid right now?"*
>
> *"Show the open positions and liquidation prices of 0xabc… — how close is it to liquidation?"*
>
> *"How much funding did my account pay over the last week, per coin?"*
>
> *"Pull 4h candles for HYPE and describe the trend."*

## Tools

| Tool | Arguments | Returns |
| --- | --- | --- |
| `get_markets` | `coin?`, `sortBy?` (volume · funding · change · openInterest), `limit?` | Perp markets: mark price, 24h change & volume, open interest, funding (1h + annualized APR), max leverage |
| `get_price` | `coins?` | Mid prices for given coins, or all perp mids |
| `get_orderbook` | `coin`, `depth?` | L2 snapshot: best bid/ask, spread %, levels per side |
| `get_candles` | `coin`, `interval?`, `count?` | OHLCV candles (1m … 1w) |
| `get_account` | `address` | Account value, margin usage, withdrawable, every perp position (side, size, entry, liq price, uPnL, leverage), spot balances |
| `get_open_orders` | `address` | Resting orders: side, price, size, type, trigger info |
| `get_recent_fills` | `address`, `limit?` | Recent fills: direction, price, size, notional, closed PnL, fees |
| `get_funding_paid` | `address`, `hours?` | Net funding paid/received per coin over a window |

All account tools work on **any** address — your own, a whale's, a vault's. It's all public on-chain data.

## Configuration

| Env var | Default | Purpose |
| --- | --- | --- |
| `HL_INFO_URL` | `https://api.hyperliquid.xyz/info` | Set to `https://api.hyperliquid-testnet.xyz/info` for testnet |

## Development

```bash
npm install
npm run build
npm run smoke   # spawns the server over stdio and exercises every tool against live mainnet
```

## Disclaimer

Read-only market data tooling. Not financial advice; no affiliation with Hyperliquid.

## License

MIT
