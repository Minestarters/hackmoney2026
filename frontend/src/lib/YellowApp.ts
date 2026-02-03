import {
  createAppSessionMessage,
  createApplicationMessage,
  createAuthRequestMessage,
  createAuthVerifyMessageFromChallenge,
  createECDSAMessageSigner,
  createGetAppDefinitionMessage,
  createGetAppSessionsMessage,
  createSubmitAppStateMessage,
  parseAnyRPCResponse,
  RPCAppStateIntent,
  RPCMethod,
  type MessageSigner,
  type RPCAppDefinition,
  type RPCAppSessionAllocation,
  type RPCResponse,
} from '@erc7824/nitrolite';
import { Wallet } from 'ethers';
import type { JsonRpcSigner } from 'ethers';
import type { Address, Hex } from 'viem';
import {
  YELLOW_APPLICATION,
  YELLOW_ASSET,
  YELLOW_PROTOCOL,
  YELLOW_SCOPE,
  YELLOW_SESSION_EXPIRES_MS,
  YELLOW_WS_URL,
} from '../config';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type YellowConnectionStatus = 'disconnected' | 'connecting' | 'connected';
export type YellowAuthStatus = 'unauthenticated' | 'authenticating' | 'authenticated';

export interface YellowSessionInfo {
  appSessionId: string;
  protocol: string;
  participants: string[];
  status: string;
  version: number;
  sessionData?: string;
}

interface SessionKey {
  privateKey: Hex;
  address: Address;
}

export interface YellowAppEvents {
  onConnectionChange?: (status: YellowConnectionStatus) => void;
  onAuthChange?: (status: YellowAuthStatus) => void;
  onSessionCreated?: (sessionId: Hex, version: number) => void;
  onSessionsReceived?: (sessions: YellowSessionInfo[]) => void;
  onSessionDefinition?: (participants: string[]) => void;
  onSessionUpdate?: (sessionData: string, version: number) => void;
  onMessage?: (params: unknown) => void;
  onError?: (error: string) => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Session Key Storage
// ─────────────────────────────────────────────────────────────────────────────

const SESSION_KEY_STORAGE = 'minestarters_yellow_session_key';

function getOrCreateSessionKey(): SessionKey {
  const stored = window.localStorage.getItem(SESSION_KEY_STORAGE);
  if (stored) {
    try {
      const parsed = JSON.parse(stored) as SessionKey;
      if (parsed?.privateKey && parsed?.address) {
        return parsed;
      }
    } catch {
      // ignore
    }
  }
  const wallet = Wallet.createRandom();
  const sessionKey: SessionKey = {
    privateKey: wallet.privateKey as Hex,
    address: wallet.address as Address,
  };
  window.localStorage.setItem(SESSION_KEY_STORAGE, JSON.stringify(sessionKey));
  return sessionKey;
}

// ─────────────────────────────────────────────────────────────────────────────
// YellowApp Class
// ─────────────────────────────────────────────────────────────────────────────

export class YellowApp {
  private ws: WebSocket | null = null;
  private account: Address;
  private sessionKey: SessionKey;
  private sessionSigner: MessageSigner;
  private events: YellowAppEvents;

  private _connectionStatus: YellowConnectionStatus = 'disconnected';
  private _authStatus: YellowAuthStatus = 'unauthenticated';
  private _authInFlight = false;

  private currentSessionId: Hex | null = null;
  private appStateVersion = 0;

  constructor(account: Address, _signer: JsonRpcSigner, events: YellowAppEvents = {}) {
    this.account = account;
    this.events = events;
    this.sessionKey = getOrCreateSessionKey();
    this.sessionSigner = createECDSAMessageSigner(this.sessionKey.privateKey);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Getters
  // ───────────────────────────────────────────────────────────────────────────

  get connectionStatus(): YellowConnectionStatus {
    return this._connectionStatus;
  }

  get authStatus(): YellowAuthStatus {
    return this._authStatus;
  }

  get isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  get isAuthenticated(): boolean {
    return this._authStatus === 'authenticated';
  }

  get sessionId(): Hex | null {
    return this.currentSessionId;
  }

  get stateVersion(): number {
    return this.appStateVersion;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Connection Management
  // ───────────────────────────────────────────────────────────────────────────

  connect(): void {
    if (this.ws) {
      this.ws.close();
    }

    this.setConnectionStatus('connecting');
    this.ws = new WebSocket(YELLOW_WS_URL);

    this.ws.onopen = () => {
      this.setConnectionStatus('connected');
      void this.authenticate();
    };

    this.ws.onclose = () => {
      this.setConnectionStatus('disconnected');
      this.setAuthStatus('unauthenticated');
    };

    this.ws.onerror = () => {
      this.events.onError?.('Yellow connection failed');
      this.setConnectionStatus('disconnected');
    };

    this.ws.onmessage = (event) => {
      this.handleMessage(event.data as string);
    };
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.setConnectionStatus('disconnected');
    this.setAuthStatus('unauthenticated');
    this.currentSessionId = null;
    this.appStateVersion = 0;
  }

  private setConnectionStatus(status: YellowConnectionStatus): void {
    this._connectionStatus = status;
    this.events.onConnectionChange?.(status);
  }

  private setAuthStatus(status: YellowAuthStatus): void {
    this._authStatus = status;
    this.events.onAuthChange?.(status);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Authentication
  // ───────────────────────────────────────────────────────────────────────────

  private async authenticate(challengeMessage?: string): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    if (this._authStatus === 'authenticated') return;
    if (this._authInFlight) return;

    this._authInFlight = true;
    this.setAuthStatus('authenticating');

    const expiresAtSeconds = BigInt(
      Math.floor((Date.now() + YELLOW_SESSION_EXPIRES_MS) / 1000)
    );
    const allowances: { asset: string; amount: string }[] = [];

    if (!challengeMessage) {
      const authRequest = await createAuthRequestMessage({
        address: this.account,
        session_key: this.sessionKey.address,
        application: YELLOW_APPLICATION,
        allowances,
        expires_at: expiresAtSeconds,
        scope: YELLOW_SCOPE,
      });
      this.ws.send(authRequest);
    } else {
      const verifyMessage = await createAuthVerifyMessageFromChallenge(
        this.sessionSigner,
        challengeMessage
      );
      this.ws.send(verifyMessage);
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Session Management
  // ───────────────────────────────────────────────────────────────────────────

  async createSession(
    participants: Address[],
    nonce: number,
    initialData?: unknown
  ): Promise<void> {
    if (!this.isConnected || !this.isAuthenticated) {
      throw new Error('Not connected or authenticated');
    }

    const weightBase = Math.floor(100 / participants.length);
    const weights = participants.map(() => weightBase);
    const remainder = 100 - weightBase * participants.length;
    if (remainder > 0) {
      weights[weights.length - 1] += remainder;
    }

    const appDefinition: RPCAppDefinition = {
      application: YELLOW_APPLICATION,
      protocol: YELLOW_PROTOCOL as RPCAppDefinition['protocol'],
      participants,
      weights,
      quorum: 100,
      challenge: 0,
      nonce,
    };

    const allocations: RPCAppSessionAllocation[] = participants.map((participant) => ({
      participant,
      asset: YELLOW_ASSET,
      amount: '0',
    }));

    const sessionMessage = await createAppSessionMessage(this.sessionSigner, {
      definition: appDefinition,
      allocations,
      session_data: initialData ? JSON.stringify(initialData) : undefined,
    });

    this.ws!.send(sessionMessage);
    this.appStateVersion = 0;
  }

  async refreshSessions(): Promise<void> {
    if (!this.isConnected || !this.isAuthenticated) {
      throw new Error('Not connected or authenticated');
    }

    const request = await createGetAppSessionsMessage(this.sessionSigner, this.account);
    this.ws!.send(request);
  }

  async joinSession(session: YellowSessionInfo): Promise<void> {
    this.currentSessionId = session.appSessionId as Hex;
    this.appStateVersion = session.version ?? 0;

    if (this.isConnected) {
      const request = await createGetAppDefinitionMessage(
        this.sessionSigner,
        session.appSessionId as Hex
      );
      this.ws!.send(request);
    }

    if (session.sessionData) {
      this.events.onSessionUpdate?.(session.sessionData, session.version);
    }
  }

  async submitState(
    participants: Address[],
    sessionData: unknown
  ): Promise<void> {
    if (!this.isConnected || !this.isAuthenticated || !this.currentSessionId) {
      return;
    }

    const allocations: RPCAppSessionAllocation[] = participants.map((participant) => ({
      participant,
      asset: YELLOW_ASSET,
      amount: '0',
    }));

    const nextVersion = this.appStateVersion + 1;
    const message = await createSubmitAppStateMessage(this.sessionSigner, {
      app_session_id: this.currentSessionId,
      intent: RPCAppStateIntent.Operate,
      version: nextVersion,
      allocations,
      session_data: JSON.stringify(sessionData),
    });

    this.ws!.send(message);
    this.appStateVersion = nextVersion;
  }

  async sendApplicationMessage(payload: unknown): Promise<void> {
    if (!this.isConnected || !this.isAuthenticated || !this.currentSessionId) {
      return;
    }

    const message = await createApplicationMessage(
      this.sessionSigner,
      this.currentSessionId,
      payload
    );
    this.ws!.send(message);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Message Handling
  // ───────────────────────────────────────────────────────────────────────────

  private handleMessage(raw: string): void {
    let parsed: RPCResponse | null = null;
    try {
      parsed = parseAnyRPCResponse(raw);
    } catch {
      try {
        parsed = JSON.parse(raw);
      } catch {
        return;
      }
    }

    if (!parsed) return;

    // Handle AppSessionUpdate separately since it's not in the typed RPCResponse union
    const rawParsed = parsed as unknown as {
      method: string;
      params?: { sessionData?: string; version?: number };
    };
    if (rawParsed.method === 'asu') {
      if (rawParsed.params?.sessionData) {
        if (typeof rawParsed.params?.version === 'number') {
          this.appStateVersion = rawParsed.params.version;
        }
        this.events.onSessionUpdate?.(rawParsed.params.sessionData, this.appStateVersion);
      }
      return;
    }

    switch (parsed.method) {
      case RPCMethod.CreateAppSession: {
        const info = parsed.params;
        if (info?.appSessionId) {
          this.currentSessionId = info.appSessionId;
          this.appStateVersion = info.version ?? 0;
          this.events.onSessionCreated?.(info.appSessionId, info.version ?? 0);
        }
        break;
      }

      case RPCMethod.AuthChallenge: {
        const challenge = parsed.params?.challengeMessage;
        if (challenge) {
          this._authInFlight = false;
          void this.authenticate(challenge);
        }
        break;
      }

      case RPCMethod.AuthVerify: {
        this._authInFlight = false;
        if (parsed.params?.success) {
          this.setAuthStatus('authenticated');
        } else {
          this.setAuthStatus('unauthenticated');
          this.events.onError?.('Yellow auth failed');
        }
        break;
      }

      case RPCMethod.Error: {
        const errorText = parsed.params?.error || 'Yellow error';
        this.events.onError?.(errorText);
        if (errorText.toLowerCase().includes('authentication')) {
          this.setAuthStatus('unauthenticated');
          this._authInFlight = false;
          void this.authenticate();
        }
        break;
      }

      case RPCMethod.GetAppSessions: {
        const sessions = (parsed.params?.appSessions || []) as YellowSessionInfo[];
        const filtered = sessions.filter((session) => session.protocol === YELLOW_PROTOCOL);
        this.events.onSessionsReceived?.(filtered);
        break;
      }

      case RPCMethod.GetAppDefinition: {
        const definition = parsed.params;
        if (definition?.participants) {
          this.events.onSessionDefinition?.(definition.participants);
        }
        break;
      }

      case RPCMethod.Message: {
        this.events.onMessage?.(parsed.params);
        break;
      }

      default: {
        // Check for untyped message-like payloads
        const p = parsed as unknown as Record<string, unknown>;
        if (p?.type || p?.data) {
          this.events.onMessage?.(p);
        }
        break;
      }
    }
  }
}
