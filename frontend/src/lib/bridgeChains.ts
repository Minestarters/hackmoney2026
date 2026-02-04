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

// Filter only testnet chains
export const BRIDGEKIT_SUPPORTED_TESTNETS = BRIDGEKIT_SUPPORTED_CHAINS.filter(
  (chain) => chain.isTestnet
);

export type ChainInfo = typeof BRIDGEKIT_SUPPORTED_TESTNETS[number];