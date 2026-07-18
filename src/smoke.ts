/**
 * End-to-end smoke test: spawns the built server over stdio via the MCP client SDK,
 * lists tools and calls every one of them against the live mainnet API.
 * The account-scoped calls use the public HLP vault address.
 *
 * Run: npm run build && npm run smoke
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const HLP_VAULT = "0xdfc24b077bc1425ad1dea75bcb6f8158e10df303";

const client = new Client({ name: "smoke", version: "0.0.0" });
await client.connect(
  new StdioClientTransport({ command: process.execPath, args: ["dist/index.js"] }),
);

const { tools } = await client.listTools();
console.log(`tools (${tools.length}): ${tools.map((t) => t.name).join(", ")}\n`);

const calls: [string, Record<string, unknown>][] = [
  ["get_markets", { limit: 3 }],
  ["get_markets", { coin: "BTC" }],
  ["get_markets", { sortBy: "funding", limit: 3 }],
  ["get_price", { coins: ["BTC", "ETH"] }],
  ["get_orderbook", { coin: "ETH", depth: 3 }],
  ["get_candles", { coin: "BTC", interval: "1h", count: 3 }],
  ["get_account", { address: HLP_VAULT }],
  ["get_open_orders", { address: HLP_VAULT }],
  ["get_recent_fills", { address: HLP_VAULT, limit: 3 }],
  ["get_funding_paid", { address: HLP_VAULT, hours: 24 }],
  // error paths
  ["get_markets", { coin: "NOPE_COIN" }],
  ["get_account", { address: "0x123" }],
];

let failures = 0;
for (const [name, args] of calls) {
  const res = await client.callTool({ name, arguments: args });
  const content = res.content as { type: string; text: string }[];
  const text = content[0]?.text ?? "";
  const expectError = name === "get_markets" && args.coin === "NOPE_COIN" ? true : args.address === "0x123";
  const failed = Boolean(res.isError) !== Boolean(expectError);
  if (failed) failures++;
  console.log(`${failed ? "FAIL" : " ok "} ${name}(${JSON.stringify(args)})`);
  console.log(`      ${text.replace(/\s+/g, " ").slice(0, 220)}\n`);
}

await client.close();
if (failures > 0) {
  console.error(`${failures} call(s) failed`);
  process.exit(1);
}
console.log("smoke: all calls behaved as expected");
