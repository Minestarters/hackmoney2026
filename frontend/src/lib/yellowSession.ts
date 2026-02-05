/**
 * Yellow Network Session Manager
 * Cross-device support using signed session invites
 */

import {
  createAppSessionMessage,
  createAuthRequestMessage,
  createAuthVerifyMessageFromChallenge,
  createCloseAppSessionMessage,
  createECDSAMessageSigner,
  createEIP712AuthMessageSigner,
  createSubmitAppStateMessage,
  RPCAppStateIntent,
  RPCMethod,
  RPCProtocolVersion,
  type MessageSigner,
  type RPCAppDefinition,
  type RPCAppSessionAllocation,
  type RPCData,
  type RPCResponse,
} from "@erc7824/nitrolite";
import { Client } from "yellow-ts";
import { createWalletClient, custom, http, type WalletClient, type Account } from "viem";
import { generatePrivateKey, privateKeyToAccount, mnemonicToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import {
  YELLOW_APPLICATION,
  YELLOW_SCOPE,
  YELLOW_SESSION_EXPIRES_MS,
  YELLOW_WALLET_2_SEED_PHRASE,
} from "../config";

// ============================================================================
// Types
// ============================================================================

export type Logger = (line: string) => void;

type SessionKey = {
  privateKey: `0x${string}`;
  address: `0x${string}`;
};

export type SessionInvite = {
  creatorAddress: `0x${string}`;
  joinerAddress: `0x${string}`;
  req: RPCData;
  sig: string[];
  nonce: number;
};

// Form fields that can be collaboratively edited
export type ProjectFormFields = {
  projectName: string;
  minimumRaise: string;
  deadline: string;
  raiseFeePct: string;
  profitFeePct: string;
  withdrawAddress: string;
};

// Collaborative basket state - synced via session_data
export type BasketState = {
  companies: string[]; // List of company names
  stakes: Record<string, Record<string, string>>; // company -> { userAddr -> amount }
  formFields?: ProjectFormFields; // Collaborative form fields
};

export type YellowSessionState = {
  status: "idle" | "connecting" | "invite_ready" | "joining" | "active" | "closed" | "error";
  role?: "creator" | "joiner";
  user1Address?: `0x${string}`;
  user2Address?: `0x${string}`;
  appSessionId?: `0x${string}`;
  allocations?: { user1: string; user2: string };
  invite?: string; // Base64 encoded invite for sharing
  error?: string;
  basket?: BasketState; // Collaborative basket data
};

export type YellowSessionManager = {
  state: YellowSessionState;
  // Creator flow - creates invite automatically using predefined User 2 address
  createSession: () => Promise<string>;
  // Joiner flow  
  joinWithInvite: (inviteCode: string) => Promise<void>;
  // Session operations
  transfer: (amount: string, toUser: "user1" | "user2") => Promise<void>;
  closeSession: () => Promise<void>;
  disconnect: () => void;
  // Collaborative basket operations
  addCompany: (name: string, initialStake: string) => Promise<void>;
  stakeInCompany: (companyName: string, amount: string) => Promise<void>;
  // Collaborative form field operations
  updateFormField: (field: keyof ProjectFormFields, value: string) => Promise<void>;
};

// ============================================================================
// Helpers
// ============================================================================

const logLine = (logger: Logger | undefined, line: string) => {
  if (logger) {
    logger(line);
  }
  console.log(line);
};

const encodeInvite = (invite: SessionInvite): string => {
  return btoa(JSON.stringify(invite));
};

const decodeInvite = (code: string): SessionInvite => {
  try {
    return JSON.parse(atob(code)) as SessionInvite;
  } catch {
    throw new Error("Invalid invite code");
  }
};

const waitForResponse = (
  client: Client,
  method: RPCMethod,
  timeoutMs = 30_000
): Promise<RPCResponse> =>
  new Promise((resolve, reject) => {
    const timeout = globalThis.setTimeout(() => {
      unsubscribe();
      reject(new Error(`Timed out waiting for ${method}`));
    }, timeoutMs);

    const unsubscribe = client.listen((message: RPCResponse) => {
      if (!message) return;
      if (message.method === RPCMethod.Error) {
        globalThis.clearTimeout(timeout);
        unsubscribe();
        reject(new Error(message.params?.error || "Yellow RPC error"));
        return;
      }
      if (message.method !== method) return;
      globalThis.clearTimeout(timeout);
      unsubscribe();
      resolve(message);
    });
  });

const authenticateWallet = async (
  client: Client,
  walletClient: WalletClient,
  logger?: Logger
): Promise<SessionKey> => {
  const privateKey = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);
  const sessionKey: SessionKey = {
    privateKey,
    address: account.address,
  };

  const address = walletClient.account?.address as `0x${string}`;
  const expiresAtSeconds = BigInt(
    Math.floor((Date.now() + YELLOW_SESSION_EXPIRES_MS) / 1000)
  );

  const allowances = [{ asset: "ytest.usd", amount: "10" }];

  const authRequest = await createAuthRequestMessage({
    address,
    session_key: sessionKey.address,
    application: YELLOW_APPLICATION,
    allowances,
    expires_at: expiresAtSeconds,
    scope: YELLOW_SCOPE,
  });

  logLine(logger, `Auth request sent for ${address}`);
  void client.sendMessage(authRequest);

  const challenge = await waitForResponse(client, RPCMethod.AuthChallenge);
  const challengeParams = challenge.params as { challengeMessage?: string } | undefined;
  const challengeMessage = challengeParams?.challengeMessage;
  if (!challengeMessage) {
    throw new Error("Missing auth challenge message");
  }

  const eip712Signer = createEIP712AuthMessageSigner(
    walletClient,
    {
      scope: YELLOW_SCOPE,
      session_key: sessionKey.address,
      expires_at: expiresAtSeconds,
      allowances,
    },
    { name: YELLOW_APPLICATION }
  );

  const verifyMessage = await createAuthVerifyMessageFromChallenge(
    eip712Signer,
    challengeMessage
  );

  void client.sendMessage(verifyMessage);

  const verify = await waitForResponse(client, RPCMethod.AuthVerify);
  const verifyParams = verify.params as { success?: boolean } | undefined;
  if (!verifyParams?.success) {
    throw new Error("Yellow auth failed");
  }

  logLine(logger, `Auth verified for ${address}`);
  return sessionKey;
};

// ============================================================================
// Session Manager Factory
// ============================================================================

export const createYellowSessionManager = (
  onStateChange: (state: YellowSessionState) => void,
  getAccount: () => Account | null,
  logger?: Logger
): YellowSessionManager => {
  let state: YellowSessionState = { status: "idle" };
  let yellowClient: Client | null = null;
  let messageSigner: MessageSigner | null = null;
  let currentAppSessionId: `0x${string}` | null = null;
  let user1Addr: `0x${string}` | null = null;
  let user2Addr: `0x${string}` | null = null;
  let sessionNonce: number = 0;
  let stateVersion: number = 0; // Track state version for Yellow protocol

  const setState = (newState: Partial<YellowSessionState>) => {
    state = { ...state, ...newState };
    onStateChange(state);
  };

  const connectToYellow = async (): Promise<Client> => {
    if (yellowClient) return yellowClient;
    
    logLine(logger, "Connecting to Yellow clearnet...");
    yellowClient = new Client({
      url: "wss://clearnet-sandbox.yellow.com/ws",
    });
    await yellowClient.connect();
    logLine(logger, "Connected to Yellow clearnet.");
    return yellowClient;
  };

  // ========== CREATOR FLOW ==========
  
  // Creator creates session and invite using predefined User 2 address
  const createSession = async (): Promise<string> => {
    const account = getAccount();
    if (!account) {
      throw new Error("No wallet connected. Please connect your wallet first.");
    }
    if (!YELLOW_WALLET_2_SEED_PHRASE) {
      throw new Error("Missing VITE_WALLET_2_SEED_PHRASE");
    }

    setState({ status: "connecting", role: "creator" });

    try {
      const client = await connectToYellow();

      // Use the connected wallet account with browser wallet transport for signing
      if (typeof window === "undefined" || !window.ethereum) {
        throw new Error("No wallet provider found. Please install MetaMask or another wallet.");
      }
      const walletClient = createWalletClient({
        account,
        chain: baseSepolia,
        transport: custom(window.ethereum as Parameters<typeof custom>[0]),
      });

      // Derive User 2's address from seed phrase
      const wallet2Account = mnemonicToAccount(YELLOW_WALLET_2_SEED_PHRASE);
      const joinerAddr = wallet2Account.address as `0x${string}`;

      logLine(logger, "Authenticating as session creator...");
      const sessionKey = await authenticateWallet(client, walletClient, logger);
      messageSigner = createECDSAMessageSigner(sessionKey.privateKey);

      const userAddress = walletClient.account?.address as `0x${string}`;
      user1Addr = userAddress;
      user2Addr = joinerAddr;
      sessionNonce = Date.now();

      logLine(logger, `User 1: ${userAddress}`);
      logLine(logger, `User 2: ${joinerAddr}`);
      logLine(logger, `Creating invite...`);

      const appDefinition: RPCAppDefinition = {
        protocol: RPCProtocolVersion.NitroRPC_0_4,
        participants: [user1Addr, joinerAddr],
        weights: [50, 50],
        quorum: 50, // Allow either party to update state (for collaborative editing)
        challenge: 0,
        nonce: sessionNonce,
        application: YELLOW_APPLICATION,
      };

      const initialAllocations = [
        { participant: user1Addr, asset: "ytest.usd", amount: "1.00" },
        { participant: joinerAddr, asset: "ytest.usd", amount: "0.00" },
      ] as RPCAppSessionAllocation[];

      // Creator signs the session message
      const sessionMessage = await createAppSessionMessage(messageSigner, {
        definition: appDefinition,
        allocations: initialAllocations,
      });

      const parsed = JSON.parse(sessionMessage) as { req: RPCData; sig: string[] };

      const invite: SessionInvite = {
        creatorAddress: user1Addr,
        joinerAddress: joinerAddr,
        req: parsed.req,
        sig: parsed.sig,
        nonce: sessionNonce,
      };

      const inviteCode = encodeInvite(invite);

      setState({
        status: "invite_ready",
        user1Address: userAddress,
        user2Address: joinerAddr,
        invite: inviteCode,
        basket: { companies: [], stakes: {} }, // Initialize basket so form can be shown
      });

      logLine(logger, `Invite created! Share the code with User 2.`);
      logLine(logger, `Waiting for User 2 to join...`);

      // Poll for session creation since Yellow doesn't broadcast to creator
      let pollCount = 0;
      const maxPolls = 60; // Poll for max 2 minutes
      
      const pollForSession = async () => {
        pollCount++;
        logLine(logger, `Polling for session... (${pollCount}/${maxPolls})`);
        
        if (state.status !== "invite_ready") {
          logLine(logger, `Stopping poll - status changed to ${state.status}`);
          return;
        }
        if (!yellowClient || !messageSigner) {
          logLine(logger, `Stopping poll - no client or signer`);
          return;
        }
        if (pollCount > maxPolls) {
          logLine(logger, `Stopping poll - max attempts reached`);
          return;
        }
        
        try {
          // Request app sessions
          const reqId = Date.now();
          const reqData: RPCData = [reqId, RPCMethod.GetAppSessions, {}, reqId];
          const sig = await messageSigner(reqData);
          
          const getSessionsReq = JSON.stringify({
            req: reqData,
            sig: [sig],
          });
          
          logLine(logger, `Sending get_app_sessions request...`);
          const response = await yellowClient.sendMessage(getSessionsReq) as RPCResponse;
          logLine(logger, `Got response: ${JSON.stringify(response).slice(0, 500)}`);
          
          // Yellow returns appSessions (camelCase)
          const params = response.params as { 
            appSessions?: Array<{ 
              appSessionId: `0x${string}`; 
              participants?: string[];
              allocations?: Array<{ participant: string; asset: string; amount: string }> 
            }> 
          } | undefined;
          
          if (params?.appSessions && params.appSessions.length > 0) {
            logLine(logger, `Found ${params.appSessions.length} session(s)`);
            
            // Find a session with our participants
            for (const session of params.appSessions) {
              logLine(logger, `Checking session ${session.appSessionId}: participants=${JSON.stringify(session.participants)}, allocations=${JSON.stringify(session.allocations)}`);
              
              // Check by participants array or allocations
              let hasUser1 = false;
              let hasUser2 = false;
              
              if (session.participants) {
                hasUser1 = session.participants.some(p => p.toLowerCase() === user1Addr?.toLowerCase());
                hasUser2 = session.participants.some(p => p.toLowerCase() === user2Addr?.toLowerCase());
              }
              
              if (session.allocations) {
                hasUser1 = hasUser1 || session.allocations.some(a => a.participant.toLowerCase() === user1Addr?.toLowerCase());
                hasUser2 = hasUser2 || session.allocations.some(a => a.participant.toLowerCase() === user2Addr?.toLowerCase());
              }
              
              if (hasUser1 && hasUser2) {
                currentAppSessionId = session.appSessionId;
                stateVersion = (session as { version?: number }).version || 1; // Capture current version
                const user1Alloc = session.allocations?.find(a => a.participant.toLowerCase() === user1Addr?.toLowerCase());
                const user2Alloc = session.allocations?.find(a => a.participant.toLowerCase() === user2Addr?.toLowerCase());
                
                logLine(logger, `Our session found: ${session.appSessionId}, version: ${stateVersion}`);
                setState({
                  status: "active",
                  appSessionId: session.appSessionId,
                  allocations: { 
                    user1: user1Alloc?.amount || "1.00", 
                    user2: user2Alloc?.amount || "0.00" 
                  },
                  basket: { companies: [], stakes: {} }, // Initialize empty basket
                });
                return; // Stop polling
              }
            }
            
            logLine(logger, `No matching session found yet`);
          } else {
            logLine(logger, `No sessions in response`);
          }
          
          // Continue polling
          setTimeout(pollForSession, 2000);
        } catch (err) {
          logLine(logger, `Poll error: ${err instanceof Error ? err.message : String(err)}`);
          // Continue polling on error
          setTimeout(pollForSession, 3000);
        }
      };
      
      // Start polling after a short delay
      logLine(logger, `Starting session poll...`);
      setTimeout(pollForSession, 2000);

      // Also listen for any session-related messages
      client.listen((message: RPCResponse) => {
        const method = message.method as string;
        
        // Log all messages when session is active (for debugging)
        if (state.status === "active" || state.status === "invite_ready") {
          logLine(logger, `[Creator] Active msg: ${method} - ${JSON.stringify(message.params).slice(0, 200)}`);
        }
        
        // App session update (asu) indicates state change - this is how we detect User 2 joined
        if (method === "asu") {
          const params = message.params as { 
            appSessionId?: `0x${string}`;
            allocations?: { participant: string; asset?: string; amount: string }[];
            version?: number;
            sessionData?: string; // camelCase in response
          } | undefined;
          
          // If we're in invite_ready and receive an asu with our session, transition to active
          if (state.status === "invite_ready" && params?.appSessionId) {
            logLine(logger, `Received asu during invite_ready - session is now active: ${params.appSessionId}`);
            currentAppSessionId = params.appSessionId;
          }
          
          // Also update appSessionId if we already have one but receive a different one (shouldn't happen)
          if (params?.appSessionId && !currentAppSessionId) {
            logLine(logger, `Setting currentAppSessionId from asu: ${params.appSessionId}`);
            currentAppSessionId = params.appSessionId;
          }
          
          // Update version from incoming state
          if (params?.version && params.version > stateVersion) {
            stateVersion = params.version;
            logLine(logger, `Version updated to ${stateVersion}`);
          }
          
          const stateUpdate: Partial<YellowSessionState> = {};
          
          // Transition to active if we were waiting
          if (state.status === "invite_ready" && params?.appSessionId) {
            stateUpdate.status = "active";
            stateUpdate.appSessionId = params.appSessionId;
            // Initialize basket if not provided in the asu
            if (!params?.sessionData && !state.basket) {
              stateUpdate.basket = { companies: [], stakes: {} };
            }
          }
          
          // Parse basket from sessionData (this will override the empty basket if data exists)
          if (params?.sessionData) {
            try {
              const basket = JSON.parse(params.sessionData) as BasketState;
              stateUpdate.basket = basket;
              logLine(logger, `Basket update: ${basket.companies.length} companies, formFields: ${JSON.stringify(basket.formFields || {})}`);
            } catch (e) {
              logLine(logger, `Failed to parse sessionData: ${e}`);
            }
          }
          
          if (params?.allocations && user1Addr && user2Addr) {
            // Find ytest.usd allocations for basic balances
            const user1Alloc = params.allocations.find(
              a => a.participant.toLowerCase() === user1Addr!.toLowerCase() && a.asset === "ytest.usd"
            );
            const user2Alloc = params.allocations.find(
              a => a.participant.toLowerCase() === user2Addr!.toLowerCase() && a.asset === "ytest.usd"
            );
            
            if (user1Alloc && user2Alloc) {
              stateUpdate.allocations = { user1: user1Alloc.amount, user2: user2Alloc.amount };
              logLine(logger, `State update: User1=${user1Alloc.amount}, User2=${user2Alloc.amount}`);
            }
          }
          
          if (Object.keys(stateUpdate).length > 0) {
            setState(stateUpdate);
          }
        }
      });

      return inviteCode;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to create session";
      setState({ status: "error", error: message });
      throw err;
    }
  };

  // ========== JOINER FLOW ==========

  // Joiner receives invite, adds signature, submits to Yellow
  const joinWithInvite = async (inviteCode: string): Promise<void> => {
    if (!YELLOW_WALLET_2_SEED_PHRASE) {
      throw new Error("Missing VITE_WALLET_2_SEED_PHRASE");
    }

    setState({ status: "joining", role: "joiner" });

    try {
      const invite = decodeInvite(inviteCode);
      
      logLine(logger, `Decoded invite from ${invite.creatorAddress}`);

      const client = await connectToYellow();

      const walletClient = createWalletClient({
        account: mnemonicToAccount(YELLOW_WALLET_2_SEED_PHRASE),
        chain: baseSepolia,
        transport: http(),
      });

      const joinerAddress = walletClient.account?.address as `0x${string}`;

      // Verify this invite is for us
      if (invite.joinerAddress.toLowerCase() !== joinerAddress.toLowerCase()) {
        throw new Error(`This invite is for ${invite.joinerAddress}, but your address is ${joinerAddress}`);
      }

      logLine(logger, "Authenticating as session joiner...");
      const sessionKey = await authenticateWallet(client, walletClient, logger);
      messageSigner = createECDSAMessageSigner(sessionKey.privateKey);

      user1Addr = invite.creatorAddress;
      user2Addr = joinerAddress;
      sessionNonce = invite.nonce;

      logLine(logger, `Adding signature and submitting session...`);

      // Add joiner's signature to the invite
      const joinerSig = await messageSigner(invite.req);
      invite.sig.push(joinerSig);

      // Submit the fully-signed session to Yellow
      const sessionResponse = (await client.sendMessage(
        JSON.stringify({ req: invite.req, sig: invite.sig })
      )) as RPCResponse;

      const sessionParams = sessionResponse.params as { appSessionId?: `0x${string}`; version?: number } | undefined;
      const appSessionId = sessionParams?.appSessionId;

      if (!appSessionId) {
        const errorParams = sessionResponse.params as { error?: string } | undefined;
        throw new Error(errorParams?.error || "Failed to create app session");
      }

      currentAppSessionId = appSessionId;
      stateVersion = sessionParams?.version || 1; // Capture initial version

      setState({
        status: "active",
        user1Address: invite.creatorAddress,
        user2Address: joinerAddress,
        appSessionId,
        allocations: { user1: "1.00", user2: "0.00" },
        basket: { companies: [], stakes: {} }, // Initialize empty basket
      });

      logLine(logger, `Session created: ${appSessionId}, version: ${stateVersion}`);
      logLine(logger, `User1=${invite.creatorAddress}, User2=${joinerAddress}`);

      // Listen for all messages to detect state updates
      client.listen((message: RPCResponse) => {
        const method = message.method as string;
        logLine(logger, `[Joiner] Received: ${method} - ${JSON.stringify(message.params).slice(0, 200)}`);
        
        if (method === "asu" || method === "submit_app_state") {
          const params = message.params as { 
            allocations?: { participant: string; asset?: string; amount: string }[];
            version?: number;
            sessionData?: string; // camelCase in response
          } | undefined;
          
          // Update version from incoming state
          if (params?.version && params.version > stateVersion) {
            stateVersion = params.version;
            logLine(logger, `Version updated to ${stateVersion}`);
          }
          
          const stateUpdate: Partial<YellowSessionState> = {};
          
          // Parse basket from sessionData
          if (params?.sessionData) {
            try {
              const basket = JSON.parse(params.sessionData) as BasketState;
              stateUpdate.basket = basket;
              logLine(logger, `Basket update: ${basket.companies.length} companies`);
            } catch (e) {
              logLine(logger, `Failed to parse sessionData: ${e}`);
            }
          }
          
          if (params?.allocations && user1Addr && user2Addr) {
            // Find ytest.usd allocations for basic balances
            const user1Alloc = params.allocations.find(
              a => a.participant.toLowerCase() === user1Addr!.toLowerCase() && a.asset === "ytest.usd"
            );
            const user2Alloc = params.allocations.find(
              a => a.participant.toLowerCase() === user2Addr!.toLowerCase() && a.asset === "ytest.usd"
            );
            
            if (user1Alloc && user2Alloc) {
              stateUpdate.allocations = { user1: user1Alloc.amount, user2: user2Alloc.amount };
              logLine(logger, `State update: User1=${user1Alloc.amount}, User2=${user2Alloc.amount}`);
            }
          }
          
          if (Object.keys(stateUpdate).length > 0) {
            setState(stateUpdate);
          }
        }
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to join session";
      setState({ status: "error", error: message });
      throw err;
    }
  };

  // ========== SESSION OPERATIONS ==========

  const transfer = async (amount: string, toUser: "user1" | "user2"): Promise<void> => {
    if (!yellowClient || !messageSigner || !currentAppSessionId || !user1Addr || !user2Addr) {
      throw new Error("Session not active");
    }

    const currentUser1 = parseFloat(state.allocations?.user1 || "0");
    const currentUser2 = parseFloat(state.allocations?.user2 || "0");
    const transferAmount = parseFloat(amount);

    let newUser1: number;
    let newUser2: number;

    if (toUser === "user2") {
      newUser1 = currentUser1 - transferAmount;
      newUser2 = currentUser2 + transferAmount;
    } else {
      newUser1 = currentUser1 + transferAmount;
      newUser2 = currentUser2 - transferAmount;
    }

    if (newUser1 < 0 || newUser2 < 0) {
      throw new Error("Insufficient funds for transfer");
    }

    const newAllocations = [
      { participant: user1Addr, asset: "ytest.usd", amount: newUser1.toFixed(2) },
      { participant: user2Addr, asset: "ytest.usd", amount: newUser2.toFixed(2) },
    ] as RPCAppSessionAllocation[];

    // Use current version + 1 for submission
    // NOTE: We do NOT update stateVersion here - it gets updated from the asu response
    const nextVersion = stateVersion + 1;

    logLine(logger, `Transferring ${amount} ytest.usd to ${toUser} (version ${nextVersion}, current: ${stateVersion})...`);

    const submitMessage = await createSubmitAppStateMessage(messageSigner, {
      app_session_id: currentAppSessionId,
      intent: RPCAppStateIntent.Operate,
      version: nextVersion,
      allocations: newAllocations,
    });

    await yellowClient.sendMessage(submitMessage);

    // NOTE: Do NOT update stateVersion here!
    // The asu response listener will update it when the server confirms

    // Optimistically update local allocations (but not version)
    setState({
      allocations: { user1: newUser1.toFixed(2), user2: newUser2.toFixed(2) },
    });

    logLine(logger, `Transfer submitted, waiting for confirmation...`);
  };

  const closeSession = async (): Promise<void> => {
    if (!yellowClient || !messageSigner || !currentAppSessionId || !user1Addr || !user2Addr) {
      throw new Error("Session not active");
    }

    logLine(logger, "Closing session...");

    const finalAllocations = [
      { participant: user1Addr, asset: "ytest.usd", amount: state.allocations?.user1 || "0" },
      { participant: user2Addr, asset: "ytest.usd", amount: state.allocations?.user2 || "0" },
    ] as RPCAppSessionAllocation[];

    const closeMessage = await createCloseAppSessionMessage(messageSigner, {
      app_session_id: currentAppSessionId,
      allocations: finalAllocations,
    });

    await yellowClient.sendMessage(closeMessage);

    setState({ status: "closed" });
    logLine(logger, "Close request sent. Full closure requires both signatures.");
  };

  const disconnect = () => {
    yellowClient = null;
    messageSigner = null;
    currentAppSessionId = null;
    user1Addr = null;
    user2Addr = null;
    sessionNonce = 0;
    stateVersion = 0;
    setState({ status: "idle", invite: undefined, basket: undefined });
    logLine(logger, "Disconnected.");
  };

  // ========== COLLABORATIVE BASKET OPERATIONS ==========

  const getCurrentUserAddress = (): `0x${string}` => {
    if (state.role === "creator") {
      return user1Addr!;
    }
    return user2Addr!;
  };

  const submitBasketUpdate = async (newBasket: BasketState): Promise<void> => {
    if (!yellowClient || !messageSigner || !currentAppSessionId || !user1Addr || !user2Addr) {
      throw new Error("Session not active");
    }

    // Use standard allocations (only registered assets like ytest.usd)
    const allocations = [
      { participant: user1Addr, asset: "ytest.usd", amount: state.allocations?.user1 || "1.00" },
      { participant: user2Addr, asset: "ytest.usd", amount: state.allocations?.user2 || "0.00" },
    ] as RPCAppSessionAllocation[];

    // Use current version + 1 for submission
    // NOTE: We do NOT update stateVersion here - it gets updated from the asu response
    // This prevents version drift if submissions fail
    const nextVersion = stateVersion + 1;

    logLine(logger, `Submitting basket update (version ${nextVersion}, current: ${stateVersion}): ${newBasket.companies.length} companies`);

    // Store basket in session_data (this gets broadcast to other participant)
    const submitMessage = await createSubmitAppStateMessage(messageSigner, {
      app_session_id: currentAppSessionId,
      intent: RPCAppStateIntent.Operate,
      version: nextVersion,
      allocations,
      session_data: JSON.stringify(newBasket),
    });

    await yellowClient.sendMessage(submitMessage);

    // NOTE: Do NOT update stateVersion here!
    // The asu response listener will update it when the server confirms

    // Optimistically update local basket state (but not version)
    setState({ basket: newBasket });

    logLine(logger, `Basket submitted, waiting for confirmation...`);
  };

  const addCompany = async (name: string, initialStake: string): Promise<void> => {
    if (!yellowClient || !messageSigner || !currentAppSessionId) {
      throw new Error("Session not active");
    }

    const trimmedName = name.trim();
    if (!trimmedName) {
      throw new Error("Company name cannot be empty");
    }

    const stakeAmount = parseFloat(initialStake);
    if (isNaN(stakeAmount) || stakeAmount <= 0) {
      throw new Error("Initial stake must be a positive number");
    }

    const currentBasket = state.basket || { companies: [], stakes: {} };

    // Check if company already exists
    if (currentBasket.companies.includes(trimmedName)) {
      throw new Error(`Company "${trimmedName}" already exists. Use stakeInCompany to add more stake.`);
    }

    const userAddr = getCurrentUserAddress();

    // Add company and initial stake
    const newBasket: BasketState = {
      companies: [...currentBasket.companies, trimmedName],
      stakes: {
        ...currentBasket.stakes,
        [trimmedName]: {
          [userAddr]: stakeAmount.toFixed(2),
        },
      },
    };

    logLine(logger, `Adding company "${trimmedName}" with initial stake ${stakeAmount.toFixed(2)}`);
    await submitBasketUpdate(newBasket);
  };

  const stakeInCompany = async (companyName: string, amount: string): Promise<void> => {
    if (!yellowClient || !messageSigner || !currentAppSessionId) {
      throw new Error("Session not active");
    }

    const stakeAmount = parseFloat(amount);
    if (isNaN(stakeAmount) || stakeAmount <= 0) {
      throw new Error("Stake amount must be a positive number");
    }

    const currentBasket = state.basket || { companies: [], stakes: {} };

    // Check if company exists
    if (!currentBasket.companies.includes(companyName)) {
      throw new Error(`Company "${companyName}" does not exist. Use addCompany first.`);
    }

    const userAddr = getCurrentUserAddress();
    const currentStake = parseFloat(currentBasket.stakes[companyName]?.[userAddr] || "0");
    const newStake = currentStake + stakeAmount;

    // Update stakes (additive only)
    const newBasket: BasketState = {
      companies: [...currentBasket.companies],
      stakes: {
        ...currentBasket.stakes,
        [companyName]: {
          ...currentBasket.stakes[companyName],
          [userAddr]: newStake.toFixed(2),
        },
      },
    };

    logLine(logger, `Adding ${stakeAmount.toFixed(2)} stake to "${companyName}" (total: ${newStake.toFixed(2)})`);
    await submitBasketUpdate(newBasket);
  };

  const updateFormField = async (field: keyof ProjectFormFields, value: string): Promise<void> => {
    if (!yellowClient || !messageSigner || !currentAppSessionId) {
      throw new Error("Session not active");
    }

    const currentBasket = state.basket || { companies: [], stakes: {} };
    const currentFormFields = currentBasket.formFields || {
      projectName: "",
      minimumRaise: "1000",
      deadline: "",
      raiseFeePct: "0.05",
      profitFeePct: "0.01",
      withdrawAddress: "",
    };

    const newBasket: BasketState = {
      ...currentBasket,
      formFields: {
        ...currentFormFields,
        [field]: value,
      },
    };

    logLine(logger, `Updating ${field}: ${value.slice(0, 30)}${value.length > 30 ? "..." : ""}`);
    await submitBasketUpdate(newBasket);
  };

  return {
    get state() {
      return state;
    },
    createSession,
    joinWithInvite,
    transfer,
    closeSession,
    disconnect,
    addCompany,
    stakeInCompany,
    updateFormField,
  };
};

// ============================================================================
// Legacy function for backward compatibility
// ============================================================================

export type YellowSessionResult = {
  appSessionId: `0x${string}`;
  version: number;
};

export type YellowSessionOptions = {
  account: Account;
  onLog?: Logger;
};

export const runYellowMultiPartySession = async (
  options: YellowSessionOptions
): Promise<YellowSessionResult> => {
  if (!YELLOW_WALLET_2_SEED_PHRASE) {
    throw new Error("Missing VITE_WALLET_2_SEED_PHRASE");
  }

  logLine(options.onLog, "Connecting to Yellow clearnet...");
  const yellow = new Client({
    url: "wss://clearnet-sandbox.yellow.com/ws",
  });
  await yellow.connect();
  logLine(options.onLog, "Connected to Yellow clearnet.");

  // Use browser wallet transport for the connected account
  if (typeof window === "undefined" || !window.ethereum) {
    throw new Error("No wallet provider found. Please install MetaMask or another wallet.");
  }
  const walletClient = createWalletClient({
    account: options.account,
    chain: baseSepolia,
    transport: custom(window.ethereum as Parameters<typeof custom>[0]),
  });

  const wallet2Client = createWalletClient({
    account: mnemonicToAccount(YELLOW_WALLET_2_SEED_PHRASE),
    chain: baseSepolia,
    transport: http(),
  });

  logLine(options.onLog, "Authenticating wallet 1...");
  const sessionKey = await authenticateWallet(yellow, walletClient, options.onLog);
  const messageSigner = createECDSAMessageSigner(sessionKey.privateKey);

  logLine(options.onLog, "Authenticating wallet 2...");
  const sessionKey2 = await authenticateWallet(yellow, wallet2Client, options.onLog);
  const messageSigner2 = createECDSAMessageSigner(sessionKey2.privateKey);

  const userAddress = walletClient.account?.address as `0x${string}`;
  const partnerAddress = wallet2Client.account?.address as `0x${string}`;

  const appDefinition: RPCAppDefinition = {
    protocol: RPCProtocolVersion.NitroRPC_0_4,
    participants: [userAddress, partnerAddress],
    weights: [50, 50],
    quorum: 50, // Allow either party to update state
    challenge: 0,
    nonce: Date.now(),
    application: YELLOW_APPLICATION,
  };

  const allocations = [
    { participant: userAddress, asset: "ytest.usd", amount: "0.01" },
    { participant: partnerAddress, asset: "ytest.usd", amount: "0.00" },
  ] as RPCAppSessionAllocation[];

  logLine(options.onLog, "Creating app session...");
  const sessionMessage = await createAppSessionMessage(messageSigner, {
    definition: appDefinition,
    allocations,
  });

  // Add second signature
  const parsed = JSON.parse(sessionMessage) as { req: RPCData; sig: string[] };
  const sig2 = await messageSigner2(parsed.req);
  parsed.sig.push(sig2);

  logLine(options.onLog, `Session message created with both signatures`);

  const sessionResponse = (await yellow.sendMessage(JSON.stringify(parsed))) as RPCResponse;
  logLine(options.onLog, "Session message sent.");
  logLine(options.onLog, `Session response: ${JSON.stringify(sessionResponse)}`);

  const sessionParams = sessionResponse.params as { appSessionId?: `0x${string}` } | undefined;
  const appSessionId = sessionParams?.appSessionId;
  if (!appSessionId) {
    throw new Error("Missing appSessionId from create session response");
  }

  logLine(options.onLog, `App session created: ${appSessionId}`);

  const finalAllocations = [
    { participant: userAddress, asset: "ytest.usd", amount: "0.00" },
    { participant: partnerAddress, asset: "ytest.usd", amount: "0.01" },
  ] as RPCAppSessionAllocation[];

  logLine(options.onLog, "Submitting app state update...");
  const submitAppStateMessage = await createSubmitAppStateMessage(messageSigner, {
    app_session_id: appSessionId,
    allocations: finalAllocations,
  });

  await yellow.sendMessage(submitAppStateMessage);
  logLine(options.onLog, "App state updated.");

  logLine(options.onLog, "Preparing close session message...");
  const closeSessionMessage = await createCloseAppSessionMessage(messageSigner, {
    app_session_id: appSessionId,
    allocations: finalAllocations,
  });

  const closeSessionMessageJson = JSON.parse(closeSessionMessage) as {
    req: RPCData;
    sig: string[];
  };

  const signedCloseSessionMessageSignature2 = await messageSigner2(
    closeSessionMessageJson.req
  );

  closeSessionMessageJson.sig.push(signedCloseSessionMessageSignature2);

  logLine(options.onLog, "Sending close session message...");
  const closeSessionResponse = await yellow.sendMessage(
    JSON.stringify(closeSessionMessageJson)
  );
  logLine(options.onLog, `Close session response: ${JSON.stringify(closeSessionResponse)}`);

  logLine(options.onLog, "Session closed.");

  return { appSessionId, version: 1 };
};
