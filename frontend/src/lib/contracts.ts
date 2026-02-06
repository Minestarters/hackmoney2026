import { Contract } from "ethers";
import type { BrowserProvider, JsonRpcProvider, Signer } from "ethers";
import { FACTORY_ADDRESS, USDC_ADDRESS } from "../config";
import { getContract } from "viem";
import {
  basketVaultAbi,
  erc20Abi,
  minestartersFactoryAbi,
} from "../contracts/abis";
import { publicClient, type WalletClientWithAccount } from "./wagmi";
import type { ProjectInfo, UserPosition } from "../types";
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
    name: info.projectName,
    companyNames: info.companies,
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
    stage: Number(info[16]) as ProjectInfo["stage"], // stage
  };
};

export const fetchSupporterCount = async (
  projectAddress: string,
): Promise<number> => {
  try {
    return await getProjectSupporterCount(projectAddress);
  } catch (e) {
    console.error("Subgraph failed, falling back to RPC", e);
    return 0;
  }
};

export const fetchUserPosition = async (
  project: ProjectInfo,
  user: `0x${string}`
): Promise<UserPosition> => {
  const shareToken = new Contract(project.shareToken, erc20Abi, provider);
  const [usdcBalance, shareBalance] = await Promise.all([
    getUsdc(provider).balanceOf(user),
    shareToken.balanceOf(user),
  ]);

  return {
    shares: shareBalance,
    usdcBalance,
  };
};

// TODO: switch to indexer
export const fetchProjectAddresses = async (
  provider: BrowserProvider | JsonRpcProvider
): Promise<string[]> => {
  try {
    return await getProjectsList();
  } catch (e) {
    console.error("Subgraph failed, falling back to RPC", e);
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
  }
};
