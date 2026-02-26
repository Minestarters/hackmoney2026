import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePrivy, useFundWallet, useWallets } from "@privy-io/react-auth";
import { useAccount, useReadContract } from "wagmi";
import { sepolia } from "viem/chains";
import { formatUnits } from "viem";
import { shortAddress } from "../lib/format";
import { useKernelClient } from "../lib/kernelClient";
import { USDC_ADDRESS } from "../config";


const USDC_DECIMALS = 6;

const ERC20_BALANCE_ABI = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

function useCopyText() {
  const [copied, setCopied] = useState(false);
  const copy = useCallback((text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, []);
  return { copied, copy };
}

function useUsdcBalance(address: string | null) {
  const { data, isLoading } = useReadContract({
    address: USDC_ADDRESS as `0x${string}`,
    abi: ERC20_BALANCE_ABI,
    functionName: "balanceOf",
    args: [address as `0x${string}`],
    query: {
      enabled: !!address && !!USDC_ADDRESS,
      staleTime: 15_000,
      refetchInterval: 30_000,
      refetchIntervalInBackground: false,
    },
  });

  return {
    balance: data != null ? formatUnits(data, USDC_DECIMALS) : null,
    loading: isLoading,
  };
}

function CopyIcon() {
  return (
    <svg className="h-3 w-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="5" y="5" width="9" height="9" rx="1" />
      <path d="M2 11V2h9" />
    </svg>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      className={`h-2 w-2 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
      viewBox="0 0 8 8"
      fill="currentColor"
    >
      <path d="M0 2l4 4 4-4z" />
    </svg>
  );
}

function AddressRow({
  label,
  address,
  loading = false,
  accent = false,
}: {
  label: string;
  address: string | null;
  loading?: boolean;
  accent?: boolean;
}) {
  const { copied, copy } = useCopyText();
  return (
    <div className="mb-3">
      <p className="mb-1 text-[8px] uppercase tracking-widest text-stone-500">{label}</p>
      <div
        className={`flex items-center justify-between rounded border px-2 py-1.5 bg-stone-900/60 ${
          accent ? "border-grass/20" : "border-stone-700"
        }`}
      >
        <span className={`font-mono text-[9px] ${accent ? "text-grass" : "text-stone-300"}`}>
          {loading ? "resolving…" : address ? shortAddress(address) : "—"}
        </span>
        {address && (
          <button
            type="button"
            onClick={() => copy(address)}
            className={`${accent ? "hover:text-grass" : "hover:text-stone-200"} text-stone-400`}
            title={`Copy ${label}`}
          >
            {copied ? <span className="text-[8px] text-grass">✓</span> : <CopyIcon />}
          </button>
        )}
      </div>
    </div>
  );
}

function UsdcBalanceRow({ address }: { address: string | null }) {
  const { balance, loading } = useUsdcBalance(address);
  if (!USDC_ADDRESS) return null;

  return (
    <div className="mb-3 flex items-center justify-between rounded border border-stone-700/60 bg-stone-900/40 px-2 py-1.5">
      <div className="flex items-center gap-1.5">
        {/* USDC circle logo */}
        <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-blue-500 text-[7px] font-black text-white">$</span>
        <span className="text-[8px] uppercase tracking-widest text-stone-500">USDC</span>
      </div>
      <span className="font-mono text-[9px] text-stone-200">
        {loading ? "…" : balance !== null ? Number(balance).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—"}
      </span>
    </div>
  );
}


export default function WalletDropdown() {
  const { ready, authenticated, login, logout, user } = usePrivy();
  const { address: eoaAddress } = useAccount();
  const { wallets } = useWallets();
  const { getKernelClient } = useKernelClient();
  const { fundWallet } = useFundWallet();

  const [open, setOpen] = useState(false);
  const [kernelAddress, setKernelAddress] = useState<string | null>(null);
  const [kernelLoading, setKernelLoading] = useState(false);

  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!authenticated) { setKernelAddress(null); return; }
    let cancelled = false;
    setKernelLoading(true);
    getKernelClient()
      .then((client) => { if (!cancelled) setKernelAddress((client.account?.address as string) ?? null); })
      .catch(() => { if (!cancelled) setKernelAddress(null); })
      .finally(() => { if (!cancelled) setKernelLoading(false); });
    return () => { cancelled = true; };
  }, [authenticated, wallets, getKernelClient]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const buttonLabel = useMemo(
    () =>
      kernelLoading ? "Loading…"
      : (kernelAddress ?? eoaAddress) ? shortAddress((kernelAddress ?? eoaAddress)!)
      : "Wallet",
    [kernelLoading, kernelAddress, eoaAddress],
  );

  const userEmail = user?.email?.address;

  const isLinkedExternalWallet = useMemo(
    () =>
      !!eoaAddress &&
      (user?.linkedAccounts ?? []).some(
        (acct) =>
          acct.type === "wallet" &&
          "address" in acct &&
          acct.address?.toLowerCase() === eoaAddress.toLowerCase(),
      ),
    [eoaAddress, user?.linkedAccounts],
  );

  const handleFund = useCallback(async () => {
    const target = kernelAddress ?? eoaAddress;
    if (!target) return;
    setOpen(false);
    await fundWallet({ address: target as `0x${string}`, options: { chain: sepolia } });
  }, [kernelAddress, eoaAddress, fundWallet]);

  if (!ready) return <div className="h-8 w-24 animate-pulse rounded bg-stone-800" />;

  if (!authenticated) {
    return (
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={login}
          className="button-blocky rounded px-3 py-2 text-[10px] uppercase tracking-wider"
        >
          Login
        </button>
        <button
          type="button"
          onClick={login}
          className="rounded border-2 border-grass bg-grass/10 px-3 py-2 text-[10px] uppercase tracking-wider text-grass transition-colors hover:bg-grass/20"
        >
          Sign Up
        </button>
      </div>
    );
  }

  return (
    <div ref={dropdownRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded border-2 border-grass/60 bg-night px-3 py-2 text-[10px] uppercase tracking-wider text-grass transition-colors hover:border-grass hover:bg-grass/10"
      >
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-grass" />
        {buttonLabel}
        <ChevronIcon open={open} />
      </button>

      {open && (
        <div className="card-frame absolute right-0 top-full z-50 mt-2 w-64 rounded-lg border-2 border-grass/30 bg-night p-4 shadow-lg">
          {userEmail && (
            <p className="mb-3 truncate text-[9px] text-stone-400">✉ {userEmail}</p>
          )}

          <AddressRow label="Smart Account" address={kernelAddress} loading={kernelLoading} accent />

          {isLinkedExternalWallet && eoaAddress && (
            <AddressRow label="Signer (EOA)" address={eoaAddress} />
          )}

          {/* USDC balance — reads from kernel smart account */}
          <UsdcBalanceRow address={kernelAddress} />

          <div className="space-y-2 border-t border-stone-800 pt-3">
            <button
              type="button"
              onClick={handleFund}
              className="flex w-full items-center gap-2 rounded border border-sky/40 bg-sky/10 px-3 py-2 text-left text-[9px] uppercase tracking-wider text-sky-300 transition-colors hover:border-sky/70 hover:bg-sky/20"
            >
              <span>⬆</span>
              Fund Wallet
            </button>

            <button
              type="button"
              onClick={() => { setOpen(false); logout(); }}
              className="flex w-full items-center gap-2 rounded border border-stone-700 bg-stone-900/40 px-3 py-2 text-left text-[9px] uppercase tracking-wider text-stone-400 transition-colors hover:border-red-500/50 hover:bg-red-900/20 hover:text-red-400"
            >
              <span>⏻</span>
              Disconnect
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
