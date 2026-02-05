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
    const lower = userAddr.toLowerCase();
    let total = 0;
    for (const company of sessionState.basket.companies) {
      const stakes = sessionState.basket.stakes[company] || {};
      const direct = stakes[userAddr] ?? stakes[lower];
      const found =
        direct ??
        (() => {
          const matchKey = Object.keys(stakes).find((key) => key.toLowerCase() === lower);
          return matchKey ? stakes[matchKey] : "0";
        })();
      const userStake = parseFloat(found || "0");
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
    const stakes = sessionState.basket?.stakes[companyName];
    if (!stakes) return "0";
    if (stakes[userAddr]) return stakes[userAddr];
    const lower = userAddr.toLowerCase();
    if (stakes[lower]) return stakes[lower];
    const matchKey = Object.keys(stakes).find((key) => key.toLowerCase() === lower);
    return matchKey ? stakes[matchKey] : "0";
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
      <div className="mb-6 rounded-lg bg-stone-900/50 p-5 text-sm">
        <div className="mb-4 flex items-center justify-between">
          {!isIdle && (
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${
                isActive
                  ? "bg-green-900/60 text-green-300"
                  : isInviteReady
                    ? "bg-yellow-900/60 text-yellow-300"
                    : isClosed
                      ? "bg-stone-700/60 text-stone-300"
                      : "bg-sky-900/60 text-sky-300"
              }`}
            >
              {isActive && (
                <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
              )}
              {sessionState.status.replace(/_/g, " ")}
            </span>
          )}
        </div>

        {/* Idle State - Choose Role */}
        {isIdle && !soloMode && (
          <div className="space-y-5">
            <p className="text-sm text-stone-400">
              Create a session and share the invite code, or join with an invite code from another device.
            </p>
            <div className="grid gap-5 md:grid-cols-2">
              {/* Creator Flow */}
              <div className="flex flex-col rounded-lg bg-sky-950/40 p-4 transition-colors hover:bg-sky-950/50">
                <div className="mb-3 flex items-center justify-center gap-2">
                  <svg className="h-5 w-5 text-sky-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                  </svg>
                  <span className="text-base font-semibold text-sky-300">Host</span>
                </div>
                <p className="mb-4 text-center text-sm text-stone-400">
                  Enter your collaborator's wallet address, then create a session.
                </p>
                <div className="mt-auto space-y-3">
                  <input
                    type="text"
                    value={joinerAddressInput}
                    onChange={(e) => setJoinerAddressInput(e.target.value)}
                    placeholder="Collaborator's wallet address (0x...)"
                    className="input-blocky w-full rounded-lg px-3 py-2.5 font-mono text-xs"
                  />
                  <button
                    type="button"
                    onClick={handleCreateSession}
                    className="button-blocky flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg px-3 py-2.5"
                    disabled={isConnecting || !joinerAddressInput.trim()}
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                    </svg>
                    Create Session
                  </button>
                </div>
              </div>

              {/* Joiner Flow */}
              <div className="flex flex-col rounded-lg bg-amber-950/40 p-4 transition-colors hover:bg-amber-950/50">
                <div className="mb-3 flex items-center justify-center gap-2">
                  <svg className="h-5 w-5 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
                  </svg>
                  <span className="text-base font-semibold text-amber-300">Join</span>
                </div>
                <p className="mb-4 text-center text-sm text-stone-400">
                  Paste the invite code from the host.
                </p>
                <div className="mt-auto space-y-3">
                  <textarea
                    value={inviteCode}
                    onChange={(e) => setInviteCode(e.target.value)}
                    placeholder="Paste invite code here..."
                    className="input-blocky h-16 w-full resize-none rounded-lg px-3 py-2.5 font-mono text-[10px]"
                  />
                  <button
                    type="button"
                    onClick={handleJoinWithInvite}
                    className="button-blocky flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg px-4 py-2.5"
                    disabled={isJoining || !inviteCode.trim()}
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M11 16l-4-4m0 0l4-4m-4 4h14" />
                    </svg>
                    Join Session
                  </button>
                </div>
              </div>
            </div>

            {/* Solo Mode */}
            <div className="pt-3 text-center">
              <button
                type="button"
                onClick={() => setSoloMode(true)}
                className="inline-flex cursor-pointer items-center gap-1.5 text-sm text-stone-500 underline transition-colors hover:text-stone-300"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
                Create form solo
              </button>
            </div>
          </div>
        )}

        {/* Connecting State */}
        {(isConnecting || isJoining) && (
          <div className="py-6 text-center">
            <svg className="mx-auto mb-3 h-8 w-8 animate-spin text-sky-400" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            <p className="text-base text-stone-300">
              {isJoining ? "Joining session..." : "Creating session..."}
            </p>
            <p className="mt-1 text-sm text-stone-500">Authenticating with Yellow Network</p>
          </div>
        )}

        {/* Creator: Invite Ready */}
        {isInviteReady && sessionState.invite && (
          <div className="space-y-4">
            <div className="rounded-lg bg-green-900/30 p-4">
              <div className="mb-3 flex items-center justify-center gap-2">
                <svg className="h-5 w-5 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span className="text-base font-medium text-stone-200">Session invite created!</span>
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-lg bg-black/20 p-2.5 text-center">
                  <p className="text-xs text-stone-500">You (Host)</p>
                  <p className="mt-1 font-mono text-sky-300">{shortAddress(sessionState.user1Address || "")}</p>
                </div>
                <div className="rounded-lg bg-black/20 p-2.5 text-center">
                  <p className="text-xs text-stone-500">Collaborator</p>
                  <p className="mt-1 font-mono text-amber-300">{shortAddress(sessionState.user2Address || "")}</p>
                </div>
              </div>
            </div>

            <div className="rounded-lg bg-yellow-950/40 p-4">
              <div className="mb-3 flex items-center justify-between">
                <p className="flex items-center gap-1.5 text-sm text-stone-300">
                  <svg className="h-4 w-4 text-yellow-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                  </svg>
                  Share this invite code
                </p>
                <button
                  type="button"
                  onClick={() => copyToClipboard(sessionState.invite!)}
                  className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-yellow-800/50 px-3 py-1.5 text-sm font-medium text-yellow-200 transition-colors hover:bg-yellow-800/70"
                >
                  {copied ? (
                    <>
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                      Copied!
                    </>
                  ) : (
                    <>
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                      Copy
                    </>
                  )}
                </button>
              </div>
              <textarea
                readOnly
                value={sessionState.invite}
                className="h-20 w-full resize-none rounded-lg bg-black/40 p-3 font-mono text-[10px] text-yellow-200"
              />
            </div>

            <p className="text-center text-sm text-stone-500">
              Send this code to your collaborator. They paste it on their device to join.
            </p>

            <button
              type="button"
              onClick={handleDisconnect}
              className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg border border-stone-700 px-4 py-2.5 text-sm text-stone-400 transition-colors hover:bg-stone-800"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
              Cancel
            </button>
          </div>
        )}

        {/* Active State */}
        {isActive && (
          <div className="space-y-4">
            <div className="rounded-lg bg-green-900/30 p-4">
              <div className="mb-3 flex items-center justify-center gap-2">
                <div className="h-2 w-2 animate-pulse rounded-full bg-green-400" />
                <span className="text-sm font-medium text-stone-300">Session Active</span>
              </div>
              <p className="mb-3 text-center font-mono text-xs text-stone-500">
                {sessionState.appSessionId?.slice(0, 24)}...
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg bg-black/20 p-2.5 text-center">
                  <div className="mb-1 flex items-center justify-center gap-1.5 text-xs text-stone-500">
                    <svg className="h-3 w-3 text-sky-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                    </svg>
                    Host
                  </div>
                  <p className="font-mono text-sm text-sky-300">{shortAddress(sessionState.user1Address || "")}</p>
                </div>
                <div className="rounded-lg bg-black/20 p-2.5 text-center">
                  <div className="mb-1 flex items-center justify-center gap-1.5 text-xs text-stone-500">
                    <svg className="h-3 w-3 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
                    </svg>
                    Joiner
                  </div>
                  <p className="font-mono text-sm text-amber-300">{shortAddress(sessionState.user2Address || "")}</p>
                </div>
              </div>
            </div>

            {/* Session Actions */}
            <div className="flex gap-3">
              <button
                type="button"
                onClick={handleCloseSession}
                className="flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-lg bg-red-900/40 px-4 py-2.5 text-sm text-red-300 transition-colors hover:bg-red-900/60"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
                Close Session
              </button>
              <button
                type="button"
                onClick={handleDisconnect}
                className="cursor-pointer rounded-lg border border-stone-700 px-4 py-2.5 text-sm text-stone-400 transition-colors hover:bg-stone-800"
              >
                Disconnect
              </button>
            </div>
          </div>
        )}

        {/* Closed State */}
        {isClosed && (
          <div className="space-y-4">
            <div className="rounded-lg bg-stone-800/60 p-4 text-center">
              <svg className="mx-auto mb-2 h-8 w-8 text-stone-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-base text-stone-300">Session closed</p>
              <p className="mt-1 text-sm text-stone-500">
                Final balances have been settled
              </p>
            </div>
            <button
              type="button"
              onClick={handleDisconnect}
              className="button-blocky flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg px-4 py-2.5"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              Start New Session
            </button>
          </div>
        )}

        {/* Solo Mode State */}
        {soloMode && isIdle && (
          <div className="space-y-4">
            <div className="rounded-lg bg-purple-950/40 p-4 text-center">
              <div className="mb-2 flex items-center justify-center gap-2">
                <svg className="h-5 w-5 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
                <span className="text-base font-medium text-purple-300">Solo Mode</span>
              </div>
              <p className="text-sm text-stone-400">
                Create a project without a collaborative session
              </p>
            </div>
            <button
              type="button"
              onClick={() => setSoloMode(false)}
              className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg border border-stone-700 px-4 py-2.5 text-sm text-stone-400 transition-colors hover:bg-stone-800"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
              Exit Solo Mode
            </button>
          </div>
        )}

        {/* Error */}
        {yellowError && (
          <div className="mt-3 flex items-start gap-2 rounded-lg bg-red-900/30 p-3">
            <svg className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-sm text-red-300">{yellowError}</p>
          </div>
        )}

        {/* Logs */}
        {yellowLogs.length > 0 && (
          <div className="mt-4 max-h-32 overflow-y-auto rounded-lg bg-black/40 p-3 font-mono text-xs text-stone-500">
            {yellowLogs.map((line, idx) => (
              <p key={`${line}-${idx}`}>{line}</p>
            ))}
          </div>
        )}
      </div>

      {/* Project Creation Form - Shown when session is active, invite ready, or solo mode */}
      {canEditForm && (soloMode || sessionState.basket) && (
        <form onSubmit={handleSubmit} className="space-y-5 text-sm">
          {/* Finalization Voting Card */}
          {finalizationRequest && isActive && (
            <div className="rounded-lg bg-amber-950/50 p-5">
              <div className="mb-4 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <svg className="h-5 w-5 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span className="font-semibold text-amber-300">Finalization Vote in Progress</span>
                </div>
                {quorumReached && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-green-800/60 px-3 py-1 text-xs font-medium text-green-200">
                    <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                    100% Quorum
                  </span>
                )}
              </div>
              
              <div className="mb-4 text-sm text-stone-400">
                <p>Proposed by: <span className="font-mono text-amber-200">{shortAddress(finalizationRequest.proposer)}</span></p>
                <p>Time: {new Date(finalizationRequest.timestamp).toLocaleTimeString()}</p>
              </div>

              {/* Vote Status */}
              <div className="mb-4 grid grid-cols-2 gap-3">
                <div className="rounded-lg bg-black/30 p-3">
                  <p className="text-xs text-stone-500">Host</p>
                  <p className="mt-1 font-mono text-sm text-sky-300">{shortAddress(sessionState.user1Address || "")}</p>
                  <p className={`mt-2 flex items-center gap-1.5 text-sm font-medium ${
                    finalizationRequest.votes[sessionState.user1Address?.toLowerCase() || ""] === true
                      ? "text-green-400"
                      : "text-stone-500"
                  }`}>
                    {finalizationRequest.votes[sessionState.user1Address?.toLowerCase() || ""] === true ? (
                      <>
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                        Accepted
                      </>
                    ) : (
                      <>
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        Pending
                      </>
                    )}
                  </p>
                </div>
                <div className="rounded-lg bg-black/30 p-3">
                  <p className="text-xs text-stone-500">Joiner</p>
                  <p className="mt-1 font-mono text-sm text-amber-300">{shortAddress(sessionState.user2Address || "")}</p>
                  <p className={`mt-2 flex items-center gap-1.5 text-sm font-medium ${
                    finalizationRequest.votes[sessionState.user2Address?.toLowerCase() || ""] === true
                      ? "text-green-400"
                      : "text-stone-500"
                  }`}>
                    {finalizationRequest.votes[sessionState.user2Address?.toLowerCase() || ""] === true ? (
                      <>
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                        Accepted
                      </>
                    ) : (
                      <>
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        Pending
                      </>
                    )}
                  </p>
                </div>
              </div>

              {/* Action Buttons */}
              {!hasVoted && !quorumReached && (
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => handleVoteFinalization(true)}
                    className="flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-lg bg-green-700 px-4 py-2.5 font-medium text-green-100 transition-colors hover:bg-green-600"
                    disabled={submitting}
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                    Accept
                  </button>
                  <button
                    type="button"
                    onClick={() => handleVoteFinalization(false)}
                    className="flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-lg bg-red-800 px-4 py-2.5 font-medium text-red-200 transition-colors hover:bg-red-700"
                    disabled={submitting}
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                    Reject
                  </button>
                </div>
              )}

              {/* Status Messages */}
              {hasVoted && !quorumReached && (
                <p className="text-center text-sm text-amber-300">
                  Waiting for other participant to vote...
                </p>
              )}
              {quorumReached && (submitting || deploymentTriggered) && (
                <div className="flex items-center justify-center gap-2 text-sm text-green-300">
                  <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Deploying to blockchain...
                </div>
              )}

              <p className="mt-3 flex items-center justify-center gap-1.5 text-sm text-stone-500">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
                Editing is locked during voting. Reject to make changes.
              </p>
            </div>
          )}

          {isActive && !finalizationRequest ? (
            <div className="flex items-center gap-2 text-sm text-green-400">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              All fields below are collaboratively editable. Changes sync in real-time.
            </div>
          ) : !isActive ? (
            <div className="flex items-center gap-2 text-sm text-yellow-400">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Start filling out the form. Changes will sync once the other user joins.
            </div>
          ) : null}

          <div className={`grid gap-4 md:grid-cols-2 ${isEditingLocked ? "opacity-60" : ""}`}>
            <label className="space-y-2">
              <span className="text-sm text-stone-300">Project name</span>
              <input
                className="input-blocky w-full rounded-lg px-3 py-2.5"
                value={localFormFields.projectName}
                onChange={(e) => handleLocalFieldChange("projectName", e.target.value)}
                onBlur={() => handleFieldBlur("projectName")}
                placeholder="Enter project name"
                required
                disabled={isEditingLocked}
              />
            </label>
            <label className="space-y-2">
              <span className="text-sm text-stone-300">Withdraw address</span>
              <input
                className="input-blocky w-full rounded-lg px-3 py-2.5"
                value={localFormFields.withdrawAddress}
                onChange={(e) => handleLocalFieldChange("withdrawAddress", e.target.value)}
                onBlur={() => handleFieldBlur("withdrawAddress")}
                placeholder="0x..."
                required
                disabled={isEditingLocked}
              />
            </label>
            <label className="space-y-2">
              <span className="text-sm text-stone-300">Minimum raise (USDC)</span>
              <input
                className="input-blocky w-full rounded-lg px-3 py-2.5"
                value={localFormFields.minimumRaise}
                onChange={(e) => handleLocalFieldChange("minimumRaise", e.target.value)}
                onBlur={() => handleFieldBlur("minimumRaise")}
                type="number"
                min="0"
                disabled={isEditingLocked}
              />
            </label>
            <label className="space-y-2">
              <span className="text-sm text-stone-300">Deadline</span>
              <input
                className="input-blocky w-full rounded-lg px-3 py-2.5"
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
              <span className="text-sm text-stone-300">Raise fee (%)</span>
              <input
                className="input-blocky w-full rounded-lg px-3 py-2.5"
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
              <span className="text-sm text-stone-300">Profit fee (%)</span>
              <input
                className="input-blocky w-full rounded-lg px-3 py-2.5"
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

          <div className="rounded-lg bg-stone-900/50 p-4">
            <div className="mb-4 flex items-center gap-2">
              <svg className="h-5 w-5 text-stone-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
              </svg>
              <span className="text-base font-medium text-stone-300">Companies & weights</span>
            </div>

            <div className="space-y-4">
              {/* Yellow Balance Display */}
              {(isActive || isInviteReady) && (
                <div className="rounded-lg bg-amber-950/40 p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <svg className="h-4 w-4 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <span className="text-sm text-amber-300">Your Yellow Balance (ytest.USD)</span>
                    </div>
                    <span className="font-mono text-lg font-semibold text-amber-200">
                      ${remainingBalance.toFixed(2)}
                    </span>
                  </div>
                  <div className="mt-2 flex gap-4 text-sm text-stone-500">
                    <span>Total: ${yellowBalance.toFixed(2)}</span>
                    <span>Staked: ${currentUserStaked.toFixed(2)}</span>
                  </div>
                </div>
              )}

              {/* Add new company - enabled when session is active, invite_ready, or solo mode */}
              <div className={`rounded-lg p-4 ${(isActive || isInviteReady || soloMode) && !isEditingLocked ? "bg-green-950/40" : "bg-stone-800/40"} ${isEditingLocked ? "opacity-60" : ""}`}>
                <p className={`mb-3 flex items-center gap-2 text-sm ${(isActive || isInviteReady || soloMode) && !isEditingLocked ? "text-green-300" : "text-stone-400"}`}>
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                  </svg>
                  Add a company {(isInviteReady || soloMode) && "(changes saved locally)"}{isEditingLocked && "(locked during voting)"}
                </p>
                <div className="flex gap-3">
                  <input
                    className="input-blocky flex-1 rounded-lg px-3 py-2.5"
                    value={newCompanyName}
                    onChange={(e) => setNewCompanyName(e.target.value)}
                    placeholder="Company name"
                    disabled={(!isActive && !isInviteReady && !soloMode) || isEditingLocked}
                  />
                  <input
                    className="input-blocky w-28 rounded-lg px-3 py-2.5 text-center"
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
                    className="button-blocky flex cursor-pointer items-center gap-2 rounded-lg px-5 py-2.5"
                    disabled={(!isActive && !isInviteReady && !soloMode) || isEditingLocked || (!soloMode && parseFloat(newCompanyStake || "0") > remainingBalance)}
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                    </svg>
                    Add
                  </button>
                </div>
                <p className="mt-2 text-sm text-stone-500">
                  {isEditingLocked ? "Editing locked during finalization vote." : soloMode ? "Enter weight amounts for each company." : isActive ? `Initial stake in ytest.USD. ${remainingBalance > 0 ? `You can stake up to $${remainingBalance.toFixed(2)}` : "No balance remaining"}` : isInviteReady ? `Build your basket now. ${remainingBalance > 0 ? `You can stake up to $${remainingBalance.toFixed(2)}` : "No balance remaining"}` : "Create a session first."}
                </p>
              </div>

              {/* List of companies with stakes */}
              {activeBasket && activeBasket.companies.length > 0 ? (
                <>
                  {/* Weight Distribution Progress Bar */}
                  {(() => {
                    const basketWeights = calculateWeightsFromBasket(activeBasket);
                    const totalWeight = basketWeights.reduce((sum, c) => sum + c.weight, 0);
                    const colors = [
                      "bg-amber-500",
                      "bg-emerald-500",
                      "bg-sky-500",
                      "bg-purple-500",
                      "bg-rose-500",
                      "bg-cyan-500",
                      "bg-orange-500",
                      "bg-lime-500",
                    ];
                    return (
                      <div className="mb-5">
                        <div className="mb-2 flex items-center justify-between text-sm">
                          <span className="text-stone-400">Weight Distribution</span>
                          <span className={`font-medium ${totalWeight === 100 ? "text-green-400" : "text-amber-400"}`}>
                            {totalWeight}% / 100%
                          </span>
                        </div>
                        <div className="flex h-8 w-full overflow-hidden rounded-lg bg-stone-800">
                          {basketWeights.map((company, idx) => (
                            <div
                              key={company.name}
                              className={`${colors[idx % colors.length]} flex items-center justify-center transition-all duration-300`}
                              style={{ width: `${company.weight}%` }}
                              title={`${company.name}: ${company.weight}%`}
                            >
                              {company.weight >= 10 && (
                                <span className="truncate px-1 text-xs font-bold text-white drop-shadow">
                                  {company.weight}%
                                </span>
                              )}
                            </div>
                          ))}
                          {totalWeight < 100 && (
                            <div
                              className="flex items-center justify-center bg-stone-700/50"
                              style={{ width: `${100 - totalWeight}%` }}
                            >
                              <span className="text-xs text-stone-500">
                                {100 - totalWeight}%
                              </span>
                            </div>
                          )}
                        </div>
                        {/* Legend */}
                        <div className="mt-3 flex flex-wrap gap-3">
                          {basketWeights.map((company, idx) => (
                            <div key={company.name} className="flex items-center gap-1.5">
                              <div className={`h-2.5 w-2.5 rounded ${colors[idx % colors.length]}`} />
                              <span className="text-xs text-stone-400">{company.name}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })()}

                  {/* Company Cards */}
                  <div className="space-y-3">
                    {(() => {
                      const basketWeights = calculateWeightsFromBasket(activeBasket);
                      const colors = [
                        { bg: "bg-amber-500", bgLight: "bg-amber-500/10", text: "text-amber-400" },
                        { bg: "bg-emerald-500", bgLight: "bg-emerald-500/10", text: "text-emerald-400" },
                        { bg: "bg-sky-500", bgLight: "bg-sky-500/10", text: "text-sky-400" },
                        { bg: "bg-purple-500", bgLight: "bg-purple-500/10", text: "text-purple-400" },
                        { bg: "bg-rose-500", bgLight: "bg-rose-500/10", text: "text-rose-400" },
                        { bg: "bg-cyan-500", bgLight: "bg-cyan-500/10", text: "text-cyan-400" },
                        { bg: "bg-orange-500", bgLight: "bg-orange-500/10", text: "text-orange-400" },
                        { bg: "bg-lime-500", bgLight: "bg-lime-500/10", text: "text-lime-400" },
                      ];

                      return activeBasket.companies.map((companyName, idx) => {
                        const myStake = soloMode 
                          ? getSoloStake(companyName) 
                          : getUserStake(companyName, currentUserAddress || "");
                        const totalStake = soloMode 
                          ? parseFloat(getSoloStake(companyName)) 
                          : getCompanyTotalStake(companyName);
                        const weight = basketWeights.find(w => w.name === companyName)?.weight || 0;
                        const colorSet = colors[idx % colors.length];

                        return (
                          <div 
                            key={companyName} 
                            className={`flex items-stretch overflow-hidden rounded-lg ${colorSet.bgLight} transition-colors hover:bg-opacity-20`}
                          >
                            {/* Color Indicator */}
                            <div className={`${colorSet.bg} w-1.5 flex-shrink-0`} />
                            
                            {/* Main Content */}
                            <div className="flex flex-1 items-center p-4">
                              {/* Company Name - Left */}
                              <div className="min-w-0 w-1/3">
                                <p className="truncate text-base font-semibold text-stone-100">{companyName}</p>
                                <p className={`text-xs ${colorSet.text}`}>{weight}% weight</p>
                              </div>
                              
                              {/* My Stake - Center */}
                              <div className="flex-1 text-center">
                                <p className="text-xs uppercase tracking-wide text-stone-500">My Stake</p>
                                <p className="text-xl font-bold text-sky-400">${myStake}</p>
                              </div>
                              
                              {/* Total - Right */}
                              <div className="w-1/4 text-right">
                                <p className="text-xs uppercase tracking-wide text-stone-500">Total</p>
                                <p className="text-xl font-bold text-green-400">${totalStake.toFixed(2)}</p>
                              </div>
                            </div>

                            {/* Right: Top Up Controls */}
                            <div className={`flex items-center gap-3 border-l border-stone-700/30 bg-black/20 px-4 py-3 ${isEditingLocked ? "opacity-60" : ""}`}>
                              <input
                                className="input-blocky w-20 rounded-lg px-2 py-2 text-center text-sm"
                                type="number"
                                value={topUpAmounts[companyName] || ""}
                                onChange={(e) =>
                                  setTopUpAmounts((prev) => ({
                                    ...prev,
                                    [companyName]: e.target.value,
                                  }))
                                }
                                placeholder="$0"
                                min="0.01"
                                step="0.01"
                                max={soloMode ? undefined : remainingBalance.toString()}
                                disabled={isEditingLocked || (!soloMode && remainingBalance <= 0) || (!isActive && !isInviteReady && !soloMode)}
                              />
                              <button
                                type="button"
                                onClick={() => handleTopUp(companyName)}
                                className="flex cursor-pointer items-center gap-1.5 rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-green-500 disabled:cursor-not-allowed disabled:opacity-50"
                                disabled={isEditingLocked || (!soloMode && remainingBalance <= 0) || (!soloMode && parseFloat(topUpAmounts[companyName] || "0") > remainingBalance) || (!isActive && !isInviteReady && !soloMode)}
                              >
                                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                                </svg>
                                Stake
                              </button>
                            </div>
                          </div>
                        );
                      });
                    })()}
                  </div>
                </>
              ) : (
                <div className="py-10 text-center">
                  <svg className="mx-auto mb-3 h-12 w-12 text-stone-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                  </svg>
                  <p className="text-base text-stone-500">No companies yet</p>
                  <p className="mt-1 text-sm text-stone-600">Add one above to start building the basket</p>
                </div>
              )}
            </div>
          </div>

          {message && (
            <div className="flex items-center gap-2 rounded-lg bg-sky-900/30 p-3 text-sm text-sky-200">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {message}
            </div>
          )}

          {/* Solo Deploy Button - when waiting for joiner and basket is ready */}
          {isInviteReady && sessionState.basket && sessionState.basket.companies.length > 0 && (
            <div className="rounded-lg bg-stone-800/50 p-5">
              <p className="mb-3 text-sm text-stone-400">
                No one joined yet? You can deploy this project on your own.
              </p>
              <button
                type="button"
                onClick={triggerDeployment}
                className="button-blocky flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg px-4 py-3"
                disabled={
                  submitting ||
                  !localFormFields.projectName ||
                  calculateWeightsFromBasket(sessionState.basket).reduce((sum, c) => sum + c.weight, 0) !== 100
                }
              >
                {submitting ? (
                  <>
                    <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    Deploying...
                  </>
                ) : (
                  <>
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                    </svg>
                    Deploy Solo
                  </>
                )}
              </button>
              {calculateWeightsFromBasket(sessionState.basket).reduce((sum, c) => sum + c.weight, 0) !== 100 && (
                <p className="mt-2 flex items-center gap-1.5 text-sm text-amber-400">
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  Weights must sum to 100% before deploying
                </p>
              )}
              {!localFormFields.projectName && (
                <p className="mt-2 flex items-center gap-1.5 text-sm text-amber-400">
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  Enter a project name before deploying
                </p>
              )}
              <p className="mt-3 text-sm text-stone-500">
                Or wait for someone to join using the invite code above.
              </p>
            </div>
          )}

          {/* Solo Mode Deploy Button */}
          {soloMode && isIdle && soloBasket.companies.length > 0 && (
            <div className="rounded-lg bg-purple-950/40 p-5">
              <p className="mb-3 text-sm text-stone-400">
                Deploy your project directly without a collaborative session.
              </p>
              <button
                type="button"
                onClick={handleSoloDeploy}
                className="button-blocky flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg px-4 py-3"
                disabled={
                  submitting ||
                  !localFormFields.projectName ||
                  calculateWeightsFromBasket(soloBasket).reduce((sum, c) => sum + c.weight, 0) !== 100
                }
              >
                {submitting ? (
                  <>
                    <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    Deploying...
                  </>
                ) : (
                  <>
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                    </svg>
                    Deploy Project
                  </>
                )}
              </button>
              {calculateWeightsFromBasket(soloBasket).reduce((sum, c) => sum + c.weight, 0) !== 100 && (
                <p className="mt-2 flex items-center gap-1.5 text-sm text-amber-400">
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  Weights must sum to 100% before deploying
                </p>
              )}
              {!localFormFields.projectName && (
                <p className="mt-2 flex items-center gap-1.5 text-sm text-amber-400">
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  Enter a project name before deploying
                </p>
              )}
            </div>
          )}

          {/* Propose Finalization Button - only when session active, no finalization in progress, and form is valid */}
          {isActive && !finalizationRequest && sessionState.basket && sessionState.basket.companies.length > 0 && (
            <div className="rounded-lg bg-green-950/40 p-5">
              <p className="mb-3 text-sm text-stone-400">
                Ready to finalize? Both participants must agree before deploying.
              </p>
              <button
                type="button"
                onClick={handleProposeFinalization}
                className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg bg-green-700 px-4 py-3 text-sm font-medium text-green-100 transition-colors hover:bg-green-600"
                disabled={
                  submitting ||
                  !localFormFields.projectName ||
                  calculateWeightsFromBasket(sessionState.basket).reduce((sum, c) => sum + c.weight, 0) !== 100
                }
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Propose Finalization (Requires 100% Vote)
              </button>
              {calculateWeightsFromBasket(sessionState.basket).reduce((sum, c) => sum + c.weight, 0) !== 100 && (
                <p className="mt-2 flex items-center gap-1.5 text-sm text-amber-400">
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  Weights must sum to 100% before proposing
                </p>
              )}
              {!localFormFields.projectName && (
                <p className="mt-2 flex items-center gap-1.5 text-sm text-amber-400">
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  Enter a project name before proposing
                </p>
              )}
            </div>
          )}

          {/* Legacy submit button - hidden when we have explicit deploy options above */}
          {!isActive && !isInviteReady && !soloMode && (
            <button
              type="submit"
              className="button-blocky flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg px-4 py-3"
              disabled={submitting}
            >
              {submitting ? (
                <>
                  <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Deploying...
                </>
              ) : (
                <>
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                  </svg>
                  Create project
                </>
              )}
            </button>
          )}
        </form>
      )}
    </div>
  );
};

export default CreateProjectPage;
