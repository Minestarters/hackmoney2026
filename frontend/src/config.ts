export const FACTORY_ADDRESS = import.meta.env.VITE_FACTORY_ADDRESS || "";
export const USDC_ADDRESS = import.meta.env.VITE_USDC_ADDRESS || "";
export const NAV_ENGINE_ADDRESS = import.meta.env.VITE_NAV_ENGINE_ADDRESS || "";
export const RPC_URL = import.meta.env.VITE_RPC_URL || "http://localhost:8545";
export const EXPLORER_URL = import.meta.env.VITE_EXPLORER_URL || "";
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:3000";
export const IPFS_GATEWAY_URL = import.meta.env.VITE_IPFS_GATEWAY_URL;

export const SUBGRAPH_URL = "https://api.studio.thegraph.com/query/1740729/hackmoney-2026/version/latest";

export const START_BLOCK = Number(import.meta.env.VITE_START_BLOCK || "0");
export const YELLOW_WS_URL =
  import.meta.env.VITE_YELLOW_WS_URL || "wss://clearnet.yellow.com/ws";
export const YELLOW_PROTOCOL =
  import.meta.env.VITE_YELLOW_PROTOCOL || "NitroRPC/0.4";
export const YELLOW_ASSET = import.meta.env.VITE_YELLOW_ASSET || "ytest.USD";
export const YELLOW_APPLICATION = "minestarters-curators";
export const YELLOW_SCOPE =
  import.meta.env.VITE_YELLOW_SCOPE || "transfer,app.create";
export const YELLOW_SESSION_EXPIRES_MS = Number(
  import.meta.env.VITE_YELLOW_SESSION_EXPIRES_MS || `${7 * 24 * 60 * 60 * 1000}`
);
export const SESSION_API_URL =
  import.meta.env.VITE_SESSION_API_URL || "https://hackmoney2026.onrender.com";
export const YELLOW_WALLET_1_SEED_PHRASE =
  import.meta.env.VITE_WALLET_1_SEED_PHRASE || "";
export const YELLOW_WALLET_2_SEED_PHRASE =
  import.meta.env.VITE_WALLET_2_SEED_PHRASE || "";

const DEFAULT_CHAIN_EXPLORERS: Record<number, string> = {
  1: "https://etherscan.io",
  11155111: "https://sepolia.etherscan.io",
  5042002: "https://testnet.arcscan.app", // Arc Testnet
};

export const FALLBACK_CHAIN_ID = 5042002;

// Arc Testnet Chain ID for BridgeKit comparison
export const ARC_TESTNET_CHAIN_ID = 5042002;

const normalizeChainId = (chainId?: number | bigint | null) => {
  if (typeof chainId === "bigint") {
    return Number(chainId);
  }
  if (typeof chainId === "number" && Number.isFinite(chainId)) {
    return chainId;
  }
  return null;
};

export const getExplorerUrl = (chainId?: number | bigint | null) => {
  if (EXPLORER_URL) {
    return EXPLORER_URL;
  }

  const normalizedChainId = normalizeChainId(chainId);
  if (normalizedChainId && DEFAULT_CHAIN_EXPLORERS[normalizedChainId]) {
    return DEFAULT_CHAIN_EXPLORERS[normalizedChainId];
  }

  return DEFAULT_CHAIN_EXPLORERS[FALLBACK_CHAIN_ID];
};

export const DISTRIBUTOR_ADDRESSES: Record<number, string> = {
  5042002: "0x7916aa2b4E351bD3Da48B3BF04a53e4C90e8203f", // Example Arc Testnet address
  11155111: "0x088F82f3d1aEd9854620c4C3b9d0284d14a54027", // Example Sepolia address
};

export const STAGE_LABELS: Record<number, string> = {
  0: "Active",
  1: "Active",
  2: "Failed",
};
