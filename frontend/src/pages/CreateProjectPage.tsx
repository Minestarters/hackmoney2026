import { useCallback, useEffect, useMemo, useState } from "react";
import { Contract, parseUnits } from "ethers";
import { FACTORY_ADDRESS } from "../config";
import { minestartersFactoryAbi } from "../contracts/abis";
import { useWallet } from "../context/WalletContext";
import {
  createYellowSessionManager,
  runYellowMultiPartySession,
  type YellowSessionState,
} from "../lib/yellowSession";

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

const shortAddress = (addr: string) =>
  addr ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : "";

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

  // Yellow Session State
  const [yellowLogs, setYellowLogs] = useState<string[]>([]);
  const [yellowError, setYellowError] = useState<string | null>(null);
  const [sessionState, setSessionState] = useState<YellowSessionState>({ status: "idle" });
  const [inviteCode, setInviteCode] = useState("");
  const [transferAmount, setTransferAmount] = useState("0.10");
  const [legacyRunning, setLegacyRunning] = useState(false);
  const [copied, setCopied] = useState(false);

  const appendLog = useCallback((line: string) => {
    setYellowLogs((prev) => [...prev, line].slice(-100));
  }, []);

  const sessionManager = useMemo(
    () => createYellowSessionManager(setSessionState, appendLog),
    [appendLog]
  );

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

  // Yellow Session Handlers - Creator Flow
  const handleCreateSession = async () => {
    setYellowError(null);
    setYellowLogs([]);
    try {
      await sessionManager.createSession();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to create session";
      setYellowError(msg);
    }
  };

  // Yellow Session Handlers - Joiner Flow
  const handleJoinWithInvite = async () => {
    if (!inviteCode.trim()) {
      setYellowError("Paste the invite code");
      return;
    }
    setYellowError(null);
    setYellowLogs([]);
    try {
      await sessionManager.joinWithInvite(inviteCode.trim());
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to join session";
      setYellowError(msg);
    }
  };

  const handleTransfer = async (toUser: "user1" | "user2") => {
    try {
      await sessionManager.transfer(transferAmount, toUser);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Transfer failed";
      setYellowError(msg);
    }
  };

  const handleCloseSession = async () => {
    try {
      await sessionManager.closeSession();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to close session";
      setYellowError(msg);
    }
  };

  const handleDisconnect = () => {
    sessionManager.disconnect();
    setYellowLogs([]);
    setYellowError(null);
    setInviteCode("");
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const textArea = document.createElement("textarea");
      textArea.value = text;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand("copy");
      document.body.removeChild(textArea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const runLegacyDemo = async () => {
    setYellowError(null);
    setYellowLogs([]);
    setLegacyRunning(true);
    try {
      await runYellowMultiPartySession({ onLog: appendLog });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Yellow session failed";
      setYellowError(msg);
      appendLog(`Error: ${msg}`);
    } finally {
      setLegacyRunning(false);
    }
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

  const isIdle = sessionState.status === "idle";
  const isConnecting = sessionState.status === "connecting";
  const isInviteReady = sessionState.status === "invite_ready";
  const isJoining = sessionState.status === "joining";
  const isActive = sessionState.status === "active";
  const isClosed = sessionState.status === "closed";

  return (
    <div className="card-frame rounded-lg p-6">
      <h1 className="mb-4 text-lg text-sky-200">Create a project</h1>

      {/* Yellow Session UI */}
      <div className="mb-6 rounded border-4 border-dirt p-4 text-xs">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-sm font-medium text-stone-200">Yellow Network Session</p>
          {!isIdle && (
            <span
              className={`rounded px-2 py-0.5 text-[10px] uppercase ${
                isActive
                  ? "bg-green-900 text-green-300"
                  : isInviteReady
                    ? "bg-yellow-900 text-yellow-300"
                    : isClosed
                      ? "bg-stone-700 text-stone-300"
                      : "bg-sky-900 text-sky-300"
              }`}
            >
              {sessionState.status.replace(/_/g, " ")}
            </span>
          )}
        </div>

        {/* Idle State - Choose Role */}
        {isIdle && (
          <div className="space-y-4">
            <p className="text-[10px] text-stone-400">
              Create a session and share the invite code, or join with an invite code from another device.
            </p>
            <div className="grid gap-4 md:grid-cols-2">
              {/* Creator Flow */}
              <div className="rounded border-2 border-sky-800/50 bg-sky-900/10 p-3">
                <p className="mb-2 font-medium text-sky-300">Host (User 1)</p>
                <p className="mb-3 text-[10px] text-stone-400">
                  Create a session and get an invite code to share.
                </p>
                <button
                  type="button"
                  onClick={handleCreateSession}
                  className="button-blocky w-full rounded px-3 py-2"
                  disabled={isConnecting}
                >
                  Create Session
                </button>
              </div>

              {/* Joiner Flow */}
              <div className="rounded border-2 border-amber-800/50 bg-amber-900/10 p-3">
                <p className="mb-2 font-medium text-amber-300">Join (User 2)</p>
                <p className="mb-3 text-[10px] text-stone-400">
                  Paste the invite code from the host.
                </p>
                <div className="space-y-2">
                  <textarea
                    value={inviteCode}
                    onChange={(e) => setInviteCode(e.target.value)}
                    placeholder="Paste invite code here..."
                    className="input-blocky h-16 w-full resize-none rounded px-3 py-2 font-mono text-[9px]"
                  />
                  <button
                    type="button"
                    onClick={handleJoinWithInvite}
                    className="button-blocky w-full rounded px-4 py-2"
                    disabled={isJoining || !inviteCode.trim()}
                  >
                    Join Session
                  </button>
                </div>
              </div>
            </div>

            {/* Legacy Demo */}
            <div className="border-t border-dirt/30 pt-3">
              <button
                type="button"
                onClick={runLegacyDemo}
                className="text-[10px] text-stone-400 underline hover:text-stone-300"
                disabled={legacyRunning}
              >
                {legacyRunning ? "Running..." : "Run automated demo (both wallets locally)"}
              </button>
            </div>
          </div>
        )}

        {/* Connecting State */}
        {(isConnecting || isJoining) && (
          <div className="py-4 text-center">
            <div className="mb-2 text-stone-300">
              {isJoining ? "Joining session..." : "Creating session..."}
            </div>
            <p className="text-[10px] text-stone-400">Authenticating with Yellow Network</p>
          </div>
        )}

        {/* Creator: Invite Ready */}
        {isInviteReady && sessionState.invite && (
          <div className="space-y-4">
            <div className="rounded bg-green-900/20 p-3">
              <p className="mb-2 text-center text-stone-300">Session invite created!</p>
              <div className="grid grid-cols-2 gap-2 text-[10px]">
                <div>
                  <p className="text-stone-500">User 1 (You):</p>
                  <p className="font-mono text-sky-300">{shortAddress(sessionState.user1Address || "")}</p>
                </div>
                <div>
                  <p className="text-stone-500">User 2:</p>
                  <p className="font-mono text-amber-300">{shortAddress(sessionState.user2Address || "")}</p>
                </div>
              </div>
            </div>

            <div className="rounded border-2 border-yellow-800/50 bg-yellow-900/10 p-3">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-[10px] text-stone-400">Share this invite code:</p>
                <button
                  type="button"
                  onClick={() => copyToClipboard(sessionState.invite!)}
                  className="rounded border border-yellow-700 px-2 py-0.5 text-[10px] text-yellow-300 hover:bg-yellow-900/30"
                >
                  {copied ? "Copied!" : "Copy"}
                </button>
              </div>
              <textarea
                readOnly
                value={sessionState.invite}
                className="h-20 w-full resize-none rounded bg-black/30 p-2 font-mono text-[8px] text-yellow-200"
              />
            </div>

            <p className="text-center text-[10px] text-stone-400">
              Send this code to User 2. They paste it on their device to join.
            </p>

            <button
              type="button"
              onClick={handleDisconnect}
              className="w-full rounded border border-stone-600 px-3 py-1 text-stone-400 hover:bg-stone-800"
            >
              Cancel
            </button>
          </div>
        )}

        {/* Active State */}
        {isActive && (
          <div className="space-y-4">
            <div className="rounded bg-green-900/20 p-3">
              <p className="mb-2 text-center text-[10px] text-stone-400">Session Active</p>
              <p className="text-center font-mono text-[10px] text-stone-500">
                {sessionState.appSessionId?.slice(0, 20)}...
              </p>
            </div>

            {/* Allocations */}
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded border border-sky-800 bg-sky-900/20 p-3 text-center">
                <p className="text-[10px] text-stone-400">User 1 (Host)</p>
                <p className="text-lg text-sky-300">{sessionState.allocations?.user1 || "0"}</p>
                <p className="text-[10px] text-stone-500">ytest.usd</p>
                <p className="mt-1 text-[9px] text-stone-500">
                  {shortAddress(sessionState.user1Address || "")}
                </p>
              </div>
              <div className="rounded border border-amber-800 bg-amber-900/20 p-3 text-center">
                <p className="text-[10px] text-stone-400">User 2 (Joiner)</p>
                <p className="text-lg text-amber-300">{sessionState.allocations?.user2 || "0"}</p>
                <p className="text-[10px] text-stone-500">ytest.usd</p>
                <p className="mt-1 text-[9px] text-stone-500">
                  {shortAddress(sessionState.user2Address || "")}
                </p>
              </div>
            </div>

            {/* Transfer */}
            <div className="rounded border-2 border-dirt/50 p-3">
              <p className="mb-2 text-stone-300">Transfer funds</p>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  value={transferAmount}
                  onChange={(e) => setTransferAmount(e.target.value)}
                  className="input-blocky w-24 rounded px-2 py-1 text-center"
                  step="0.01"
                  min="0"
                />
                <span className="text-[10px] text-stone-400">ytest.usd</span>
                <div className="flex flex-1 justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => handleTransfer("user1")}
                    className="rounded border border-sky-700 px-3 py-1 text-sky-300 hover:bg-sky-900/30"
                  >
                    → User 1
                  </button>
                  <button
                    type="button"
                    onClick={() => handleTransfer("user2")}
                    className="rounded border border-amber-700 px-3 py-1 text-amber-300 hover:bg-amber-900/30"
                  >
                    → User 2
                  </button>
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleCloseSession}
                className="flex-1 rounded bg-red-900/50 px-3 py-2 text-red-300 hover:bg-red-900/70"
              >
                Close Session
              </button>
              <button
                type="button"
                onClick={handleDisconnect}
                className="rounded border border-stone-600 px-3 py-2 text-stone-400 hover:bg-stone-800"
              >
                Disconnect
              </button>
            </div>
          </div>
        )}

        {/* Closed State */}
        {isClosed && (
          <div className="space-y-3">
            <div className="rounded bg-stone-800 p-3 text-center">
              <p className="text-stone-300">Session closed</p>
              <p className="mt-1 text-[10px] text-stone-400">
                Final balances have been settled
              </p>
            </div>
            <button
              type="button"
              onClick={handleDisconnect}
              className="button-blocky w-full rounded px-3 py-2"
            >
              Start New Session
            </button>
          </div>
        )}

        {/* Error */}
        {yellowError && (
          <p className="mt-2 rounded bg-red-900/30 p-2 text-[10px] text-red-300">
            {yellowError}
          </p>
        )}

        {/* Logs */}
        {yellowLogs.length > 0 && (
          <div className="mt-3 max-h-32 overflow-y-auto rounded border-2 border-dirt/50 bg-black/30 p-2 font-mono text-[10px] text-stone-400">
            {yellowLogs.map((line, idx) => (
              <p key={`${line}-${idx}`}>{line}</p>
            ))}
          </div>
        )}
      </div>

      {/* Project Creation Form */}
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
