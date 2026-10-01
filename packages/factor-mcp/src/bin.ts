#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { FactorClient, defaultSessionPath } from "@firfi/factor-sdk";
import { createServer } from "./server.js";
const server = createServer(
  FactorClient.fromSession(
    process.env.FACTOR_AUTH_SESSION_PATH || defaultSessionPath(),
  ),
);
await server.connect(new StdioServerTransport());
