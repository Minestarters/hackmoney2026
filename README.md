# Minestarters

tl;dr: Off-chain collaborative curation of mining company portfolios, NAV-aware on-chain liquidity, and cross-chain capital rails for mining finance.

## 💡 Why Minestarters

Junior mining exploration is structurally underfunded. Even with stronger commodity prices, exploration budgets in key regions (including parts of Africa) are near decade lows. Operating-level price strength does not reliably become risk capital for early-stage companies. High failure rates and asymmetric risk-reward force investors to deploy large amounts of capital just to diversify, shrinking the pool of suitable backers and leaving fragmented, slow funding routes that strand many high-quality projects.

The path from discovery (exploration) to feasibility, permitting, project finance, construction, and production is long and capital-intensive. Until production, in-ground mineral assets are non-producing, non-cash-flowing, and largely illiquid. That illiquidity drives valuation discounts during exploration and development, raises the cost of capital, and limits funding access. Early investors are locked in for years with no ability to trade, rebalance, or exit before long-term milestones are reached.

### Enter Minestarters

- Collaborative basket curation: Curators (researchers, mining creators, junior executives, or Minestarters) assemble baskets of projects, set allocation weights, and define minimum raise targets. Investors gain diversified exposure by backing expert-led strategies rather than individual high-risk projects. Curators stake tokens to collectively assign weights to projects inside a basket using Yellow Network, enabling fast, gasless, multi-party curation with on-chain settlement only once the basket is finalized.

- NAV tracking: Material legal and financial documents are verified via oracles or required counterparty signatures. Net Asset Value (NAV) is tracked and reflected on-chain, providing real-time transparency and accountability for vault token holders. Each basket issues vault tokens that trade in a Uniswap V4 pool. Custom hooks keep prices aligned with on-chain NAV based on project stage and progress, creating continuous price discovery for traditionally illiquid mining assets. Withdrawals from mining companies are also gated by progress.

- Cross chain capital rails: By deploying on ARC Network, Minestarters enables seamless cross-chain USDC funding and unified settlement without bridging friction, opening access to a global investor base.

## 📁 Project Structure

This is a **Yarn Workspace** monorepo containing:

```
hackmoney2026/
├── backend/            # Node/TypeScript API service
├── contracts/          # Smart contracts (Foundry/Solidity)
│   ├── src/            # Contract source files
│   ├── scripts/        # Deployment scripts
│   └── test/           # Contract tests
├── frontend/           # React frontend (Vite + TypeScript)
│   ├── public/         # Static assets
│   └── src/            # Frontend source code
├── subgraph/           # The Graph subgraph
│   ├── abis/           # Contract ABIs
│   ├── schema.graphql  # Subgraph schema
│   └── src/            # Mapping handlers
├── lib/                # Shared libs (workspace-level)
└── render.yaml         # Render deployment config
```

## 🚀 Getting Started

### Prerequisites

Make sure you have the following installed:

- **Node.js** 22.17.0 (managed via Volta)
- **Yarn** 1.22.22 (managed via Volta)
- **Foundry** (for smart contract development)

#### Installing Foundry

Foundry is the official Ethereum development toolkit. To install it:

1. **Install Foundryup** (the Foundry toolchain installer):

   ```bash
   curl -L https://foundry.paradigm.xyz | bash
   ```

2. **Run Foundryup** to install Foundry:

   ```bash
   foundryup
   ```

   This will install `forge`, `cast`, `anvil`, and `chisel`.

> **Note for Windows users:** You'll need to use [Git BASH](https://gitforwindows.org/) or [WSL](https://learn.microsoft.com/en-us/windows/wsl/install) as Foundryup doesn't support PowerShell or Command Prompt.

For more installation options (building from source, Docker, etc.), visit the [official Foundry installation guide](https://getfoundry.sh/introduction/installation/).

### Installation

1. **Clone the repository:**

   ```bash
   git clone <repository-url>
   cd hackmoney2026
   ```

2. **Install dependencies:**

   ```bash
   # Install all workspace dependencies
   yarn install
   ```

This will install dependencies for the `contracts`, `frontend`, `backend`, and `subgraph` workspaces.

3. **Set up environment variables:**

   Create a `.env` file in the `contracts/` directory:

   ```bash
   cd contracts
   cp .env.example .env  # if available, or create manually
   ```

   Add your configuration:

   ```env
   PRIVATE_KEY=your_private_key_here
   RPC_URL=https://testnet.arcscan.app/
   ```

## 📦 Working with Yarn Workspaces

This project uses Yarn Workspaces to manage multiple packages in a single repository.

### Running Commands in Workspaces

**From the root directory:**

```bash
# Run commands in specific workspace
yarn workspace @hackmoney2026/contracts <command>
yarn workspace @hackmoney2026/frontend <command>
```

**Or use the predefined scripts:**

```bash
# Smart Contracts
yarn contracts:compile
yarn contracts:test
yarn contracts:deploy:usdc
yarn contracts:deploy:factory
yarn contracts:clean

# Backend
yarn backend:dev
yarn backend:build
yarn backend:start

# Frontend
yarn frontend:dev
yarn frontend:build
yarn frontend:preview
yarn frontend:lint
```

## 🏗️ Development

### Smart Contracts

Navigate to the contracts directory or use workspace commands:

```bash
# Compile contracts
yarn contracts:compile
# OR
cd contracts && yarn compile

# Run tests
yarn contracts:test
# OR
cd contracts && yarn test

# Run tests with verbose output
cd contracts && yarn test:verbose

# Deploy USDC mock token (testnet)
yarn contracts:deploy:usdc

# Deploy Factory contract (testnet)
yarn contracts:deploy:factory

# Dry run deployments
cd contracts && yarn deploy:usdc:dry
cd contracts && yarn deploy:factory:dry

# Clean build artifacts
yarn contracts:clean
```

### Frontend

```bash
# Start development server
yarn frontend:dev
# OR
cd frontend && yarn dev

# Build for production
yarn frontend:build

# Preview production build
yarn frontend:preview

# Lint code
yarn frontend:lint
```

The frontend development server runs on `http://localhost:5173` by default.

### Backend

```bash
# Start dev server
yarn backend:dev

# Build
yarn backend:build

# Run built server
yarn backend:start
```

## 🌐 Deployment

The contracts are deployed on **ARC Testnet**. Deployment scripts are located in `contracts/scripts/`:

- `DeployUSDC.s.sol` - Deploys mock USDC token
- `DeployFactory.s.sol` - Deploys the MinestartersFactory contract

Deployment artifacts are stored in `contracts/broadcast/`.

---

Built for HackMoney 2026 🚀
