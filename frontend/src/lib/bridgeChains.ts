import {
  ArbitrumSepolia,
  ArcTestnet,
  AvalancheFuji,
  BaseSepolia,
  CodexTestnet,
  EthereumSepolia,
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
import { arbitrumSepolia, arcTestnet, avalancheFuji, baseSepolia, codexTestnet, inkSepolia, lineaSepolia, monadTestnet, optimismSepolia, plumeTestnet, polygonAmoy, seiTestnet, sepolia, unichainSepolia, worldchainSepolia, xdcTestnet } from "viem/chains";

// All supported chains from BridgeKit
export const BRIDGEKIT_SUPPORTED_CHAINS = [
  ArcTestnet,
  ArbitrumSepolia,
  AvalancheFuji,
  BaseSepolia,
  CodexTestnet,
  EthereumSepolia,
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
] as const;

export const MULTICALL3_ADDRESSES: Record<number, `0x${string}`> = {
  [ArcTestnet.chainId]: arcTestnet.contracts.multicall3.address,
  [ArbitrumSepolia.chainId]: arbitrumSepolia.contracts.multicall3.address,
  [AvalancheFuji.chainId]: avalancheFuji.contracts.multicall3.address,
  [BaseSepolia.chainId]: baseSepolia.contracts.multicall3.address,
  [CodexTestnet.chainId]: codexTestnet.contracts.multicall3.address,
  [EthereumSepolia.chainId]: sepolia.contracts.multicall3.address,
  [InkTestnet.chainId]: inkSepolia.contracts.multicall3.address,
  [LineaSepolia.chainId]: lineaSepolia.contracts.multicall3.address,
  [MonadTestnet.chainId]: monadTestnet.contracts.multicall3.address,
  [OptimismSepolia.chainId]: optimismSepolia.contracts.multicall3.address,
  [PlumeTestnet.chainId]: plumeTestnet.contracts.multicall3.address,
  [PolygonAmoy.chainId]: polygonAmoy.contracts.multicall3.address,
  [SeiTestnet.chainId]: seiTestnet.contracts.multicall3.address,
  [UnichainSepolia.chainId]: unichainSepolia.contracts.multicall3.address,
  [WorldChainSepolia.chainId]: worldchainSepolia.contracts.multicall3.address,
  [XDCApothem.chainId]: xdcTestnet.contracts.multicall3.address,
}


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

export const getChainNameAndRPC = (
  chainId: number,
): { name: string; rpc: string } | null => {
  const chain = BRIDGEKIT_SUPPORTED_CHAINS.find((c) => c.chainId === chainId);
  if (chain) {
    return { name: chain.name, rpc: chain.rpcEndpoints[0] };
  }
  return null;
};

export const getChainById = (
  chainId: number,
): ChainInfo | null => {
  const chain = BRIDGEKIT_SUPPORTED_CHAINS.find((c) => c.chainId === chainId);
  if (chain) {
    return chain;
  }
  return null;
};