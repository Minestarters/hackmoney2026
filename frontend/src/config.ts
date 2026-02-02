export const FACTORY_ADDRESS = import.meta.env.VITE_FACTORY_ADDRESS || "";
export const USDC_ADDRESS = import.meta.env.VITE_USDC_ADDRESS || "";
export const RPC_URL = import.meta.env.VITE_RPC_URL || "http://localhost:8545";
export const EXPLORER_URL = import.meta.env.VITE_EXPLORER_URL || "";
export const START_BLOCK = Number(import.meta.env.VITE_START_BLOCK || "0");

const DEFAULT_CHAIN_EXPLORERS: Record<number, string> = {
  1: "https://etherscan.io",
  11155111: "https://sepolia.etherscan.io",
  5042002: "https://explorer.arctest.net", // Arc Testnet
};

const FALLBACK_CHAIN_ID = 11155111;

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

export const STAGE_LABELS: Record<number, string> = {
  0: "Active",
  1: "Active",
  2: "Failed",
};
