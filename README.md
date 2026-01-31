# Minestarters

## 📁 Project Structure

This is a **Yarn Workspace** monorepo containing:

```
hackmoney2026/
├── contracts/          # Smart contracts (Foundry/Solidity)
│   ├── src/           # Contract source files
│   ├── scripts/       # Deployment scripts
│   └── test/          # Contract tests
└── frontend/          # React frontend (Vite + TypeScript)
    └── src/           # Frontend source code
```

## 🛠️ Tech Stack

### Smart Contracts

- **Solidity** ^0.8.24
- **Foundry** (Forge) for compilation and testing
- **OpenZeppelin** contracts for security standards
- Deployed on **ARC Testnet**

### Frontend

- **React** 19.2 with **TypeScript**
- **Vite** for build tooling
- **Ethers.js** v6 for blockchain interaction
- **TailwindCSS** for styling
- **React Router** for navigation
- **Recharts** for data visualization

## 🚀 Getting Started

### Prerequisites

Make sure you have the following installed:

- **Node.js** 22.17.0 (managed via Volta)
- **Yarn** 1.22.22 (managed via Volta)
- **Foundry** (for smart contract development)

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

   This will install dependencies for both `contracts` and `frontend` workspaces.

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

## 📜 Smart Contracts

### Core Contracts

1. **MinestartersFactory.sol**
   - Factory contract for creating new project vaults
   - Deploys `BasketVault` instances
   - Tracks all created projects

2. **BasketVault.sol**
   - Manages individual project fundraising
   - Handles USDC deposits and share token minting
   - Manages profit distribution to share holders
   - Implements three stages: Fundraising, Active, Failed

3. **BasketShareToken.sol**
   - ERC-20 token representing ownership in a basket
   - Minted when investors contribute USDC
   - Used for profit distribution claims

4. **MockUSDC.sol**
   - Mock USDC token for testing purposes

### Contract Features

- **Weighted Baskets**: Projects can include multiple companies with custom weight distributions
- **Minimum Raise Goals**: Projects must meet minimum funding thresholds
- **Deadline-based Fundraising**: Time-limited fundraising periods
- **Fee Structure**: Configurable raise and profit fees
- **Profit Distribution**: Automatic profit sharing based on share ownership
- **Refund Mechanism**: Investors can reclaim funds if minimum raise isn't met

## 🌐 Deployment

The contracts are deployed on **ARC Testnet**. Deployment scripts are located in `contracts/scripts/`:

- `DeployUSDC.s.sol` - Deploys mock USDC token
- `DeployFactory.s.sol` - Deploys the MinestartersFactory contract

Deployment artifacts are stored in `contracts/broadcast/`.

## 🧪 Testing

```bash
# Run all contract tests
yarn contracts:test

# Run with detailed output
cd contracts && yarn test:verbose
```

Tests are written using Foundry's testing framework and located in `contracts/test/`.

## 📱 Frontend Pages

- **Home**: Landing page and project overview
- **Create Project**: Form to create new fundraising campaigns
- **Project Details**: View individual project information and invest
- **Calculator**: Financial calculations and projections

## 🔧 Configuration

### Foundry Configuration

See `contracts/foundry.toml` for Solidity compiler settings and paths.

### Vite Configuration

Frontend build configuration is in `frontend/vite.config.ts`.

### TailwindCSS

Styling configuration is in `frontend/tailwind.config.js`.

## 📝 License

ISC

## 🤝 Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 🔗 Links

- ARC Testnet Explorer: https://testnet.arcscan.app/
- Deployed Contracts: See `contracts/broadcast/` for deployment details

---

Built for HackMoney 2026 🚀
