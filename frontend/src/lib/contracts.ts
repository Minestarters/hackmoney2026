import { Contract } from "ethers";
import type { BrowserProvider, JsonRpcProvider, Signer } from "ethers";
import { FACTORY_ADDRESS, START_BLOCK, USDC_ADDRESS } from "../config";
import {
  basketVaultAbi,
  erc20Abi,
  minestartersFactoryAbi,
} from "../contracts/abis";
import type { ProjectInfo, UserPosition } from "../types";

type Connection = BrowserProvider | JsonRpcProvider | Signer;

export const getFactory = (provider: Connection) =>
  new Contract(FACTORY_ADDRESS, minestartersFactoryAbi, provider);

export const getVault = (address: string, provider: Connection) =>
  new Contract(address, basketVaultAbi, provider);

export const getUsdc = (provider: Connection) =>
  new Contract(USDC_ADDRESS, erc20Abi, provider);

const normalizeWeights = (weights: bigint[]) => weights.map((w) => Number(w));

export const fetchProjectInfo = async (
  address: string,
  provider: BrowserProvider | JsonRpcProvider
): Promise<ProjectInfo> => {
  const vault = getVault(address, provider);
  const info = await vault.getProjectInfo();
  let accruedRaiseFees: bigint = 0n;
  try {
    accruedRaiseFees = await vault.accruedRaiseFees();
  } catch {
    // older ABI; fall back to zero if method not present
  }
  let withdrawnTotal = 0n;
  let hasWithdrawnValue = false;
  try {
    const withdrawnResult = await vault.withdrawnPrincipal?.();
    if (withdrawnResult != null) {
      withdrawnTotal =
        typeof withdrawnResult === "bigint" ? withdrawnResult : BigInt(withdrawnResult);
      hasWithdrawnValue = true;
    }
  } catch {
    // method may not exist on older deployments
  }
  let withdrawable = 0n;
  let withdrawableFees = accruedRaiseFees;
  try {
    const withdrawableResult = await vault.withdrawableFunds();
    if (typeof withdrawableResult === "bigint") {
      withdrawable = withdrawableResult;
    } else {
      const asObj = withdrawableResult as any;
      const legacyValue = asObj?.principal ?? asObj?.[0];
      const feeValue = asObj?.fees ?? asObj?.[1];
      withdrawable = legacyValue != null ? BigInt(legacyValue) : 0n;
      if (feeValue != null) {
        withdrawableFees = BigInt(feeValue);
      }
    }
  } catch {
    const raised = info.raised as bigint;
    if (hasWithdrawnValue) {
      const available = raised > withdrawnTotal ? raised - withdrawnTotal : 0n;
      withdrawable = available > accruedRaiseFees ? available - accruedRaiseFees : 0n;
      withdrawableFees = available > accruedRaiseFees ? accruedRaiseFees : available;
    } else {
      const minimumRaise = info.minRaise as bigint;
      if (raised >= minimumRaise) {
        withdrawable = raised > accruedRaiseFees ? raised - accruedRaiseFees : 0n;
        withdrawableFees = raised > accruedRaiseFees ? accruedRaiseFees : raised;
      }
    }
  }

  return {
    address,
    name: info.projectName,
    companyNames: info.companies,
    companyWeights: normalizeWeights(info.weights),
    shareToken: info.shareTokenAddress,
    creator: info.projectCreator,
    withdrawAddress: info.projectWithdrawAddress,
    minimumRaise: info.minRaise,
    deadline: info.projectDeadline,
    raiseFeeBps: Number(info.raiseFee),
    profitFeeBps: Number(info.profitFee),
    totalRaised: info.raised,
    accruedRaiseFees,
    totalProfit: info.profit,
    totalRaiseFeesPaid: info.raiseFeesPaid ?? 0n,
    totalProfitFeesPaid: info.profitFeesPaid ?? 0n,
    profitPerShare: info.currentProfitPerShare,
    finalized: info.isFinalized,
    withdrawable,
    withdrawableFees,
    withdrawnTotal,
    stage: Number(info.stage) as ProjectInfo["stage"],
  };
};

const normalizeAddress = (address: string) => address.trim().toLowerCase();

// Generic helper to fetch events in chunks
const fetchEventsInChunks = async (
  vault: Contract,
  eventName: string,
  provider: BrowserProvider | JsonRpcProvider,
  chunkSize = 10000
) => {
  const fromBlock = START_BLOCK;
  const currentBlock = await provider.getBlockNumber();
  const allEvents = [];

  for (let start = fromBlock; start <= currentBlock; start += chunkSize) {
    const end = Math.min(start + chunkSize - 1, currentBlock);
    const events = await vault.queryFilter(eventName, start, end);
    allEvents.push(...events);
  }

  return allEvents;
};

export const fetchSupporterCount = async (
  projectAddress: string,
  provider: BrowserProvider | JsonRpcProvider
): Promise<number> => {
  const vault = getVault(projectAddress, provider);
  const events = await fetchEventsInChunks(vault, "Deposited", provider);

  const uniqueDepositors = new Set<string>();
  for (const event of events) {
    const user = (event as any)?.args?.user as string | undefined;
    if (user) uniqueDepositors.add(normalizeAddress(user));
  }

  return uniqueDepositors.size;
};

export const fetchTotalClaimed = async (
  projectAddress: string,
  provider: BrowserProvider | JsonRpcProvider
): Promise<bigint> => {
  const vault = getVault(projectAddress, provider);
  const events = await fetchEventsInChunks(vault, "ProfitClaimed", provider);

  return events.reduce((sum, event) => {
    const amount = (event as any)?.args?.amount as bigint | undefined;
    return amount != null ? sum + BigInt(amount) : sum;
  }, 0n);
};

export const fetchUserPosition = async (
  project: ProjectInfo,
  user: string,
  provider: BrowserProvider | JsonRpcProvider
): Promise<UserPosition> => {
  const vault = getVault(project.address, provider);
  const [userInfo, pending] = await Promise.all([
    vault.getUserInfo(user),
    vault.pendingProfit(user),
  ]);
  const shareToken = new Contract(project.shareToken, erc20Abi, provider);
  const [usdcBalance, shareBalance] = await Promise.all([
    getUsdc(provider).balanceOf(user),
    shareToken.balanceOf(user),
  ]);

  return {
    shares: userInfo.shares,
    claimed: userInfo.totalClaimed,
    pending,
    usdcBalance,
    shareBalance,
  };
};

// TODO: switch to indexer
export const fetchProjectAddresses = async (
  provider: BrowserProvider | JsonRpcProvider
): Promise<string[]> => {
  const factory = getFactory(provider);

  try {
    return await factory.getAllProjects();
  } catch {
    const count: bigint = await factory.getProjectCount();
    const addresses: string[] = [];
    for (let i = 0n; i < count; i++) {
      const addr = await factory.getProjectAt(i);
      addresses.push(addr);
    }
    return addresses;
  }
};
