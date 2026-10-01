import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { packPackages, auditPackages } from "./package-audit.mjs";
const directory = mkdtempSync(join(tmpdir(), "factor-consumer-"));
try {
  const packs = join(directory, "packs");
  mkdirSync(packs);
  const archives = packPackages(packs);
  auditPackages(archives);
  const consumer = join(directory, "consumer");
  mkdirSync(consumer);
  writeFileSync(
    join(consumer, "package.json"),
    JSON.stringify({ private: true, type: "module" }),
  );
  const manager = process.argv.includes("--pnpm") ? "pnpm" : "npm";
  if (manager === "pnpm") {
    // Until registry publication, resolve the inter-package SDK dependency from its release tarball.
    writeFileSync(
      join(consumer, "package.json"),
      JSON.stringify({
        private: true,
        type: "module",
        pnpm: { overrides: { "@firfi/factor-sdk": "file:" + archives[0] } },
      }),
    );
  }
  execFileSync(
    manager,
    [manager === "npm" ? "install" : "add", ...archives, "--ignore-scripts"],
    { cwd: consumer, stdio: "pipe", timeout: 120000 },
  );
  const script = `import {createRequire} from 'node:module';
 import {realpathSync} from 'node:fs';
 const require=createRequire(realpathSync('node_modules/@firfi/factor-mcp/dist/bin.js'));
 const {Client}=await import(require.resolve('@modelcontextprotocol/sdk/client/index.js'));
 const {StdioClientTransport}=await import(require.resolve('@modelcontextprotocol/sdk/client/stdio.js'));
 import {FactorClient} from '@firfi/factor-sdk';
 const c=new Client({name:'clean-consumer',version:'1'});
 try{await c.connect(new StdioClientTransport({command:process.execPath,args:['node_modules/@firfi/factor-mcp/dist/bin.js'],env:{...process.env,FACTOR_AUTH_SESSION_PATH:'missing-test-session.json'}}));
 const tools=await c.listTools();if(tools.tools.length!==10)throw Error('Missing tools');
 const health=await c.callTool({name:'factor_check_session_health',arguments:{}});if(!health.isError)throw Error('Expected authentication guidance');
 console.log('Clean installation: 10 MCP tools and safe missing-session guidance');}finally{await c.close();}`;
  writeFileSync(join(consumer, "smoke.mjs"), script);
  execFileSync(process.execPath, ["smoke.mjs"], {
    cwd: consumer,
    stdio: "inherit",
    timeout: 30000,
  });
  const cli = execFileSync(
    process.execPath,
    ["node_modules/@firfi/factor-cli/dist/bin.js", "auth", "status"],
    {
      cwd: consumer,
      env: {
        ...process.env,
        FACTOR_AUTH_SESSION_PATH: "missing-test-session.json",
      },
      encoding: "utf8",
      stdio: "pipe",
    },
  );
} catch (error) {
  // CLI authentication error is expected, but unrelated failures must fail the smoke test.
  if (
    error.status !== 1 ||
    !String(error.stderr).includes("Factor session missing or invalid")
  )
    throw error;
  console.log("Installed CLI executes with safe missing-session guidance");
} finally {
  rmSync(directory, { recursive: true, force: true });
}
