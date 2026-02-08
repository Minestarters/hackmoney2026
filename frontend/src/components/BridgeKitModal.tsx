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
 * @param onComplete - Callback after deposit completes (optional)
 * @param ctaLabel - Label for the action button (default: "Deposit")
 * @param bridgeMode - When to execute contract method:
 *   - "before": Bridge first, then execute contract method (shows "Bridge & {ctaLabel}")
 *   - "after": Execute contract method first, then bridge (shows "{ctaLabel} & Bridge")
 * @param showAmount - Whether to show the amount input field (default: true)
 * @param initialAmount - Initial amount value (default: "0")
 * @param onContinue - Callback with amount and chain when continue is clicked (bypasses all other logic)
 * @param onContractMethod - Custom contract method to execute instead of default deposit logic
 */

import { useState, useEffect } from "react";
import { Contract, ethers } from "ethers";
import toast from "react-hot-toast";
import {
  Blockchain,
  BridgeKit,
  type BridgeChainIdentifier,
} from "@circle-fin/bridge-kit";
import { createEthersAdapterFromProvider } from "@circle-fin/adapter-ethers-v6";
import {
  BRIDGEKIT_SUPPORTED_TESTNETS,
  getChainIcon,
  MULTICALL3_ADDRESSES,
  type ChainInfo,
} from "../lib/bridgeChains";
import { useAccount, useConnect } from "wagmi";
import { injected } from "wagmi/connectors";
import { USDC_ADDRESS, ARC_TESTNET_CHAIN_ID, FACTORY_ADDRESS } from "../config";
import type { ProjectInfo } from "../types";
import { DEFAULT_CHAIN_ID, getWalletClient } from "../lib/wagmi";
import {
  getMulticall3ForWrite,
  getTokenMessengerForWrite,
  getUsdcReadByAddress,
} from "../lib/contracts";
import { encodeFunctionData } from "viem";
import { messageTransmitterAbi } from "../contracts/abis";

import { chain } from "../lib/wagmi";
import { arcTestnet } from "viem/chains";
import { ArcTestnet } from "@circle-fin/bridge-kit/chains";
import {
  getTransactionReceipt,
  switchChain,
  waitForTransactionReceipt,
} from "viem/actions";

const DEFAULT_CHAIN = chain;

export type BridgeMode = "before" | "after";

type BridgeKitModalProps = {
  isOpen: boolean;
  onClose: () => void;
  project: ProjectInfo | null;
  onComplete?: () => void;
  // Generic props
  ctaLabel?: string;
  bridgeMode?: BridgeMode;
  showAmount?: boolean;
  initialAmount?: string;
  onContinue?: (amount: string, chain: ChainInfo) => void | Promise<void>;
  multiCallSteps?: {
    target: `0x${string}`;
    callData: any;
    amountArgIndex?: number; // If provided, will replace the argument at this index with the deposit amount
    chainIdArgIndex?: number; // If provided, will replace the argument at this index with the chainId
  }[]; // For additional multicall steps after completeBurn
  // For custom contract methods
  onContractMethod?: (
    amount: string,
    chainId: number | bigint,
  ) => void | Promise<void>;
};

const handledToastErrors = new WeakSet<object>();

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

async function retrieveAttestation(domain: string, transactionHash: string) {
  console.log("Retrieving attestation...");
  const url = `https://iris-api-sandbox.circle.com/v2/messages/${domain}?transactionHash=${transactionHash}`;
  while (true) {
    try {
      const response = await fetch(url, { method: "GET" });

      if (!response.ok) {
        if (response.status !== 404) {
          const text = await response.text().catch(() => "");
          console.error(
            "Error fetching attestation:",
            `${response.status} ${response.statusText}${
              text ? ` - ${text}` : ""
            }`,
          );
        }
        await new Promise((resolve) => setTimeout(resolve, 5000));
        continue;
      }

      const data = await response.json();

      if (data?.messages?.[0]?.status === "complete") {
        console.log("Attestation retrieved successfully!");
        return data.messages[0];
      }
      console.log("Waiting for attestation...");
      await new Promise((resolve) => setTimeout(resolve, 5000));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("Error fetching attestation:", message);
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
}

const BridgeKitModal = ({
  isOpen,
  onClose,
  project,
  onComplete,
  ctaLabel = "Deposit",
  bridgeMode = "after",
  showAmount = true,
  initialAmount = "0",
  onContinue,
  onContractMethod,
  multiCallSteps = [],
}: BridgeKitModalProps) => {
  const { isConnected } = useAccount();
  const { connect } = useConnect();

  // Find Arc Testnet as default chain
  const defaultChain =
    BRIDGEKIT_SUPPORTED_TESTNETS.find(
      (chain) => chain.chainId === ARC_TESTNET_CHAIN_ID,
    ) || BRIDGEKIT_SUPPORTED_TESTNETS[0];

  const [selectedChain, setSelectedChain] = useState<ChainInfo | null>(
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

  const handleChainSelect = (chain: ChainInfo) => {
    setSelectedChain(chain);
  };

  const executeBridge = async (chain: ChainInfo) => {
    toast.success("Bridge Initiated");

    if (bridgeMode === "before") {
      const tokenMessengerAddress = chain?.cctp?.contracts?.v2?.tokenMessenger;
      const usdcAddress = chain?.usdcAddress;
      const multicall3Address = MULTICALL3_ADDRESSES[chain.chainId];
      const messageTransmitter = chain?.cctp?.contracts?.v2?.messageTransmitter;

      const domain = chain.cctp.domain;

      if (
        !tokenMessengerAddress ||
        !usdcAddress ||
        !multicall3Address ||
        domain === undefined ||
        domain === null ||
        !messageTransmitter
      ) {
        toast.error(
          `Bridging from ${chain.name} is not supported at this time`,
        );
        console.error(
          "Missing Either one of BridgeKit configuration for chain:",
          {
            tokenMessengerAddress,
            usdcAddress,
            multicall3Address,
            domain,
            messageTransmitter,
          },
        );
        return;
      }

      let client = await getWalletClient();

      try {
        console.log("Switching to ", chain.chainId, " for bridging");
        await switchChain(client as any, { id: chain.chainId });

        console.log("Switched to ", chain.name, " for bridging");

        client = await getWalletClient();

        const usdcContract = getUsdcReadByAddress(usdcAddress, client!);

        console.log(client?.chain);

        const currentAllowance = await usdcContract.read.allowance([
          client!.account.address,
          tokenMessengerAddress,
        ]);

        if (currentAllowance < ethers.parseUnits(depositAmount, 6)) {
          toast.loading("Approving USDC for bridging...", { id: "approve" });

          const approveTx = await usdcContract.write.approve([
            tokenMessengerAddress,
            ethers.MaxUint256,
          ]);

          const receipt = await waitForTransactionReceipt(client!, {
            hash: approveTx,
          });

          if (!receipt || receipt.status !== "success") {
            toast.error("Approval failed");
            return;
          } else {
            toast.success("Approval successful", { id: "approve" });
          }
        }

        toast("Initiating Bridge...");

        const tokenMessengerContract = getTokenMessengerForWrite(
          tokenMessengerAddress,
          client!,
        );

        const burnTx = await tokenMessengerContract.write.depositForBurn([
          ethers.parseUnits(depositAmount, 6),
          ArcTestnet.cctp.domain,
          `0x000000000000000000000000${client!.account.address.slice(2)}`,
          usdcAddress,
          "0x0000000000000000000000000000000000000000000000000000000000000000",
          500n,
          1000, // minFinalityThreshold (1000 or less for Fast Transfer)
        ]);

        const receipt = await waitForTransactionReceipt(client!, {
          hash: burnTx,
        });

        if (!receipt || receipt.status !== "success") {
          toast.error("Bridge transaction failed");
          return;
        }

        toast.success("Bridge transaction sent. Waiting for confirmation...");

        const attestation = await retrieveAttestation(
          domain.toString(),
          receipt.transactionHash,
        );

        await switchChain(client as any, { id: DEFAULT_CHAIN_ID });

        client = await getWalletClient();

        if (showAmount && multiCallSteps.length > 0) {
          // Check USDC Approval

          const usdcContract = getUsdcReadByAddress(USDC_ADDRESS, client!);

          const currentAllowance = await usdcContract.read.allowance([
            client!.account.address,
            multiCallSteps[0].target,
          ]);

          if (currentAllowance < ethers.parseUnits(depositAmount, 6)) {
            toast.loading(
              "Approving USDC for " + ctaLabel + " transaction...",
              { id: "approve" },
            );

            const approveTx = await usdcContract.write.approve([
              multiCallSteps[0].target,
              ethers.MaxUint256,
            ]);

            const receipt = await waitForTransactionReceipt(client!, {
              hash: approveTx,
            });

            if (!receipt || receipt.status !== "success") {
              toast.error("Approval failed");
              return;
            } else {
              toast.success("Approval successful", { id: "approve" });
            }
          }
        }

        const multiCall3Contract = getMulticall3ForWrite(
          multicall3Address,
          client!,
        );

        const additionalCallSteps = multiCallSteps.map((step) => {
          if (step.amountArgIndex) {
            const amount = ethers.parseUnits(depositAmount, 6);

            step.callData.args[step.amountArgIndex] = amount;

            delete step.amountArgIndex;
          }

          if (step.chainIdArgIndex) {
            const chainId = chain.chainId;

            step.callData.args[step.chainIdArgIndex] = chainId;

            delete step.chainIdArgIndex;
          }

          return {
            target: step.target,
            callData: encodeFunctionData(step.callData),
          };
        });

        const calls = [
          {
            target: messageTransmitter,
            callData: encodeFunctionData({
              abi: messageTransmitterAbi,
              functionName: "receiveMessage",
              args: [
                attestation.message as `0x${string}`,
                attestation.attestation as `0x${string}`,
              ],
            })!,
          },
          ...additionalCallSteps,
        ];

        const multicallTx = await multiCall3Contract.write.aggregate([calls]);

        const bridgeReceipt = await waitForTransactionReceipt(client!, {
          hash: multicallTx,
        });

        if (!bridgeReceipt || bridgeReceipt.status !== "success") {
          toast.error("Finalizing bridge transaction failed");
          return;
        }

        if (calls.length > 1) {
          toast.success(getButtonLabel() + " completed.");
        } else {
          toast.success("Bridge completed.");
        }
      } catch (err) {
        toast.error(getButtonLabel() + " failed");
        console.error("Bridge initiation failed", err);
        await switchChain(client as any, { id: DEFAULT_CHAIN_ID });
      }
    } else {
      const kit = new BridgeKit();
      const adapter = await createEthersAdapterFromProvider({
        provider: window.ethereum as ethers.Eip1193Provider,
      });

      await kit.bridge({
        from: {
          adapter,
          chain: Blockchain.Arc_Testnet,
        },
        to: { adapter, chain: chain.chain as BridgeChainIdentifier },
        amount: depositAmount,
      });

      toast.success("Bridge Completed");
    }
  };

  const executeContractMethod = async (chainId: number | bigint) => {
    await onContractMethod?.(depositAmount, chainId);

    onComplete?.();
  };

  const handleDeposit = async (chainOverride?: ChainInfo) => {
    const chain = chainOverride || selectedChain;

    if (!isConnected) {
      connect({ connector: injected() });
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
        if (multiCallSteps.length === 0) {
          await executeContractMethod(chain.chainId);
        }
      } else if (bridgeMode === "after" && !isArcTestnet) {
        // Execute contract method first, then bridge
        await executeContractMethod(chain.chainId);
        await executeBridge(chain);
      } else {
        // On Arc Testnet or no bridging needed
        await executeContractMethod(chain.chainId);
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
              ? "You're on Arc. Transactions are instant."
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
