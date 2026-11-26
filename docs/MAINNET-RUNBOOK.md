# Aegis on GIWA mainnet — runbook

Branch `mainnet` in both repos (`aegis-giwa`, `aegis-watcher`). `main` stays the judged GIWA Sepolia deployment and is never touched by any step below.

## What's ready

| Piece | Where | What it does |
|---|---|---|
| ScanRegistry v1.1.0 | `contracts/ScanRegistry.sol` | Same interface as Sepolia, plus two-step ownership (`transferOwnership` proposes, `acceptOwnership` takes over), so a mistyped owner address can't lock the registry. |
| One-command deploy | `deploy/deploy-registry.mjs` | Dry run by default. `--send` deploys, adds the attesters, removes the deploy key's rights, proposes your Ledger as owner, submits Blockscout verification, and saves `deployments/<chainId>.json`. Tested on a local cancun chain. |
| Network-agnostic app | `api/_chain.js`, `api/config.js` | Every route and the page read `AEGIS_*` variables; defaults are Sepolia. Sepolia-only numbers and examples hide themselves on any other network. |
| Watcher | `aegis-watcher/watcher.js` | Same scanner, now with a daily AI cap (`MAX_AI_PER_DAY`), and every full scan teaches its template to clone-scout. |
| Clone-scout (new) | `aegis-watcher/clone-scout.js` | Finds every new token from mint events (factory-created ones too), matches it to a known template (metadata stripped, PUSH32 masked, minimal proxies resolved), and writes the inherited verdict on-chain (schema 5). It counts unknown templates and alerts at 10/50/200 clones. |

Measured on Sepolia: 598 attested contracts came from only 126 templates. In 1,500 blocks, about 2,000 new token contracts came from about 30 templates. Every Gama token shares one template, and kachi's two implementations resolve to one template too.

## Keys (blast radius)

| Key | Lives | Holds | Can do | Worst case if leaked |
|---|---|---|---|---|
| Ledger | hardware | — | owner: add/remove attesters, transfer ownership | — |
| Deployer | hot, deploy day only | ~0.005 ETH | nothing after deploy | loses leftover gas |
| Watcher attester | Home VPS | ≤ 0.01 ETH | write scores | fake scores until the Ledger revokes it; ≤ 0.01 ETH |
| Clone attester | Home VPS | ≤ 0.01 ETH | write scores | same |

Generate the three hot keys without ever printing them (after `npm i` in `deploy/`):
```
node new-keys.mjs ~/.config/secure-env/aegis-mainnet
```
It prints the three addresses only. To put a key into an `.env` without displaying it: `echo "DEPLOYER_KEY=$(cat ~/.config/secure-env/aegis-mainnet/deployer.key)" >> .env`.

## Rehearsal on Sepolia (after the Nov 30 freeze)

1. `cd /mnt/c/github/aegis-giwa && git fetch && git switch mainnet && cd deploy && npm i`
2. `cp .env.example .env` and fill `DEPLOYER_KEY` (a Sepolia key with ~0.005 ETH), `ATTESTER_ADDRESS`, `OWNER_ADDRESS` (Ledger).
3. `node deploy-registry.mjs` (dry run), then `node deploy-registry.mjs --send`.
4. With the Ledger: open the new registry on the explorer → Write contract → `acceptOwnership()`.
5. `git switch main`. The judged deploy never runs from this branch.

## Launch day

1. **Trigger:** GitHub "Watch → Custom → Releases + all activity" on `giwa-io/chains` and `giwa-io/superchain-registry`, plus GASOK's own channels.
2. **Registry:** fill `deploy/.env` with the mainnet `RPC_URL`, `CHAIN_ID` and `EXPLORER_URL`, the deployer key, `ATTESTER_ADDRESS`, `EXTRA_ATTESTERS=<clone attester>` and `OWNER_ADDRESS=<Ledger>`. Run the dry run, then `--send`. Then `acceptOwnership()` from the Ledger.
3. **App:** a new Vercel project from the `mainnet` branch, with env `AEGIS_CHAIN_ID`, `AEGIS_CHAIN_NAME=GIWA`, `AEGIS_RPC`, `AEGIS_EXPLORER`, `AEGIS_REGISTRY`, plus the same `ANTHROPIC_API_KEY`, `RL_PER_MIN`, `RL_DAILY_MAX` and `AEGIS_INTERNAL_KEY`. Domain `mainnet.aegisgiwa.com`.
4. **Watcher + clone-scout:**
   ```
   cd /mnt/c/github && git clone -b mainnet https://github.com/Makabeez/aegis-watcher.git aegis-watcher-mainnet
   cd aegis-watcher-mainnet && npm i && cp .env.mainnet.example .env   # fill it in
   # seed templates from Sepolia so day one already knows the common launchpad templates:
   GIWA_RPC=https://sepolia-rpc.giwa.io GIWA_EXPLORER=https://sepolia-explorer.giwa.io SCAN_REGISTRY=0x6C831F9d7051E94589807D2C3d924bb195b5de94 node learn-templates.js --from-registry --pages 200
   pm2 start ecosystem.mainnet.config.js && pm2 save
   ```
   Before starting, check `templates.json` for partner templates whose verdict depends on a contract that will change on mainnet. Example: Gama's token template carries the score of the current launchpad. If Gama ships a fixed launchpad, hand-review the new token and record it with `learn-templates.js --review`.
5. **Post** (draft below) as soon as the first mainnet attestation confirms.

## Known limitation (stated in every template report)

Contracts that differ only in 32-byte constants, including address immutables, share a template. A clone inherits its template's verdict even when it points at a different external contract. PUSH20 hard-coded addresses are not masked, so a variant that hard-codes a different fee wallet does not match.

## Launch-day post (draft)

```
Aegis is live on GIWA mainnet.

Every new contract gets an AI risk score on-chain, minutes after deploy. Unverified launchpad tokens too: Aegis matches each clone to templates it has already reviewed.

Check before you sign: mainnet.aegisgiwa.com
```
