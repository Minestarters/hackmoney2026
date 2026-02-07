import { useState, useEffect } from "react";
import { Contract, ethers, type Eip1193Provider } from "ethers";
import toast from "react-hot-toast";
import {
  Blockchain,
  BridgeKit,
  type BridgeChainIdentifier,
} from "@circle-fin/bridge-kit";
import { createEthersAdapterFromProvider } from "@circle-fin/adapter-ethers-v6";
import { useAccount, useConnect } from "wagmi";
import { injected } from "wagmi/connectors";
import { DISTRIBUTOR_ADDRESSES } from "../config";
import { formatUsdc } from "../lib/format";
import { minestartersDistributor } from "../contracts/abis";
import { subgraphQuery } from "../lib/subgraph";
import type { ProjectInfo } from "../types";
import { BRIDGEKIT_SUPPORTED_CHAINS, getChainIcon, getChainNameAndRPC } from "../lib/bridgeChains";

type DistributionStep = "amount" | "breakdown" | "bridge" | "payout";

interface HolderData {
  account: string;
  initialDepositChain: string;
  profitShare: string;
}

interface ChainBreakdown {
  chainId: string;
  chainName: string;
  totalAmount: bigint;
  holders: HolderData[];
  isSupported: boolean;
}

interface BridgeProgress {
  [chainId: string]: "pending" | "bridging" | "complete" | "error";
}

type DistributeProfitModalProps = {
  isOpen: boolean;
  onClose: () => void;
  project: ProjectInfo;
};

const getChainNameById = (chainId: string): string | null => {
  const chain = BRIDGEKIT_SUPPORTED_CHAINS.find(
    (c) => chainId === c.chainId.toString(),
  );
  return chain ? chain.name : null;
};

const getUsdcAddressByChainId = (chainId: number): string | null => {
  return (
    BRIDGEKIT_SUPPORTED_CHAINS.find((chain) => chainId === chain.chainId)
      ?.usdcAddress || null
  );
};

const DistributeProfitModal = ({
  isOpen,
  onClose,
  project,
}: DistributeProfitModalProps) => {
  const { isConnected } = useAccount();
  const { connect } = useConnect();

  const [step, setStep] = useState<DistributionStep>("amount");
  const [amount, setAmount] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [chainBreakdown, setChainBreakdown] = useState<ChainBreakdown[]>([]);
  const [bridgeProgress, setBridgeProgress] = useState<BridgeProgress>({});
  const [payoutProgress, setPayoutProgress] = useState<{
    [chainId: string]: boolean;
  }>({});
  const [selectedChainTab, setSelectedChainTab] = useState<string | null>(null);
  const [isAutoDistributing, setIsAutoDistributing] = useState(false);

  const PROFIT_FEE_BP = 500n; // 5%

  // Reset state when modal closes
  useEffect(() => {
    if (!isOpen) {
      setStep("amount");
      setAmount("");
      setChainBreakdown([]);
      setBridgeProgress({});
      setPayoutProgress({});
      setSelectedChainTab(null);
    }
  }, [isOpen]);

  const fetchDistributionData = async () => {
    if (!amount || Number(amount) <= 0) {
      toast.error("Please enter a valid amount");
      return;
    }

    if (!isConnected) {
      connect({ connector: injected() });
      return;
    }

    setIsLoading(true);
    try {
      const distributionAmount = ethers.parseUnits(amount, 6);

      // Fetch holders from subgraph
      const query = `
        {
          project (id: "${project.address.toLowerCase()}") {
            id
            holders(where: { balance_gt: "0" }) {
              id
              balance
              initialDepositChain
            }
          }
        }
      `;

      const data = await subgraphQuery<{
        project?: { holders: Array<any> };
      }>(query);

      if (!data.project || !data.project.holders) {
        toast.error("No holders found");
        return;
      }

      const holders = data.project.holders;
      const totalBalance = holders.reduce(
        (sum: bigint, h: any) => sum + BigInt(h.balance),
        0n,
      );

      if (totalBalance === 0n) {
        toast.error("Total balance is zero");
        return;
      }

      // Calculate distributions
      const feeAmount = (distributionAmount * PROFIT_FEE_BP) / 10000n;
      const netDistributableAmount = distributionAmount - feeAmount;

      const csvData = holders.map((holder: any) => ({
        account: holder.id.includes("-") ? holder.id.split("-")[1] : holder.id,
        initialDepositChain: holder.initialDepositChain,
        profitShare: (
          (BigInt(holder.balance) * netDistributableAmount) /
          totalBalance
        ).toString(),
      }));

      // Group by chain
      const profitTotalsByChain: Record<
        string,
        { amount: bigint; holders: HolderData[] }
      > = {};

      csvData.forEach((row: HolderData) => {
        const chainId = row.initialDepositChain;
        if (!profitTotalsByChain[chainId]) {
          profitTotalsByChain[chainId] = { amount: 0n, holders: [] };
        }
        profitTotalsByChain[chainId].amount += BigInt(row.profitShare);
        profitTotalsByChain[chainId].holders.push(row);
      });

      // Create breakdown
      const breakdown: ChainBreakdown[] = Object.entries(
        profitTotalsByChain,
      ).map(([chainId, data]) => {
        const chainName = getChainNameById(chainId);
        const isSupported = chainId in DISTRIBUTOR_ADDRESSES;

        return {
          chainId,
          chainName: chainName || `Chain ${chainId}`,
          totalAmount: data.amount,
          holders: data.holders,
          isSupported,
        };
      });

      setChainBreakdown(breakdown);
      setSelectedChainTab(breakdown[0]?.chainId || null);
      setStep("breakdown");

      toast.success(`Distribution data fetched for ${breakdown.length} chains`);
    } catch (error) {
      console.error("Error fetching distribution data:", error);
      toast.error(
        `Failed to fetch distribution data: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleBridgeBalances = async () => {
    // Check if all chains are supported
    const unsupportedChains = chainBreakdown.filter((c) => !c.isSupported);
    if (unsupportedChains.length > 0) {
      toast.error("Cannot bridge: some chains are not supported");
      return;
    }

    setStep("bridge");
    setBridgeProgress(
      Object.fromEntries(
        chainBreakdown.map((c) => [c.chainId, "pending" as const]),
      ),
    );

    try {
      const kit = new BridgeKit();
      const adapter = await createEthersAdapterFromProvider({
        provider: window.ethereum as any as Eip1193Provider,
      });

      // Bridge to each chain sequentially
      for (const chain of chainBreakdown) {
        if (chain.chainId === "5042002") {
          // Arc Testnet - no bridge needed
          setBridgeProgress((prev) => ({
            ...prev,
            [chain.chainId]: "complete",
          }));
          continue;
        }

        try {
          setBridgeProgress((prev) => ({
            ...prev,
            [chain.chainId]: "bridging",
          }));

          const amountStr = ethers.formatUnits(chain.totalAmount, 6);

          await kit.bridge({
            from: {
              adapter,
              chain: Blockchain.Arc_Testnet,
            },
            to: {
              adapter,
              chain: getBlockchainFromChainId(Number(chain.chainId)),
            },
            amount: amountStr,
          });

          setBridgeProgress((prev) => ({
            ...prev,
            [chain.chainId]: "complete",
          }));

          toast.success(`Bridged to ${chain.chainName}`);
        } catch (error) {
          console.error(`Bridge error for chain ${chain.chainId}:`, error);
          setBridgeProgress((prev) => ({
            ...prev,
            [chain.chainId]: "error",
          }));
          toast.error(`Failed to bridge to ${chain.chainName}`);
        }
      }

      // Move to payout step after all bridges complete
      setTimeout(() => {
        setStep("payout");
        toast.success("Ready to distribute payouts");
      }, 500);
    } catch (error) {
      console.error("Bridge initialization error:", error);
      toast.error("Failed to initialize bridge");
      setStep("breakdown");
    }
  };

  const handleSkipBridge = () => {
    setStep("payout");
    setSelectedChainTab(chainBreakdown[0]?.chainId || null);
  };

  const handleDistributeToAllChains = async () => {
    if (chainBreakdown.length === 0) return;

    setIsAutoDistributing(true);

    for (let i = 0; i < chainBreakdown.length; i++) {
      const chain = chainBreakdown[i];

      // Switch to the current chain tab
      setSelectedChainTab(chain.chainId);

      // Wait a bit for UI to update
      await new Promise((resolve) => setTimeout(resolve, 300));

      // Execute payout for this chain
      await handleBatchPayout(chain.chainId);

      // Wait a bit before moving to next chain
      if (i < chainBreakdown.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }

    setIsAutoDistributing(false);
    toast.success("All chain distributions completed!");
  };

  const handleBatchPayout = async (chainId: string) => {
    if (!isConnected) {
      connect({ connector: injected() });
      return;
    }

    const chainBreakdownItem = chainBreakdown.find(
      (c) => c.chainId === chainId,
    );
    if (!chainBreakdownItem) return;

    const numericChainId = Number(chainId);
    const chainInfo = getChainNameAndRPC(numericChainId);
    if (!chainInfo) {
      toast.error("Chain configuration not found");
      return;
    }

    setPayoutProgress((prev) => ({
      ...prev,
      [chainId]: true,
    }));

    try {
      // Step 1: Switch wallet to the correct chain
      toast.loading(`Switching to ${chainInfo.name}...`);
      const hexChainId = ethers.toBeHex(numericChainId);

      try {
        await window.ethereum!.request!({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: hexChainId }],
        } as any);
      } catch (switchError: any) {
        // Chain not added, try to add it
        if (switchError.code === 4902) {
          await window.ethereum!.request!({
            method: "wallet_addEthereumChain",
            params: [
              {
                chainId: hexChainId,
                chainName: chainInfo.name,
                rpcUrls: [chainInfo.rpc],
                nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
              },
            ],
          } as any);
        } else {
          throw switchError;
        }
      }

      // Step 2: Get fresh signer after chain switch
      const provider = new ethers.BrowserProvider(
        window.ethereum as any as Eip1193Provider,
      );
      const freshSigner = await provider.getSigner();

      const distributorAddress =
        DISTRIBUTOR_ADDRESSES[
          numericChainId as keyof typeof DISTRIBUTOR_ADDRESSES
        ];
      if (!distributorAddress) {
        throw new Error("Distributor address not found for this chain");
      }

      const usdcAddress = getUsdcAddressByChainId(numericChainId);
      if (!usdcAddress) {
        throw new Error("USDC address not found for this chain");
      }

      // Step 3: Create contract instances with fresh signer
      const distributor = new Contract(
        distributorAddress,
        minestartersDistributor,
        freshSigner,
      );

      const recipients = chainBreakdownItem.holders.map((h) => h.account);
      const amounts = chainBreakdownItem.holders.map((h) =>
        ethers.parseUnits(h.profitShare, 0),
      );

      // Step 4: Approve USDC
      const usdcAbi = [
        {
          inputs: [
            { internalType: "address", name: "spender", type: "address" },
            { internalType: "uint256", name: "amount", type: "uint256" },
          ],
          name: "approve",
          outputs: [{ internalType: "bool", name: "", type: "bool" }],
          stateMutability: "nonpayable",
          type: "function",
        },
        {
          inputs: [
            { internalType: "address", name: "account", type: "address" },
          ],
          name: "balanceOf",
          outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
          stateMutability: "view",
          type: "function",
        },
        {
          inputs: [
            { internalType: "address", name: "owner", type: "address" },
            { internalType: "address", name: "spender", type: "address" },
          ],
          name: "allowance",
          outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
          stateMutability: "view",
          type: "function",
        },
      ];

      const usdc = new Contract(usdcAddress, usdcAbi, freshSigner);
      const userAddress = await freshSigner.getAddress();

      const totalAmount = amounts.reduce((sum, a) => sum + a, 0n);

      // Check current balance
      toast.loading("Checking USDC balance...");
      const balance = await usdc.balanceOf(userAddress);

      if (balance < totalAmount) {
        throw new Error(
          `Insufficient USDC balance. Have: ${ethers.formatUnits(
            balance,
            6,
          )}, Need: ${ethers.formatUnits(totalAmount, 6)}`,
        );
      }

      // Check current allowance
      const currentAllowance = await usdc.allowance(
        userAddress,
        distributorAddress,
      );

      if (currentAllowance < totalAmount) {
        toast.loading("Approving USDC...");
        // Approve max uint256 for unlimited approval
        const approveAmount = ethers.MaxUint256;
        const approveTx = await usdc.approve(distributorAddress, approveAmount);
        const approveReceipt = await approveTx.wait();

        if (!approveReceipt) {
          throw new Error("USDC approval failed - no receipt");
        }
      }

      // Step 5: Execute batch payout with correct USDC address
      toast.loading("Executing batch payout...");
      const tx = await distributor.batchPayout(
        usdcAddress,
        recipients,
        amounts,
      );
      const receipt = await tx.wait();

      if (receipt) {
        toast.success(`Payout completed for ${chainBreakdownItem.chainName}`);
      } else {
        throw new Error("Batch payout failed - no receipt");
      }
    } catch (error) {
      console.error("Payout error:", error);
      toast.error(
        `Payout failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      );
    } finally {
      setPayoutProgress((prev) => ({
        ...prev,
        [chainId]: false,
      }));
    }
  };

  if (!isOpen) return null;

  const isChainSupported = (chainId: number | string) =>
    DISTRIBUTOR_ADDRESSES[chainId as keyof typeof DISTRIBUTOR_ADDRESSES] !==
    undefined;

  const allChainsSupported = chainBreakdown.every((c) =>
    isChainSupported(c.chainId),
  );

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
        {/* Header */}
        <div className="flex items-center justify-between border-b-4 border-dirt bg-night/60 px-6 py-4">
          <div>
            <h2 className="pixel-heading text-sm text-sky-200">
              Distribute Profit
            </h2>
            <p className="mt-1 text-[10px] text-stone">
              Step{" "}
              {step === "amount"
                ? "1"
                : step === "breakdown"
                ? "2"
                : step === "bridge"
                ? "3"
                : "4"}{" "}
              of 4
            </p>
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

        {/* Content */}
        <div className="max-h-[calc(90vh-180px)] overflow-y-auto bg-night/40 p-6">
          {/* Step 1: Amount Input */}
          {step === "amount" && (
            <div className="space-y-4">
              <div>
                <p className="mb-2 text-[11px] font-semibold text-stone">
                  Distribution Amount (USDC)
                </p>
                <p className="mb-3 text-[10px] text-stone-400">
                  Enter the total amount to distribute to all holders
                </p>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                  className="input-blocky w-full rounded px-4 py-2.5 text-sm text-stone-100 focus:border-sky focus:outline-none"
                  disabled={isLoading}
                />
              </div>
              <div className="rounded border-2 border-dirt bg-night/80 px-3 py-2 text-[10px] text-stone-400">
                <p>
                  💡 A 5% fee will be deducted from the distribution amount.
                </p>
              </div>
            </div>
          )}

          {/* Step 2: Breakdown */}
          {step === "breakdown" && (
            <div className="space-y-4">
              <p className="text-[11px] font-semibold text-stone">
                Chain Breakdown
              </p>
              <div className="space-y-2">
                {chainBreakdown.map((chain) => (
                  <div
                    key={chain.chainId}
                    className="rounded border-2 border-dirt bg-night/60 p-3"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-lg">
                          {getChainIcon(chain.chainName)}
                        </span>
                        <div>
                          <p className="text-[11px] font-semibold text-sky-100">
                            {chain.chainName}
                          </p>
                          <p className="text-[10px] text-stone-400">
                            {chain.holders.length} holder
                            {chain.holders.length !== 1 ? "s" : ""}
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-[11px] font-semibold text-sky-100">
                          {formatUsdc(chain.totalAmount)} USDC
                        </p>
                        {!isChainSupported(chain.chainId) && (
                          <p className="text-[9px] text-red-400 font-semibold">
                            ⚠️ Not supported
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {!allChainsSupported && (
                <div className="rounded border-2 border-red-700 bg-red-950/30 px-3 py-2 text-[10px] text-red-300">
                  <p className="font-semibold">
                    ⚠️ Some chains are not supported
                  </p>
                  <p>
                    Bridge and payout will be disabled until this is resolved.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Step 3: Bridge */}
          {step === "bridge" && (
            <div className="space-y-4">
              <p className="text-[11px] font-semibold text-stone">
                Bridging Balances
              </p>
              <div className="space-y-2">
                {chainBreakdown.map((chain) => {
                  const status = bridgeProgress[chain.chainId];
                  return (
                    <div
                      key={chain.chainId}
                      className="rounded border-2 border-dirt bg-night/60 p-3"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-lg">
                            {getChainIcon(chain.chainName)}
                          </span>
                          <div>
                            <p className="text-[11px] font-semibold text-sky-100">
                              {chain.chainName}
                            </p>
                            <p className="text-[10px] text-stone-400">
                              {formatUsdc(chain.totalAmount)} USDC
                            </p>
                          </div>
                        </div>
                        <div className="text-right">
                          {status === "pending" && (
                            <p className="text-[10px] text-stone-300">
                              Pending
                            </p>
                          )}
                          {status === "bridging" && (
                            <div className="flex items-center gap-1">
                              <div className="h-3 w-3 rounded-full bg-yellow-400 animate-pulse"></div>
                              <p className="text-[10px] text-yellow-300">
                                Bridging...
                              </p>
                            </div>
                          )}
                          {status === "complete" && (
                            <p className="text-[10px] text-green-300 font-semibold">
                              ✓ Complete
                            </p>
                          )}
                          {status === "error" && (
                            <p className="text-[10px] text-red-300 font-semibold">
                              ✗ Error
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Step 4: Payout */}
          {step === "payout" && (
            <div className="space-y-4">
              <div className="mb-4 rounded border-2 border-sky-800/50 bg-sky-900/20 px-3 py-2">
                <button
                  onClick={handleDistributeToAllChains}
                  disabled={
                    isAutoDistributing ||
                    Object.values(payoutProgress).some((v) => v)
                  }
                  className="button-blocky w-full rounded px-4 py-2.5 text-[11px] uppercase disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isAutoDistributing
                    ? "Auto-Distributing..."
                    : "🚀 Distribute to All Chains"}
                </button>
                <p className="mt-2 text-center text-[9px] text-stone-400">
                  {isAutoDistributing
                    ? "Processing all chains automatically..."
                    : "This will automatically process payouts for all chains sequentially"}
                </p>
              </div>

              <div>
                <p className="mb-3 text-[11px] font-semibold text-stone">
                  Distribution by Chain
                </p>

                {/* Chain Tabs */}
                <div className="mb-4 flex gap-2 overflow-x-auto pb-2">
                  {chainBreakdown.map((chain) => (
                    <button
                      key={chain.chainId}
                      onClick={() => setSelectedChainTab(chain.chainId)}
                      className={`
                        flex items-center gap-2 whitespace-nowrap rounded border-2 px-3 py-2 text-[10px] font-semibold transition-all
                        ${
                          selectedChainTab === chain.chainId
                            ? "border-sky bg-sky/20 text-sky-100"
                            : "border-stone bg-night/60 text-stone hover:border-dirt"
                        }
                      `}
                    >
                      <span>{getChainIcon(chain.chainName)}</span>
                      {chain.chainName}
                    </button>
                  ))}
                </div>

                {/* Holders Table for Selected Chain */}
                {selectedChainTab && (
                  <div>
                    {chainBreakdown
                      .filter((c) => c.chainId === selectedChainTab)
                      .map((chain) => (
                        <div key={chain.chainId} className="space-y-3">
                          {/* Table */}
                          <div className="rounded border-2 border-dirt bg-night/80 overflow-hidden">
                            <div className="grid grid-cols-2 gap-3 bg-night/60 px-3 py-2 text-[9px] font-bold uppercase text-stone-400">
                              <div>Account</div>
                              <div className="text-right">Profit (USDC)</div>
                            </div>
                            <div className="max-h-64 overflow-y-auto">
                              {chain.holders.map((holder, idx) => (
                                <div
                                  key={idx}
                                  className="grid grid-cols-2 gap-3 border-t border-dirt/50 px-3 py-2 text-[10px]"
                                >
                                  <div className="text-stone-300 font-mono">
                                    {holder.account.slice(0, 6)}...
                                    {holder.account.slice(-4)}
                                  </div>
                                  <div className="text-right text-sky-100 font-semibold">
                                    {formatUsdc(BigInt(holder.profitShare))}
                                  </div>
                                </div>
                              ))}
                            </div>
                            <div className="grid grid-cols-2 gap-3 border-t-2 border-dirt bg-night/60 px-3 py-2 text-[10px] font-bold">
                              <div>Total</div>
                              <div className="text-right text-sky-200">
                                {formatUsdc(chain.totalAmount)}
                              </div>
                            </div>
                          </div>

                          {/* Payout Button */}
                          <button
                            onClick={() => handleBatchPayout(chain.chainId)}
                            disabled={
                              payoutProgress[chain.chainId] ||
                              isAutoDistributing
                            }
                            className="button-blocky w-full rounded px-4 py-2.5 text-[11px] uppercase disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {payoutProgress[chain.chainId]
                              ? "Processing..."
                              : `Execute Payout for ${chain.chainName}`}
                          </button>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t-4 border-dirt bg-night/60 px-6 py-4">
          <div className="flex gap-3">
            {step !== "breakdown" && (
              <button
                onClick={onClose}
                className="flex-1 rounded border-3 border-stone bg-night/80 px-4 py-2.5 text-[11px] font-bold uppercase text-stone transition-colors hover:bg-night"
                disabled={isLoading}
              >
                {step === "payout" ? "Done" : "Cancel"}
              </button>
            )}

            {step === "breakdown" && (
              <button
                onClick={handleSkipBridge}
                disabled={!allChainsSupported}
                className="flex-1 rounded border-3 border-stone bg-night/80 px-4 py-2.5 text-[11px] font-bold uppercase text-stone transition-colors hover:bg-night disabled:cursor-not-allowed disabled:opacity-50"
              >
                Skip
              </button>
            )}

            {step === "amount" && (
              <button
                onClick={fetchDistributionData}
                disabled={!amount || Number(amount) <= 0 || isLoading}
                className="button-blocky flex-1 rounded px-4 py-2.5 text-[11px] uppercase disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isLoading ? "Loading..." : "Get Multi-Chain Breakdown"}
              </button>
            )}

            {step === "breakdown" && (
              <button
                onClick={handleBridgeBalances}
                disabled={!allChainsSupported}
                className="button-blocky flex-1 rounded px-4 py-2.5 text-[11px] uppercase disabled:cursor-not-allowed disabled:opacity-50"
              >
                Bridge Balances
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

// Helper function to map chain ID to BridgeKit blockchain
function getBlockchainFromChainId(chainId: number): BridgeChainIdentifier {
  const chainMap: Record<number, BridgeChainIdentifier> = {
    5042002: Blockchain.Arc_Testnet,
    11155111: Blockchain.Ethereum_Sepolia,
    84532: Blockchain.Base_Sepolia,
    421614: Blockchain.Arbitrum_Sepolia,
    11155420: Blockchain.Optimism_Sepolia,
    43113: Blockchain.Avalanche_Fuji,
    80002: Blockchain.Polygon_Amoy_Testnet,
    534351: Blockchain.Linea_Sepolia,
    1301: Blockchain.Unichain_Sepolia,
    115108: Blockchain.Plume_Testnet,
  };

  return chainMap[chainId] || Blockchain.Arc_Testnet;
}

export default DistributeProfitModal;
