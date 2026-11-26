// Chain settings for every API route. Defaults are GIWA Sepolia (the judged deployment);
// a mainnet deployment sets the AEGIS_* environment variables in its own Vercel project.
const env = (k, d) => (process.env[k] && process.env[k].trim()) || d;
const explorer = env("AEGIS_EXPLORER", "https://sepolia-explorer.giwa.io").replace(/\/+$/, "");
module.exports = {
  chainId: Number(env("AEGIS_CHAIN_ID", "91342")),
  chainName: env("AEGIS_CHAIN_NAME", "GIWA Sepolia"),
  rpc: env("AEGIS_RPC", "https://sepolia-rpc.giwa.io"),
  explorer,
  explorerApi: explorer + "/api/v2",
  registry: env("AEGIS_REGISTRY", "0x6C831F9d7051E94589807D2C3d924bb195b5de94"),
};
