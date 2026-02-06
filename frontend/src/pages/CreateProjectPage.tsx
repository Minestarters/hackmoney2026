import { useCallback, useEffect, useMemo, useState } from "react";
import { parseUnits } from "viem";
import { useConnect, useConnection } from "wagmi";
import { injected } from "wagmi/connectors";
import { FACTORY_ADDRESS } from "../config";
import { getWalletClient, publicClient } from "../lib/wagmi";
import {
  createYellowSessionManager,
  type YellowSessionState,
  type BasketState,
  type ProjectFormFields,
} from "../lib/yellowSession";
import { writeFactory } from "../lib/contracts";

// Helper to calculate weights from basket stakes
const calculateWeightsFromBasket = (basket: BasketState): { name: string; weight: number }[] => {
  const totalStakes: Record<string, number> = {};
  let grandTotal = 0;

  // Sum up all stakes per company
  for (const company of basket.companies) {
    const companyStakes = basket.stakes[company] || {};
    const total = Object.values(companyStakes).reduce((sum, amt) => sum + parseFloat(amt || "0"), 0);
    totalStakes[company] = total;
    grandTotal += total;
  }

  // Convert to weights (percentages)
  if (grandTotal === 0) {
    return basket.companies.map(name => ({ name, weight: 0 }));
  }

  return basket.companies.map(name => ({
    name,
    weight: Math.round((totalStakes[name] / grandTotal) * 100),
  }));
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

const shortAddress = (addr: string) =>
  addr ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : "";

const CreateProjectPage = () => {
  const { address: account, isConnected } = useConnection();
  const { mutate } = useConnect();
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // Yellow Session State
  const [yellowLogs, setYellowLogs] = useState<string[]>([]);
  const [yellowError, setYellowError] = useState<string | null>(null);
  const [sessionState, setSessionState] = useState<YellowSessionState>({ status: "idle" });
  const [inviteCode, setInviteCode] = useState("");
  const [joinerAddressInput, setJoinerAddressInput] = useState(""); // Address of the user to invite
  const [soloMode, setSoloMode] = useState(false);
  const [copied, setCopied] = useState(false);

  // Solo mode basket state
  const [soloBasket, setSoloBasket] = useState<BasketState>({ companies: [], stakes: {} });

  // Collaborative basket state
  const [newCompanyName, setNewCompanyName] = useState("");
  const [newCompanyStake, setNewCompanyStake] = useState("10");
  const [topUpAmounts, setTopUpAmounts] = useState<Record<string, string>>({});

  // Finalization state
  const [deploymentTriggered, setDeploymentTriggered] = useState(false);

  // Local form fields state (for typing without network lag)
  const defaultFormFields: ProjectFormFields = {
    projectName: "",
    minimumRaise: "1000",
    deadline: toDateInputValue(addDays(new Date(), 30)),
    raiseFeePct: "0.05",
    profitFeePct: "0.01",
    withdrawAddress: "",
  };
  const [localFormFields, setLocalFormFields] = useState<ProjectFormFields>(defaultFormFields);

  const appendLog = useCallback((line: string) => {
    setYellowLogs((prev) => [...prev, line].slice(-100));
  }, []);

  // Get the connected account for Yellow session
  const getAccount = useCallback(() => {
    if (!account) return null;
    // Return a JSON-RPC account that signs via the connected wallet
    return { address: account, type: "json-rpc" } as const;
  }, [account]);

  const sessionManager = useMemo(
    () => createYellowSessionManager(setSessionState, getAccount, appendLog),
    [getAccount, appendLog]
  );

  // Finalization derived state
  const finalizationRequest = sessionState.basket?.finalizationRequest;
  const isEditingLocked = !!finalizationRequest;
  
  const currentUserAddress = useMemo(() => {
    if (sessionState.role === "creator") {
      return sessionState.user1Address?.toLowerCase();
    }
    return sessionState.user2Address?.toLowerCase();
  }, [sessionState.role, sessionState.user1Address, sessionState.user2Address]);

  const hasVoted = useMemo(() => {
    if (!finalizationRequest || !currentUserAddress) return false;
    return currentUserAddress in finalizationRequest.votes;
  }, [finalizationRequest, currentUserAddress]);

  const quorumReached = useMemo(() => {
    if (!finalizationRequest || !sessionState.user1Address || !sessionState.user2Address) return false;
    const user1Key = sessionState.user1Address.toLowerCase();
    const user2Key = sessionState.user2Address.toLowerCase();
    return finalizationRequest.votes[user1Key] === true && finalizationRequest.votes[user2Key] === true;
  }, [finalizationRequest, sessionState.user1Address, sessionState.user2Address]);

  // Sync local form fields from session state when it changes (incoming updates)
  useEffect(() => {
    const remoteFields = sessionState.basket?.formFields;
    if (remoteFields) {
      setLocalFormFields((prev) => ({
        projectName: remoteFields.projectName || prev.projectName,
        minimumRaise: remoteFields.minimumRaise || prev.minimumRaise,
        deadline: remoteFields.deadline || prev.deadline,
        raiseFeePct: remoteFields.raiseFeePct || prev.raiseFeePct,
        profitFeePct: remoteFields.profitFeePct || prev.profitFeePct,
        withdrawAddress: remoteFields.withdrawAddress || prev.withdrawAddress,
      }));
    }
  }, [sessionState.basket?.formFields]);

  // Initialize withdraw address from connected account
  useEffect(() => {
    if (account && !localFormFields.withdrawAddress) {
      setLocalFormFields((prev) => ({ ...prev, withdrawAddress: account }));
    }
  }, [account, localFormFields.withdrawAddress]);

  // Update local field (instant, no network)
  const handleLocalFieldChange = (field: keyof ProjectFormFields, value: string) => {
    setLocalFormFields((prev) => ({ ...prev, [field]: value }));
  };

  // Sync field to network on blur (only when session is active)
  const handleFieldBlur = async (field: keyof ProjectFormFields) => {
    if (sessionState.status === "active") {
      try {
        await sessionManager.updateFormField(field, localFormFields[field]);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to sync field";
        setYellowError(msg);
      }
    }
  };

  // Yellow Session Handlers - Creator Flow
  const handleCreateSession = async () => {
    const trimmedJoiner = joinerAddressInput.trim();
    if (!trimmedJoiner || !trimmedJoiner.startsWith("0x") || trimmedJoiner.length !== 42) {
      setYellowError("Please enter a valid Ethereum address for the collaborator");
      return;
    }
    setYellowError(null);
    setYellowLogs([]);
    try {
      await sessionManager.createSession(trimmedJoiner as `0x${string}`);
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

  // Collaborative basket handlers
  const handleAddCompany = async () => {
    const isSoloModeActive = soloMode && sessionState.status === "idle";
    if (sessionState.status !== "active" && sessionState.status !== "invite_ready" && !isSoloModeActive) {
      setYellowError("Create or join a session first");
      return;
    }
    if (!newCompanyName.trim()) {
      setYellowError("Enter a company name");
      return;
    }
    if (!newCompanyStake || parseFloat(newCompanyStake) <= 0) {
      setYellowError("Enter a valid initial stake amount");
      return;
    }
    setYellowError(null);
    try {
      // Solo mode - update soloBasket directly
      if (isSoloModeActive) {
        const trimmedName = newCompanyName.trim();
        
        if (soloBasket.companies.includes(trimmedName)) {
          setYellowError(`Company "${trimmedName}" already exists`);
          return;
        }
        
        const userAddr = account?.toLowerCase() || "solo";
        const stakeAmount = parseFloat(newCompanyStake);
        
        setSoloBasket(prev => ({
          ...prev,
          companies: [...prev.companies, trimmedName],
          stakes: {
            ...prev.stakes,
            [trimmedName]: {
              [userAddr]: stakeAmount.toFixed(2),
            },
          },
        }));
        setNewCompanyName("");
        setNewCompanyStake("10");
        return;
      }
      // If invite_ready (waiting for joiner), update basket locally
      if (sessionState.status === "invite_ready") {
        const currentBasket = sessionState.basket || { companies: [], stakes: {} };
        const trimmedName = newCompanyName.trim();
        
        if (currentBasket.companies.includes(trimmedName)) {
          setYellowError(`Company "${trimmedName}" already exists`);
          return;
        }
        
        const userAddr = sessionState.user1Address?.toLowerCase() || "";
        const stakeAmount = parseFloat(newCompanyStake);
        
        const newBasket = {
          ...currentBasket,
          companies: [...currentBasket.companies, trimmedName],
          stakes: {
            ...currentBasket.stakes,
            [trimmedName]: {
              [userAddr]: stakeAmount.toFixed(2),
            },
          },
        };
        
        // Update local state directly (will sync when joiner connects or on solo deploy)
        setSessionState(prev => ({ ...prev, basket: newBasket }));
        setNewCompanyName("");
        setNewCompanyStake("10");
      } else {
        // Active session - sync to Yellow network
        await sessionManager.addCompany(newCompanyName.trim(), newCompanyStake);
        setNewCompanyName("");
        setNewCompanyStake("10");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to add company";
      setYellowError(msg);
    }
  };

  const handleTopUp = async (companyName: string) => {
    const isSoloModeActive = soloMode && sessionState.status === "idle";
    if (sessionState.status !== "active" && sessionState.status !== "invite_ready" && !isSoloModeActive) {
      setYellowError("Create or join a session first");
      return;
    }
    const amount = topUpAmounts[companyName];
    if (!amount || parseFloat(amount) <= 0) {
      setYellowError("Enter a valid top-up amount");
      return;
    }
    setYellowError(null);
    try {
      // Solo mode - update soloBasket directly
      if (isSoloModeActive) {
        const userAddr = account?.toLowerCase() || "solo";
        const stakeAmount = parseFloat(amount);
        const currentStake = parseFloat(soloBasket.stakes[companyName]?.[userAddr] || "0");
        const newStake = currentStake + stakeAmount;
        
        setSoloBasket(prev => ({
          ...prev,
          stakes: {
            ...prev.stakes,
            [companyName]: {
              ...prev.stakes[companyName],
              [userAddr]: newStake.toFixed(2),
            },
          },
        }));
        setTopUpAmounts((prev) => ({ ...prev, [companyName]: "" }));
        return;
      }
      // If invite_ready (waiting for joiner), update basket locally
      if (sessionState.status === "invite_ready") {
        const currentBasket = sessionState.basket || { companies: [], stakes: {} };
        const userAddr = sessionState.user1Address?.toLowerCase() || "";
        const stakeAmount = parseFloat(amount);
        const currentStake = parseFloat(currentBasket.stakes[companyName]?.[userAddr] || "0");
        const newStake = currentStake + stakeAmount;
        
        const newBasket = {
          ...currentBasket,
          stakes: {
            ...currentBasket.stakes,
            [companyName]: {
              ...currentBasket.stakes[companyName],
              [userAddr]: newStake.toFixed(2),
            },
          },
        };
        
        setSessionState(prev => ({ ...prev, basket: newBasket }));
        setTopUpAmounts((prev) => ({ ...prev, [companyName]: "" }));
      } else {
        // Active session - sync to Yellow network
        await sessionManager.stakeInCompany(companyName, amount);
        setTopUpAmounts((prev) => ({ ...prev, [companyName]: "" }));
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to top up stake";
      setYellowError(msg);
    }
  };

  const getCompanyTotalStake = (companyName: string): number => {
    const stakes = sessionState.basket?.stakes[companyName] || {};
    return Object.values(stakes).reduce((sum, amt) => sum + parseFloat(amt || "0"), 0);
  };

  // Calculate total staked by current user across all companies
  const getTotalStakedByUser = (userAddr: string): number => {
    if (!sessionState.basket) return 0;
    let total = 0;
    for (const company of sessionState.basket.companies) {
      const userStake = parseFloat(sessionState.basket.stakes[company]?.[userAddr] || "0");
      total += userStake;
    }
    return total;
  };

  // Get the current user's Yellow balance (from faucet)
  const yellowBalance = parseFloat(sessionState.yellowBalance || "100");
  const currentUserStaked = currentUserAddress ? getTotalStakedByUser(currentUserAddress) : 0;
  const remainingBalance = yellowBalance - currentUserStaked;

  // Finalization handlers
  const handleProposeFinalization = async () => {
    setYellowError(null);
    try {
      await sessionManager.proposeFinalization();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to propose finalization";
      setYellowError(msg);
    }
  };

  const handleVoteFinalization = async (accept: boolean) => {
    setYellowError(null);
    try {
      const { quorumReached } = await sessionManager.voteOnFinalization(accept);
      if (quorumReached && !deploymentTriggered) {
        // Last voter triggers deployment
        setDeploymentTriggered(true);
        await triggerDeployment();
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to vote on finalization";
      setYellowError(msg);
      setDeploymentTriggered(false);
    }
  };

  // Extract deployment logic for reuse
  const triggerDeployment = async () => {
    if (!sessionState.basket) {
      setMessage("No basket data");
      setDeploymentTriggered(false);
      return;
    }

    const companiesForSubmit = calculateWeightsFromBasket(sessionState.basket);

    if (companiesForSubmit.length === 0) {
      setMessage("Add at least one company");
      setDeploymentTriggered(false);
      return;
    }

    const totalWeight = companiesForSubmit.reduce((sum, c) => sum + c.weight, 0);
    if (totalWeight !== 100) {
      setMessage(`Weights must sum to 100% (currently ${totalWeight}%)`);
      setDeploymentTriggered(false);
      return;
    }

    if (!localFormFields.projectName) {
      setMessage("Enter a project name");
      setDeploymentTriggered(false);
      return;
    }

    if (!isConnected) {
      mutate({ connector: injected() });
      setDeploymentTriggered(false);
      return;
    }

    const walletClient = await getWalletClient();
    if (!walletClient) {
      setMessage("Could not get wallet");
      setDeploymentTriggered(false);
      return;
    }

    try {
      setSubmitting(true);
      const minRaise = parseUnits(localFormFields.minimumRaise || "0", 6);
      const deadlineTs = dateInputValueToUnixSeconds(localFormFields.deadline);
      if (!Number.isFinite(deadlineTs)) {
        setMessage("Select a valid deadline");
        setSubmitting(false);
        setDeploymentTriggered(false);
        return;
      }
      const raiseFeeBps = Math.round((parseFloat(localFormFields.raiseFeePct || "0") || 0) * 100);
      const profitFeeBps = Math.round((parseFloat(localFormFields.profitFeePct || "0") || 0) * 100);

      if (raiseFeeBps > 10_000 || profitFeeBps > 10_000) {
        setMessage("Fees cannot exceed 100%");
        setSubmitting(false);
        setDeploymentTriggered(false);
        return;
      }

      const hash = await writeFactory.createProject(walletClient, {
        projectName: localFormFields.projectName,
        companyNames: companiesForSubmit.map((c) => c.name),
        companyWeights: companiesForSubmit.map((c) => BigInt(c.weight)),
        minimumRaise: minRaise,
        deadline: BigInt(deadlineTs),
        withdrawAddress: (localFormFields.withdrawAddress || account) as `0x${string}`,
        raiseFeeBps: BigInt(raiseFeeBps),
        profitFeeBps: BigInt(profitFeeBps),
      });

      await publicClient.waitForTransactionReceipt({ hash });
      setMessage("Project created! Refresh home to see it.");
    } catch (err) {
      console.error(err);
      setMessage("Transaction failed");
      setDeploymentTriggered(false);
    } finally {
      setSubmitting(false);
    }
  };

  const getUserStake = (companyName: string, userAddr: string): string => {
    return sessionState.basket?.stakes[companyName]?.[userAddr] || "0";
  };

  const getSoloStake = (companyName: string): string => {
    const userAddr = account?.toLowerCase() || "solo";
    return soloBasket.stakes[companyName]?.[userAddr] || "0";
  };

  const handleSoloDeploy = async () => {
    if (!FACTORY_ADDRESS) {
      setMessage("Set VITE_FACTORY_ADDRESS to deploy");
      return;
    }

    const companiesForSubmit = calculateWeightsFromBasket(soloBasket);

    if (companiesForSubmit.length === 0) {
      setMessage("Add at least one company");
      return;
    }

    const totalWeight = companiesForSubmit.reduce((sum, c) => sum + c.weight, 0);
    if (totalWeight !== 100) {
      setMessage(`Weights must sum to 100% (currently ${totalWeight}%)`);
      return;
    }

    if (!localFormFields.projectName) {
      setMessage("Enter a project name");
      return;
    }

    if (!isConnected) {
      mutate({ connector: injected() });
      return;
    }

    const walletClient = await getWalletClient();
    if (!walletClient) {
      setMessage("Could not get wallet");
      return;
    }

    try {
      setSubmitting(true);
      const minRaise = parseUnits(localFormFields.minimumRaise || "0", 6);
      const deadlineTs = dateInputValueToUnixSeconds(localFormFields.deadline);
      if (!Number.isFinite(deadlineTs)) {
        setMessage("Select a valid deadline");
        setSubmitting(false);
        return;
      }
      const raiseFeeBps = Math.round((parseFloat(localFormFields.raiseFeePct || "0") || 0) * 100);
      const profitFeeBps = Math.round((parseFloat(localFormFields.profitFeePct || "0") || 0) * 100);

      if (raiseFeeBps > 10_000 || profitFeeBps > 10_000) {
        setMessage("Fees cannot exceed 100%");
        setSubmitting(false);
        return;
      }

      const hash = await writeFactory.createProject(walletClient, {
        projectName: localFormFields.projectName,
        companyNames: companiesForSubmit.map((c) => c.name),
        companyWeights: companiesForSubmit.map((c) => BigInt(c.weight)),
        minimumRaise: minRaise,
        deadline: BigInt(deadlineTs),
        withdrawAddress: (localFormFields.withdrawAddress || account) as `0x${string}`,
        raiseFeeBps: BigInt(raiseFeeBps),
        profitFeeBps: BigInt(profitFeeBps),
      });

      await publicClient.waitForTransactionReceipt({ hash });
      setMessage("Project created! Refresh home to see it.");
      setSoloMode(false);
      setSoloBasket({ companies: [], stakes: {} });
    } catch (err) {
      console.error(err);
      setMessage("Transaction failed");
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);

    if (!FACTORY_ADDRESS) {
      setMessage("Set VITE_FACTORY_ADDRESS to deploy");
      return;
    }

    if (!isActive || !sessionState.basket) {
      setMessage("Join a session first");
      return;
    }

    // Get companies from collaborative basket
    const companiesForSubmit = calculateWeightsFromBasket(sessionState.basket);

    if (companiesForSubmit.length === 0) {
      setMessage("Add at least one company");
      return;
    }

    const totalWeight = companiesForSubmit.reduce((sum, c) => sum + c.weight, 0);
    if (totalWeight !== 100) {
      setMessage(`Weights must sum to 100% (currently ${totalWeight}%)`);
      return;
    }

    if (!localFormFields.projectName) {
      setMessage("Enter a project name");
      return;
    }

    if (!isConnected) {
      mutate({ connector: injected() });
      return;
    }

    const walletClient = await getWalletClient();
    if (!walletClient) {
      setMessage("Could not get wallet");
      return;
    }

    try {
      setSubmitting(true);
      const minRaise = parseUnits(localFormFields.minimumRaise || "0", 6);
      const deadlineTs = dateInputValueToUnixSeconds(localFormFields.deadline);
      if (!Number.isFinite(deadlineTs)) {
        setMessage("Select a valid deadline");
        setSubmitting(false);
        return;
      }
      const raiseFeeBps = Math.round((parseFloat(localFormFields.raiseFeePct || "0") || 0) * 100);
      const profitFeeBps = Math.round((parseFloat(localFormFields.profitFeePct || "0") || 0) * 100);

      if (raiseFeeBps > 10_000 || profitFeeBps > 10_000) {
        setMessage("Fees cannot exceed 100%");
        setSubmitting(false);
        return;
      }

      const hash = await writeFactory.createProjectWithNAV(walletClient, {
        projectName: localFormFields.projectName,
        companyNames: companiesForSubmit.map((c) => c.name),
        companyWeights: companiesForSubmit.map((c) => BigInt(c.weight)),
        minimumRaise: minRaise,
        deadline: BigInt(deadlineTs),
        withdrawAddress: (localFormFields.withdrawAddress || account) as `0x${string}`,
        raiseFeeBps: BigInt(raiseFeeBps),
        profitFeeBps: BigInt(profitFeeBps),
      });

      await publicClient.waitForTransactionReceipt({ hash });
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
  const canEditForm = isActive || isInviteReady || soloMode; // Show form when active, waiting for joiner, or solo mode

  // Use solo basket when in solo mode, otherwise session basket
  const activeBasket = soloMode && isIdle ? soloBasket : sessionState.basket;

  return (
    <div className="card-frame rounded-lg p-6">
      <h1 className="mb-4 text-lg text-sky-200">Create a project</h1>

      {/* Yellow Session UI */}
      <div className="mb-6 rounded border-4 border-dirt p-4 text-xs">
        <div className="mb-3 flex items-center justify-between">
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
        {isIdle && !soloMode && (
          <div className="space-y-4">
            <p className="text-[10px] text-stone-400">
              Create a session and share the invite code, or join with an invite code from another device.
            </p>
            <div className="grid gap-4 md:grid-cols-2">
              {/* Creator Flow */}
              <div className="rounded border-2 border-sky-800/50 bg-sky-900/10 p-3">
                <p className="mb-2 font-medium text-sky-300">Host (User 1)</p>
                <p className="mb-3 text-[10px] text-stone-400">
                  Enter your collaborator's wallet address, then create a session.
                </p>
                <div className="space-y-2">
                  <input
                    type="text"
                    value={joinerAddressInput}
                    onChange={(e) => setJoinerAddressInput(e.target.value)}
                    placeholder="Collaborator's wallet address (0x...)"
                    className="input-blocky w-full rounded px-3 py-2 font-mono text-[10px]"
                  />
                  <button
                    type="button"
                    onClick={handleCreateSession}
                    className="button-blocky w-full rounded px-3 py-2"
                    disabled={isConnecting || !joinerAddressInput.trim()}
                  >
                    Create Session
                  </button>
                </div>
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

            {/* Solo Mode */}
            <div className="border-t border-dirt/30 pt-3 text-center">
              <button
                type="button"
                onClick={() => setSoloMode(true)}
                className="text-[10px] text-stone-400 underline hover:text-stone-300"
              >
                Create form solo
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
              <div className="mt-2 grid grid-cols-2 gap-2 text-[10px]">
                <div className="text-center">
                  <p className="text-stone-500">Host</p>
                  <p className="font-mono text-sky-300">{shortAddress(sessionState.user1Address || "")}</p>
                </div>
                <div className="text-center">
                  <p className="text-stone-500">Joiner</p>
                  <p className="font-mono text-amber-300">{shortAddress(sessionState.user2Address || "")}</p>
                </div>
              </div>
            </div>

            {/* Session Actions */}
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

        {/* Solo Mode State */}
        {soloMode && isIdle && (
          <div className="space-y-3">
            <div className="rounded bg-purple-900/20 p-3 text-center">
              <p className="text-purple-300">Solo Mode</p>
              <p className="mt-1 text-[10px] text-stone-400">
                Create a project without a collaborative session
              </p>
            </div>
            <button
              type="button"
              onClick={() => setSoloMode(false)}
              className="rounded border border-stone-600 px-3 py-2 text-[10px] text-stone-400 hover:bg-stone-800"
            >
              Exit Solo Mode
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

      {/* Project Creation Form - Shown when session is active, invite ready, or solo mode */}
      {canEditForm && (soloMode || sessionState.basket) && (
        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          {/* Finalization Voting Card */}
          {finalizationRequest && isActive && (
            <div className="rounded border-2 border-amber-600 bg-amber-900/20 p-4">
              <div className="mb-3 flex items-center justify-between">
                <p className="font-medium text-amber-300">Finalization Vote in Progress</p>
                {quorumReached && (
                  <span className="rounded bg-green-800 px-2 py-0.5 text-[10px] text-green-200">
                    100% Quorum Reached
                  </span>
                )}
              </div>
              
              <div className="mb-3 text-[10px] text-stone-400">
                <p>Proposed by: <span className="font-mono text-amber-200">{shortAddress(finalizationRequest.proposer)}</span></p>
                <p>Time: {new Date(finalizationRequest.timestamp).toLocaleTimeString()}</p>
              </div>

              {/* Vote Status */}
              <div className="mb-3 grid grid-cols-2 gap-2 text-[10px]">
                <div className="rounded bg-black/20 p-2">
                  <p className="text-stone-500">Host</p>
                  <p className="font-mono text-sky-300">{shortAddress(sessionState.user1Address || "")}</p>
                  <p className={`mt-1 font-medium ${
                    finalizationRequest.votes[sessionState.user1Address?.toLowerCase() || ""] === true
                      ? "text-green-400"
                      : "text-stone-500"
                  }`}>
                    {finalizationRequest.votes[sessionState.user1Address?.toLowerCase() || ""] === true
                      ? "✓ Accepted"
                      : "○ Pending"}
                  </p>
                </div>
                <div className="rounded bg-black/20 p-2">
                  <p className="text-stone-500">Joiner</p>
                  <p className="font-mono text-amber-300">{shortAddress(sessionState.user2Address || "")}</p>
                  <p className={`mt-1 font-medium ${
                    finalizationRequest.votes[sessionState.user2Address?.toLowerCase() || ""] === true
                      ? "text-green-400"
                      : "text-stone-500"
                  }`}>
                    {finalizationRequest.votes[sessionState.user2Address?.toLowerCase() || ""] === true
                      ? "✓ Accepted"
                      : "○ Pending"}
                  </p>
                </div>
              </div>

              {/* Action Buttons */}
              {!hasVoted && !quorumReached && (
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => handleVoteFinalization(true)}
                    className="flex-1 rounded bg-green-700 px-4 py-2 text-green-100 hover:bg-green-600"
                    disabled={submitting}
                  >
                    Accept
                  </button>
                  <button
                    type="button"
                    onClick={() => handleVoteFinalization(false)}
                    className="flex-1 rounded bg-red-800 px-4 py-2 text-red-200 hover:bg-red-700"
                    disabled={submitting}
                  >
                    Reject
                  </button>
                </div>
              )}

              {/* Status Messages */}
              {hasVoted && !quorumReached && (
                <p className="text-center text-[10px] text-amber-300">
                  Waiting for other participant to vote...
                </p>
              )}
              {quorumReached && (submitting || deploymentTriggered) && (
                <p className="text-center text-[10px] text-green-300">
                  Deploying to blockchain...
                </p>
              )}

              <p className="mt-2 text-[10px] text-stone-500">
                Editing is locked during voting. Reject to make changes.
              </p>
            </div>
          )}

          {isActive && !finalizationRequest ? (
            <p className="text-[10px] text-green-400">
              All fields below are collaboratively editable. Changes sync in real-time.
            </p>
          ) : !isActive ? (
            <p className="text-[10px] text-yellow-400">
              Start filling out the form. Changes will sync once the other user joins.
            </p>
          ) : null}

          <div className={`grid gap-4 md:grid-cols-2 ${isEditingLocked ? "opacity-60" : ""}`}>
            <label className="space-y-2">
              <span className="text-stone-300">Project name</span>
              <input
                className="input-blocky w-full rounded px-3 py-2"
                value={localFormFields.projectName}
                onChange={(e) => handleLocalFieldChange("projectName", e.target.value)}
                onBlur={() => handleFieldBlur("projectName")}
                placeholder="Enter project name"
                required
                disabled={isEditingLocked}
              />
            </label>
            <label className="space-y-2">
              <span className="text-stone-300">Withdraw address</span>
              <input
                className="input-blocky w-full rounded px-3 py-2"
                value={localFormFields.withdrawAddress}
                onChange={(e) => handleLocalFieldChange("withdrawAddress", e.target.value)}
                onBlur={() => handleFieldBlur("withdrawAddress")}
                placeholder="0x..."
                required
                disabled={isEditingLocked}
              />
            </label>
            <label className="space-y-2">
              <span className="text-stone-300">Minimum raise (USDC)</span>
              <input
                className="input-blocky w-full rounded px-3 py-2"
                value={localFormFields.minimumRaise}
                onChange={(e) => handleLocalFieldChange("minimumRaise", e.target.value)}
                onBlur={() => handleFieldBlur("minimumRaise")}
                type="number"
                min="0"
                disabled={isEditingLocked}
              />
            </label>
            <label className="space-y-2">
              <span className="text-stone-300">Deadline</span>
              <input
                className="input-blocky w-full rounded px-3 py-2"
                type="date"
                value={localFormFields.deadline}
                onChange={(e) => handleLocalFieldChange("deadline", e.target.value)}
                onBlur={() => handleFieldBlur("deadline")}
                min={toDateInputValue(new Date())}
                required
                disabled={isEditingLocked}
              />
            </label>
            <label className="space-y-2">
              <span className="text-stone-300">Raise fee (%)</span>
              <input
                className="input-blocky w-full rounded px-3 py-2"
                type="number"
                step="0.01"
                value={localFormFields.raiseFeePct}
                onChange={(e) => handleLocalFieldChange("raiseFeePct", e.target.value)}
                onBlur={() => handleFieldBlur("raiseFeePct")}
                min="0"
                max="100"
                disabled={isEditingLocked}
              />
            </label>
            <label className="space-y-2">
              <span className="text-stone-300">Profit fee (%)</span>
              <input
                className="input-blocky w-full rounded px-3 py-2"
                type="number"
                step="0.01"
                value={localFormFields.profitFeePct}
                onChange={(e) => handleLocalFieldChange("profitFeePct", e.target.value)}
                onBlur={() => handleFieldBlur("profitFeePct")}
                min="0"
                max="100"
                disabled={isEditingLocked}
              />
            </label>
          </div>

          <div className="rounded border-4 border-dirt p-3">
            <p className="mb-3 text-stone-300">Companies & weights</p>

            <div className="space-y-3">
              {/* Yellow Balance Display */}
              {(isActive || isInviteReady) && (
                <div className="rounded border-2 border-amber-700/50 bg-amber-900/10 p-3">
                  <div className="flex items-center justify-between">
                    <p className="text-[10px] text-amber-300">Your Yellow Balance (ytest.USD)</p>
                    <span className="font-mono text-sm text-amber-200">
                      ${remainingBalance.toFixed(2)} available
                    </span>
                  </div>
                  <div className="mt-1 flex gap-4 text-[10px] text-stone-400">
                    <span>Total: ${yellowBalance.toFixed(2)}</span>
                    <span>Staked: ${currentUserStaked.toFixed(2)}</span>
                  </div>
                </div>
              )}

              {/* Add new company - enabled when session is active, invite_ready, or solo mode */}
              <div className={`rounded border-2 p-3 ${(isActive || isInviteReady || soloMode) && !isEditingLocked ? "border-green-800/50 bg-green-900/10" : "border-stone-700/50 bg-stone-900/10"} ${isEditingLocked ? "opacity-60" : ""}`}>
                <p className={`mb-2 text-[10px] ${(isActive || isInviteReady || soloMode) && !isEditingLocked ? "text-green-300" : "text-stone-400"}`}>
                  Add a company {(isInviteReady || soloMode) && "(changes saved locally)"}{isEditingLocked && "(locked during voting)"}
                </p>
                <div className="flex gap-2">
                  <input
                    className="input-blocky flex-1 rounded px-3 py-2"
                    value={newCompanyName}
                    onChange={(e) => setNewCompanyName(e.target.value)}
                    placeholder="Company name"
                    disabled={(!isActive && !isInviteReady && !soloMode) || isEditingLocked}
                  />
                  <input
                    className="input-blocky w-24 rounded px-3 py-2 text-center"
                    type="number"
                    value={newCompanyStake}
                    onChange={(e) => setNewCompanyStake(e.target.value)}
                    placeholder="Stake"
                    min="0.01"
                    step="0.01"
                    max={soloMode ? undefined : remainingBalance.toString()}
                    disabled={(!isActive && !isInviteReady && !soloMode) || isEditingLocked}
                  />
                  <button
                    type="button"
                    onClick={handleAddCompany}
                    className="button-blocky rounded px-4 py-2"
                    disabled={(!isActive && !isInviteReady && !soloMode) || isEditingLocked || (!soloMode && parseFloat(newCompanyStake || "0") > remainingBalance)}
                  >
                    Add
                  </button>
                </div>
                <p className="mt-1 text-[10px] text-stone-500">
                  {isEditingLocked ? "Editing locked during finalization vote." : soloMode ? "Enter weight amounts for each company." : isActive ? `Initial stake in ytest.USD. ${remainingBalance > 0 ? `You can stake up to $${remainingBalance.toFixed(2)}` : "No balance remaining"}` : isInviteReady ? `Build your basket now. ${remainingBalance > 0 ? `You can stake up to $${remainingBalance.toFixed(2)}` : "No balance remaining"}` : "Create a session first."}
                </p>
              </div>

              {/* List of companies with stakes */}
              {activeBasket && activeBasket.companies.length > 0 ? (
                <div className="space-y-2">
                  {activeBasket.companies.map((companyName) => {
                    const user1Stake = soloMode ? getSoloStake(companyName) : getUserStake(companyName, sessionState.user1Address || "");
                    const user2Stake = soloMode ? "0" : getUserStake(companyName, sessionState.user2Address || "");
                    const totalStake = soloMode ? parseFloat(getSoloStake(companyName)) : getCompanyTotalStake(companyName);
                    const basketWeights = calculateWeightsFromBasket(activeBasket);
                    const weight = basketWeights.find(w => w.name === companyName)?.weight || 0;

                    return (
                      <div key={companyName} className="rounded border border-dirt bg-black/20 p-3">
                        <div className="mb-2 flex items-center justify-between">
                          <p className="font-medium text-stone-200">{companyName}</p>
                          <span className="rounded bg-sky-900/50 px-2 py-0.5 text-[10px] text-sky-300">
                            {weight}% weight
                          </span>
                        </div>
                        {soloMode ? (
                          <div className="mb-2 text-[10px]">
                            <p className="text-stone-500">Your stake</p>
                            <p className="text-green-300">${user1Stake}</p>
                          </div>
                        ) : (
                          <div className="mb-2 grid grid-cols-3 gap-2 text-[10px]">
                            <div>
                              <p className="text-stone-500">Host stake</p>
                              <p className="text-sky-300">${user1Stake}</p>
                            </div>
                            <div>
                              <p className="text-stone-500">Joiner stake</p>
                              <p className="text-amber-300">${user2Stake}</p>
                            </div>
                            <div>
                              <p className="text-stone-500">Total</p>
                              <p className="text-green-300">${totalStake.toFixed(2)}</p>
                            </div>
                          </div>
                        )}
                        <div className={`flex items-center gap-2 ${isEditingLocked ? "opacity-60" : ""}`}>
                          <input
                            className="input-blocky w-20 rounded px-2 py-1 text-center text-[10px]"
                            type="number"
                            value={topUpAmounts[companyName] || ""}
                            onChange={(e) =>
                              setTopUpAmounts((prev) => ({
                                ...prev,
                                [companyName]: e.target.value,
                              }))
                            }
                            placeholder="Amount"
                            min="0.01"
                            step="0.01"
                            max={soloMode ? undefined : remainingBalance.toString()}
                            disabled={isEditingLocked || (!soloMode && remainingBalance <= 0) || (!isActive && !isInviteReady && !soloMode)}
                          />
                          <button
                            type="button"
                            onClick={() => handleTopUp(companyName)}
                            className="rounded border border-green-700 px-2 py-1 text-[10px] text-green-300 hover:bg-green-900/30 disabled:opacity-50 disabled:cursor-not-allowed"
                            disabled={isEditingLocked || (!soloMode && remainingBalance <= 0) || (!soloMode && parseFloat(topUpAmounts[companyName] || "0") > remainingBalance) || (!isActive && !isInviteReady && !soloMode)}
                          >
                            + Top Up
                          </button>
                          {remainingBalance <= 0 && !isEditingLocked && (
                            <span className="text-[9px] text-red-400">No balance</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="py-4 text-center text-[10px] text-stone-500">
                  No companies yet. Add one above to start building the basket.
                </p>
              )}

              {/* Summary */}
              {activeBasket && activeBasket.companies.length > 0 && (
                <div className="rounded bg-stone-800/50 p-2 text-[10px]">
                  <p className="text-stone-400">
                    Total weight:{" "}
                    <span className="text-stone-200">
                      {calculateWeightsFromBasket(activeBasket).reduce((sum, c) => sum + c.weight, 0)}%
                    </span>
                    {" | "}
                    Companies: <span className="text-stone-200">{activeBasket.companies.length}</span>
                  </p>
                </div>
              )}
            </div>
          </div>

          {message && <p className="text-[10px] text-sky-200">{message}</p>}

          {/* Solo Deploy Button - when waiting for joiner and basket is ready */}
          {isInviteReady && sessionState.basket && sessionState.basket.companies.length > 0 && (
            <div className="rounded border-4 border-dirt p-4">
              <p className="mb-2 text-[10px] text-stone-400">
                No one joined yet? You can deploy this project on your own.
              </p>
              <button
                type="button"
                onClick={triggerDeployment}
                className="button-blocky w-full rounded px-4 py-3 text-xs uppercase"
                disabled={
                  submitting ||
                  !localFormFields.projectName ||
                  calculateWeightsFromBasket(sessionState.basket).reduce((sum, c) => sum + c.weight, 0) !== 100
                }
              >
                {submitting ? "Deploying..." : "Deploy Solo"}
              </button>
              {calculateWeightsFromBasket(sessionState.basket).reduce((sum, c) => sum + c.weight, 0) !== 100 && (
                <p className="mt-1 text-[10px] text-amber-400">
                  Weights must sum to 100% before deploying
                </p>
              )}
              {!localFormFields.projectName && (
                <p className="mt-1 text-[10px] text-amber-400">
                  Enter a project name before deploying
                </p>
              )}
              <p className="mt-2 text-[10px] text-stone-500">
                Or wait for someone to join using the invite code above.
              </p>
            </div>
          )}

          {/* Solo Mode Deploy Button */}
          {soloMode && isIdle && soloBasket.companies.length > 0 && (
            <div className="rounded border-4 border-purple-800/50 bg-purple-900/10 p-4">
              <p className="mb-2 text-[10px] text-stone-400">
                Deploy your project directly without a collaborative session.
              </p>
              <button
                type="button"
                onClick={handleSoloDeploy}
                className="button-blocky w-full rounded px-4 py-3 text-xs uppercase"
                disabled={
                  submitting ||
                  !localFormFields.projectName ||
                  calculateWeightsFromBasket(soloBasket).reduce((sum, c) => sum + c.weight, 0) !== 100
                }
              >
                {submitting ? "Deploying..." : "Deploy Project"}
              </button>
              {calculateWeightsFromBasket(soloBasket).reduce((sum, c) => sum + c.weight, 0) !== 100 && (
                <p className="mt-1 text-[10px] text-amber-400">
                  Weights must sum to 100% before deploying
                </p>
              )}
              {!localFormFields.projectName && (
                <p className="mt-1 text-[10px] text-amber-400">
                  Enter a project name before deploying
                </p>
              )}
            </div>
          )}

          {/* Propose Finalization Button - only when session active, no finalization in progress, and form is valid */}
          {isActive && !finalizationRequest && sessionState.basket && sessionState.basket.companies.length > 0 && (
            <div className="rounded border-2 border-green-800/50 bg-green-900/10 p-4">
              <p className="mb-2 text-[10px] text-stone-400">
                Ready to finalize? Both participants must agree before deploying.
              </p>
              <button
                type="button"
                onClick={handleProposeFinalization}
                className="w-full rounded bg-green-700 px-4 py-3 text-sm font-medium text-green-100 hover:bg-green-600"
                disabled={
                  submitting ||
                  !localFormFields.projectName ||
                  calculateWeightsFromBasket(sessionState.basket).reduce((sum, c) => sum + c.weight, 0) !== 100
                }
              >
                Propose Finalization (Requires 100% Vote)
              </button>
              {calculateWeightsFromBasket(sessionState.basket).reduce((sum, c) => sum + c.weight, 0) !== 100 && (
                <p className="mt-1 text-[10px] text-amber-400">
                  Weights must sum to 100% before proposing
                </p>
              )}
              {!localFormFields.projectName && (
                <p className="mt-1 text-[10px] text-amber-400">
                  Enter a project name before proposing
                </p>
              )}
            </div>
          )}

          {/* Legacy submit button - hidden when we have explicit deploy options above */}
          {!isActive && !isInviteReady && !soloMode && (
            <button
              type="submit"
              className="button-blocky rounded px-4 py-3 text-xs uppercase"
              disabled={submitting}
            >
              {submitting ? "Deploying..." : "Create project"}
            </button>
          )}
        </form>
      )}

      {/* Message when no session is active */}
      {!canEditForm && (
        <div className="rounded border-4 border-dirt/50 bg-stone-900/30 p-6 text-center">
          <p className="text-stone-400">
            Join or create a Yellow Network session above to start building a project collaboratively.
          </p>
        </div>
      )}
    </div>
  );
};

export default CreateProjectPage;
