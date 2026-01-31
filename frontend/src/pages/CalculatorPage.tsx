import { useEffect, useMemo, useState } from "react";

type CompanyInput = {
  id: string;
  name: string;
  split: string;
};

type CalculatorState = {
  companies: CompanyInput[];
  selectedCompanyId: string | null;
  raiseFeePct: string;
  profitFeePct: string;
  totalContribution: string;
  profitAmount: string;
};

const STORAGE_KEY = "calculator-state:global";

const createId = () => Math.random().toString(36).slice(2, 10);

const clampPercent = (value: number) => {
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(value, 0), 100);
};

const sanitizeNumber = (value: string) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(parsed, 0) : 0;
};

const normalizePercentInput = (value: string, maxDecimals = 5) => {
  if (value === "") return "";
  if (value === ".") return "0.";
  if (!/^\d*(?:\.\d*)?$/.test(value)) {
    return null;
  }
  const [intPart = "", decimalPart = ""] = value.split(".");
  if (decimalPart.length > maxDecimals) {
    return `${intPart}.${decimalPart.slice(0, maxDecimals)}`;
  }
  if (value.endsWith(".") && decimalPart.length === 0) {
    return `${intPart}.`;
  }
  return value;
};

const formatNumber = (value: number) =>
  value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const formatPercent = (value: number) =>
  `${value.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 6,
  })}%`;

const createDefaultState = (): CalculatorState => {
  const companies: CompanyInput[] = [
    {
      id: createId(),
      name: "Company 1",
      split: "100",
    },
  ];

  return {
    companies,
    selectedCompanyId: companies[0]?.id ?? null,
    raiseFeePct: "0",
    profitFeePct: "0",
    totalContribution: "",
    profitAmount: "",
  };
};

const loadCalculatorState = (): CalculatorState => {
  const fallback = createDefaultState();
  if (typeof window === "undefined") {
    return fallback;
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return fallback;
    }
    const parsed = JSON.parse(raw) as Partial<CalculatorState> | null;
    const rawCompanies = Array.isArray(parsed?.companies) ? parsed?.companies : null;
    const companies =
      rawCompanies && rawCompanies.length > 0
        ? rawCompanies.map((company) => ({
            ...company,
            id: company.id ?? createId(),
            split: typeof company.split === "string" ? company.split : "",
          }))
        : fallback.companies;
    const selectedCompanyId = companies.some((company) => company.id === parsed?.selectedCompanyId)
      ? parsed?.selectedCompanyId ?? companies[0]?.id ?? null
      : companies[0]?.id ?? null;

    const legacyRaiseBps = (parsed as Record<string, unknown> | null)?.raiseFeeBps;
    const legacyProfitBps = (parsed as Record<string, unknown> | null)?.profitFeeBps;
    return {
      companies,
      selectedCompanyId,
      raiseFeePct:
        typeof parsed?.raiseFeePct === "string"
          ? parsed.raiseFeePct
          : typeof legacyRaiseBps === "string"
            ? (Number(legacyRaiseBps) / 100).toString()
            : fallback.raiseFeePct,
      profitFeePct:
        typeof parsed?.profitFeePct === "string"
          ? parsed.profitFeePct
          : typeof legacyProfitBps === "string"
            ? (Number(legacyProfitBps) / 100).toString()
            : fallback.profitFeePct,
      totalContribution:
        typeof parsed?.totalContribution === "string" ? parsed.totalContribution : fallback.totalContribution,
      profitAmount: typeof parsed?.profitAmount === "string" ? parsed.profitAmount : fallback.profitAmount,
    };
  } catch (error) {
    console.error("Failed to load calculator state", error);
    return fallback;
  }
};

const CalculatorPage = () => {
  const [state, setState] = useState<CalculatorState>(() => loadCalculatorState());

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  const raiseFeePercentValue = clampPercent(Number(state.raiseFeePct));
  const profitFeePercentValue = clampPercent(Number(state.profitFeePct));

  const updateCompany = (id: string, field: keyof Omit<CompanyInput, "id">, value: string) => {
    if (field === "split" && !/^\d*(?:\.\d*)?$/.test(value)) {
      return;
    }
    setState((prev) => ({
      ...prev,
      companies: prev.companies.map((company) => (company.id === id ? { ...company, [field]: value } : company)),
    }));
  };

  const updateFee = (field: "raiseFeePct" | "profitFeePct", value: string) => {
    const normalized = normalizePercentInput(value);
    if (normalized === null) {
      return;
    }
    setState((prev) => ({
      ...prev,
      [field]: normalized,
    }));
  };

  const updateContribution = (value: string) => {
    if (!/^\d*(?:\.\d*)?$/.test(value)) return;
    setState((prev) => ({
      ...prev,
      totalContribution: value,
    }));
  };

  const updateProfitAmount = (value: string) => {
    if (!/^\d*(?:\.\d*)?$/.test(value)) return;
    setState((prev) => ({
      ...prev,
      profitAmount: value,
    }));
  };

  const addCompany = () => {
    setState((prev) => {
      const nextCompany = { id: createId(), name: "", split: "" };
      const next = {
        ...prev,
        companies: [...prev.companies, nextCompany],
      };
      if (!next.selectedCompanyId) {
        next.selectedCompanyId = nextCompany.id;
      }
      return next;
    });
  };

  const removeCompany = (id: string) => {
    setState((prev) => {
      if (prev.companies.length === 1) {
        return prev;
      }
      const filtered = prev.companies.filter((company) => company.id !== id);
      const selectedCompanyId = prev.selectedCompanyId === id ? filtered[0]?.id ?? null : prev.selectedCompanyId;
      return {
        ...prev,
        companies: filtered,
        selectedCompanyId,
      };
    });
  };

  const selectCompany = (id: string) => {
    setState((prev) => ({
      ...prev,
      selectedCompanyId: id,
    }));
  };

  const companySummaries = useMemo(() => {
    const parsed = state.companies.map((company) => {
      const splitValue = Math.max(Number(company.split) || 0, 0);
      return {
        ...company,
        splitValue,
      };
    });
    const totalSplit = parsed.reduce((sum, company) => sum + company.splitValue, 0);
    return parsed.map((company) => ({
      ...company,
      normalizedShare: totalSplit > 0 ? company.splitValue / totalSplit : 0,
    }));
  }, [state.companies]);

  const totalSplitPercent = companySummaries.reduce((sum, company) => sum + company.splitValue, 0);

  const totals = useMemo(() => {
    const contribution = sanitizeNumber(state.totalContribution);
    const raiseFeeFraction = raiseFeePercentValue / 100;
    const totalRaiseFees = contribution * raiseFeeFraction;
    const totalNetShares = Math.max(contribution - totalRaiseFees, 0);

    return {
      totalContribution: contribution,
      totalRaiseFees,
      totalNetShares,
    };
  }, [state.totalContribution, raiseFeePercentValue]);

  const selectedCompany =
    companySummaries.find((company) => company.id === state.selectedCompanyId) ?? companySummaries[0];
  const grossProfit = sanitizeNumber(state.profitAmount);
  const curatorCut = grossProfit * (profitFeePercentValue / 100);
  const investorPool = Math.max(grossProfit - curatorCut, 0);

  return (
    <div className="space-y-6">
      <div>
        <p className="text-[10px] uppercase tracking-wide text-stone-400">Tools</p>
        <h1 className="text-2xl text-sky-100">Offline Profit Calculator</h1>
      </div>

      <div className="rounded border-4 border-dirt bg-night/40 p-4">
        <p className="text-[10px] uppercase text-stone-400">Fee Settings</p>
        <div className="mt-3 grid gap-4 md:grid-cols-2">
          <label className="block text-[10px] uppercase text-stone-400">
            Raise Fee (%)
            <input
              type="number"
              min="0"
              max="100"
              value={state.raiseFeePct}
              onChange={(event) => updateFee("raiseFeePct", event.target.value)}
              className="input-blocky mt-1 w-full rounded px-3 py-2 text-xs"
            />
            <span className="mt-1 block text-[10px] text-stone-500">
              {formatPercent(raiseFeePercentValue)} taken from all investor deposits.
            </span>
          </label>
          <label className="block text-[10px] uppercase text-stone-400">
            Profit Fee (%)
            <input
              type="number"
              min="0"
              max="100"
              value={state.profitFeePct}
              onChange={(event) => updateFee("profitFeePct", event.target.value)}
              className="input-blocky mt-1 w-full rounded px-3 py-2 text-xs"
            />
            <span className="mt-1 block text-[10px] text-stone-500">
              {formatPercent(profitFeePercentValue)} taken from all exit proceeds.
            </span>
          </label>
        </div>
      </div>

      <div className="rounded border-4 border-dirt bg-night/40 p-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[10px] uppercase text-stone-400">Basket Companies</p>
          <button onClick={addCompany} className="button-blocky rounded px-2 py-1 text-[10px] uppercase">
            Add Company
          </button>
        </div>
        <div className="mt-3 space-y-3">
          {state.companies.map((company) => (
            <div key={company.id} className="rounded border-4 border-dirt bg-stone-900/40 p-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <input
                  className="input-blocky flex-1 rounded px-3 py-2 text-xs"
                  placeholder="Company name"
                  value={company.name}
                  onChange={(event) => updateCompany(company.id, "name", event.target.value)}
                />
                <label className="flex items-center gap-2 text-[10px] uppercase text-stone-400">
                  <span className="whitespace-nowrap">Split (%)</span>
                  <input
                    type="number"
                    min="0"
                    value={company.split}
                    onChange={(event) => updateCompany(company.id, "split", event.target.value)}
                    className="input-blocky w-24 rounded px-3 py-2 text-xs"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => removeCompany(company.id)}
                  className="rounded border border-stone-700 px-2 py-2 text-[10px] text-stone-300 sm:px-3"
                  disabled={state.companies.length === 1}
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
        <p className="mt-3 text-[10px] text-stone-400">
          Declared splits total:{" "}
          <span className={totalSplitPercent === 100 ? "text-grass" : "text-sunrise"}>
            {totalSplitPercent.toFixed(2)}%
          </span>{" "}
          {totalSplitPercent === 100 ? "(balanced)" : "(adjust to hit 100%)"}
        </p>
      </div>

      <div className="rounded border-4 border-dirt bg-night/40 p-4">
        <p className="text-[10px] uppercase text-stone-400">Investor Group</p>
        <div className="mt-3 grid gap-4 md:grid-cols-2">
          <label className="block text-[10px] uppercase text-stone-400 md:col-span-2">
            Total Deposited (USDC)
            <input
              type="number"
              min="0"
              value={state.totalContribution}
              onChange={(event) => updateContribution(event.target.value)}
              className="input-blocky mt-1 w-full rounded px-3 py-2 text-xs"
            />
          </label>
          <div className="rounded border border-stone-700 bg-stone-900/40 p-3">
            <p className="text-[10px] uppercase text-stone-400">Used to Acquire Equity</p>
            <p className="text-2xl text-sunrise">{formatNumber(totals.totalNetShares)} USDC</p>
            <p className="text-[10px] text-stone-400">
              {totals.totalContribution > 0
                ? `${((totals.totalNetShares / totals.totalContribution) * 100).toFixed(2)}% of deposits`
                : "0.00% of deposits"}
            </p>
          </div>
          <div className="rounded border border-stone-700 bg-stone-900/40 p-3">
            <p className="text-[10px] uppercase text-stone-400">Curator Raise Fees</p>
            <p className="text-2xl text-grass">{formatNumber(totals.totalRaiseFees)} USDC</p>
            <p className="text-[10px] text-stone-400">
              {totals.totalContribution > 0
                ? `${((totals.totalRaiseFees / totals.totalContribution) * 100).toFixed(2)}% of deposits`
                : "0.00% of deposits"}
            </p>
          </div>
      </div>
    </div>

      <div className="rounded border-4 border-dirt bg-night/40 p-4">
        <div className="mt-3 grid gap-4 md:grid-cols-2">
          <div className="md:col-span-2 md:flex md:items-end md:gap-4">
            <div className="flex-1">
              <p className="text-[10px] uppercase text-stone-400">Profit Source</p>
              <select
                className="input-blocky mt-1 w-full rounded px-3 py-2 text-xs"
                value={selectedCompany?.id ?? ""}
                onChange={(event) => selectCompany(event.target.value)}
              >
                {companySummaries.map((company) => (
                  <option key={company.id} value={company.id}>
                    {company.name || "Unnamed company"}
                  </option>
                ))}
              </select>
            </div>
            <label className="mt-3 block flex-1 text-[10px] uppercase text-stone-400 md:mt-0 md:max-w-xs">
              Profit Amount (USDC)
              <input
                type="number"
                min="0"
                value={state.profitAmount}
                onChange={(event) => updateProfitAmount(event.target.value)}
                className="input-blocky mt-1 w-full rounded px-3 py-2 text-xs"
              />
            </label>
          </div>
          <div className="rounded border border-stone-700 bg-stone-900/40 p-3 text-[11px] text-stone-200">
            <p className="text-[10px] uppercase text-stone-400">Investor Payout</p>
            <p className="text-2xl text-sunrise">{formatNumber(investorPool)} USDC</p>
            <p className="text-[10px] text-stone-400">
              {grossProfit > 0 ? ((investorPool / grossProfit) * 100).toFixed(2) : "0.00"}% of profit
            </p>
          </div>
          <div className="rounded border border-stone-700 bg-stone-900/40 p-3 text-[11px] text-stone-200">
            <p className="text-[10px] uppercase text-stone-400">Curator Proceeds Fees</p>
            <p className="text-2xl text-grass">{formatNumber(curatorCut)} USDC</p>
            <p className="text-[10px] text-stone-400">
              {grossProfit > 0 ? ((curatorCut / grossProfit) * 100).toFixed(2) : "0.00"}% of profit
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CalculatorPage;
