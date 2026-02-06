import { FACTORY_ADDRESS, USDC_ADDRESS, NAV_ENGINE_ADDRESS } from "../config";
import { getContract, type Address } from "viem";
import {
  basketVaultAbi,
  erc20Abi,
  minestartersFactoryAbi,
  navEngineAbi,
} from "../contracts/abis";
import type { ProjectInfo, UserPosition, CompanyDetails, CompanyDetailsResponse } from "../types";
import { publicClient, type WalletClientWithAccount } from "./wagmi";
import { fetchLogsInChunks } from "../utils/get_logs";

// Read-only contract getters (use publicClient)
export const getVaultRead = (address: Address) =>
  getContract({
    address,
    abi: basketVaultAbi,
    client: publicClient,
  });

export const getUsdcRead = () =>
  getContract({
    address: USDC_ADDRESS as Address,
    abi: erc20Abi,
    client: publicClient,
  });

export const getFactoryRead = () =>
  getContract({
    address: FACTORY_ADDRESS as Address,
    abi: minestartersFactoryAbi,
    client: publicClient,
  });

export const getNAVEngineRead = () =>
  getContract({
    address: NAV_ENGINE_ADDRESS as Address,
    abi: navEngineAbi,
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
      withdrawAddress: Address;
      raiseFeeBps: bigint;
      profitFeeBps: bigint;
    }
  ) => {
    return walletClient.writeContract({
      address: FACTORY_ADDRESS as Address,
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
  createProjectWithNAV: async (
    walletClient: WalletClientWithAccount,
    args: {
      projectName: string;
      companyNames: string[];
      companyWeights: bigint[];
      minimumRaise: bigint;
      deadline: bigint;
      withdrawAddress: Address;
      raiseFeeBps: bigint;
      profitFeeBps: bigint;
    }
  ) => {
    return walletClient.writeContract({
      address: FACTORY_ADDRESS as Address,
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
  deposit: async (walletClient: WalletClientWithAccount, vaultAddress: Address, amount: bigint) => {
    return walletClient.writeContract({
      address: vaultAddress,
      abi: basketVaultAbi,
      functionName: "deposit",
      args: [amount],
    });
  },
  claimProfit: async (walletClient: WalletClientWithAccount, vaultAddress: Address) => {
    return walletClient.writeContract({
      address: vaultAddress,
      abi: basketVaultAbi,
      functionName: "claimProfit",
    });
  },
  refund: async (walletClient: WalletClientWithAccount, vaultAddress: Address) => {
    return walletClient.writeContract({
      address: vaultAddress,
      abi: basketVaultAbi,
      functionName: "refund",
    });
  },
  withdrawRaisedFunds: async (walletClient: WalletClientWithAccount, vaultAddress: Address) => {
    return walletClient.writeContract({
      address: vaultAddress,
      abi: basketVaultAbi,
      functionName: "withdrawRaisedFunds",
    });
  },
  depositProfit: async (walletClient: WalletClientWithAccount, vaultAddress: Address, amount: bigint) => {
    return walletClient.writeContract({
      address: vaultAddress,
      abi: basketVaultAbi,
      functionName: "depositProfit",
      args: [amount],
    });
  },
};

export const writeUsdc = {
  approve: async (walletClient: WalletClientWithAccount, spender: Address, amount: bigint) => {
    return walletClient.writeContract({
      address: USDC_ADDRESS as Address,
      abi: erc20Abi,
      functionName: "approve",
      args: [spender, amount],
    });
  },
  mint: async (walletClient: WalletClientWithAccount, to: Address, amount: bigint) => {
    return walletClient.writeContract({
      address: USDC_ADDRESS as Address,
      abi: erc20Abi,
      functionName: "mint",
      args: [to, amount],
    });
  },
};

const normalizeWeights = (weights: readonly bigint[]) => weights.map((w) => Number(w));

export const fetchProjectInfo = async (
  address: Address
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
  projectAddress: Address
): Promise<number> => {
  const event = {
    type: "event",
    name: "Deposited",
    inputs: [
      { indexed: true, name: "user", type: "address" },
      { indexed: false, name: "amount", type: "uint256" },
      { indexed: false, name: "shares", type: "uint256" },
    ],
  } as const
  const logs = await fetchLogsInChunks<typeof event>(projectAddress, event);

  const uniqueDepositors = new Set<string>();
  for (const log of logs) {
    const user = log.args.user;
    if (user) uniqueDepositors.add(normalizeAddress(user));
  }

  return uniqueDepositors.size;
};

export const fetchTotalClaimed = async (
  projectAddress: Address
): Promise<bigint> => {
  const event = {
    type: "event",
    name: "ProfitClaimed",
    inputs: [
      { indexed: true, name: "user", type: "address" },
      { indexed: false, name: "amount", type: "uint256" },
    ],
  } as const
  const logs = await fetchLogsInChunks<typeof event>(projectAddress, event)
  console.log('logs for fetchTotalClaimed: ', logs)

  return logs.reduce((sum, log) => {
    const amount = log.args.amount
    return amount != null ? sum + amount : sum;
  }, 0n);
};

export const fetchUserPosition = async (
  project: ProjectInfo,
  user: Address
): Promise<UserPosition> => {
  const vault = getVaultRead(project.address as Address);
  const usdc = getUsdcRead();
  const shareToken = getContract({
    address: project.shareToken as Address,
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

export const fetchProjectAddresses = async (): Promise<Address[]> => {
  const factory = getFactoryRead();

  try {
    const addresses = await factory.read.getAllProjects() as Address[];
    return [...addresses];
  } catch {
    const count = await factory.read.getProjectCount() as bigint;
    const addresses: Address[] = [];
    for (let i = 0n; i < count; i++) {
      const addr = await factory.read.getProjectAt([i]) as Address;
      addresses.push(addr);
    }
    return addresses;
  }
};

export const fetchCompanyDetails = async (
  vaultAddress: string,
  companyIndex: number,
): Promise<CompanyDetails> => {
  const navEngine = getNAVEngineRead();
  const result = await navEngine.read.getCompany([vaultAddress, companyIndex]) as CompanyDetailsResponse;

  return {
    name: result.name,
    weight: Number(result.weight),
    resourceTonnes: result.resourceTonnes as bigint,
    inventoryTonnes: result.inventoryTonnes as bigint,
    stage: Number(result.stage),
    navUsd: result.navUsd as bigint,
    totalResourceTonnes: result.resourceTonnes as bigint,
    recoveryRateBps: 0,
    yearsToProduction: 0,
    remainingMineLife: 0,
    discountRateBps: 0,
    floorNavTotalUsd: 0n,
  };
};

/**
 * Advance a company to the next stage
 * @param vaultAddress - The address of the vault/project
 * @param companyIndex - The index of the company within the vault
 * @param yearsToProduction - Years until production starts
 * @param remainingMineLife - Remaining mine life in years
 * @param signer - The signer to execute the transaction
 * @param ipfsHashes - The ipfs hashes of uploaded documents
 */
export const advanceCompanyStage = async (
  vaultAddress: string,
  companyIndex: number,
  yearsToProduction: number,
  remainingMineLife: number,
  ipfsHashes: string[] = []
): Promise<string | undefined> => {
  const navEngine = getNAVEngineRead();

  try {
    // Call advanceCompanyStage on the NAVEngine contract
    const hash = await navEngine.write.advanceCompanyStage(
      [
        vaultAddress,
        companyIndex,
        yearsToProduction,
        remainingMineLife,
        ipfsHashes
      ]
    );

    return hash;
  } catch (error) {
    console.error('Error in advanceCompanyStage: ', error)
    return undefined
  }
};
