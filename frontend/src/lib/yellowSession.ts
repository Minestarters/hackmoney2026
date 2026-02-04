/**
 * Multi-Party Application Session
 * Based on: https://github.com/stevenzeiler/yellow-sdk-tutorials/blob/main/scripts/app_sessions/app_session_two_signers.ts
 */

import {
  createAppSessionMessage,
  createAuthRequestMessage,
  createAuthVerifyMessageFromChallenge,
  createCloseAppSessionMessage,
  createECDSAMessageSigner,
  createEIP712AuthMessageSigner,
  createSubmitAppStateMessage,
  RPCMethod,
  RPCProtocolVersion,
  type RPCAppDefinition,
  type RPCAppSessionAllocation,
  type RPCData,
  type RPCResponse,
} from "@erc7824/nitrolite";
import { Wallet } from "ethers";
import { Client } from "yellow-ts";
import { createWalletClient, http, type WalletClient } from "viem";
import { mnemonicToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import {
  YELLOW_APPLICATION,
  YELLOW_SCOPE,
  YELLOW_SESSION_EXPIRES_MS,
  YELLOW_WALLET_1_SEED_PHRASE,
  YELLOW_WALLET_2_SEED_PHRASE,
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

  const allowances = [{ asset: "ytest.usd", amount: "0.01" }];

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

  // ============================================================================
  // STEP 1: Connect to Yellow Network (Sandbox for testing)
  // ============================================================================
  logLine(options.onLog, "Connecting to Yellow clearnet...");
  const yellow = new Client({
    url: "wss://clearnet-sandbox.yellow.com/ws",
  });
  await yellow.connect();
  logLine(options.onLog, "Connected to Yellow clearnet.");

  // ============================================================================
  // STEP 2: Set Up Both Participants' Wallets
  // ============================================================================
  const walletClient = createWalletClient({
    account: mnemonicToAccount(YELLOW_WALLET_1_SEED_PHRASE),
    chain: baseSepolia,
    transport: http(),
  });

  const wallet2Client = createWalletClient({
    account: mnemonicToAccount(YELLOW_WALLET_2_SEED_PHRASE),
    chain: baseSepolia,
    transport: http(),
  });

  // ============================================================================
  // STEP 3: Authenticate Both Participants
  // ============================================================================
  logLine(options.onLog, "Authenticating wallet 1...");
  const sessionKey = await authenticateWallet(yellow, walletClient, options.onLog);
  const messageSigner = createECDSAMessageSigner(sessionKey.privateKey);

  logLine(options.onLog, "Authenticating wallet 2...");
  const sessionKey2 = await authenticateWallet(yellow, wallet2Client, options.onLog);
  const messageSigner2 = createECDSAMessageSigner(sessionKey2.privateKey);

  const userAddress = walletClient.account?.address as `0x${string}`;
  const partnerAddress = wallet2Client.account?.address as `0x${string}`;

  // ============================================================================
  // STEP 4: Define Application Configuration
  // ============================================================================
  const appDefinition: RPCAppDefinition = {
    protocol: RPCProtocolVersion.NitroRPC_0_4,
    participants: [userAddress, partnerAddress],
    weights: [50, 50],
    quorum: 100,
    challenge: 0,
    nonce: Date.now(),
    application: YELLOW_APPLICATION,
  };

  // ============================================================================
  // STEP 5: Set Initial Allocations
  // ============================================================================
  const allocations = [
    { participant: userAddress, asset: "ytest.usd", amount: "0.01" },
    { participant: partnerAddress, asset: "ytest.usd", amount: "0.00" },
  ] as RPCAppSessionAllocation[];

  // ============================================================================
  // STEP 6: Create and Submit App Session
  // ============================================================================
  logLine(options.onLog, "Creating app session...");
  const sessionMessage = await createAppSessionMessage(messageSigner, {
    definition: appDefinition,
    allocations,
  });

  logLine(options.onLog, `Session message created: ${sessionMessage}`);

  const sessionResponse = (await yellow.sendMessage(sessionMessage)) as RPCResponse;
  logLine(options.onLog, "Session message sent.");
  logLine(options.onLog, `Session response: ${JSON.stringify(sessionResponse)}`);

  const sessionParams = sessionResponse.params as { appSessionId?: `0x${string}` } | undefined;
  const appSessionId = sessionParams?.appSessionId;
  if (!appSessionId) {
    throw new Error("Missing appSessionId from create session response");
  }

  logLine(options.onLog, `App session created: ${appSessionId}`);

  // ============================================================================
  // STEP 7: Update Session State (Transfer Between Participants)
  // ============================================================================
  const finalAllocations = [
    { participant: userAddress, asset: "ytest.usd", amount: "0.00" },
    { participant: partnerAddress, asset: "ytest.usd", amount: "0.01" },
  ] as RPCAppSessionAllocation[];

  logLine(options.onLog, "Submitting app state update...");
  const submitAppStateMessage = await createSubmitAppStateMessage(messageSigner, {
    app_session_id: appSessionId,
    allocations: finalAllocations,
  });

  const submitAppStateMessageJson = JSON.parse(submitAppStateMessage);
  logLine(options.onLog, `Submit app state message: ${JSON.stringify(submitAppStateMessageJson)}`);

  // ============================================================================
  // STEP 8: Close Session with Multi-Party Signatures
  // ============================================================================
  logLine(options.onLog, "Preparing close session message...");
  const closeSessionMessage = await createCloseAppSessionMessage(messageSigner, {
    app_session_id: appSessionId,
    allocations: finalAllocations,
  });

  const closeSessionMessageJson = JSON.parse(closeSessionMessage) as {
    req: RPCData;
    sig: string[];
  };

  // ============================================================================
  // STEP 9: Collect Second Participant's Signature
  // ============================================================================
  const signedCloseSessionMessageSignature2 = await messageSigner2(
    closeSessionMessageJson.req
  );

  logLine(options.onLog, `Wallet 2 signed close session message: ${signedCloseSessionMessageSignature2}`);

  closeSessionMessageJson.sig.push(signedCloseSessionMessageSignature2);

  logLine(options.onLog, `Close session message (with all signatures): ${JSON.stringify(closeSessionMessageJson)}`);

  // ============================================================================
  // STEP 10: Submit Close Request
  // ============================================================================
  logLine(options.onLog, "Sending close session message...");
  const closeSessionResponse = await yellow.sendMessage(
    JSON.stringify(closeSessionMessageJson)
  );
  logLine(options.onLog, "Close session message sent.");
  logLine(options.onLog, `Close session response: ${JSON.stringify(closeSessionResponse)}`);

  logLine(options.onLog, "Session closed.");

  yellow.listen((message: RPCResponse) => {
    logLine(options.onLog, `Yellow message: ${JSON.stringify(message)}`);
  });

  return { appSessionId, version: 1 };
};
