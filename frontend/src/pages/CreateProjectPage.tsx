import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Contract, Wallet, isAddress, parseUnits } from "ethers";
import {
  EIP712AuthTypes,
  RPCAppStateIntent,
  RPCMethod,
  createAppSessionMessage,
  createApplicationMessage,
  createAuthRequestMessage,
  createAuthVerifyMessageFromChallenge,
  createECDSAMessageSigner,
  createGetAppDefinitionMessage,
  createGetAppSessionsMessage,
  createSubmitAppStateMessage,
  parseAnyRPCResponse,
} from "@erc7824/nitrolite";
import {
  FACTORY_ADDRESS,
  YELLOW_APPLICATION,
  YELLOW_ASSET,
  YELLOW_PROTOCOL,
  YELLOW_SCOPE,
  YELLOW_SESSION_EXPIRES_MS,
  YELLOW_WS_URL,
} from "../config";
import { minestartersFactoryAbi } from "../contracts/abis";
import { useWallet } from "../context/WalletContext";

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

type YellowStatus = "disconnected" | "connecting" | "connected";
type AuthStatus = "unauthenticated" | "authenticating" | "authenticated";
type YellowSessionInfo = {
  appSessionId: string;
  protocol: string;
  participants: string[];
  status: string;
  version: number;
  sessionData?: string;
};

type SessionKey = {
  privateKey: string;
  address: string;
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
  const [yellowStatus, setYellowStatus] = useState<YellowStatus>("disconnected");
  const [authStatus, setAuthStatus] = useState<AuthStatus>("unauthenticated");
  const [roomError, setRoomError] = useState<string | null>(null);
  const [participantsInput, setParticipantsInput] = useState("");
  const [roomNonce, setRoomNonce] = useState(() => `${Date.now()}`);
  const [sessionId, setSessionId] = useState("");
  const [sessionParticipants, setSessionParticipants] = useState<string[]>([]);
  const [availableSessions, setAvailableSessions] = useState<YellowSessionInfo[]>([]);
  const [roomMessages, setRoomMessages] = useState<RoomMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const wsRef = useRef<WebSocket | null>(null);
  const suppressBroadcastRef = useRef(false);
  const lastUpdateIdRef = useRef<string | null>(null);
  const nextMessageIdRef = useRef(0);
  const appStateVersionRef = useRef(0);
  const sessionKeyRef = useRef<SessionKey | null>(null);
  const sessionSignerRef = useRef<((payload: unknown) => Promise<string>) | null>(null);
  const authInFlightRef = useRef(false);

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

  useEffect(() => {
    return () => {
      wsRef.current?.close();
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

  const getOrCreateSessionKey = useCallback(() => {
    if (sessionKeyRef.current) {
      return sessionKeyRef.current;
    }
    const storageKey = "minestarters_yellow_session_key";
    const stored = window.localStorage.getItem(storageKey);
    if (stored) {
      try {
        const parsed = JSON.parse(stored) as SessionKey;
        if (parsed?.privateKey && parsed?.address) {
          sessionKeyRef.current = parsed;
          return parsed;
        }
      } catch {
        // ignore
      }
    }
    const wallet = Wallet.createRandom();
    const sessionKey = { privateKey: wallet.privateKey, address: wallet.address };
    sessionKeyRef.current = sessionKey;
    window.localStorage.setItem(storageKey, JSON.stringify(sessionKey));
    return sessionKey;
  }, []);

  const getSessionSigner = useCallback(() => {
    if (sessionSignerRef.current) {
      return sessionSignerRef.current;
    }
    const sessionKey = getOrCreateSessionKey();
    const signer = createECDSAMessageSigner(sessionKey.privateKey as `0x${string}`);
    sessionSignerRef.current = signer;
    return signer;
  }, [getOrCreateSessionKey]);

  const ensureAuth = useCallback(
    async (challengeMessage?: string) => {
      if (!signer || !account) return;
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
      if (authStatus === "authenticated") return;
      if (authInFlightRef.current) return;
      authInFlightRef.current = true;
      setAuthStatus("authenticating");

      const sessionKey = getOrCreateSessionKey();
      const expiresAtSeconds = BigInt(
        Math.floor((Date.now() + YELLOW_SESSION_EXPIRES_MS) / 1000)
      );
      const allowances: { asset: string; amount: string }[] = [];
      if (!challengeMessage) {
        const authRequest = await createAuthRequestMessage({
          address: account as `0x${string}`,
          session_key: sessionKey.address as `0x${string}`,
          application: YELLOW_APPLICATION,
          allowances,
          expires_at: expiresAtSeconds,
          scope: YELLOW_SCOPE,
        });
        wsRef.current.send(authRequest);
      }

      if (challengeMessage) {
        const authSigner = async (payload: unknown) => {
          const params = (payload as [number, string, { challenge?: string }])[2];
          const challenge = params?.challenge ?? challengeMessage;
          const message = {
            challenge,
            scope: YELLOW_SCOPE,
            wallet: account,
            session_key: sessionKey.address,
            expires_at: expiresAtSeconds,
            allowances,
          };
          return signer.signTypedData(
            { name: YELLOW_APPLICATION },
            EIP712AuthTypes,
            message
          );
        };
        const verifyMessage = await createAuthVerifyMessageFromChallenge(
          authSigner,
          challengeMessage
        );
        wsRef.current.send(verifyMessage);
      }
    },
    [signer, account, authStatus, getOrCreateSessionKey]
  );

  const handleYellowMessage = useCallback(
    (payload: any) => {
      if (!payload || typeof payload !== "object") return;
      const messageType = payload.type as RoomMessage["type"];
      const updateId = String(payload.id ?? payload.updateId ?? "");
      if (updateId && updateId === lastUpdateIdRef.current) return;
      if (updateId) {
        lastUpdateIdRef.current = updateId;
      }
      const sender = payload.sender as string | undefined;
      const timestamp = Number(payload.timestamp || Date.now());

      if (messageType === "state:update" && payload.data?.state) {
        if (sender && account && sender.toLowerCase() === account.toLowerCase()) {
          return;
        }
        handleIncomingState(payload.data.state as RoomState);
      }

      if (messageType === "chat:message" && payload.data?.text) {
        if (sender && account && sender.toLowerCase() === account.toLowerCase()) {
          return;
        }
        setRoomMessages((prev) => [
          ...prev,
          {
            id: updateId || `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            sender,
            type: "chat:message",
            data: payload.data,
            timestamp,
          },
        ]);
      }
    },
    [account, handleIncomingState]
  );

  const joinSession = useCallback(
    async (session: YellowSessionInfo) => {
      setSessionId(session.appSessionId);
      appStateVersionRef.current = session.version ?? 0;
      setSessionParticipants(session.participants ?? []);
      setParticipantsInput(session.participants?.join(", ") ?? "");
      applySessionData(session.sessionData);
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN && signer) {
        const messageSigner = getSessionSigner();
        const request = await createGetAppDefinitionMessage(messageSigner, session.appSessionId);
        wsRef.current.send(request);
      }
    },
    [applySessionData, signer, getSessionSigner]
  );

  const connectYellow = useCallback(async () => {
    setRoomError(null);
    if (!signer) {
      await connect();
      return;
    }

    if (wsRef.current) {
      wsRef.current.close();
    }

    setYellowStatus("connecting");
    const ws = new WebSocket(YELLOW_WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      setYellowStatus("connected");
      void ensureAuth();
    };

    ws.onclose = () => {
      setYellowStatus("disconnected");
      setAuthStatus("unauthenticated");
    };

    ws.onerror = () => {
      setRoomError("Yellow connection failed");
      setYellowStatus("disconnected");
    };

    ws.onmessage = (event) => {
      const raw = event.data as string;
      let parsed: any = null;
      try {
        parsed = parseAnyRPCResponse(raw);
      } catch {
        try {
          parsed = JSON.parse(raw);
        } catch {
          parsed = null;
        }
      }

      if (parsed?.method === RPCMethod.CreateAppSession) {
        const info = parsed.params;
        if (info?.appSessionId) {
          setSessionId(info.appSessionId);
          appStateVersionRef.current = info.version ?? 0;
        }
        return;
      }

      if (parsed?.method === RPCMethod.AuthChallenge) {
        const challenge = parsed.params?.challengeMessage;
        if (challenge) {
          authInFlightRef.current = false;
          void ensureAuth(challenge);
        }
        return;
      }

      if (parsed?.method === RPCMethod.AuthVerify) {
        if (parsed.params?.success) {
          setAuthStatus("authenticated");
          authInFlightRef.current = false;
        } else {
          setAuthStatus("unauthenticated");
          authInFlightRef.current = false;
          setRoomError("Yellow auth failed");
        }
        return;
      }

      if (parsed?.method === RPCMethod.Error) {
        const errorText = parsed.params?.error || "Yellow error";
        setRoomError(errorText);
        if (errorText.toLowerCase().includes("authentication")) {
          setAuthStatus("unauthenticated");
          authInFlightRef.current = false;
          void ensureAuth();
        }
        return;
      }

      if (parsed?.method === RPCMethod.GetAppSessions) {
        const sessions = (parsed.params?.appSessions || []) as YellowSessionInfo[];
        const filtered = sessions.filter((session) => session.protocol === YELLOW_PROTOCOL);
        setAvailableSessions(filtered);
        if (!sessionId && account && filtered.length > 0) {
          const match = filtered.find((session) =>
            session.participants?.some(
              (participant) => participant.toLowerCase() === account.toLowerCase()
            )
          );
          if (match) {
            void joinSession(match);
          }
        }
        return;
      }

      if (parsed?.method === RPCMethod.GetAppDefinition) {
        const definition = parsed.params;
        if (definition?.participants) {
          setSessionParticipants(definition.participants);
          setParticipantsInput(definition.participants.join(", "));
        }
        return;
      }

      if (parsed?.method === RPCMethod.AppSessionUpdate) {
        if (parsed.params?.sessionData) {
          applySessionData(parsed.params.sessionData);
        }
        if (typeof parsed.params?.version === "number") {
          appStateVersionRef.current = parsed.params.version;
        }
        return;
      }

      if (parsed?.method === RPCMethod.Message) {
        handleYellowMessage(parsed.params);
        return;
      }

      if (parsed?.type || parsed?.data) {
        handleYellowMessage(parsed);
      }
    };
  }, [
    signer,
    connect,
    handleYellowMessage,
    applySessionData,
    account,
    sessionId,
    joinSession,
    ensureAuth,
  ]);

  const createRoomSession = useCallback(async () => {
    setRoomError(null);
    if (!signer) {
      await connect();
      return;
    }

    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      await connectYellow();
      return;
    }
    if (authStatus !== "authenticated") {
      await ensureAuth();
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

    const weightBase = Math.floor(100 / participants.length);
    const weights = participants.map(() => weightBase);
    const remainder = 100 - weightBase * participants.length;
    if (remainder > 0) {
      weights[weights.length - 1] += remainder;
    }

    const appDefinition = {
      protocol: YELLOW_PROTOCOL,
      participants,
      weights,
      quorum: 100,
      challenge: 0,
      nonce: nonceValue,
    };

    const allocations = participants.map((participant) => ({
      participant,
      asset: YELLOW_ASSET,
      amount: "0",
    }));

    const messageSigner = getSessionSigner();
    const sessionMessage = await createAppSessionMessage(messageSigner, {
      definition: appDefinition,
      allocations,
      session_data: JSON.stringify(collaborationState),
    });
    wsRef.current.send(sessionMessage);
    setSessionParticipants(participants);
    appStateVersionRef.current = 0;
  }, [
    signer,
    connect,
    connectYellow,
    getParticipants,
    roomNonce,
    collaborationState,
    getSessionSigner,
    authStatus,
    ensureAuth,
  ]);

  const sendRoomMessage = useCallback(
    async (type: RoomMessage["type"], data: unknown) => {
      if (!signer || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN || !sessionId) {
        return;
      }
      if (authStatus !== "authenticated") {
        await ensureAuth();
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
      const messageSigner = getSessionSigner();
      const message = await createApplicationMessage(messageSigner, sessionId, payload);
      wsRef.current.send(message);
      return id;
    },
    [signer, sessionId, account, getSessionSigner, authStatus, ensureAuth]
  );

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

  useEffect(() => {
    if (!sessionId || yellowStatus !== "connected") return;
    if (authStatus !== "authenticated") return;
    if (suppressBroadcastRef.current) return;
    if (sessionParticipants.length === 0) return;
    const handle = window.setTimeout(async () => {
      const allocations = sessionParticipants.map((participant) => ({
        participant,
        asset: YELLOW_ASSET,
        amount: "0",
      }));
      const messageSigner = getSessionSigner();
      if (!signer) return;
      const nextVersion = appStateVersionRef.current + 1;
      const message = await createSubmitAppStateMessage(
        messageSigner,
        {
          app_session_id: sessionId,
          intent: RPCAppStateIntent.Operate,
          version: nextVersion,
          allocations,
          session_data: JSON.stringify(collaborationState),
        },
        undefined,
        undefined
      );
      wsRef.current?.send(message);
      appStateVersionRef.current = nextVersion;
    }, 700);
    return () => window.clearTimeout(handle);
  }, [
    collaborationState,
    sessionId,
    yellowStatus,
    sessionParticipants,
    signer,
    getSessionSigner,
    authStatus,
  ]);

  const submitChat = useCallback(
    async (event: React.FormEvent) => {
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
    if (!signer) {
      await connect();
      return;
    }
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      await connectYellow();
      return;
    }
    if (authStatus !== "authenticated") {
      await ensureAuth();
      return;
    }
    if (!account) {
      setRoomError("Connect a wallet to list sessions");
      return;
    }
    const messageSigner = getSessionSigner();
    const request = await createGetAppSessionsMessage(messageSigner, account);
    wsRef.current.send(request);
  }, [signer, connect, connectYellow, account, getSessionSigner, authStatus, ensureAuth]);

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
