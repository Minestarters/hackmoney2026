export const FACTORY_ADDRESS = "0x523faDa2A3ee98D8069928c3CB5aB94bb65e91A8";
export const USDC_ADDRESS = "0x3600000000000000000000000000000000000000";
export const RPC_URL = "https://rpc.testnet.arc.network";
export const EXPLORER_URL = import.meta.env.VITE_EXPLORER_URL || "";
export const SUBGRAPH_URL = "https://api.studio.thegraph.com/query/1740165/minestarters-hackmoney/version/latest";

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
