import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Contract, isAddress, parseUnits } from "ethers";
import { FACTORY_ADDRESS } from "../config";
import { minestartersFactoryAbi } from "../contracts/abis";
import { useWallet } from "../context/WalletContext";
import {
  YellowApp,
  type YellowConnectionStatus,
  type YellowAuthStatus,
  type YellowSessionInfo,
} from "../lib/YellowApp";
import type { Address } from "viem";

type CompanyInput = { name: string; weight: number };
type RoomMessage = {
  id: string;
  sender?: string;
  type: "state:update" | "chat:message";
  data: unknown;
  timestamp: number;
};

type RoomState = {
  projectName: string;
  minimumRaise: string;
  deadline: string;
  raiseFeePct: string;
  profitFeePct: string;
  withdrawAddress: string;
  companies: CompanyInput[];
};

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
  const [yellowStatus, setYellowStatus] = useState<YellowConnectionStatus>("disconnected");
  const [authStatus, setAuthStatus] = useState<YellowAuthStatus>("unauthenticated");
  const [roomError, setRoomError] = useState<string | null>(null);
  const [participantsInput, setParticipantsInput] = useState("");
  const [roomNonce, setRoomNonce] = useState(() => `${Date.now()}`);
  const [sessionId, setSessionId] = useState<`0x${string}` | null>(null);
  const [sessionParticipants, setSessionParticipants] = useState<string[]>([]);
  const [availableSessions, setAvailableSessions] = useState<YellowSessionInfo[]>([]);
  const [roomMessages, setRoomMessages] = useState<RoomMessage[]>([]);
  const [chatInput, setChatInput] = useState("");

  const yellowAppRef = useRef<YellowApp | null>(null);
  const suppressBroadcastRef = useRef(false);
  const lastUpdateIdRef = useRef<string | null>(null);
  const nextMessageIdRef = useRef(0);

  const collaborationState = useMemo<RoomState>(
    () => ({
      projectName,
      minimumRaise,
      deadline,
      raiseFeePct,
      profitFeePct,
      withdrawAddress,
      companies,
    }),
    [
      projectName,
      minimumRaise,
      deadline,
      raiseFeePct,
      profitFeePct,
      withdrawAddress,
      companies,
    ]
  );

  const handleIncomingState = useCallback((state: RoomState) => {
    suppressBroadcastRef.current = true;
    setProjectName(state.projectName ?? "");
    setMinimumRaise(state.minimumRaise ?? "0");
    setDeadline(state.deadline ?? toDateInputValue(addDays(new Date(), 30)));
    setRaiseFeePct(state.raiseFeePct ?? "0");
    setProfitFeePct(state.profitFeePct ?? "0");
    setWithdrawAddress(state.withdrawAddress ?? "");
    if (state.companies?.length) {
      setCompanies(
        state.companies.map((company) => ({
          name: company.name ?? "",
          weight: Number(company.weight ?? 0),
        }))
      );
    }
  }, []);

  const handleYellowMessage = useCallback(
    (payload: unknown) => {
      if (!payload || typeof payload !== "object") return;
      const p = payload as Record<string, unknown>;
      const messageType = p.type as RoomMessage["type"];
      const updateId = String(p.id ?? p.updateId ?? "");
      if (updateId && updateId === lastUpdateIdRef.current) return;
      if (updateId) {
        lastUpdateIdRef.current = updateId;
      }
      const sender = p.sender as string | undefined;
      const timestamp = Number(p.timestamp || Date.now());
      const data = p.data as Record<string, unknown> | undefined;

      if (messageType === "state:update" && data?.state) {
        if (sender && account && sender.toLowerCase() === account.toLowerCase()) {
          return;
        }
        handleIncomingState(data.state as RoomState);
      }

      if (messageType === "chat:message" && data?.text) {
        if (sender && account && sender.toLowerCase() === account.toLowerCase()) {
          return;
        }
        setRoomMessages((prev) => [
          ...prev,
          {
            id: updateId || `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            sender,
            type: "chat:message",
            data: data,
            timestamp,
          },
        ]);
      }
    },
    [account, handleIncomingState]
  );

  useEffect(() => {
    if (account && !withdrawAddress) {
      setWithdrawAddress(account);
    }
  }, [account, withdrawAddress]);

  useEffect(() => {
    if (!account) return;
    const normalized = account.toLowerCase();
    const existing = participantsInput
      .split(/[,\s]+/)
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean);
    if (!existing.includes(normalized)) {
      setParticipantsInput((prev) => (prev ? `${prev}, ${account}` : account));
    }
  }, [account, participantsInput]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      yellowAppRef.current?.disconnect();
    };
  }, []);

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

  const getParticipants = useCallback(() => {
    const participants = participantsInput
      .split(/[,\s]+/)
      .map((entry) => entry.trim())
      .filter(Boolean)
      .filter((entry) => isAddress(entry));
    if (account && isAddress(account)) {
      participants.unshift(account);
    }
    return Array.from(new Set(participants.map((entry) => entry.toLowerCase())));
  }, [participantsInput, account]);

  const applySessionData = useCallback(
    (raw?: string) => {
      if (!raw) return;
      try {
        const parsed = JSON.parse(raw) as RoomState;
        handleIncomingState(parsed);
      } catch {
        // ignore invalid session data
      }
    },
    [handleIncomingState]
  );

  const connectYellow = useCallback(async () => {
    setRoomError(null);
    if (!signer || !account) {
      await connect();
      return;
    }

    // Disconnect existing connection
    yellowAppRef.current?.disconnect();

    // Create new YellowApp instance with event handlers
    const app = new YellowApp(account as Address, signer, {
      onConnectionChange: setYellowStatus,
      onAuthChange: setAuthStatus,
      onSessionCreated: (id, version) => {
        setSessionId(id);
        console.log("Session created:", id, "version:", version);
      },
      onSessionsReceived: (sessions) => {
        setAvailableSessions(sessions);
        // Auto-join matching session
        if (!sessionId && account && sessions.length > 0) {
          const match = sessions.find((session) =>
            session.participants?.some(
              (participant) => participant.toLowerCase() === account.toLowerCase()
            )
          );
          if (match) {
            void app.joinSession(match).then(() => {
              setSessionId(match.appSessionId as `0x${string}`);
              setSessionParticipants(match.participants ?? []);
              setParticipantsInput(match.participants?.join(", ") ?? "");
              applySessionData(match.sessionData);
            });
          }
        }
      },
      onSessionDefinition: (participants) => {
        setSessionParticipants(participants);
        setParticipantsInput(participants.join(", "));
      },
      onSessionUpdate: (sessionData, version) => {
        console.log("Session update:", version);
        applySessionData(sessionData);
      },
      onMessage: handleYellowMessage,
      onError: setRoomError,
    });

    yellowAppRef.current = app;
    app.connect();
  }, [signer, account, connect, sessionId, applySessionData, handleYellowMessage]);

  const joinSession = useCallback(
    async (session: YellowSessionInfo) => {
      const app = yellowAppRef.current;
      if (!app) return;

      await app.joinSession(session);
      setSessionId(session.appSessionId as `0x${string}`);
      setSessionParticipants(session.participants ?? []);
      setParticipantsInput(session.participants?.join(", ") ?? "");
      applySessionData(session.sessionData);
    },
    [applySessionData]
  );

  const createRoomSession = useCallback(async () => {
    setRoomError(null);
    if (!signer || !account) {
      await connect();
      return;
    }

    const app = yellowAppRef.current;
    if (!app || !app.isConnected) {
      await connectYellow();
      return;
    }
    if (!app.isAuthenticated) {
      // Wait for auth - the connect flow handles this automatically
      return;
    }

    const participants = getParticipants();
    if (participants.length === 0) {
      setRoomError("Add at least one participant address");
      return;
    }
    const nonceValue = Number(roomNonce);
    if (!Number.isFinite(nonceValue)) {
      setRoomError("Room nonce must be a number");
      return;
    }

    await app.createSession(
      participants as Address[],
      nonceValue,
      collaborationState
    );
    setSessionParticipants(participants);
  }, [
    signer,
    account,
    connect,
    connectYellow,
    getParticipants,
    roomNonce,
    collaborationState,
  ]);

  const sendRoomMessage = useCallback(
    async (type: RoomMessage["type"], data: unknown) => {
      const app = yellowAppRef.current;
      if (!app || !app.isConnected || !app.isAuthenticated || !sessionId) {
        return;
      }

      const id = `${Date.now()}-${nextMessageIdRef.current++}`;
      const payload = {
        type,
        data,
        sender: account ?? undefined,
        timestamp: Date.now(),
        id,
      };
      await app.sendApplicationMessage(payload);
      return id;
    },
    [sessionId, account]
  );

  // Broadcast state changes to other participants
  useEffect(() => {
    if (!sessionId || yellowStatus !== "connected") return;
    if (suppressBroadcastRef.current) {
      suppressBroadcastRef.current = false;
      return;
    }
    const handle = window.setTimeout(() => {
      void sendRoomMessage("state:update", { state: collaborationState });
    }, 350);
    return () => window.clearTimeout(handle);
  }, [collaborationState, sendRoomMessage, sessionId, yellowStatus]);

  // Submit state to Yellow Network
  useEffect(() => {
    if (!sessionId || yellowStatus !== "connected") return;
    if (authStatus !== "authenticated") return;
    if (suppressBroadcastRef.current) return;
    if (sessionParticipants.length === 0) return;

    const app = yellowAppRef.current;
    if (!app) return;

    const handle = window.setTimeout(async () => {
      await app.submitState(
        sessionParticipants as Address[],
        collaborationState
      );
    }, 700);
    return () => window.clearTimeout(handle);
  }, [
    collaborationState,
    sessionId,
    yellowStatus,
    sessionParticipants,
    authStatus,
  ]);

  const submitChat: React.SubmitEventHandler<HTMLFormElement> = useCallback(
    async (event) => {
      event.preventDefault();
      const text = chatInput.trim();
      if (!text) return;
      const updateId = await sendRoomMessage("chat:message", { text });
      if (updateId) {
        setRoomMessages((prev) => [
          ...prev,
          {
            id: updateId,
            sender: account ?? undefined,
            type: "chat:message",
            data: { text },
            timestamp: Date.now(),
          },
        ]);
      }
      setChatInput("");
    },
    [chatInput, sendRoomMessage, account]
  );

  const refreshSessions = useCallback(async () => {
    setRoomError(null);
    if (!signer || !account) {
      await connect();
      return;
    }

    const app = yellowAppRef.current;
    if (!app || !app.isConnected) {
      await connectYellow();
      return;
    }
    if (!app.isAuthenticated) {
      return;
    }

    await app.refreshSessions();
  }, [signer, account, connect, connectYellow]);

  // Refresh sessions when authenticated
  useEffect(() => {
    if (!account || yellowStatus !== "connected") return;
    if (authStatus !== "authenticated") return;
    void refreshSessions();
  }, [account, yellowStatus, authStatus, refreshSessions]);

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
      <div className="mb-6 rounded border-4 border-dirt p-4 text-xs">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-stone-300">Curator room (Yellow session)</p>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-stone-400">
              Status: {yellowStatus} / {authStatus}
            </span>
            <button
              type="button"
              onClick={connectYellow}
              className="button-blocky rounded px-3 py-1"
            >
              {yellowStatus === "connected" ? "Reconnect" : "Connect"}
            </button>
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="space-y-2">
            <span className="text-stone-300">Participant addresses</span>
            <input
              className="input-blocky w-full rounded px-3 py-2"
              value={participantsInput}
              onChange={(e) => setParticipantsInput(e.target.value)}
              placeholder="0xabc..., 0xdef..."
            />
          </label>
          <label className="space-y-2">
            <span className="text-stone-300">Room nonce</span>
            <input
              className="input-blocky w-full rounded px-3 py-2"
              value={roomNonce}
              onChange={(e) => setRoomNonce(e.target.value)}
            />
          </label>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={createRoomSession}
            className="button-blocky rounded px-3 py-1"
          >
            Create session
          </button>
          <button
            type="button"
            onClick={refreshSessions}
            className="button-blocky rounded px-3 py-1"
          >
            Find my sessions
          </button>
          {sessionId && <span className="text-[10px] text-stone-400">Session: {sessionId}</span>}
        </div>
        {availableSessions.length > 0 && (
          <div className="mt-3 rounded border-2 border-dirt/70 p-3">
            <p className="text-[10px] uppercase text-stone-400">Available sessions</p>
            <div className="mt-2 space-y-2 text-[11px] text-stone-200">
              {availableSessions.map((session) => (
                <div key={session.appSessionId} className="flex flex-wrap items-center gap-2">
                  <span className="text-stone-400">
                    {session.appSessionId.slice(0, 10)}…
                  </span>
                  <span>{session.status}</span>
                  <button
                    type="button"
                    onClick={() => joinSession(session)}
                    className="button-blocky rounded px-2 py-1"
                  >
                    Join
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
        {roomError && <p className="mt-2 text-[10px] text-amber-300">{roomError}</p>}
        <div className="mt-4 rounded border-2 border-dirt/70 p-3">
          <p className="text-[10px] uppercase text-stone-400">Chat</p>
          <div className="mt-2 max-h-28 space-y-1 overflow-y-auto text-[11px] text-stone-200">
            {roomMessages.length === 0 && (
              <p className="text-[10px] text-stone-400">No messages yet.</p>
            )}
            {roomMessages.map((msg) => (
              <p key={msg.id}>
                <span className="text-stone-400">
                  {msg.sender ? `${msg.sender.slice(0, 6)}...` : "anon"}:
                </span>{" "}
                {(msg.data as { text?: string })?.text ?? ""}
              </p>
            ))}
          </div>
          <form onSubmit={submitChat} className="mt-2 flex gap-2">
            <input
              className="input-blocky flex-1 rounded px-3 py-2"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              placeholder="Say hello..."
            />
            <button type="submit" className="button-blocky rounded px-3 py-2">
              Send
            </button>
          </form>
        </div>
      </div>
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
