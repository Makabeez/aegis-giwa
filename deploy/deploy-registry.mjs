#!/usr/bin/env node
/**
 * deploy-registry.mjs — deploy ScanRegistry to a GIWA network in one command.
 *
 *   node deploy-registry.mjs            dry run: compiles, checks chain + balances, prints the plan
 *   node deploy-registry.mjs --send     deploys and configures (4 transactions at most)
 *
 * Reads deploy/.env (see .env.example). What --send does, in order:
 *   1. deploy ScanRegistry (deployer becomes owner + attester)
 *   2. setAttester(ATTESTER_ADDRESS, true)            if the attester is a different key
 *   3. setAttester(deployer, false)                   so the deploy key keeps no write rights
 *   4. transferOwnership(OWNER_ADDRESS)               proposal only: OWNER_ADDRESS (your Ledger)
 *                                                     must call acceptOwnership() to take over
 *   then verifies the source on Blockscout (best effort) and writes deployments/<chainId>.json.
 *
 * Blast radius: the deployer key spends gas for these 4 transactions and ends with no rights
 * on the registry. Nothing else is touched. Keys are never printed.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import solc from "solc";
import { ethers } from "ethers";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(HERE, "..", "contracts", "ScanRegistry.sol");
const SEND = process.argv.includes("--send");

// --- tiny .env loader (no dependency) ---------------------------------------
const envFile = path.join(HERE, ".env");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
const need = (k) => { const v = process.env[k]; if (!v) die(`${k} missing in deploy/.env`); return v; };
function die(msg) { console.error(`STOP: ${msg}`); process.exit(1); }

const RPC_URL = need("RPC_URL");
const CHAIN_ID = BigInt(need("CHAIN_ID"));
const DEPLOYER_KEY = need("DEPLOYER_KEY");
const ATTESTER = need("ATTESTER_ADDRESS");
const OWNER = need("OWNER_ADDRESS");
const EXPLORER = (process.env.EXPLORER_URL || "").replace(/\/+$/, "");
// optional: more attesters, comma-separated (e.g. the clone-scout key)
const EXTRA = (process.env.EXTRA_ATTESTERS || "").split(",").map((s) => s.trim()).filter(Boolean);
for (const [k, a] of [["ATTESTER_ADDRESS", ATTESTER], ["OWNER_ADDRESS", OWNER], ...EXTRA.map((e) => ["EXTRA_ATTESTERS", e])]) {
  if (!ethers.isAddress(a)) die(`${k} is not an address: ${a}`);
}

// --- compile ------------------------------------------------------------------
const input = {
  language: "Solidity",
  sources: { "contracts/ScanRegistry.sol": { content: fs.readFileSync(SRC, "utf8") } },
  settings: {
    optimizer: { enabled: true, runs: 200 },
    evmVersion: "cancun",
    outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
  },
};
const out = JSON.parse(solc.compile(JSON.stringify(input)));
const errors = (out.errors || []).filter((e) => e.severity === "error");
if (errors.length) die(`compile failed:\n${errors.map((e) => e.formattedMessage).join("\n")}`);
const art = out.contracts["contracts/ScanRegistry.sol"].ScanRegistry;
const compilerVersion = "v" + solc.version().replace(/\.Emscripten.*$/, "");

// --- chain checks ---------------------------------------------------------------
const provider = new ethers.JsonRpcProvider(RPC_URL);
const net = await provider.getNetwork();
if (net.chainId !== CHAIN_ID) die(`RPC is on chain ${net.chainId}, .env says CHAIN_ID=${CHAIN_ID}`);
const deployer = new ethers.Wallet(DEPLOYER_KEY, provider);
// NonceManager: public RPCs can lag on the pending nonce between our back-to-back transactions.
const signer = new ethers.NonceManager(deployer);
const bal = await provider.getBalance(deployer.address);
const factory = new ethers.ContractFactory(art.abi, art.evm.bytecode.object, signer);
const deployGas = await provider.estimateGas(await factory.getDeployTransaction());
const fee = await provider.getFeeData();
const gasPrice = fee.maxFeePerGas ?? fee.gasPrice ?? 0n;
const worst = (deployGas + 3n * 60_000n) * gasPrice;

console.log(`network      : chain ${net.chainId} via ${new URL(RPC_URL).host}`);
console.log(`compiler     : ${compilerVersion}, optimizer 200, evm cancun`);
console.log(`deployer     : ${deployer.address}  balance ${ethers.formatEther(bal)} ETH`);
console.log(`attester     : ${ATTESTER}${ATTESTER.toLowerCase() === deployer.address.toLowerCase() ? "  (same key as deployer)" : ""}`);
console.log(`owner (Ledger): ${OWNER}  — must call acceptOwnership() after deploy`);
console.log(`gas estimate : deploy ${deployGas}, worst case total ≈ ${ethers.formatEther(worst)} ETH`);
if (bal < worst) die("deployer balance is below the worst-case cost");
if (!SEND) { console.log("\nDRY RUN — nothing sent. Re-run with --send to deploy."); process.exit(0); }

// --- deploy + configure ---------------------------------------------------------
const reg = await factory.deploy();
console.log(`deploy tx    : ${reg.deploymentTransaction().hash}`);
await reg.waitForDeployment();
const addr = await reg.getAddress();
console.log(`ScanRegistry : ${addr}`);

const sameKey = ATTESTER.toLowerCase() === deployer.address.toLowerCase();
const step = async (label, p) => { const tx = await p; await tx.wait(); console.log(`${label.padEnd(13)}: ${tx.hash}`); };
if (!sameKey) await step("add attester", reg.setAttester(ATTESTER, true));
for (const extra of EXTRA) await step("add attester", reg.setAttester(extra, true));
if (!sameKey && !EXTRA.some((e) => e.toLowerCase() === deployer.address.toLowerCase())) {
  await step("drop deployer", reg.setAttester(deployer.address, false));
}
if (OWNER.toLowerCase() !== deployer.address.toLowerCase()) {
  await step("propose owner", reg.transferOwnership(OWNER));
}

// sanity reads
const checks = {
  attesterEnabled: await reg.isAttester(ATTESTER),
  deployerAttester: await reg.isAttester(deployer.address),
  owner: await reg.owner(),
  pendingOwner: await reg.pendingOwner(),
  version: await reg.VERSION(),
};
console.log("state        :", checks);

// --- verify on Blockscout (best effort) -------------------------------------------
let verified = "skipped (no EXPLORER_URL)";
if (EXPLORER) {
  try {
    const std = { ...input, settings: { ...input.settings, outputSelection: { "*": { "*": ["*"] } } } };
    const form = new FormData();
    form.append("compiler_version", compilerVersion);
    form.append("license_type", "mit");
    form.append("contract_name", "ScanRegistry");
    form.append("autodetect_constructor_args", "true");
    form.append("files[0]", new Blob([JSON.stringify(std)], { type: "application/json" }), "input.json");
    const r = await fetch(`${EXPLORER}/api/v2/smart-contracts/${addr}/verification/via/standard-input`, { method: "POST", body: form, headers: { "User-Agent": "curl/8.5.0" } });
    verified = `submitted (HTTP ${r.status}) — check ${EXPLORER}/address/${addr}?tab=contract in a minute`;
  } catch (e) {
    verified = `failed (${e.message}) — verify by hand with deployments/${net.chainId}-input.json`;
  }
}
console.log(`verification : ${verified}`);

// --- record --------------------------------------------------------------------------
const dir = path.join(HERE, "deployments");
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, `${net.chainId}.json`), JSON.stringify({
  chainId: Number(net.chainId), registry: addr, deployTx: reg.deploymentTransaction().hash,
  attester: ATTESTER, proposedOwner: OWNER, compiler: compilerVersion, optimizerRuns: 200, evmVersion: "cancun",
  deployedAt: new Date().toISOString(),
}, null, 2));
fs.writeFileSync(path.join(dir, `${net.chainId}-input.json`), JSON.stringify(input, null, 2));
console.log(`\nSaved deployments/${net.chainId}.json`);
console.log(`NEXT: with the Ledger (${OWNER}), open the registry on the explorer → Write contract → acceptOwnership().`);
