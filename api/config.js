// /api/config -> public chain settings for the page, as a script that sets window.AEGIS_CFG.
// Loaded synchronously before the app script, so the page never mixes two networks.
const C = require("./_chain");
module.exports = (req, res) => {
  res.setHeader("content-type", "application/javascript; charset=utf-8");
  res.setHeader("cache-control", "public, max-age=300, s-maxage=3600");
  const cfg = { chainId: C.chainId, chainName: C.chainName, rpc: C.rpc, explorer: C.explorer, registry: C.registry };
  res.status(200).end(`window.AEGIS_CFG=${JSON.stringify(cfg)};`);
};
