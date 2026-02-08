import { http, createConfig } from "wagmi";
import { arcTestnet } from "wagmi/chains";
import { injected } from "wagmi/connectors";
import { createPublicClient, createWalletClient, custom, defineChain } from "viem";
import type { Account, Chain, Transport, WalletClient } from "viem";
import { RPC_URL } from "../config";
import { BRIDGEKIT_SUPPORTED_TESTNETS, type ChainInfo } from "./bridgeChains";

// Export the primary chain
export const chain = arcTestnet;
export const DEFAULT_CHAIN_ID = arcTestnet.id;

const getTransports = () => {
  return BRIDGEKIT_SUPPORTED_TESTNETS.map((chain) => ({
    [chain.chainId]: http(chain.rpcEndpoints[0]),
  })).reduce((acc, transport) => ({ ...acc, ...transport }), {});
}

const chains = BRIDGEKIT_SUPPORTED_TESTNETS.map((chain: ChainInfo) => defineChain({
  id: chain.chainId,
  name: chain.name,
  nativeCurrency: { name: "Native", symbol: "NATIVE", decimals: 18 },
  rpcUrls: {
    default: { http: [chain.rpcEndpoints[0]] },
    ...Object.keys(chain.rpcEndpoints).reduce((acc, key) => {
      acc[key] = { http: [chain.rpcEndpoints[key as any]] };
      return acc;
    }, {} as Record<string, { http: string[] }>)
  },
  blockExplorers: {
    default: { name: `${chain.name} Explorer`, url: chain.explorerUrl },
  },
}))

export const wagmiConfig = createConfig({
  chains: chains as any,
  multiInjectedProviderDiscovery: true,
  connectors: [injected()],
  transports: getTransports(),
});

// Public client for read-only operations (no wallet needed)
export const publicClient = createPublicClient({
  transport: http(RPC_URL),
});

// Type for wallet client with account (required for writes)
export type WalletClientWithAccount = WalletClient<Transport, Chain, Account>;

// Get wallet client for write operations (requires connected wallet)
export const getWalletClient = async (): Promise<WalletClientWithAccount | null> => {
  if (typeof window === "undefined" || !window.ethereum?.request) {
    return null;
  }
  try {
    const accounts = await window.ethereum.request({
      method: "eth_accounts",
    }) as `0x${string}`[];
    const address = accounts?.[0];
    if (!address) return null;

    const connectedChain = await window.ethereum.request({
      method: "eth_chainId",
    }) as string;

    const chainId = parseInt(connectedChain, 16);

    const rpcChain = chains.find((c) => c.id === chainId);

    const client = createWalletClient({
      account: address,
      chain: rpcChain,
      transport: custom(window.ethereum as Parameters<typeof custom>[0]),
    });

    // Ensure account is set before returning
    if (!client.account) return null;

    return client as WalletClientWithAccount;
  } catch {
    return null;
  }
};
