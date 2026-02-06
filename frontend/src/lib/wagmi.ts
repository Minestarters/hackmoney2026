import { http, createConfig } from "wagmi";
import { localhost, arcTestnet } from "wagmi/chains";
import { injected } from "wagmi/connectors";
import { createPublicClient, createWalletClient, custom, defineChain } from "viem";
import type { Account, Chain, Transport, WalletClient } from "viem";
import { RPC_URL } from "../config";

// Check if we're using localhost
const isLocalhost =
  RPC_URL.includes("localhost") || RPC_URL.includes("127.0.0.1");

// Export the primary chain
export const chain = isLocalhost ? localhost : arcTestnet;

// Wagmi config
export const wagmiConfig = createConfig({
  chains: [arcTestnet, localhost],
  connectors: [injected()],
  transports: {
    [arcTestnet.id]: http(isLocalhost ? undefined : RPC_URL),
    [localhost.id]: http(isLocalhost ? RPC_URL : undefined),
  },
});

// Public client for read-only operations (no wallet needed)
export const publicClient = createPublicClient({
  transport: http(RPC_URL),
});

let cachedRpcChain: Chain | null = null;
export const getRpcChain = async (): Promise<Chain> => {
  if (cachedRpcChain) return cachedRpcChain;
  const chainId = await publicClient.getChainId();
  if (chainId === localhost.id) {
    cachedRpcChain = localhost;
    return cachedRpcChain;
  }
  if (chainId === arcTestnet.id) {
    cachedRpcChain = arcTestnet;
    return cachedRpcChain;
  }
  cachedRpcChain = defineChain({
    id: chainId,
    name: `Chain ${chainId}`,
    nativeCurrency: { name: "Native", symbol: "NATIVE", decimals: 18 },
    rpcUrls: {
      default: { http: [RPC_URL] },
      public: { http: [RPC_URL] },
    },
  });
  return cachedRpcChain;
};

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


    const rpcChain = await getRpcChain();
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
