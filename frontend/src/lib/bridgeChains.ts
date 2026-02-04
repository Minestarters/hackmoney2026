import {
  ArbitrumSepolia,
  ArcTestnet,
  AvalancheFuji,
  BaseSepolia,
  CodexTestnet,
  EthereumSepolia,
  HyperEVMTestnet,
  InkTestnet,
  LineaSepolia,
  MonadTestnet,
  OptimismSepolia,
  PlumeTestnet,
  PolygonAmoy,
  SeiTestnet,
  SonicTestnet,
  UnichainSepolia,
  WorldChainSepolia,
  XDCApothem,
} from "@circle-fin/bridge-kit/chains";

// All supported chains from BridgeKit
export const BRIDGEKIT_SUPPORTED_CHAINS = [
  ArbitrumSepolia,
  ArcTestnet,
  AvalancheFuji,
  BaseSepolia,
  CodexTestnet,
  EthereumSepolia,
  HyperEVMTestnet,
  InkTestnet,
  LineaSepolia,
  MonadTestnet,
  OptimismSepolia,
  PlumeTestnet,
  PolygonAmoy,
  SeiTestnet,
  SonicTestnet,
  UnichainSepolia,
  WorldChainSepolia,
  XDCApothem,
];


export const getChainIcon = (chainName: string) => {
  const icons: Record<string, string> = {
    "Arc Testnet": "⚡",
    "Ethereum Sepolia": "Ξ",
    "Base Sepolia": "🔵",
    "Arbitrum Sepolia": "🔷",
    "OP Sepolia": "🔴",
    "Avalanche Fuji": "🔺",
    "Polygon PoS Amoy": "🟣",
    "Celo Sepolia": "🟡",
    "Linea Sepolia": "━",
    "Unichain Sepolia": "🦄",
    "World Chain Sepolia": "🌍",
    "ZKsync Era Testnet": "⚡",
    "Sonic Testnet": "🎵",
    "XDC Apothem": "💎",
    "Sei Testnet": "⚡",
    "Plume Testnet": "🪶",
    "Monad Testnet": "━",
    "HyperEVM Testnet": "━",
    "Ink Testnet": "━",
    "Codex Testnet": "━",
  };
  return icons[chainName] || "━";
};



// Filter only testnet chains
export const BRIDGEKIT_SUPPORTED_TESTNETS = BRIDGEKIT_SUPPORTED_CHAINS.filter(
  (chain) => chain.isTestnet
);

export type ChainInfo = typeof BRIDGEKIT_SUPPORTED_TESTNETS[number];