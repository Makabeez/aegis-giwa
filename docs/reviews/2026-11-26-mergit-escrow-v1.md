# Hand review — MergitEscrow v1 (`0xfFcF206ce1474263aAA3336fB9c8bC3d632E5879`)

**Date:** 2026-11-26 · **Reviewer:** Aymen Gnaba (Aegis) · **Chain:** GIWA Sepolia (91342)
**Trigger:** AI rescan on 2026-11-26 (tx `0x2354e5b2…55fb`) scored v1 **38/100** with two `high` findings. A hand check of the verified source shows both `high` findings are wrong. Per our published process ("Think a score is wrong? Open an issue and we re-check it by hand"), the findings are corrected below and the score is recomputed with the same published formula.

## Findings the AI got wrong

1. **`settle()` — "a reverting developer or feeRecipient permanently locks bounty funds" (AI: high). Not a lock.**
   `settle()` sets `status = Settled` and then calls `_send()`, which reverts on failure (`PayoutFailed`). The revert undoes the whole transaction, including the status change, so the bounty stays `Open`. The verifier can settle to another address before the deadline, and after the deadline the funder recovers everything with `refund()`. Real impact: the payout can be **blocked**, not locked. Kept as finding 2 below, at medium.

2. **`refund()` — "a reverting funder permanently locks bounty funds" (AI: high). Self-inflicted.**
   Only the funder can call `refund()`, and the funds go back to the funder. A funder that is a contract rejecting ETH can only lock its own deposit. Kept as finding 3 below, at low.

3. **`settle()` — "deadline check is off-by-one" (AI: low). Not a defect.**
   `settle()` is allowed while `block.timestamp <= deadline` and `refund()` while `block.timestamp > deadline`. The two windows meet exactly with no gap and no overlap. Removed.

## Corrected findings

| # | Severity | Category | Finding |
|---|---|---|---|
| 1 | medium | access-control | `settle()`: the verifier can name any developer address, including its own. The NatSpec says the verifier cannot pay itself, but no check enforces it. Trust assumption on the verifier. |
| 2 | medium | other | `settle()`: the payout is blocked if the developer or `feeRecipient` rejects ETH. Funds are not locked: the bounty stays `Open` and the funder can `refund()` after the deadline. |
| 3 | low | other | `refund()`: a funder contract that rejects ETH cannot recover its own deposit (self-inflicted). |
| 4 | low | other | `nextBountyId` overflow (theoretical; Solidity 0.8 checked arithmetic). |
| 5 | low | bytecode | Makes external calls. |

## Score (published formula)

`score = base + top severity + 0.35 × remaining severities`, with base 6 and weights low 2 · medium 8 · high 20 · critical 45.

`6 + 8 + 0.35 × (8 + 2 + 2 + 2) = 18.9 → 19/100` · flags: access-control (`2`).

The on-chain `reportHash` for this correction is the keccak256 of this file.
