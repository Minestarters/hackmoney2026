import { http } from "wagmi";
import { createConfig } from "@privy-io/wagmi";
import { sepolia } from "viem/chains";
import {
  createPublicClient,
  createWalletClient,
  custom,
  defineChain,
} from "viem";
import type { Account, Chain, Transport, WalletClient } from "viem";
import { RPC_URL } from "../config";
import { BRIDGEKIT_SUPPORTED_TESTNETS, type ChainInfo } from "./bridgeChains";

// primary chain for the app
export const chain = sepolia;
export const DEFAULT_CHAIN_ID = sepolia.id;

const bridgeChains = BRIDGEKIT_SUPPORTED_TESTNETS.filter(
  (c) => c.chainId !== sepolia.id,
).map((c: ChainInfo) =>
  defineChain({
    id: c.chainId,
    name: c.name,
    nativeCurrency: { name: "Native", symbol: "NATIVE", decimals: 18 },
    rpcUrls: {
      default: { http: [c.rpcEndpoints[0]] },
    },
    blockExplorers: {
      default: { name: `${c.name} Explorer`, url: c.explorerUrl },
    },
  }),
);

const getTransports = () => {
  const base = BRIDGEKIT_SUPPORTED_TESTNETS.filter(
    (c) => c.chainId !== sepolia.id,
  ).reduce(
    (acc, c) => ({ ...acc, [c.chainId]: http(c.rpcEndpoints[0]) }),
    {} as Record<number, ReturnType<typeof http>>,
  );
  return { ...base, [sepolia.id]: http(RPC_URL) };
};

export const wagmiConfig = createConfig({
  chains: [sepolia, ...bridgeChains] as any,
  transports: getTransports(),
});

// Public client for read-only operations (no wallet needed)
export const publicClient = createPublicClient({
  chain: sepolia,
  transport: http(RPC_URL),
});

// replace by smart account kernel client
export type WalletClientWithAccount = WalletClient<Transport, Chain, Account>;

export const getWalletClient =
  async (): Promise<WalletClientWithAccount | null> => {
    if (typeof window === "undefined" || !window.ethereum?.request) return null;
    try {
      const accounts = (await window.ethereum.request({
        method: "eth_accounts",
      })) as `0x${string}`[];
      const address = accounts?.[0];
      if (!address) return null;
      const chainIdHex = (await window.ethereum.request({
        method: "eth_chainId",
      })) as string;
      const chainId = parseInt(chainIdHex, 16);
      const rpcChain = bridgeChains.find((c) => c.id === chainId);
      const client = createWalletClient({
        account: address,
        chain: rpcChain,
        transport: custom(window.ethereum as Parameters<typeof custom>[0]),
      });
      if (!client.account) return null;
      return client as WalletClientWithAccount;
    } catch {
      return null;
    }
  };
