import { useEffect, useState } from "react";
import { Contract, parseUnits } from "ethers";
import { FACTORY_ADDRESS } from "../config";
import { minestartersFactoryAbi } from "../contracts/abis";
import { useWallet } from "../context/WalletContext";

type CompanyInput = { name: string; weight: number };

const toDateInputValue = (date: Date) => {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const addDays = (date: Date, days: number) => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};

const dateInputValueToUnixSeconds = (value: string) => {
  const [yearStr, monthStr, dayStr] = value.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  const localMidnight = new Date(year, month - 1, day, 0, 0, 0);
  return Math.floor(localMidnight.getTime() / 1000);
};

const CreateProjectPage = () => {
  const { signer, connect, account } = useWallet();
  const [projectName, setProjectName] = useState("");
  const [minimumRaise, setMinimumRaise] = useState("1000");
  const [deadline, setDeadline] = useState(() => toDateInputValue(addDays(new Date(), 30)));
  const [raiseFeePct, setRaiseFeePct] = useState("0.05");
  const [profitFeePct, setProfitFeePct] = useState("0.01");
  const [withdrawAddress, setWithdrawAddress] = useState("");
  const [companies, setCompanies] = useState<CompanyInput[]>([
    { name: "Company A", weight: 50 },
    { name: "Company B", weight: 50 },
  ]);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (account && !withdrawAddress) {
      setWithdrawAddress(account);
    }
  }, [account, withdrawAddress]);

  const handleCompanyChange = (index: number, field: keyof CompanyInput, value: string) => {
    setCompanies((prev) =>
      prev.map((entry, i) =>
        i === index ? { ...entry, [field]: field === "weight" ? Number(value) : value } : entry
      )
    );
  };

  const addCompanyRow = () => {
    setCompanies((prev) => [...prev, { name: "", weight: 0 }]);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);

    if (!FACTORY_ADDRESS) {
      setMessage("Set VITE_FACTORY_ADDRESS to deploy");
      return;
    }

    const totalWeight = companies.reduce((sum, c) => sum + c.weight, 0);
    if (totalWeight !== 100) {
      setMessage("Weights must sum to 100%");
      return;
    }

    if (!signer) {
      await connect();
      return;
    }

    try {
      setSubmitting(true);
      const factory = new Contract(FACTORY_ADDRESS, minestartersFactoryAbi, signer);
      const minRaise = parseUnits(minimumRaise || "0", 6);
      const deadlineTs = dateInputValueToUnixSeconds(deadline);
      if (!Number.isFinite(deadlineTs)) {
        setMessage("Select a valid deadline");
        setSubmitting(false);
        return;
      }
      const raiseFeeBps = Math.round((parseFloat(raiseFeePct || "0") || 0) * 100);
      const profitFeeBps = Math.round((parseFloat(profitFeePct || "0") || 0) * 100);

      if (raiseFeeBps > 10_000 || profitFeeBps > 10_000) {
        setMessage("Fees cannot exceed 100%");
        setSubmitting(false);
        return;
      }

      const tx = await factory.createProject(
        projectName,
        companies.map((c) => c.name),
        companies.map((c) => c.weight),
        minRaise,
        deadlineTs,
        withdrawAddress,
        raiseFeeBps,
        profitFeeBps
      );

      await tx.wait();
      setMessage("Project created! Refresh home to see it.");
    } catch (err) {
      console.error(err);
      setMessage("Transaction failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="card-frame rounded-lg p-6">
      <h1 className="mb-4 text-lg text-sky-200">Create a project</h1>
      <form onSubmit={handleSubmit} className="space-y-4 text-xs">
        <div className="grid gap-4 md:grid-cols-2">
          <label className="space-y-2">
            <span className="text-stone-300">Project name</span>
            <input
              className="input-blocky w-full rounded px-3 py-2"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              required
            />
          </label>
          <label className="space-y-2">
            <span className="text-stone-300">Withdraw address</span>
            <input
              className="input-blocky w-full rounded px-3 py-2"
              value={withdrawAddress}
              onChange={(e) => setWithdrawAddress(e.target.value)}
              required
            />
          </label>
          <label className="space-y-2">
            <span className="text-stone-300">Minimum raise (USDC)</span>
            <input
              className="input-blocky w-full rounded px-3 py-2"
              value={minimumRaise}
              onChange={(e) => setMinimumRaise(e.target.value)}
              type="number"
              min="0"
            />
          </label>
          <label className="space-y-2">
            <span className="text-stone-300">Deadline</span>
            <input
              className="input-blocky w-full rounded px-3 py-2"
              type="date"
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
              min={toDateInputValue(new Date())}
              required
            />
          </label>
          <label className="space-y-2">
            <span className="text-stone-300">Raise fee (%)</span>
            <input
              className="input-blocky w-full rounded px-3 py-2"
              type="number"
              step="0.01"
              value={raiseFeePct}
              onChange={(e) => setRaiseFeePct(e.target.value)}
              min="0"
              max="100"
            />
          </label>
          <label className="space-y-2">
            <span className="text-stone-300">Profit fee (%)</span>
            <input
              className="input-blocky w-full rounded px-3 py-2"
              type="number"
              step="0.01"
              value={profitFeePct}
              onChange={(e) => setProfitFeePct(e.target.value)}
              min="0"
              max="100"
            />
          </label>
        </div>

        <div className="rounded border-4 border-dirt p-3">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-stone-300">Companies & weights</p>
            <button type="button" onClick={addCompanyRow} className="button-blocky rounded px-3 py-1">
              Add Row
            </button>
          </div>
          <div className="space-y-2">
            {companies.map((company, idx) => (
              <div key={idx} className="grid grid-cols-6 gap-2">
                <input
                  className="input-blocky col-span-4 rounded px-3 py-2"
                  value={company.name}
                  onChange={(e) => handleCompanyChange(idx, "name", e.target.value)}
                  placeholder={`Company ${idx + 1}`}
                  required
                />
                <input
                  className="input-blocky col-span-2 rounded px-3 py-2"
                  type="number"
                  value={company.weight}
                  min="0"
                  max="100"
                  onChange={(e) => handleCompanyChange(idx, "weight", e.target.value)}
                  required
                />
              </div>
            ))}
          </div>
          <p className="mt-2 text-[10px] text-stone-400">
            Weights must sum to 100%. Fees entered as percentages (e.g. 2.5 = 2.5% = 250 bps).
          </p>
        </div>

        {message && <p className="text-[10px] text-sky-200">{message}</p>}

        <button
          type="submit"
          className="button-blocky rounded px-4 py-3 text-xs uppercase"
          disabled={submitting}
        >
          {submitting ? "Deploying..." : "Create project"}
        </button>
      </form>
    </div>
  );
};

export default CreateProjectPage;
