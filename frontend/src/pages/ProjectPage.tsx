import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { parseUnits } from "viem";
import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";
import toast from "react-hot-toast";
import { useAccount, useConnect } from "wagmi";
import { injected } from "wagmi/connectors";
import {
  EXPLORER_URL,
  STAGE_LABELS,
  USDC_ADDRESS,
  getExplorerUrl,
} from "../config";
import {
  fetchProjectInfo,
  fetchSupporterCount,
  fetchTotalClaimed,
  fetchUserPosition,
  writeVault,
  writeUsdc,
  getUsdcRead,
} from "../lib/contracts";
import { formatBpsAsPercent, formatUsdc, shortAddress } from "../lib/format";
import { publicClient, getWalletClient } from "../lib/wagmi";
import type { ProjectInfo, UserPosition } from "../types";

const PIE_COLORS = ["#5EBD3E", "#6ECFF6", "#836953", "#9E9E9E", "#E3A008"];
const sanitizeExplorerUrl = (url: string) => url.replace(/\/$/, "");

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

type MetricCardProps = {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
};

const MetricCard = ({ label, value, sub, icon: Icon }: MetricCardProps) => {
  return (
    <div className="rounded border-4 border-dirt bg-night/40 p-4">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 grid h-10 w-10 place-items-center rounded border-4 border-dirt bg-stone-800/60 text-sky-200">
          <Icon className="h-5 w-5" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-stone-400">
            {label}
          </p>
          <div className="mt-1 text-sm text-sky-100">{value}</div>
          {sub ? (
            <div className="mt-1 text-[10px] text-stone-400">{sub}</div>
          ) : null}
        </div>
      </div>
    </div>
  );
};

const IconUsers = (props: React.SVGProps<SVGSVGElement>) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    {...props}
  >
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
);

const IconFee = (props: React.SVGProps<SVGSVGElement>) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    {...props}
  >
    <path d="M20 12a8 8 0 1 1-16 0 8 8 0 0 1 16 0z" />
    <path d="M8 16l8-8" />
    <path d="M9 9h.01" />
    <path d="M15 15h.01" />
  </svg>
);

const IconProfit = (props: React.SVGProps<SVGSVGElement>) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    {...props}
  >
    <path d="M3 3v18h18" />
    <path d="M7 14l4-4 3 3 5-7" />
  </svg>
);

const IconClaim = (props: React.SVGProps<SVGSVGElement>) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    {...props}
  >
    <path d="M21 6H3v12h18V6z" />
    <path d="M7 12l3 3 7-7" />
  </svg>
);

const ProjectPage = () => {
  const { address } = useParams<{ address: string }>();
  const { address: account, isConnected } = useAccount();
  const { connect } = useConnect();
  const [project, setProject] = useState<ProjectInfo | null>(null);
  const [position, setPosition] = useState<UserPosition | null>(null);
  const [supportCount, setSupportCount] = useState<number | null>(null);
  const [totalClaimed, setTotalClaimed] = useState<bigint | null>(null);
  const [activeTab, setActiveTab] = useState<"investor" | "spv">("investor");
  const [amount, setAmount] = useState("0");
  const [profitAmount, setProfitAmount] = useState("0");
  const [loading, setLoading] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [explorerBaseUrl, setExplorerBaseUrl] = useState(() =>
    sanitizeExplorerUrl(getExplorerUrl()),
  );
  const profitsOpen = project
    ? project.totalRaised >= project.minimumRaise
    : false;

  const countdown = useMemo(() => {
    if (!project) return "";
    const ms = Number(project.deadline) * 1000 - now;
    if (ms < 0) return "Ended";
    const hours = Math.floor(ms / (1000 * 60 * 60));
    const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
    return `${hours}h ${minutes}m`;
  }, [project, now]);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (EXPLORER_URL) return;
    // Use chain ID from publicClient
    const chainId = publicClient.chain?.id;
    if (chainId) {
      setExplorerBaseUrl(sanitizeExplorerUrl(getExplorerUrl(chainId)));
    }
  }, []);

  const reloadProjectData = useCallback(async () => {
    if (!address) return;
    setSupportCount(null);
    setTotalClaimed(null);

    try {
      const projectAddress = address as `0x${string}`;
      const [info, supporters, claimedTotal] = await Promise.all([
        fetchProjectInfo(projectAddress),
        fetchSupporterCount(projectAddress),
        fetchTotalClaimed(projectAddress),
      ]);

      setProject(info);
      setSupportCount(supporters);
      setTotalClaimed(claimedTotal);
    } catch (error) {
      console.error("Failed to reload project data", error);
    }
  }, [address]);

  useEffect(() => {
    if (!address) return;
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      try {
        await reloadProjectData();
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    load();

    return () => {
      cancelled = true;
    };
  }, [address, reloadProjectData]);

  useEffect(() => {
    if (!account) {
      setPosition(null);
      return;
    }
    if (!project) return;

    let cancelled = false;
    const loadPosition = async () => {
      try {
        const pos = await fetchUserPosition(project, account as `0x${string}`);
        if (!cancelled) {
          setPosition(pos);
        }
      } catch (error) {
        console.error("Failed to fetch user position", error);
        if (!cancelled) {
          setPosition(null);
        }
      }
    };

    loadPosition();

    return () => {
      cancelled = true;
    };
  }, [account, project]);

  const handleDeposit = async () => {
    if (!project || !account) return;
    if (!isConnected) {
      connect({ connector: injected() });
      return;
    }
    if (project.stage === 2) {
      toast.error("Fundraise closed");
      return;
    }
    if (!USDC_ADDRESS) {
      toast.error("Set VITE_USDC_ADDRESS for deposits");
      return;
    }
    const walletClient = await getWalletClient();
    if (!walletClient) {
      toast.error("Could not get wallet");
      return;
    }
    try {
      const value = parseUnits(amount || "0", 6);
      const usdcRead = getUsdcRead();
      const balance = await usdcRead.read.balanceOf([account]);
      if (balance < value) {
        toast.error(
          `Insufficient USDC balance. You have ${formatUsdc(balance)} but need ${formatUsdc(value)}`,
        );
        return;
      }
      const allowance = await usdcRead.read.allowance([account, project.address as `0x${string}`]);
      if (allowance < value) {
        await toast.promise(
          (async () => {
            const hash = await writeUsdc.approve(walletClient, project.address as `0x${string}`, value);
            await publicClient.waitForTransactionReceipt({ hash });
          })(),
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

      await toast.promise(
        (async () => {
          const hash = await writeVault.deposit(walletClient, project.address as `0x${string}`, value);
          await publicClient.waitForTransactionReceipt({ hash });
        })(),
        {
          loading: "Depositing...",
          success: "Deposit confirmed",
          error: (error) => {
            markErrorHandled(error);
            return `Deposit failed: ${getRevertMessage(error)}`;
          },
        },
      );
      await reloadProjectData();
    } catch (error) {
      console.error(error);
      if (!wasErrorHandled(error)) {
        toast.error(`Deposit failed: ${getRevertMessage(error)}`);
      }
    }
  };

  const handleClaim = async () => {
    if (!project) return;
    if (!isConnected) {
      connect({ connector: injected() });
      return;
    }
    if (!profitsOpen) {
      toast.error(
        "Project must reach the minimum raise before claiming profits",
      );
      return;
    }
    const walletClient = await getWalletClient();
    if (!walletClient) {
      toast.error("Could not get wallet");
      return;
    }
    try {
      await toast.promise(
        (async () => {
          const hash = await writeVault.claimProfit(walletClient, project.address as `0x${string}`);
          await publicClient.waitForTransactionReceipt({ hash });
        })(),
        {
          loading: "Claiming profits...",
          success: "Profits claimed",
          error: (error) => {
            markErrorHandled(error);
            return `Claim failed: ${getRevertMessage(error)}`;
          },
        },
      );
      await reloadProjectData();
    } catch (error) {
      console.error(error);
      if (!wasErrorHandled(error)) {
        toast.error(`Claim failed: ${getRevertMessage(error)}`);
      }
    }
  };

  const handleRefund = async () => {
    if (!project) return;
    if (!isConnected) {
      connect({ connector: injected() });
      return;
    }
    const walletClient = await getWalletClient();
    if (!walletClient) {
      toast.error("Could not get wallet");
      return;
    }
    try {
      await toast.promise(
        (async () => {
          const hash = await writeVault.refund(walletClient, project.address as `0x${string}`);
          await publicClient.waitForTransactionReceipt({ hash });
        })(),
        {
          loading: "Processing refund...",
          success: "Refund complete",
          error: (error) => {
            markErrorHandled(error);
            return `Refund failed: ${getRevertMessage(error)}`;
          },
        },
      );
      await reloadProjectData();
    } catch (error) {
      console.error(error);
      if (!wasErrorHandled(error)) {
        toast.error(`Refund failed: ${getRevertMessage(error)}`);
      }
    }
  };

  const handleWithdrawRaised = async () => {
    if (!project) return;
    if (!isConnected) {
      connect({ connector: injected() });
      return;
    }
    if (!canWithdrawRaised) {
      toast.error("No withdrawable funds available");
      return;
    }
    const walletClient = await getWalletClient();
    if (!walletClient) {
      toast.error("Could not get wallet");
      return;
    }
    try {
      await toast.promise(
        (async () => {
          const hash = await writeVault.withdrawRaisedFunds(walletClient, project.address as `0x${string}`);
          await publicClient.waitForTransactionReceipt({ hash });
        })(),
        {
          loading: "Withdrawing raised funds...",
          success: "Raised funds withdrawn",
          error: (error) => {
            markErrorHandled(error);
            return `Withdraw failed: ${getRevertMessage(error)}`;
          },
        },
      );
      await reloadProjectData();
    } catch (error) {
      console.error(error);
      if (!wasErrorHandled(error)) {
        toast.error(`Withdraw failed: ${getRevertMessage(error)}`);
      }
    }
  };

  const handleDepositProfit = async () => {
    if (!project || !account) return;
    if (!isConnected) {
      connect({ connector: injected() });
      return;
    }
    if (!USDC_ADDRESS) {
      toast.error("Set VITE_USDC_ADDRESS for deposits");
      return;
    }
    const walletClient = await getWalletClient();
    if (!walletClient) {
      toast.error("Could not get wallet");
      return;
    }

    try {
      const value = parseUnits(profitAmount || "0", 6);
      if (value <= 0n) {
        toast.error("Enter a profit amount greater than zero");
        return;
      }
      if (!profitsOpen) {
        toast.error(
          "Project must reach the minimum raise before profit deposits",
        );
        return;
      }

      const usdcRead = getUsdcRead();
      const allowance = await usdcRead.read.allowance([account, project.address as `0x${string}`]);
      if (allowance < value) {
        await toast.promise(
          (async () => {
            const hash = await writeUsdc.approve(walletClient, project.address as `0x${string}`, value);
            await publicClient.waitForTransactionReceipt({ hash });
          })(),
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

      await toast.promise(
        (async () => {
          const hash = await writeVault.depositProfit(walletClient, project.address as `0x${string}`, value);
          await publicClient.waitForTransactionReceipt({ hash });
        })(),
        {
          loading: "Depositing profit...",
          success: "Profit deposited",
          error: (error) => {
            markErrorHandled(error);
            return `Profit deposit failed: ${getRevertMessage(error)}`;
          },
        },
      );
      await reloadProjectData();
    } catch (error) {
      console.error(error);
      if (!wasErrorHandled(error)) {
        toast.error(`Profit deposit failed: ${getRevertMessage(error)}`);
      }
    }
  };

  if (!address) {
    return <p className="text-xs text-stone-200">Missing vault address.</p>;
  }

  if (loading || !project) {
    return <p className="text-xs text-stone-200">Loading project...</p>;
  }

  const claimableAmount = position?.pending ?? 0n;
  const canClaim = profitsOpen && claimableAmount > 0n;
  const showRefund = Boolean(
    position && project.stage === 2 && position.shares > 0n,
  );

  const withdrawPrincipal = project.withdrawable;
  const withdrawFees = project.withdrawableFees ?? project.accruedRaiseFees;

  const raisedBps =
    project.minimumRaise > 0n
      ? (project.totalRaised * 10_000n) / project.minimumRaise
      : 0n;
  const raisedPct = Math.min(100, Math.max(0, Number(raisedBps) / 100));
  const creatorFeesPaid =
    project.totalRaiseFeesPaid + project.totalProfitFeesPaid;
  const withdrawnBySpv =
    project.withdrawnTotal > project.totalRaiseFeesPaid
      ? project.withdrawnTotal - project.totalRaiseFeesPaid
      : 0n;

  const explorerAddressUrl = (addr: string) =>
    explorerBaseUrl ? `${explorerBaseUrl}/address/${addr}` : "";
  const canWithdrawRaised = project.withdrawable > 0n;
  const activeTabIndex = activeTab === "investor" ? 0 : 1;
  const sliderWidth = 50;

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        <div className="card-frame rounded-lg p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[11px] text-stone-400">Project</p>
              <h1 className="text-lg text-sky-200">{project.name}</h1>
            </div>
            <div className="text-right">
              <p className="text-[10px] uppercase text-stone-400">Status</p>
              <p className="text-sm text-grass">
                {STAGE_LABELS[project.stage]}
              </p>
              <p className="text-[10px] text-stone-400">
                Countdown: {countdown}
              </p>
            </div>
          </div>

          <div className="mt-4 rounded border-4 border-dirt bg-night/40 p-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-stone-400">
                Funding Progress
              </p>
            </div>
            <div className="mt-1 flex items-center justify-between text-[10px] text-stone-400">
              <p>
                Raised:{" "}
                <span className="text-sky-100">
                  {formatUsdc(project.totalRaised)} USDC
                </span>
              </p>
              <p>{raisedPct.toFixed(1)}% funded</p>
            </div>
            <div
              className="mt-2 h-4 w-full rounded border-4 border-dirt bg-stone-800/60"
              role="progressbar"
              aria-label="Funding progress"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(raisedPct)}
            >
              <div
                className="h-full rounded-sm bg-grass"
                style={{ width: `${raisedPct}%` }}
              />
            </div>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-[10px] text-stone-400">
              <p>
                Withdrawn:{" "}
                <span className="text-sky-100">
                  {formatUsdc(withdrawnBySpv)} USDC
                </span>
              </p>
              <p>
                Minimum:{" "}
                <span className="text-sky-100">
                  {formatUsdc(project.minimumRaise)} USDC
                </span>
              </p>
            </div>
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-3">
            <MetricCard
              label="Raise Fee"
              icon={IconFee}
              value={
                <span className="text-[12px] text-stone-300">
                  {formatBpsAsPercent(project.raiseFeeBps)}
                </span>
              }
            />
            <MetricCard
              label="Revenue Fee"
              icon={IconFee}
              value={
                <span className="text-[12px] text-stone-300">
                  {formatBpsAsPercent(project.profitFeeBps)}
                </span>
              }
            />
            <MetricCard
              label="Supporters"
              icon={IconUsers}
              value={
                <span className="break-words">
                  {supportCount === null ? "—" : supportCount.toLocaleString()}{" "}
                  <span className="text-[11px] text-stone-300">wallets</span>
                </span>
              }
            />
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-3">
            <MetricCard
              label="Lifetime Profit"
              icon={IconProfit}
              value={
                <span className="text-[12px] text-stone-300">
                  {formatUsdc(project.totalProfit)} USDC
                </span>
              }
            />
            <MetricCard
              label="Profits Claimed"
              icon={IconClaim}
              value={
                <span className="text-[12px] text-stone-300">
                  {totalClaimed === null
                    ? "—"
                    : `${formatUsdc(totalClaimed)} USDC`}
                </span>
              }
            />
            <MetricCard
              label="Creator Fees Paid"
              icon={IconFee}
              value={
                <span className="pt-0.5 text-[12px] text-stone-300">
                  {formatUsdc(creatorFeesPaid)} USDC
                </span>
              }
            />
          </div>

          <div className="mt-4 rounded border-4 border-dirt p-3">
            <p className="mb-2 text-[10px] text-stone-400">Company breakdown</p>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
              <div className="h-36 w-36 shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={project.companyNames.map((name, idx) => ({
                        name,
                        value: project.companyWeights[idx],
                      }))}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={34}
                      outerRadius={56}
                    >
                      {project.companyNames.map((_, idx) => (
                        <Cell
                          key={idx}
                          fill={PIE_COLORS[idx % PIE_COLORS.length]}
                        />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
              </div>

              <div className="flex-1 space-y-2 text-[11px]">
                {project.companyNames.map((name, idx) => (
                  <div
                    key={name + idx}
                    className="flex items-center justify-between rounded bg-stone-800/60 px-3 py-2"
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className="inline-block h-2 w-2 rounded-sm"
                        style={{
                          backgroundColor: PIE_COLORS[idx % PIE_COLORS.length],
                        }}
                      />
                      <p className="text-stone-100">{name}</p>
                    </div>
                    <p className="text-stone-400">
                      {project.companyWeights[idx]}%
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-4 rounded border-4 border-dirt p-3">
            <p className="mb-2 text-[10px] text-stone-400">Contracts</p>
            <div className="space-y-1 text-[10px]">
              {[
                { label: "Vault", value: project.address },
                { label: "Share token", value: project.shareToken },
                { label: "Creator", value: project.creator },
              ].map(({ label, value }) => (
                <div key={label} className="flex items-center gap-2">
                  <span className="w-32 shrink-0 text-stone-500">{label}</span>
                  <span className="min-w-0 flex-1 break-all">
                    {explorerBaseUrl ? (
                      <a
                        href={explorerAddressUrl(value)}
                        target="_blank"
                        rel="noreferrer"
                        className="font-mono text-sky-200 underline decoration-sky-200/40 underline-offset-2 hover:text-sky-100"
                        title={value}
                      >
                        {value}
                      </a>
                    ) : (
                      <span className="font-mono text-stone-400" title={value}>
                        {value}
                      </span>
                    )}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-4 lg:col-span-1">
        <div className="card-frame rounded-lg p-4">
          <div className="mb-3">
            <div className="grid grid-cols-2 gap-2">
              {(["investor", "spv"] as const).map((tab) => {
                const isActive = activeTab === tab;
                return (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    aria-pressed={isActive}
                    className={`relative w-full rounded border-4 px-3 py-2 text-[11px] uppercase transition-all duration-200 ${
                      isActive
                        ? "border-sky-400 bg-gradient-to-b from-sky-900/70 to-sky-800/60 text-sky-50 shadow-[0_0_18px_rgba(56,189,248,0.35)]"
                        : "border-stone-700 bg-stone-900/50 text-stone-400 opacity-70"
                    }`}
                  >
                    {tab === "investor" ? "Investor" : "SPV"}
                    {isActive && (
                      <span
                        aria-hidden="true"
                        className="pointer-events-none absolute -bottom-1 left-1/2 h-1 w-8 -translate-x-1/2 rounded-full bg-sky-400"
                      />
                    )}
                  </button>
                );
              })}
            </div>
            <div className="relative mt-1 h-1 rounded-full bg-stone-800/70">
              <div
                className="absolute top-0 h-1 rounded-full bg-sky-400 transition-all duration-200"
                style={{
                  width: `${sliderWidth}%`,
                  left: `${sliderWidth * activeTabIndex}%`,
                }}
              />
            </div>
          </div>

          {activeTab === "investor" ? (
            <div className="space-y-4">
              <div className="rounded border-4 border-dirt bg-night/40 p-3">
                <p className="mb-2 text-[10px] text-stone-400">Deposit USDC</p>
                <input
                  className="input-blocky mb-3 w-full rounded px-3 py-2 text-xs"
                  type="number"
                  min="0"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
                <button
                  onClick={handleDeposit}
                  className="button-blocky w-full rounded px-3 py-2 text-[11px] uppercase"
                >
                  Deposit
                </button>
              </div>

              <div className="rounded border-4 border-dirt bg-night/40 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[10px] text-stone-400">
                      Claimable profit
                    </p>
                    <p className="text-[11px] text-sky-100">
                      {account
                        ? `${formatUsdc(claimableAmount)} USDC`
                        : "Connect wallet to view"}
                    </p>
                  </div>
                  <button
                    onClick={handleClaim}
                    disabled={!canClaim}
                    className="button-blocky rounded px-3 py-2 text-[11px] uppercase disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Claim
                  </button>
                </div>
              </div>

              {showRefund && (
                <div className="rounded border-4 border-dirt bg-night/40 p-3">
                  <p className="mb-2 text-[10px] text-stone-400">Refund</p>
                  <button
                    onClick={handleRefund}
                    className="button-blocky w-full rounded px-3 py-2 text-[11px] uppercase"
                  >
                    Refund (failed only)
                  </button>
                  <p className="mt-2 text-[10px] text-stone-500">
                    If the minimum raise is not met by the deadline, the project
                    moves to Failed. In that case, the SPV is not progressed and
                    you can claim back your full USDC contribution here.
                  </p>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="rounded border-4 border-dirt bg-night/40 p-3">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[10px] text-stone-400">Withdraw</p>
                    <p className="text-[11px] text-sky-100">
                      {formatUsdc(withdrawPrincipal)} USDC
                    </p>
                  </div>
                  <button
                    onClick={handleWithdrawRaised}
                    disabled={!canWithdrawRaised}
                    className="button-blocky rounded px-3 py-2 text-[11px] uppercase disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Withdraw
                  </button>
                </div>
                <p className="text-[10px] text-stone-500">
                  Creator Fee: {formatUsdc(withdrawFees)} USDC
                </p>
              </div>

              <div className="rounded border-4 border-dirt bg-night/40 p-3">
                <p className="mb-2 text-[10px] text-stone-400">
                  Deposit Profit
                </p>
                <input
                  className="input-blocky mb-3 w-full rounded px-3 py-2 text-xs"
                  type="number"
                  min="0"
                  value={profitAmount}
                  onChange={(e) => setProfitAmount(e.target.value)}
                />
                <button
                  onClick={handleDepositProfit}
                  disabled={!profitsOpen}
                  className="button-blocky w-full rounded px-3 py-2 text-[11px] uppercase disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Add Profit
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="card-frame rounded-lg p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[10px] text-stone-400">Wallet</p>
              {account ? (
                <p className="text-[11px] text-sky-100">
                  {shortAddress(account)}
                </p>
              ) : (
                <p className="text-[10px] text-stone-500">Not connected</p>
              )}
            </div>
            {!account && (
              <button
                onClick={() => connect({ connector: injected() })}
                className="button-blocky rounded px-3 py-2 text-[11px] uppercase"
              >
                Connect
              </button>
            )}
          </div>

          <div className="mt-3 rounded border-4 border-dirt p-3">
            <p className="mb-2 text-[10px] text-stone-400">Balances</p>
            {position ? (
              <div className="space-y-2 text-[11px]">
                <div className="flex justify-between">
                  <span className="text-stone-300">USDC</span>
                  <span className="text-sky-100">
                    {formatUsdc(position.usdcBalance)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-stone-300">Share balance</span>
                  <span className="text-sky-100">
                    {formatUsdc(position.shareBalance)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-stone-300">Claimable profit</span>
                  <span className="text-sky-100">
                    {formatUsdc(position.pending)}
                  </span>
                </div>
              </div>
            ) : (
              <p className="text-[10px] text-stone-500">
                Connect a wallet to view balances.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProjectPage;
