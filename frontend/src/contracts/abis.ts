export const minestartersFactoryAbi = [
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: "address", name: "creator", type: "address" },
      { indexed: false, internalType: "address", name: "vault", type: "address" },
      { indexed: false, internalType: "address", name: "token", type: "address" },
      { indexed: false, internalType: "string", name: "name", type: "string" },
    ],
    name: "ProjectCreated",
    type: "event",
  },
  {
    inputs: [
      { internalType: "string", name: "projectName", type: "string" },
      { internalType: "string[]", name: "companyNames", type: "string[]" },
      { internalType: "uint256[]", name: "companyWeights", type: "uint256[]" },
      { internalType: "uint256", name: "minimumRaise", type: "uint256" },
      { internalType: "uint256", name: "deadline", type: "uint256" },
      { internalType: "address", name: "withdrawAddress", type: "address" },
      { internalType: "uint256", name: "raiseFeeBps", type: "uint256" },
      { internalType: "uint256", name: "profitFeeBps", type: "uint256" },
    ],
    name: "createProject",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { internalType: "string", name: "projectName", type: "string" },
      { internalType: "string[]", name: "companyNames", type: "string[]" },
      { internalType: "uint256[]", name: "companyWeights", type: "uint256[]" },
      { internalType: "uint256", name: "minimumRaise", type: "uint256" },
      { internalType: "uint256", name: "deadline", type: "uint256" },
      { internalType: "address", name: "withdrawAddress", type: "address" },
      { internalType: "uint256", name: "raiseFeeBps", type: "uint256" },
      { internalType: "uint256", name: "profitFeeBps", type: "uint256" },
    ],
    name: "createProjectWithNAV",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "external",
    type: "function",
  },
  {
    inputs: [],
    name: "getAllProjects",
    outputs: [{ internalType: "address[]", name: "", type: "address[]" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "getProjectCount",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "uint256", name: "index", type: "uint256" }],
    name: "getProjectAt",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

export const basketVaultAbi = [
  {
    inputs: [],
    name: "accruedRaiseFees",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: "address", name: "user", type: "address" },
      { indexed: false, internalType: "uint256", name: "amount", type: "uint256" },
      { indexed: false, internalType: "uint256", name: "shares", type: "uint256" },
    ],
    name: "Deposited",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [{ indexed: false, internalType: "uint256", name: "amount", type: "uint256" }],
    name: "ProfitDeposited",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: "address", name: "user", type: "address" },
      { indexed: false, internalType: "uint256", name: "amount", type: "uint256" },
    ],
    name: "ProfitClaimed",
    type: "event",
  },
  {
    inputs: [],
    name: "claimProfit",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [],
    name: "currentStage",
    outputs: [
      {
        internalType: "enum BasketVault.Stage",
        name: "",
        type: "uint8",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "uint256", name: "amount", type: "uint256" }],
    name: "deposit",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ internalType: "uint256", name: "amount", type: "uint256" }],
    name: "depositProfit",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [],
    name: "getProjectInfo",
    outputs: [
      { internalType: "string", name: "projectName", type: "string" },
      { internalType: "string[]", name: "companies", type: "string[]" },
      { internalType: "uint256[]", name: "weights", type: "uint256[]" },
      { internalType: "address", name: "shareTokenAddress", type: "address" },
      { internalType: "address", name: "projectCreator", type: "address" },
      { internalType: "address", name: "projectWithdrawAddress", type: "address" },
      { internalType: "uint256", name: "minRaise", type: "uint256" },
      { internalType: "uint256", name: "projectDeadline", type: "uint256" },
      { internalType: "uint256", name: "raiseFee", type: "uint256" },
      { internalType: "uint256", name: "profitFee", type: "uint256" },
      { internalType: "uint256", name: "raised", type: "uint256" },
      { internalType: "uint256", name: "profit", type: "uint256" },
      { internalType: "uint256", name: "raiseFeesPaid", type: "uint256" },
      { internalType: "uint256", name: "profitFeesPaid", type: "uint256" },
      { internalType: "uint256", name: "currentProfitPerShare", type: "uint256" },
      { internalType: "bool", name: "isFinalized", type: "bool" },
      { internalType: "enum BasketVault.Stage", name: "stage", type: "uint8" },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "address", name: "user", type: "address" }],
    name: "getUserInfo",
    outputs: [
      { internalType: "uint256", name: "shares", type: "uint256" },
      { internalType: "uint256", name: "totalClaimed", type: "uint256" },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "address", name: "user", type: "address" }],
    name: "pendingProfit",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "refund",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [],
    name: "totalProfit",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "totalProfitFeesCollected",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "totalRaised",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "totalRaiseFeesCollected",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "withdrawableFunds",
    outputs: [
      { internalType: "uint256", name: "principal", type: "uint256" },
      { internalType: "uint256", name: "fees", type: "uint256" },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "withdrawnPrincipal",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "withdrawRaisedFunds",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

export const erc20Abi = [
  {
    inputs: [
      { internalType: "address", name: "spender", type: "address" },
      { internalType: "uint256", name: "amount", type: "uint256" },
    ],
    name: "approve",
    outputs: [{ internalType: "bool", name: "", type: "bool" }],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ internalType: "address", name: "account", type: "address" }],
    name: "balanceOf",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "decimals",
    outputs: [{ internalType: "uint8", name: "", type: "uint8" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "symbol",
    outputs: [{ internalType: "string", name: "", type: "string" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { internalType: "address", name: "owner", type: "address" },
      { internalType: "address", name: "spender", type: "address" },
    ],
    name: "allowance",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { internalType: "address", name: "to", type: "address" },
      { internalType: "uint256", name: "amount", type: "uint256" },
    ],
    name: "mint",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

export const navEngineAbi = [
  {
    "type": "constructor",
    "inputs": [
      { "name": "_oracle", "type": "address", "internalType": "address" },
      { "name": "_owner", "type": "address", "internalType": "address" }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "name": "BPS",
    "type": "function",
    "inputs": [],
    "outputs": [{ "name": "", "type": "uint256", "internalType": "uint256" }],
    "stateMutability": "view"
  },
  {
    "name": "DEFAULT_K_CONSTRUCTION",
    "type": "function",
    "inputs": [],
    "outputs": [{ "name": "", "type": "uint16", "internalType": "uint16" }],
    "stateMutability": "view"
  },
  {
    "name": "DEFAULT_K_PERMITS",
    "type": "function",
    "inputs": [],
    "outputs": [{ "name": "", "type": "uint16", "internalType": "uint16" }],
    "stateMutability": "view"
  },
  {
    "name": "DEFAULT_K_PRODUCTION",
    "type": "function",
    "inputs": [],
    "outputs": [{ "name": "", "type": "uint16", "internalType": "uint16" }],
    "stateMutability": "view"
  },
  {
    "name": "OZ_PER_TONNE",
    "type": "function",
    "inputs": [],
    "outputs": [{ "name": "", "type": "uint256", "internalType": "uint256" }],
    "stateMutability": "view"
  },
  {
    "name": "WAD",
    "type": "function",
    "inputs": [],
    "outputs": [{ "name": "", "type": "uint256", "internalType": "uint256" }],
    "stateMutability": "view"
  },
  {
    "name": "advanceCompanyStage",
    "type": "function",
    "inputs": [
      { "name": "vault", "type": "address", "internalType": "address" },
      { "name": "companyIndex", "type": "uint256", "internalType": "uint256" },
      { "name": "newYearsToProduction", "type": "uint32", "internalType": "uint32" },
      { "name": "newRemainingMineLife", "type": "uint32", "internalType": "uint32" },
      { "name": "ipfsHashes", "type": "string[]", "internalType": "string[]" }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "name": "companies",
    "type": "function",
    "inputs": [
      { "name": "", "type": "address", "internalType": "address" },
      { "name": "", "type": "uint256", "internalType": "uint256" }
    ],
    "outputs": [
      { "name": "name", "type": "string", "internalType": "string" },
      { "name": "totalResourceTonnes", "type": "uint128", "internalType": "uint128" },
      { "name": "inventoryTonnes", "type": "uint128", "internalType": "uint128" },
      { "name": "floorNavTotalUsd", "type": "uint128", "internalType": "uint128" },
      { "name": "weight", "type": "uint64", "internalType": "uint64" },
      { "name": "recoveryRateBps", "type": "uint32", "internalType": "uint32" },
      { "name": "yearsToProduction", "type": "uint32", "internalType": "uint32" },
      { "name": "remainingMineLife", "type": "uint32", "internalType": "uint32" },
      { "name": "discountRateBps", "type": "uint32", "internalType": "uint32" },
      { "name": "kPermits", "type": "uint16", "internalType": "uint16" },
      { "name": "kConstruction", "type": "uint16", "internalType": "uint16" },
      { "name": "kProduction", "type": "uint16", "internalType": "uint16" },
      { "name": "currentStage", "type": "uint8", "internalType": "enum NAVEngine.Stage" },
      { "name": "registered", "type": "bool", "internalType": "bool" }
    ],
    "stateMutability": "view"
  },
  {
    "name": "factory",
    "type": "function",
    "inputs": [],
    "outputs": [{ "name": "", "type": "address", "internalType": "address" }],
    "stateMutability": "view"
  },
  {
    "name": "getCompany",
    "type": "function",
    "inputs": [
      { "name": "vault", "type": "address", "internalType": "address" },
      { "name": "companyIndex", "type": "uint256", "internalType": "uint256" }
    ],
    "outputs": [
      { "name": "name", "type": "string", "internalType": "string" },
      { "name": "weight", "type": "uint256", "internalType": "uint256" },
      { "name": "resourceTonnes", "type": "uint256", "internalType": "uint256" },
      { "name": "inventoryTonnes", "type": "uint256", "internalType": "uint256" },
      { "name": "stage", "type": "uint8", "internalType": "enum NAVEngine.Stage" },
      { "name": "navUsd", "type": "uint256", "internalType": "uint256" }
    ],
    "stateMutability": "view"
  },
  {
    "name": "getCurrentNAV",
    "type": "function",
    "inputs": [{ "name": "vault", "type": "address", "internalType": "address" }],
    "outputs": [{ "name": "navPerToken", "type": "uint256", "internalType": "uint256" }],
    "stateMutability": "view"
  },
  {
    "name": "goldPriceUsd",
    "type": "function",
    "inputs": [],
    "outputs": [{ "name": "", "type": "uint256", "internalType": "uint256" }],
    "stateMutability": "view"
  },
  {
    "name": "oracle",
    "type": "function",
    "inputs": [],
    "outputs": [{ "name": "", "type": "address", "internalType": "address" }],
    "stateMutability": "view"
  },
  {
    "name": "owner",
    "type": "function",
    "inputs": [],
    "outputs": [{ "name": "", "type": "address", "internalType": "address" }],
    "stateMutability": "view"
  },
  {
    "name": "registerCompany",
    "type": "function",
    "inputs": [
      { "name": "vault", "type": "address", "internalType": "address" },
      { "name": "name", "type": "string", "internalType": "string" },
      { "name": "weight", "type": "uint256", "internalType": "uint256" },
      { "name": "resourceTonnes", "type": "uint256", "internalType": "uint256" },
      { "name": "recoveryBps", "type": "uint256", "internalType": "uint256" },
      { "name": "yearsToProduction", "type": "uint256", "internalType": "uint256" },
      { "name": "mineLifeYears", "type": "uint256", "internalType": "uint256" },
      { "name": "discountRateBps", "type": "uint256", "internalType": "uint256" },
      { "name": "floorNavUsd", "type": "uint256", "internalType": "uint256" }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "name": "registerVault",
    "type": "function",
    "inputs": [
      { "name": "vault", "type": "address", "internalType": "address" },
      { "name": "tokenSupply", "type": "uint256", "internalType": "uint256" },
      { "name": "creator", "type": "address", "internalType": "address" }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "name": "renounceOwnership",
    "type": "function",
    "inputs": [],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "name": "setFactory",
    "type": "function",
    "inputs": [{ "name": "_factory", "type": "address", "internalType": "address" }],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "name": "setOracle",
    "type": "function",
    "inputs": [{ "name": "_oracle", "type": "address", "internalType": "address" }],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "name": "transferOwnership",
    "type": "function",
    "inputs": [{ "name": "newOwner", "type": "address", "internalType": "address" }],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "name": "updateCompany",
    "type": "function",
    "inputs": [
      { "name": "vault", "type": "address", "internalType": "address" },
      { "name": "companyIndex", "type": "uint256", "internalType": "uint256" },
      { "name": "weight", "type": "uint64", "internalType": "uint64" },
      { "name": "yearsToProduction", "type": "uint32", "internalType": "uint32" },
      { "name": "remainingMineLife", "type": "uint32", "internalType": "uint32" },
      { "name": "discountRateBps", "type": "uint32", "internalType": "uint32" },
      { "name": "floorNavUsd", "type": "uint128", "internalType": "uint128" },
      { "name": "kPermits", "type": "uint16", "internalType": "uint16" },
      { "name": "kConstruction", "type": "uint16", "internalType": "uint16" },
      { "name": "kProduction", "type": "uint16", "internalType": "uint16" }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "name": "updateGoldPrice",
    "type": "function",
    "inputs": [{ "name": "newPrice", "type": "uint256", "internalType": "uint256" }],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "name": "updateInventory",
    "type": "function",
    "inputs": [
      { "name": "vault", "type": "address", "internalType": "address" },
      { "name": "companyIndex", "type": "uint256", "internalType": "uint256" },
      { "name": "tonnes", "type": "uint128", "internalType": "uint128" },
      { "name": "newRemainingMineLife", "type": "uint32", "internalType": "uint32" }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "name": "vaultCreators",
    "type": "function",
    "inputs": [{ "name": "", "type": "address", "internalType": "address" }],
    "outputs": [{ "name": "", "type": "address", "internalType": "address" }],
    "stateMutability": "view"
  },
  {
    "name": "vaults",
    "type": "function",
    "inputs": [{ "name": "", "type": "address", "internalType": "address" }],
    "outputs": [
      { "name": "companyCount", "type": "uint64", "internalType": "uint64" },
      { "name": "registered", "type": "bool", "internalType": "bool" }
    ],
    "stateMutability": "view"
  },
  {
    "name": "AlreadyProduction",
    "type": "error",
    "inputs": []
  },
  {
    "name": "CompanyNotRegistered",
    "type": "error",
    "inputs": []
  },
  {
    "name": "ExceedsResource",
    "type": "error",
    "inputs": []
  },
  {
    "name": "InvalidPrice",
    "type": "error",
    "inputs": []
  },
  {
    "name": "NotInProduction",
    "type": "error",
    "inputs": []
  },
  {
    "name": "OwnableInvalidOwner",
    "type": "error",
    "inputs": [{ "name": "owner", "type": "address", "internalType": "address" }]
  },
  {
    "name": "OwnableUnauthorizedAccount",
    "type": "error",
    "inputs": [{ "name": "account", "type": "address", "internalType": "address" }]
  },
  {
    "name": "ProjectNotRegistered",
    "type": "error",
    "inputs": []
  },
  {
    "name": "Unauthorized",
    "type": "error",
    "inputs": []
  },
  {
    "name": "CompanyRegistered",
    "type": "event",
    "inputs": [
      { "name": "vault", "type": "address", "indexed": true, "internalType": "address" },
      { "name": "companyIndex", "type": "uint256", "indexed": true, "internalType": "uint256" },
      { "name": "name", "type": "string", "indexed": false, "internalType": "string" }
    ],
    "anonymous": false
  },
  {
    "name": "CompanyStageAdvanced",
    "type": "event",
    "inputs": [
      { "name": "vault", "type": "address", "indexed": true, "internalType": "address" },
      { "name": "companyIndex", "type": "uint256", "indexed": true, "internalType": "uint256" },
      { "name": "newStage", "type": "uint8", "indexed": false, "internalType": "enum NAVEngine.Stage" }
    ],
    "anonymous": false
  },
  {
    "name": "CompanyUpdated",
    "type": "event",
    "inputs": [
      { "name": "vault", "type": "address", "indexed": true, "internalType": "address" },
      { "name": "companyIndex", "type": "uint256", "indexed": true, "internalType": "uint256" }
    ],
    "anonymous": false
  },
  {
    "name": "OwnershipTransferred",
    "type": "event",
    "inputs": [
      { "name": "previousOwner", "type": "address", "indexed": true, "internalType": "address" },
      { "name": "newOwner", "type": "address", "indexed": true, "internalType": "address" }
    ],
    "anonymous": false
  },
  {
    "name": "PriceUpdated",
    "type": "event",
    "inputs": [
      { "name": "newPrice", "type": "uint256", "indexed": false, "internalType": "uint256" }
    ],
    "anonymous": false
  },
  {
    "name": "VaultRegistered",
    "type": "event",
    "inputs": [
      { "name": "vault", "type": "address", "indexed": true, "internalType": "address" },
      { "name": "tokenSupply", "type": "uint256", "indexed": false, "internalType": "uint256" }
    ],
    "anonymous": false
  }
]