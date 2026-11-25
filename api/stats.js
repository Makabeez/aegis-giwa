// /api/stats -> live coverage numbers. No AI call; cheap, cacheable, public.
// Feeds the public stats page and gives reviewers a number they can verify themselves.

const RPC = "https://sepolia-rpc.giwa.io";
const EXPLORER_API = "https://sepolia-explorer.giwa.io/api/v2";
const REGISTRY = "0x6C831F9d7051E94589807D2C3d924bb195b5de94";
const SEL_TOTAL = "0x60485742"; // totalAttestations()

module.exports = async (req, res) => {
  res.setHeader("content-type", "application/json");
  res.setHeader("cache-control", "public, max-age=120, s-maxage=600, stale-while-revalidate=86400");
  res.setHeader("access-control-allow-origin", "*");
  try {
    const r = await fetch(RPC, {
      method: "POST",
      headers: { "content-type": "application/json", "User-Agent": "Aegis/1.0" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to: REGISTRY, data: SEL_TOTAL }, "latest"] }),
    });
    const j = await r.json();
    const total = parseInt(j.result, 16) || 0;

    let verifiedTotal = null;
    try {
      const c = await fetch(`${EXPLORER_API}/stats`, { headers: { "User-Agent": "Aegis/1.0", Accept: "application/json" } });
      if (c.ok) {
        const d = await c.json();
        const n = parseInt(String(d.total_verified_contracts || "").replace(/[^0-9]/g, ""), 10);
        if (!isNaN(n)) verifiedTotal = n;
      }
    } catch (_) {}

    return res.status(200).end(JSON.stringify({
      ok: true,
      network: "GIWA Sepolia",
      chainId: 91342,
      registry: REGISTRY,
      totalAttestations: total,
      verifiedContractsOnChain: verifiedTotal,
      coveragePct: verifiedTotal ? Math.round((total / verifiedTotal) * 1000) / 10 : null,
      engine: "claude-sonnet-4-6 + static bytecode",
      updated: new Date().toISOString(),
    }));
  } catch (e) {
    return res.status(500).end(JSON.stringify({ ok: false, error: e.message }));
  }
};
