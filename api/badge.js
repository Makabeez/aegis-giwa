// /api/badge?address=0x... -> SVG risk badge (shields-style), cacheable.
// Reads the on-chain ScanRegistry only — no AI call, so it's cheap and safe to embed.
// Usage:  <img src="https://aegis-giwa-makabeezs-projects.vercel.app/api/badge?address=0x..." alt="Aegis risk score">

const RPC = "https://sepolia-rpc.giwa.io";
const REGISTRY = "0x6C831F9d7051E94589807D2C3d924bb195b5de94";
// keccak("getAttestation(address)") -> selector
const SEL_GET = "0xf9b71797";
const SEL_HAS = "0xe14d9449";
// Dojang: only the Upbit attester means KYC. Shown as a "verified deployer"
// mark; never affects the score.
const DOJANG_SCROLL = "0xd5077b67dcb56caC8b270C7788FC3E6ee03F17B9";
const UPBIT_ATTESTER = "0xd99b42e778498aa3c9c1f6a012359130252780511687a35982e8e52735453034";
const SEL_IS_VERIFIED = "0xba03e205";
const EXPLORER_API = "https://sepolia-explorer.giwa.io/api/v2";

async function upbitVerifiedDeployer(addr) {
  try {
    const r = await fetch(`${EXPLORER_API}/addresses/${addr}`, { headers: { "User-Agent": "Aegis/1.0", Accept: "application/json" } });
    if (!r.ok) return false;
    const dep = (await r.json()).creator_address_hash;
    if (!dep) return false;
    const res = await ethCall(SEL_IS_VERIFIED + pad(dep) + pad(UPBIT_ATTESTER), DOJANG_SCROLL);
    return parseInt(res, 16) === 1;
  } catch (_) { return false; }
}

async function ethCall(data, to) {
  const r = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json", "User-Agent": "Aegis/1.0" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to: to || REGISTRY, data }, "latest"] }),
  });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message);
  return j.result;
}
const pad = (a) => a.replace(/^0x/, "").toLowerCase().padStart(64, "0");
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function svg(label, value, color, w2) {
  const w1 = 54, w = w1 + w2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="20" role="img" aria-label="${esc(label)}: ${esc(value)}">
<title>${esc(label)}: ${esc(value)}</title>
<linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient>
<clipPath id="r"><rect width="${w}" height="20" rx="3" fill="#fff"/></clipPath>
<g clip-path="url(#r)">
  <rect width="${w1}" height="20" fill="#0F1729"/>
  <rect x="${w1}" width="${w2}" height="20" fill="${color}"/>
  <rect width="${w}" height="20" fill="url(#s)"/>
</g>
<g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">
  <text x="${w1 / 2}" y="14" fill="#00D1B2">Aegis</text>
  <text x="${w1 + w2 / 2}" y="14">${esc(value)}</text>
</g></svg>`;
}

module.exports = async (req, res) => {
  const address = String((req.query && req.query.address) || "").trim();
  res.setHeader("content-type", "image/svg+xml; charset=utf-8");
  res.setHeader("cache-control", "public, max-age=300, s-maxage=900, stale-while-revalidate=86400");
  res.setHeader("access-control-allow-origin", "*");
  try {
    if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return res.status(200).end(svg("Aegis", "bad address", "#6C7A93", 78));

    const has = await ethCall(SEL_HAS + pad(address));
    if (!parseInt(has, 16)) return res.status(200).end(svg("Aegis", "unscanned", "#6C7A93", 70));

    const raw = await ethCall(SEL_GET + pad(address));
    const words = [];
    for (let i = 0; i < 6; i++) words.push(raw.slice(2 + i * 64, 2 + (i + 1) * 64));
    const score = parseInt(words[0], 16);

    const color = score >= 60 ? "#FF5C6C" : score >= 25 ? "#F5A623" : "#35D07F";
    let label = score >= 60 ? `${score}/100 high` : score >= 25 ? `${score}/100 medium` : `${score}/100 low`;
    if (await upbitVerifiedDeployer(address)) label += " \u2713";  // KYC-verified deployer
    const w = Math.ceil(label.length * 7.2) + 16;  // fits Verdana 11px; the fixed 84px clipped "39/100 medium"
    return res.status(200).end(svg("Aegis", label, color, w));
  } catch (e) {
    return res.status(200).end(svg("Aegis", "unavailable", "#6C7A93", 80));
  }
};
