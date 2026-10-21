#!/usr/bin/env node
/**
 * stdio entry point (npx -y @deeplinknow/mcp). stdout carries the MCP
 * protocol, so nothing else is written there; startup errors go to stderr
 * without the environment (MCP-62).
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";

async function main() {
  const server = createServer();
  await server.connect(new StdioServerTransport());
}

main().catch((error: unknown) => {
  process.stderr.write(
    `deeplinknow-mcp failed to start: ${error instanceof Error ? error.message : "unknown error"}\n`
  );
  process.exit(1);
});
