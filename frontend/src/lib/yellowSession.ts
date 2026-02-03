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
import { Wallet } from "ethers";
import { Client } from "yellow-ts";
import { createWalletClient, http, type WalletClient } from "viem";
import { mnemonicToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import {
  YELLOW_APPLICATION,
  YELLOW_SCOPE,
  YELLOW_SESSION_EXPIRES_MS,
  YELLOW_WALLET_1_SEED_PHRASE,
  YELLOW_WALLET_2_SEED_PHRASE,
  YELLOW_WS_URL,
} from "../config";

type Logger = (line: string) => void;

type SessionKey = {
  privateKey: `0x${string}`;
  address: `0x${string}`;
};

const logLine = (logger: Logger | undefined, line: string) => {
  if (logger) {
    logger(line);
  }
  console.log(line);
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
  const sessionKeyWallet = Wallet.createRandom();
  const sessionKey: SessionKey = {
    privateKey: sessionKeyWallet.privateKey as `0x${string}`,
    address: sessionKeyWallet.address as `0x${string}`,
  };

  const address = walletClient.account?.address as `0x${string}`;
  const expiresAtSeconds = BigInt(
    Math.floor((Date.now() + YELLOW_SESSION_EXPIRES_MS) / 1000)
  );

  const allowances = [{ asset: "usdc", amount: "0.01" }];

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
  const challengeMessage = challenge.params?.challengeMessage;
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
  if (!verify.params?.success) {
    throw new Error("Yellow auth failed");
  }

  logLine(logger, `Auth verified for ${address}`);
  return sessionKey;
};

export type YellowSessionResult = {
  appSessionId: `0x${string}`;
  version: number;
};

export type YellowSessionOptions = {
  onLog?: Logger;
};

export const runYellowMultiPartySession = async (
  options: YellowSessionOptions = {}
): Promise<YellowSessionResult> => {
  if (!YELLOW_WALLET_1_SEED_PHRASE || !YELLOW_WALLET_2_SEED_PHRASE) {
    throw new Error("Missing VITE_WALLET_1_SEED_PHRASE or VITE_WALLET_2_SEED_PHRASE");
  }

  logLine(options.onLog, "Connecting to Yellow clearnet...");
  const yellow = new Client({ url: YELLOW_WS_URL });
  await yellow.connect();
  logLine(options.onLog, "Connected to Yellow clearnet.");

  const walletClient = createWalletClient({
    account: mnemonicToAccount(YELLOW_WALLET_1_SEED_PHRASE),
    chain: sepolia,
    transport: http(),
  });

  const wallet2Client = createWalletClient({
    account: mnemonicToAccount(YELLOW_WALLET_2_SEED_PHRASE),
    chain: sepolia,
    transport: http(),
  });

  logLine(options.onLog, "Authenticating wallet 1...");
  const sessionKey = await authenticateWallet(yellow, walletClient, options.onLog);
  const messageSigner: MessageSigner = createECDSAMessageSigner(sessionKey.privateKey);

  logLine(options.onLog, "Authenticating wallet 2...");
  const sessionKey2 = await authenticateWallet(yellow, wallet2Client, options.onLog);
  const messageSigner2: MessageSigner = createECDSAMessageSigner(sessionKey2.privateKey);

  const userAddress = walletClient.account?.address as `0x${string}`;
  const partnerAddress = wallet2Client.account?.address as `0x${string}`;

  const appDefinition: RPCAppDefinition = {
    protocol: RPCProtocolVersion.NitroRPC_0_4,
    participants: [userAddress, partnerAddress],
    weights: [50, 50],
    quorum: 100,
    challenge: 0,
    nonce: Date.now(),
    application: YELLOW_APPLICATION,
  };

  const allocations: RPCAppSessionAllocation[] = [
    { participant: userAddress, asset: "usdc", amount: "0.01" },
    { participant: partnerAddress, asset: "usdc", amount: "0.00" },
  ];

  logLine(options.onLog, "Creating app session...");
  const sessionMessage = await createAppSessionMessage(messageSigner, {
    definition: appDefinition,
    allocations,
  });

  const sessionResponse = (await yellow.sendMessage(sessionMessage)) as RPCResponse | void;
  if (sessionResponse) {
    logLine(options.onLog, `Create session response: ${JSON.stringify(sessionResponse)}`);
    if (sessionResponse.method === RPCMethod.Error) {
      throw new Error(sessionResponse.params?.error || "Create session failed");
    }
  }

  const resolvedResponse =
    sessionResponse?.method === RPCMethod.CreateAppSession
      ? sessionResponse
      : await waitForResponse(yellow, RPCMethod.CreateAppSession);

  const appSessionId = resolvedResponse?.params?.appSessionId as
    | `0x${string}`
    | undefined;
  const baseVersion = (resolvedResponse?.params?.version ?? 0) as number;

  if (!appSessionId) {
    throw new Error("Missing appSessionId from create session response");
  }

  logLine(options.onLog, `App session created: ${appSessionId}`);

  const finalAllocations: RPCAppSessionAllocation[] = [
    { participant: userAddress, asset: "usdc", amount: "0.00" },
    { participant: partnerAddress, asset: "usdc", amount: "0.01" },
  ];

  logLine(options.onLog, "Submitting app state update...");
  const submitAppStateMessage = await createSubmitAppStateMessage(messageSigner, {
    app_session_id: appSessionId,
    intent: RPCAppStateIntent.Operate,
    version: baseVersion + 1,
    allocations: finalAllocations,
  });

  await yellow.sendMessage(submitAppStateMessage);
  logLine(options.onLog, "App state update submitted.");

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
  await yellow.sendMessage(JSON.stringify(closeSessionMessageJson));

  logLine(options.onLog, "Session closed.");

  yellow.listen((message: RPCResponse) => {
    logLine(options.onLog, `Yellow message: ${JSON.stringify(message)}`);
  });

  return { appSessionId, version: baseVersion + 1 };
};
