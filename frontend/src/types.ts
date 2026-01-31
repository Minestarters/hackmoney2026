export type Stage = 0 | 1 | 2;

export type ProjectInfo = {
  address: string;
  name: string;
  companyNames: string[];
  companyWeights: number[];
  shareToken: string;
  creator: string;
  withdrawAddress: string;
  minimumRaise: bigint;
  deadline: bigint;
  raiseFeeBps: number;
  profitFeeBps: number;
  totalRaised: bigint;
  accruedRaiseFees: bigint;
  totalProfit: bigint;
  totalRaiseFeesPaid: bigint;
  totalProfitFeesPaid: bigint;
  profitPerShare: bigint;
  finalized: boolean;
  withdrawable: bigint;
  withdrawableFees: bigint;
  withdrawnTotal: bigint;
  stage: Stage;
};

export type UserPosition = {
  shares: bigint;
  claimed: bigint;
  pending: bigint;
  usdcBalance: bigint;
  shareBalance: bigint;
};
