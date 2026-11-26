#!/usr/bin/env node
/**
 * new-keys.mjs — create the hot keys for a mainnet deployment without ever printing them.
 *
 *   node new-keys.mjs ~/.config/secure-env/aegis-mainnet
 *
 * Writes deployer.key, attester.key and clone.key (mode 600) into that folder (created with mode 700)
 * and prints only the addresses. Refuses to overwrite an existing key file.
 */
import fs from "node:fs";
import path from "node:path";
import { Wallet } from "ethers";

const dir = process.argv[2];
if (!dir) { console.error("usage: node new-keys.mjs <folder outside any git repo>"); process.exit(1); }
const abs = path.resolve(dir.replace(/^~(?=$|\/)/, process.env.HOME || "~"));
if (abs.startsWith("/mnt/")) { console.error("STOP: keep keys inside WSL (e.g. ~/.config/secure-env/...), not on a Windows drive."); process.exit(1); }
fs.mkdirSync(abs, { recursive: true, mode: 0o700 });
for (const name of ["deployer", "attester", "clone"]) {
  const f = path.join(abs, `${name}.key`);
  if (fs.existsSync(f)) { console.log(`${name.padEnd(9)} exists, kept: ${new Wallet(fs.readFileSync(f, "utf8").trim()).address}`); continue; }
  const w = Wallet.createRandom();
  fs.writeFileSync(f, w.privateKey + "\n", { mode: 0o600 });
  console.log(`${name.padEnd(9)} ${w.address}`);
}
console.log(`\nKeys saved in ${abs} (never printed). Fund only: deployer ~0.005 ETH, attester and clone ≤ 0.01 ETH each.`);
