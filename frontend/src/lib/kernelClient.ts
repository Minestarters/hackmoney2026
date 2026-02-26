import { usePrivy, useWallets, useCreateWallet } from "@privy-io/react-auth";
import { signerToEcdsaValidator } from "@zerodev/ecdsa-validator";
import {
  createKernelAccount,
  createKernelAccountClient,
  createZeroDevPaymasterClient,
} from "@zerodev/sdk";
import { KERNEL_V3_1, getEntryPoint } from "@zerodev/sdk/constants";
import { useEffect } from "react";
import toast from "react-hot-toast";
import { http, createPublicClient } from "viem";
import { sepolia } from "viem/chains";
import { RPC_URL } from "../config";

const ZERODEV_RPC = import.meta.env.VITE_ZERODEV_RPC as string;

const entryPoint = getEntryPoint("0.7");
const kernelVersion = KERNEL_V3_1;

//build a kernel account
export function useKernelClient() {
  const { wallets } = useWallets();

  const getKernelClient = async () => {
    const embeddedWallet =
      wallets.find((w) => w.walletClientType === "privy") ??
      wallets.find((w) => w.connectorType === "embedded");

    if (!embeddedWallet) {
      throw new Error(
        "Wallet not ready yet. Please wait a moment and try again.",
      );
    }

    if (typeof (embeddedWallet as any).switchChain === "function") {
      await (embeddedWallet as any).switchChain(sepolia.id);
    }

    if (typeof embeddedWallet.getEthereumProvider !== "function") {
      throw new Error(
        "Privy wallet does not expose getEthereumProvider. Please refresh and try again.",
      );
    }
    const provider = await embeddedWallet.getEthereumProvider();

    const publicClient = createPublicClient({
      chain: sepolia,
      transport: http(RPC_URL),
    });

    const ecdsaValidator = await signerToEcdsaValidator(publicClient as any, {
      signer: provider as any,
      entryPoint,
      kernelVersion,
    });

    const account = await createKernelAccount(publicClient as any, {
      plugins: { sudo: ecdsaValidator },
      entryPoint,
      kernelVersion,
    });

    // set up the zerodev paymaster
    const paymasterClient = createZeroDevPaymasterClient({
      chain: sepolia as any,
      transport: http(ZERODEV_RPC) as any,
    });

    const kernelClient = createKernelAccountClient({
      account,
      chain: sepolia as any,
      bundlerTransport: http(ZERODEV_RPC) as any,
      client: publicClient as any,
      paymaster: {
        getPaymasterData: (userOperation) =>
          paymasterClient.sponsorUserOperation({ userOperation }),
      },
    });

    return kernelClient;
  };

  return { getKernelClient };
}

// shared public client for bytecode checks
const sepoliaPublicClient = createPublicClient({
  chain: sepolia,
  transport: http(RPC_URL),
});

export function useDeployKernelAccount() {
  const { authenticated, ready } = usePrivy();
  const { wallets } = useWallets();
  const { createWallet } = useCreateWallet();
  const { getKernelClient } = useKernelClient();

  const embeddedWallet =
    wallets.find((w) => w.walletClientType === "privy") ??
    wallets.find((w) => w.connectorType === "embedded");
  const embeddedAddress = embeddedWallet?.address;

  useEffect(() => {
    if (!ready || !authenticated) return;
    if (embeddedWallet) return; // already have one

    createWallet().catch((err) => {
      if (!String(err).includes("already has")) {
        console.warn("[kernelClient] createWallet error:", err);
      }
    });
  }, [ready, authenticated]);

  useEffect(() => {
    if (!embeddedAddress) return;
    let cancelled = false;

    const deploy = async () => {
      let toastId: string | undefined;
      try {
        const client = await getKernelClient();
        const address = client.account?.address as `0x${string}` | undefined;
        if (!address) return;

        // check if the Kernel account contract is already deployed on-chain
        const bytecode = await sepoliaPublicClient.getBytecode({ address });
        if (bytecode && bytecode !== "0x") {
          console.info("[kernelClient] account already deployed:", address);
          return; // already exists
        }

        if (cancelled) return;
        toastId = toast.loading("Setting up your wallet…");

        await client.sendTransaction({ to: address, value: 0n, data: "0x" });

        toast.success("Wallet ready!", { id: toastId });
      } catch (err) {
        console.warn("[kernelClient] pre deployment error:", err);
        if (toastId) toast.dismiss(toastId);
      }
    };

    deploy();
    return () => {
      cancelled = true;
    };
  }, [embeddedAddress]); // eslint-disable-line react-hooks/exhaustive-deps
}
