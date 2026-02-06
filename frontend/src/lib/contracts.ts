import { FACTORY_ADDRESS, USDC_ADDRESS, NAV_ENGINE_ADDRESS, START_BLOCK } from "../config";
import { getContract } from "viem";
import {
  basketVaultAbi,
  erc20Abi,
  minestartersFactoryAbi,
  navEngineAbi,
} from "../contracts/abis";
import type { ProjectInfo, UserPosition, CompanyDetails } from "../types";
import { getWalletClient, publicClient, type WalletClientWithAccount } from "./wagmi";
import { getProjectsList, getProjectSupporterCount } from "./subgraph";

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

export const getNAVEngineContract = () =>
  getContract({
    address: NAV_ENGINE_ADDRESS as `0x${string}`,
    abi: navEngineAbi,
    client: publicClient,
  });

export const getNAVEngineWrite = async (
  walletClient: WalletClientWithAccount,
  functionName: string,
  args: Array<any>
) => {
  return walletClient.writeContract({
    address: NAV_ENGINE_ADDRESS as `0x${string}`,
    abi: navEngineAbi,
    functionName,
    args,
  });
}

const toBigInt = (value?: number | bigint | null) => {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isFinite(value)) return BigInt(value);
  return 0n;
};

const getDepositArgs = (amount: bigint, sourceChainId?: number | bigint) => {
  const depositAbi = basketVaultAbi.find(
    (item) => item.type === "function" && item.name === "deposit",
  ) as { inputs?: Array<unknown> } | undefined;
  const inputCount = depositAbi?.inputs?.length ?? 1;
  if (inputCount >= 2) {
    return [amount, toBigInt(sourceChainId)] as [bigint, bigint];
  }
  return [amount] as [bigint];
};

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
    },
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
      withdrawAddress: `0x${string}`;
      raiseFeeBps: bigint;
      profitFeeBps: bigint;
    },
  ) => {
    return walletClient.writeContract({
      address: FACTORY_ADDRESS as `0x${string}`,
      abi: minestartersFactoryAbi,
      functionName: "createProjectWithNAV",
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
  deposit: async (
    walletClient: WalletClientWithAccount,
    vaultAddress: `0x${string}`,
    amount: bigint,
    sourceChainId?: number | bigint,
  ) => {
    const args = getDepositArgs(amount, sourceChainId);
    return walletClient.writeContract({
      address: vaultAddress,
      abi: basketVaultAbi,
      functionName: "deposit",
      args,
    });
  },
  claimProfit: async (
    walletClient: WalletClientWithAccount,
    vaultAddress: `0x${string}`,
  ) => {
    return walletClient.writeContract({
      address: vaultAddress,
      abi: basketVaultAbi,
      functionName: "claimProfit",
    });
  },
  refund: async (
    walletClient: WalletClientWithAccount,
    vaultAddress: `0x${string}`,
  ) => {
    return walletClient.writeContract({
      address: vaultAddress,
      abi: basketVaultAbi,
      functionName: "refund",
    });
  },
  withdrawRaisedFunds: async (
    walletClient: WalletClientWithAccount,
    vaultAddress: `0x${string}`,
  ) => {
    return walletClient.writeContract({
      address: vaultAddress,
      abi: basketVaultAbi,
      functionName: "withdrawRaisedFunds",
    });
  },
  depositProfit: async (
    walletClient: WalletClientWithAccount,
    vaultAddress: `0x${string}`,
    amount: bigint,
  ) => {
    return walletClient.writeContract({
      address: vaultAddress,
      abi: basketVaultAbi,
      functionName: "depositProfit",
      args: [amount],
    });
  },
};

export const writeUsdc = {
  approve: async (
    walletClient: WalletClientWithAccount,
    spender: `0x${string}`,
    amount: bigint,
  ) => {
    return walletClient.writeContract({
      address: USDC_ADDRESS as `0x${string}`,
      abi: erc20Abi,
      functionName: "approve",
      args: [spender, amount],
    });
  },
  mint: async (
    walletClient: WalletClientWithAccount,
    to: `0x${string}`,
    amount: bigint,
  ) => {
    return walletClient.writeContract({
      address: USDC_ADDRESS as `0x${string}`,
      abi: erc20Abi,
      functionName: "mint",
      args: [to, amount],
    });
  },
};

const normalizeWeights = (weights: readonly bigint[]) =>
  weights.map((w) => Number(w));

type ProjectInfoLike = {
  projectName: string;
  companies: string[];
  weights: readonly bigint[];
  shareTokenAddress: `0x${string}`;
  projectCreator: `0x${string}`;
  projectWithdrawAddress: `0x${string}`;
  minRaise: bigint;
  projectDeadline: bigint;
  raiseFee: bigint;
  raised: bigint;
  raiseFeesPaid?: bigint;
  isFinalized: boolean;
  stage: number;
};

const normalizeProjectInfo = (info: unknown): ProjectInfoLike => {
  if (Array.isArray(info)) {
    const isMainShape = info.length >= 17;
    return {
      projectName: info[0] as string,
      companies: info[1] as string[],
      weights: info[2] as readonly bigint[],
      shareTokenAddress: info[3] as `0x${string}`,
      projectCreator: info[4] as `0x${string}`,
      projectWithdrawAddress: info[5] as `0x${string}`,
      minRaise: info[6] as bigint,
      projectDeadline: info[7] as bigint,
      raiseFee: info[8] as bigint,
      raised: (isMainShape ? info[10] : info[9]) as bigint,
      raiseFeesPaid: (isMainShape ? info[12] : info[10]) ?? 0n,
      isFinalized: Boolean(isMainShape ? info[15] : info[11]),
      stage: Number(isMainShape ? info[16] : (info[12] ?? 0)),
    };
  }
  const typed = info as ProjectInfoLike;
  return {
    projectName: typed.projectName,
    companies: typed.companies,
    weights: typed.weights,
    shareTokenAddress: typed.shareTokenAddress,
    projectCreator: typed.projectCreator,
    projectWithdrawAddress: typed.projectWithdrawAddress,
    minRaise: typed.minRaise,
    projectDeadline: typed.projectDeadline,
    raiseFee: typed.raiseFee,
    raised: typed.raised,
    raiseFeesPaid: typed.raiseFeesPaid ?? 0n,
    isFinalized: typed.isFinalized,
    stage: typed.stage,
  };
};

export const fetchProjectInfo = async (
  address: `0x${string}`,
): Promise<ProjectInfo> => {
  const vault = getVaultRead(address);
  const infoRaw = await vault.read.getProjectInfo();
  const info = normalizeProjectInfo(infoRaw);

  let accruedRaiseFees: bigint = 0n;
  try {
    accruedRaiseFees = (await vault.read.accruedRaiseFees()) as bigint;
  } catch {
    // older ABI; fall back to zero if method not present
  }

  let withdrawnTotal = 0n;
  let hasWithdrawnValue = false;
  try {
    const withdrawnResult = (await vault.read.withdrawnPrincipal()) as bigint;
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
    const [principal, fees] = (await vault.read.withdrawableFunds()) as [
      bigint,
      bigint,
    ];
    withdrawable = principal;
    withdrawableFees = fees;
  } catch {
    const raised = info.raised;
    if (hasWithdrawnValue) {
      const available = raised > withdrawnTotal ? raised - withdrawnTotal : 0n;
      withdrawable =
        available > accruedRaiseFees ? available - accruedRaiseFees : 0n;
      withdrawableFees =
        available > accruedRaiseFees ? accruedRaiseFees : available;
    } else {
      const minimumRaise = info.minRaise;
      if (raised >= minimumRaise) {
        withdrawable =
          raised > accruedRaiseFees ? raised - accruedRaiseFees : 0n;
        withdrawableFees =
          raised > accruedRaiseFees ? accruedRaiseFees : raised;
      }
    }
  }

  return {
    address,
    name: info.projectName,
    companyNames: [...info.companies],
    companyWeights: normalizeWeights(info.weights),
    shareToken: info.shareTokenAddress,
    creator: info.projectCreator,
    withdrawAddress: info.projectWithdrawAddress,
    minimumRaise: info.minRaise,
    deadline: info.projectDeadline,
    raiseFeeBps: Number(info.raiseFee),
    totalRaised: info.raised,
    accruedRaiseFees,
    totalRaiseFeesPaid: info.raiseFeesPaid ?? 0n,
    finalized: info.isFinalized,
    withdrawable,
    withdrawableFees,
    withdrawnTotal,
    stage: Number(info.stage) as ProjectInfo["stage"],
  };
};

const normalizeAddress = (address: string) => address.trim().toLowerCase();

export const fetchSupporterCount = async (
  projectAddress: string,
): Promise<number> => {
  try {
    return await getProjectSupporterCount(projectAddress);
  } catch (e) {
    console.error("Subgraph failed, falling back to RPC", e);
  }

  const currentBlock = await publicClient.getBlockNumber();
  const logs = await publicClient.getLogs({
    address: projectAddress as `0x${string}`,
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

export const fetchUserPosition = async (
  project: ProjectInfo,
  user: `0x${string}`,
): Promise<UserPosition> => {
  const usdc = getUsdcRead();
  const shareToken = getContract({
    address: project.shareToken as `0x${string}`,
    abi: erc20Abi,
    client: publicClient,
  });

  const [usdcBalance, shareBalance] = await Promise.all([
    usdc.read.balanceOf([user]),
    shareToken.read.balanceOf([user]),
  ]);

  return {
    shares: shareBalance,
    usdcBalance,
  };
};

export const fetchProjectAddresses = async (): Promise<`0x${string}`[]> => {
  try {
    const addresses = await getProjectsList();
    return addresses as `0x${string}`[];
  } catch (e) {
    console.error("Subgraph failed, falling back to RPC", e);
  }

  const factory = getFactoryRead();
  try {
    const addresses = (await factory.read.getAllProjects()) as `0x${string}`[];
    return [...addresses];
  } catch {
    const count = (await factory.read.getProjectCount()) as bigint;
    const addresses: `0x${string}`[] = [];
    for (let i = 0n; i < count; i++) {
      const addr = (await factory.read.getProjectAt([i])) as `0x${string}`;
      addresses.push(addr);
    }
    return addresses;
  }
};

export const fetchCompanyDetails = async (
  vaultAddress: string,
  companyIndex: number,
): Promise<Partial<CompanyDetails>> => {
  const navEngine = getNAVEngineContract();
  const result = await navEngine.read.getCompany([vaultAddress, companyIndex]) as Array<string | bigint>;

  return {
    name: result[0] as string,
    weight: Number(result[1]),
    resourceTonnes: result[2] as bigint,
    inventoryTonnes: result[3] as bigint,
    stage: Number(result[4]),
    navUsd: result[5] as bigint,
    //   totalResourceTonnes: 0n,
    //   recoveryRateBps: 0,
    //   yearsToProduction: 0,
    //   remainingMineLife: 0,
    //   discountRateBps: 0,
    //   floorNavTotalUsd: 0n,
  }
};

/**
 * Advance a company to the next stage
 * @param vaultAddress - The address of the vault/project
 * @param companyIndex - The index of the company within the vault
 * @param yearsToProduction - Years until production starts
 * @param remainingMineLife - Remaining mine life in years
 * @param signer - The signer to execute the transaction
 */
export const advanceCompanyStage = async (
  vaultAddress: string,
  companyIndex: number,
  yearsToProduction: number,
  remainingMineLife: number,
  ipfsHashes: string[] = [],
): Promise<string | undefined> => {
  const walletClient = await getWalletClient();

  if (!walletClient) return

  // Call advanceCompanyStage on the NAVEngine contract
  const hash = await getNAVEngineWrite(
    walletClient,
    'advanceCompanyStage',
    [
      vaultAddress,
      companyIndex,
      yearsToProduction,
      remainingMineLife,
      ipfsHashes
    ]
  );
  return hash

};
