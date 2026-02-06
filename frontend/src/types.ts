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
  totalRaised: bigint;
  accruedRaiseFees: bigint;
  totalRaiseFeesPaid: bigint;
  finalized: boolean;
  withdrawable: bigint;
  withdrawableFees: bigint;
  withdrawnTotal: bigint;
  stage: Stage;
};

export const COMPANY_STAGE_LABELS: Record<number, string> = {
  0: "Exploration",
  1: "Permits",
  2: "Construction",
  3: "Production",
};

export type CompanyDetails = {
  name: string;
  weight: number;
  resourceTonnes: bigint;
  inventoryTonnes: bigint;
  stage: number;
  navUsd: bigint;
  totalResourceTonnes: bigint;
  recoveryRateBps: number;
  yearsToProduction: number;
  remainingMineLife: number;
  discountRateBps: number;
  floorNavTotalUsd: bigint;
};

export type CompanyDocument = {
  id: string;
  companyIndex: number;
  fileName?: string;
  uploadedAt: number; // Block timestamp from subgraph
  stage: number;
  ipfsHash?: string;
  localPath?: string;
  closedStage: number;
};

export type UserPosition = {
  shares: bigint;
  usdcBalance: bigint;
};
