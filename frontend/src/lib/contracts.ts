import { getContract } from "viem";
import { FACTORY_ADDRESS, START_BLOCK, USDC_ADDRESS } from "../config";
import {
  basketVaultAbi,
  erc20Abi,
  minestartersFactoryAbi,
} from "../contracts/abis";
import { publicClient, type WalletClientWithAccount } from "./wagmi";
import type { ProjectInfo, UserPosition } from "../types";

// Read-only contract getters (use publicClient)
export const getVaultRead = (address: `0x${string}`) =>
  getContract({
    address,
    abi: basketVaultAbi,
    client: publicClient,
  });

export const getUsdcRead = () =>
  getContract({
    address: USDC_ADDRESS as `0x${string}`,
    abi: erc20Abi,
    client: publicClient,
  });

export const getFactoryRead = () =>
  getContract({
    address: FACTORY_ADDRESS as `0x${string}`,
    abi: minestartersFactoryAbi,
    client: publicClient,
  });

// Write helpers using writeContract directly
export const writeFactory = {
  createProject: async (
    walletClient: WalletClientWithAccount,
    args: {
      projectName: string;
      companyNames: string[];
      companyWeights: bigint[];
      minimumRaise: bigint;
      deadline: bigint;
      withdrawAddress: `0x${string}`;
      raiseFeeBps: bigint;
      profitFeeBps: bigint;
    }
  ) => {
    return walletClient.writeContract({
      address: FACTORY_ADDRESS as `0x${string}`,
      abi: minestartersFactoryAbi,
      functionName: "createProject",
      args: [
        args.projectName,
        args.companyNames,
        args.companyWeights,
        args.minimumRaise,
        args.deadline,
        args.withdrawAddress,
        args.raiseFeeBps,
        args.profitFeeBps,
      ],
    });
  },
};

export const writeVault = {
  deposit: async (walletClient: WalletClientWithAccount, vaultAddress: `0x${string}`, amount: bigint) => {
    return walletClient.writeContract({
      address: vaultAddress,
      abi: basketVaultAbi,
      functionName: "deposit",
      args: [amount],
    });
  },
  claimProfit: async (walletClient: WalletClientWithAccount, vaultAddress: `0x${string}`) => {
    return walletClient.writeContract({
      address: vaultAddress,
      abi: basketVaultAbi,
      functionName: "claimProfit",
    });
  },
  refund: async (walletClient: WalletClientWithAccount, vaultAddress: `0x${string}`) => {
    return walletClient.writeContract({
      address: vaultAddress,
      abi: basketVaultAbi,
      functionName: "refund",
    });
  },
  withdrawRaisedFunds: async (walletClient: WalletClientWithAccount, vaultAddress: `0x${string}`) => {
    return walletClient.writeContract({
      address: vaultAddress,
      abi: basketVaultAbi,
      functionName: "withdrawRaisedFunds",
    });
  },
  depositProfit: async (walletClient: WalletClientWithAccount, vaultAddress: `0x${string}`, amount: bigint) => {
    return walletClient.writeContract({
      address: vaultAddress,
      abi: basketVaultAbi,
      functionName: "depositProfit",
      args: [amount],
    });
  },
};

export const writeUsdc = {
  approve: async (walletClient: WalletClientWithAccount, spender: `0x${string}`, amount: bigint) => {
    return walletClient.writeContract({
      address: USDC_ADDRESS as `0x${string}`,
      abi: erc20Abi,
      functionName: "approve",
      args: [spender, amount],
    });
  },
  mint: async (walletClient: WalletClientWithAccount, to: `0x${string}`, amount: bigint) => {
    return walletClient.writeContract({
      address: USDC_ADDRESS as `0x${string}`,
      abi: erc20Abi,
      functionName: "mint",
      args: [to, amount],
    });
  },
};

const normalizeWeights = (weights: readonly bigint[]) => weights.map((w) => Number(w));

export const fetchProjectInfo = async (
  address: `0x${string}`
): Promise<ProjectInfo> => {
  const vault = getVaultRead(address);
  const info = await vault.read.getProjectInfo();
  
  let accruedRaiseFees: bigint = 0n;
  try {
    accruedRaiseFees = await vault.read.accruedRaiseFees();
  } catch {
    // older ABI; fall back to zero if method not present
  }
  
  let withdrawnTotal = 0n;
  let hasWithdrawnValue = false;
  try {
    const withdrawnResult = await vault.read.withdrawnPrincipal();
    if (withdrawnResult != null) {
      withdrawnTotal = withdrawnResult;
      hasWithdrawnValue = true;
    }
  } catch {
    // method may not exist on older deployments
  }
  
  let withdrawable = 0n;
  let withdrawableFees = accruedRaiseFees;
  try {
    const [principal, fees] = await vault.read.withdrawableFunds();
    withdrawable = principal;
    withdrawableFees = fees;
  } catch {
    const raised = info[10]; // raised
    if (hasWithdrawnValue) {
      const available = raised > withdrawnTotal ? raised - withdrawnTotal : 0n;
      withdrawable = available > accruedRaiseFees ? available - accruedRaiseFees : 0n;
      withdrawableFees = available > accruedRaiseFees ? accruedRaiseFees : available;
    } else {
      const minimumRaise = info[6]; // minRaise
      if (raised >= minimumRaise) {
        withdrawable = raised > accruedRaiseFees ? raised - accruedRaiseFees : 0n;
        withdrawableFees = raised > accruedRaiseFees ? accruedRaiseFees : raised;
      }
    }
  }

  return {
    address,
    name: info[0], // projectName
    companyNames: [...info[1]], // companies
    companyWeights: normalizeWeights(info[2]), // weights
    shareToken: info[3], // shareTokenAddress
    creator: info[4], // projectCreator
    withdrawAddress: info[5], // projectWithdrawAddress
    minimumRaise: info[6], // minRaise
    deadline: info[7], // projectDeadline
    raiseFeeBps: Number(info[8]), // raiseFee
    profitFeeBps: Number(info[9]), // profitFee
    totalRaised: info[10], // raised
    accruedRaiseFees,
    totalProfit: info[11], // profit
    totalRaiseFeesPaid: info[12] ?? 0n, // raiseFeesPaid
    totalProfitFeesPaid: info[13] ?? 0n, // profitFeesPaid
    profitPerShare: info[14], // currentProfitPerShare
    finalized: info[15], // isFinalized
    withdrawable,
    withdrawableFees,
    withdrawnTotal,
    stage: Number(info[16]) as ProjectInfo["stage"], // stage
  };
};

const normalizeAddress = (address: string) => address.trim().toLowerCase();

export const fetchSupporterCount = async (
  projectAddress: `0x${string}`
): Promise<number> => {
  const currentBlock = await publicClient.getBlockNumber();
  const logs = await publicClient.getLogs({
    address: projectAddress,
    event: {
      type: "event",
      name: "Deposited",
      inputs: [
        { indexed: true, name: "user", type: "address" },
        { indexed: false, name: "amount", type: "uint256" },
        { indexed: false, name: "shares", type: "uint256" },
      ],
    },
    fromBlock: BigInt(START_BLOCK),
    toBlock: currentBlock,
  });

  const uniqueDepositors = new Set<string>();
  for (const log of logs) {
    const user = log.args.user;
    if (user) uniqueDepositors.add(normalizeAddress(user));
  }

  return uniqueDepositors.size;
};

export const fetchTotalClaimed = async (
  projectAddress: `0x${string}`
): Promise<bigint> => {
  const currentBlock = await publicClient.getBlockNumber();
  const logs = await publicClient.getLogs({
    address: projectAddress,
    event: {
      type: "event",
      name: "ProfitClaimed",
      inputs: [
        { indexed: true, name: "user", type: "address" },
        { indexed: false, name: "amount", type: "uint256" },
      ],
    },
    fromBlock: BigInt(START_BLOCK),
    toBlock: currentBlock,
  });

  return logs.reduce((sum, log) => {
    const amount = log.args.amount;
    return amount != null ? sum + amount : sum;
  }, 0n);
};

export const fetchUserPosition = async (
  project: ProjectInfo,
  user: `0x${string}`
): Promise<UserPosition> => {
  const vault = getVaultRead(project.address as `0x${string}`);
  const usdc = getUsdcRead();
  const shareToken = getContract({
    address: project.shareToken as `0x${string}`,
    abi: erc20Abi,
    client: publicClient,
  });

  const [userInfo, pending, usdcBalance, shareBalance] = await Promise.all([
    vault.read.getUserInfo([user]),
    vault.read.pendingProfit([user]),
    usdc.read.balanceOf([user]),
    shareToken.read.balanceOf([user]),
  ]);

  return {
    shares: userInfo[0],
    claimed: userInfo[1],
    pending,
    usdcBalance,
    shareBalance,
  };
};

export const fetchProjectAddresses = async (): Promise<`0x${string}`[]> => {
  const factory = getFactoryRead();

  try {
    const addresses = await factory.read.getAllProjects();
    return [...addresses];
  } catch {
    const count = await factory.read.getProjectCount();
    const addresses: `0x${string}`[] = [];
    for (let i = 0n; i < count; i++) {
      const addr = await factory.read.getProjectAt([i]);
      addresses.push(addr);
    }
    return addresses;
  }
};
