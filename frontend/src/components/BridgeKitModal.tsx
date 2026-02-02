/**
 * BridgeKitModal - A generic modal for bridging USDC across chains with custom contract interactions
 *
 * Features:
 * - Cross-chain USDC bridging using Circle's CCTP
 * - Flexible contract method execution (before or after bridging)
 * - Optional amount input with initial value support
 * - Customizable CTA labels
 * - Default chain selection (Arc Testnet)
 *
 * Props:
 * @param isOpen - Controls modal visibility
 * @param onClose - Callback when modal is closed
 * @param project - Project info (optional, for backward compatibility)
 * @param onDepositComplete - Callback after deposit completes (optional)
 * @param ctaLabel - Label for the action button (default: "Deposit")
 * @param bridgeMode - When to execute contract method:
 *   - "before": Bridge first, then execute contract method (shows "Bridge & {ctaLabel}")
 *   - "after": Execute contract method first, then bridge (shows "{ctaLabel} & Bridge")
 * @param showAmount - Whether to show the amount input field (default: true)
 * @param initialAmount - Initial amount value (default: "0")
 * @param onContinue - Callback with amount and chain when continue is clicked (bypasses all other logic)
 * @param onContractMethod - Custom contract method to execute instead of default deposit logic
 *
 * Examples:
 *
 * 1. Default Deposit (backward compatible):
 * <BridgeKitModal
 *   isOpen={isOpen}
 *   onClose={onClose}
 *   project={project}
 *   onDepositComplete={handleComplete}
 * />
 *
 * 2. Withdraw (contract method first, then bridge):
 * <BridgeKitModal
 *   isOpen={isOpen}
 *   onClose={onClose}
 *   ctaLabel="Withdraw"
 *   bridgeMode="after"
 *   showAmount={true}
 *   initialAmount="100"
 *   onContractMethod={async (amount) => {
 *     await vault.withdraw(parseUnits(amount, 6));
 *   }}
 * />
 *
 * 3. Custom callback (parent handles everything):
 * <BridgeKitModal
 *   isOpen={isOpen}
 *   onClose={onClose}
 *   ctaLabel="Transfer"
 *   showAmount={false}
 *   onContinue={async (amount, chain) => {
 *     console.log('Selected chain:', chain);
 *     // Handle custom logic
 *   }}
 * />
 */

import { useState, useEffect } from "react";
import { ethers, parseUnits } from "ethers";
import toast from "react-hot-toast";
import {
  Blockchain,
  BridgeKit,
  type BridgeChainIdentifier,
  type ChainDefinition,
} from "@circle-fin/bridge-kit";
import { createEthersAdapterFromProvider } from "@circle-fin/adapter-ethers-v6";
import { BRIDGEKIT_SUPPORTED_TESTNETS } from "../lib/bridgeChains";
import { USDC_ADDRESS, ARC_TESTNET_CHAIN_ID } from "../config";
import { useWallet } from "../context/WalletContext";
import { getVault, getUsdc } from "../lib/contracts";
import { formatUsdc } from "../lib/format";
import type { ProjectInfo } from "../types";
import { ArcTestnet } from "@circle-fin/bridge-kit/chains";

export type BridgeMode = "before" | "after";

type BridgeKitModalProps = {
  isOpen: boolean;
  onClose: () => void;
  project: ProjectInfo | null;
  onDepositComplete?: () => void;
  // Generic props
  ctaLabel?: string;
  bridgeMode?: BridgeMode;
  showAmount?: boolean;
  initialAmount?: string;
  onContinue?: (amount: string, chain: ChainDefinition) => void | Promise<void>;
  // For custom contract methods
  onContractMethod?: (amount: string) => void | Promise<void>;
};

const handledToastErrors = new WeakSet<object>();

const markErrorHandled = (error: unknown) => {
  if (error && typeof error === "object") {
    handledToastErrors.add(error as object);
  }
};

const wasErrorHandled = (error: unknown) =>
  Boolean(
    error &&
    typeof error === "object" &&
    handledToastErrors.has(error as object),
  );

const resolveErrorMessage = (error: unknown): string | null => {
  if (!error) return null;
  if (typeof error === "string") return error;
  if (typeof error === "object") {
    const err = error as Record<string, unknown>;
    const keys = ["reason", "shortMessage", "message"];
    for (const key of keys) {
      const value = err[key];
      if (typeof value === "string" && value.length > 0) {
        return value;
      }
    }
    if ("error" in err) {
      const nested = resolveErrorMessage((err as { error?: unknown }).error);
      if (nested) return nested;
    }
    if ("data" in err) {
      const nested = resolveErrorMessage((err as { data?: unknown }).data);
      if (nested) return nested;
    }
    if ("info" in err) {
      const info = (err as { info?: unknown }).info;
      if (info && typeof info === "object" && "error" in info) {
        const nested = resolveErrorMessage((info as { error?: unknown }).error);
        if (nested) return nested;
      }
    }
  }
  return null;
};

const getRevertMessage = (error: unknown) => {
  const fallback = "Transaction failed";
  const raw = resolveErrorMessage(error);
  if (!raw) return fallback;
  const match = raw.match(/reverted(?: with reason string)?(?::)?\s*(.*)/i);
  if (match && match[1]) {
    const trimmed = match[1].trim();
    return trimmed.length > 0 ? trimmed : "Transaction reverted";
  }
  return raw;
};

const getChainIcon = (chainName: string) => {
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
    "Sonic Blaze Testnet": "🔥",
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

const BridgeKitModal = ({
  isOpen,
  onClose,
  project,
  onDepositComplete,
  ctaLabel = "Deposit",
  bridgeMode = "after",
  showAmount = true,
  initialAmount = "0",
  onContinue,
  onContractMethod,
}: BridgeKitModalProps) => {
  const { signer, connect } = useWallet();

  // Find Arc Testnet as default chain
  const defaultChain =
    BRIDGEKIT_SUPPORTED_TESTNETS.find(
      (chain) => chain.chainId === ARC_TESTNET_CHAIN_ID,
    ) || BRIDGEKIT_SUPPORTED_TESTNETS[0];

  const [selectedChain, setSelectedChain] = useState<ChainDefinition | null>(
    defaultChain,
  );
  const [depositAmount, setDepositAmount] = useState(initialAmount);
  const [isProcessing, setIsProcessing] = useState(false);

  // Update amount if initialAmount prop changes
  useEffect(() => {
    setDepositAmount(initialAmount);
  }, [initialAmount]);

  // Reset to default chain when modal opens
  useEffect(() => {
    if (isOpen) {
      setSelectedChain(defaultChain);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleChainSelect = (chain: ChainDefinition) => {
    setSelectedChain(chain);
  };

  const executeBridge = async (chain: ChainDefinition) => {
    const kit = new BridgeKit();
    const adapter = await createEthersAdapterFromProvider({
      provider: window.ethereum as ethers.Eip1193Provider,
    });

    toast.success("Bridge Initiated");

    if (bridgeMode === "before") {
      await kit.bridge({
        from: {
          adapter,
          chain: chain.chain as BridgeChainIdentifier,
        },
        to: { adapter, chain: Blockchain.Arc_Testnet },
        amount: depositAmount,
      });
    } else {
      await kit.bridge({
        from: {
          adapter,
          chain: Blockchain.Arc_Testnet,
        },
        to: { adapter, chain: chain.chain as BridgeChainIdentifier },
        amount: depositAmount,
      });
    }

    toast.success("Bridge Completed");
  };

  const executeContractMethod = async () => {
    if (onContractMethod) {
      await onContractMethod(depositAmount);
      return;
    }

    // Default deposit logic for backward compatibility
    if (!project) return;

    const value = parseUnits(depositAmount || "0", 6);
    const usdc = getUsdc(signer!);
    const owner = await signer!.getAddress();
    const balance: bigint = await usdc.balanceOf(owner);

    if (balance < value) {
      toast.error(
        `Insufficient USDC balance. You have ${formatUsdc(balance)} but need ${formatUsdc(value)}`,
      );
      throw new Error("Insufficient balance");
    }

    const allowance: bigint = await usdc.allowance(owner, project.address);
    if (allowance < value) {
      await toast.promise(
        usdc.approve(project.address, value).then((tx) => tx.wait()),
        {
          loading: "Approving USDC...",
          success: "USDC approved",
          error: (error) => {
            markErrorHandled(error);
            return `Approval failed: ${getRevertMessage(error)}`;
          },
        },
      );
    }

    const vault = getVault(project.address, signer!);
    await toast.promise(
      vault.deposit(value).then((tx) => tx.wait()),
      {
        loading: "Depositing...",
        success: "Deposit confirmed",
        error: (error) => {
          markErrorHandled(error);
          return `Deposit failed: ${getRevertMessage(error)}`;
        },
      },
    );

    if (onDepositComplete) {
      onDepositComplete();
    }
  };

  const handleDeposit = async (chainOverride?: ChainDefinition) => {
    const chain = chainOverride || selectedChain;

    if (!signer) {
      await connect();
      return;
    }

    // Validation for deposit mode (backward compatibility)
    if (project && project.stage === 2 && !onContractMethod) {
      toast.error("Fundraise closed");
      return;
    }
    if (!USDC_ADDRESS && !onContractMethod) {
      toast.error("USDC ADDRESS NOT AVAILABLE for deposits");
      return;
    }
    if (!chain) {
      toast.error("Please select a chain");
      return;
    }
    if (showAmount && (!depositAmount || Number(depositAmount) <= 0)) {
      toast.error("Please enter an amount");
      return;
    }

    // Call onContinue callback if provided
    if (onContinue) {
      await onContinue(depositAmount, chain);
      return;
    }

    setIsProcessing(true);

    try {
      const isArcTestnet = chain.name === "Arc Testnet";

      if (bridgeMode === "before" && !isArcTestnet) {
        // Bridge first, then execute contract method
        await executeBridge(chain);
        await executeContractMethod();
      } else if (bridgeMode === "after" && !isArcTestnet) {
        // Execute contract method first, then bridge
        await executeContractMethod();
        await executeBridge(chain);
      } else {
        // On Arc Testnet or no bridging needed
        await executeContractMethod();
      }

      setSelectedChain(defaultChain);
      setDepositAmount(initialAmount);
      onClose();
    } catch (error) {
      console.error(error);
      if (!wasErrorHandled(error)) {
        toast.error(`Operation failed: ${getRevertMessage(error)}`);
      }
    } finally {
      setIsProcessing(false);
    }
  };

  const isArcTestnet = selectedChain?.name === "Arc Testnet";

  const getButtonLabel = () => {
    if (isProcessing) return "Processing...";

    if (isArcTestnet) {
      return ctaLabel;
    }

    if (bridgeMode === "before") {
      return `Bridge & ${ctaLabel}`;
    }

    if (bridgeMode === "after") {
      return `${ctaLabel} & Bridge`;
    }

    return ctaLabel;
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="w-full max-w-4xl rounded-lg border-4 border-dirt bg-night/95 shadow-2xl">
        <div className="flex items-center justify-between border-b-4 border-dirt bg-night/60 px-6 py-4">
          <div>
            <h2 className="pixel-heading text-sm text-sky-200">
              {isArcTestnet ? ctaLabel : `Cross-Chain ${ctaLabel}`}
            </h2>
            {!isArcTestnet && (
              <p className="mt-1 text-[10px] text-stone">
                Bridge USDC from other chains using Circle's Bridge Kit
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-stone hover:text-sky-200 transition-colors"
            aria-label="Close"
          >
            <svg
              className="h-6 w-6"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2.5}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        <div className="max-h-[calc(90vh-180px)] overflow-y-auto bg-night/40 p-6">
          <div className="space-y-4">
            <div>
              <p className="mb-3 text-[11px] font-semibold text-stone">
                Source Chain
              </p>
              <div className="grid grid-cols-4 gap-2">
                {BRIDGEKIT_SUPPORTED_TESTNETS.map((chain) => (
                  <button
                    key={chain.name}
                    onClick={() => handleChainSelect(chain)}
                    className={`
                      flex items-center gap-2 rounded border-2 px-3 py-2.5 text-left text-[10px] font-medium transition-all
                      ${
                        selectedChain?.name === chain.name
                          ? "border-sky bg-sky/20 text-sky-100 shadow-lg"
                          : "border-stone bg-night/60 text-stone hover:border-dirt hover:bg-night/80"
                      }
                    `}
                  >
                    <span className="text-base">
                      {getChainIcon(chain.name)}
                    </span>
                    <span className="flex-1 leading-tight">{chain.name}</span>
                  </button>
                ))}
              </div>
            </div>

            {showAmount && (
              <div>
                <p className="mb-2 text-[11px] font-semibold text-stone">
                  Amount (USDC)
                </p>
                <input
                  className="input-blocky w-full rounded px-4 py-2.5 text-sm text-stone-100 focus:border-sky focus:outline-none"
                  type="number"
                  min="0"
                  step="0.01"
                  value={depositAmount}
                  onChange={(e) => setDepositAmount(e.target.value)}
                  placeholder="0.00"
                  disabled={isProcessing}
                />
              </div>
            )}
          </div>
        </div>

        <div className="border-t-4 border-dirt bg-night/60 px-6 py-4">
          <div className="mb-4 rounded border-2 border-dirt bg-night/80 px-3 py-2 text-[10px] text-stone">
            {isArcTestnet
              ? "You're on Arc. Deposits are instant."
              : "Bridge powered by Circle Bridge Kit. Cross-chain transfers may take several minutes."}
          </div>
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="flex-1 rounded border-3 border-stone bg-night/80 px-4 py-2.5 text-[11px] font-bold uppercase text-stone transition-colors hover:bg-night"
              disabled={isProcessing}
            >
              Cancel
            </button>
            <button
              onClick={() => handleDeposit()}
              disabled={
                !selectedChain ||
                (showAmount &&
                  (!depositAmount || Number(depositAmount) <= 0)) ||
                isProcessing
              }
              className="button-blocky flex-1 rounded px-4 py-2.5 text-[11px] uppercase disabled:cursor-not-allowed disabled:opacity-50"
            >
              {getButtonLabel()}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default BridgeKitModal;
