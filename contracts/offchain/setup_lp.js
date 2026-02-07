/**
	* LP Setup Script - Minestarters (JavaScript/viem version)
	* One-time setup: Deposit, create pool, register, and add liquidity for a vault.
	*
	* Usage:
	*   node setup_lp.js <VAULT_ADDRESS> [USDC_AMOUNT]
	*
	* Example:
	*   node setup_lp.js 0x367F7BF37F7E2D6EA3De96D8caDB0c3eAe4C13BE
	*   node setup_lp.js 0x367F7BF37F7E2D6EA3De96D8caDB0c3eAe4C13BE 50000
	*/

import { createPublicClient, createWalletClient, http, parseUnits, formatUnits, getAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Load .env from script directory
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '.env') });

// Configuration
const RPC_URL = process.env.RPC_URL || 'http://localhost:8545';
const PRIVATE_KEY = process.env.PRIVATE_KEY;

const FACTORY_ADDRESS = process.env.FACTORY_ADDRESS;
const DISTRIBUTOR_ADDRESS = process.env.DISTRIBUTOR_ADDRESS;
const POOL_MANAGER_ADDRESS = process.env.POOL_MANAGER_ADDRESS;
const NAV_ENGINE_ADDRESS = process.env.NAV_ENGINE_ADDRESS;
const USDC_ADDRESS = process.env.USDC_ADDRESS;

// LP Configuration
const LP_ALLOCATION_BPS = 5000n; // 50%
const DEFAULT_TICK_SPREAD = 1000;
const POOL_FEE = 3000;
const TICK_SPACING = 60;
const DEFAULT_NAV = 10000n; // $0.01 fallback

// ABIs
const ERC20_ABI = [
	{
		inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }],
		name: 'approve',
		outputs: [{ type: 'bool' }],
		stateMutability: 'nonpayable',
		type: 'function',
	},
	{
		inputs: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }],
		name: 'transfer',
		outputs: [{ type: 'bool' }],
		stateMutability: 'nonpayable',
		type: 'function',
	},
	{
		inputs: [{ name: 'account', type: 'address' }],
		name: 'balanceOf',
		outputs: [{ type: 'uint256' }],
		stateMutability: 'view',
		type: 'function',
	},
];

const NAV_ENGINE_ABI = [
	{
		inputs: [{ name: 'vault', type: 'address' }],
		name: 'getCurrentNAV',
		outputs: [{ type: 'uint256' }],
		stateMutability: 'view',
		type: 'function',
	},
];

const DISTRIBUTOR_ABI = [
	{
		inputs: [
			{ name: 'vault', type: 'address' },
			{
				name: 'poolKey',
				type: 'tuple',
				components: [
					{ name: 'currency0', type: 'address' },
					{ name: 'currency1', type: 'address' },
					{ name: 'fee', type: 'uint24' },
					{ name: 'tickSpacing', type: 'int24' },
					{ name: 'hooks', type: 'address' },
				],
			},
			{ name: 'lpTokenId', type: 'uint256' },
			{ name: 'isToken0Share', type: 'bool' },
		],
		name: 'registerPool',
		outputs: [],
		stateMutability: 'nonpayable',
		type: 'function',
	},
	{
		inputs: [
			{ name: 'vault', type: 'address' },
			{ name: 'tickLower', type: 'int24' },
			{ name: 'tickUpper', type: 'int24' },
			{ name: 'amount', type: 'uint128' },
		],
		name: 'addInitialLiquidity',
		outputs: [],
		stateMutability: 'nonpayable',
		type: 'function',
	},
	{
		inputs: [{ name: 'navPerToken', type: 'uint256' }, { name: 'isToken0Share', type: 'bool' }],
		name: 'calculateTickForNAV',
		outputs: [{ type: 'int24' }],
		stateMutability: 'pure',
		type: 'function',
	},
	{
		inputs: [{ name: 'navPerToken', type: 'uint256' }, { name: 'isToken0Share', type: 'bool' }],
		name: 'getSqrtPriceFromNAV',
		outputs: [{ type: 'uint160' }],
		stateMutability: 'pure',
		type: 'function',
	},
];

const POOL_MANAGER_ABI = [
	{
		inputs: [
			{
				name: 'key',
				type: 'tuple',
				components: [
					{ name: 'currency0', type: 'address' },
					{ name: 'currency1', type: 'address' },
					{ name: 'fee', type: 'uint24' },
					{ name: 'tickSpacing', type: 'int24' },
					{ name: 'hooks', type: 'address' },
				],
			},
			{ name: 'sqrtPriceX96', type: 'uint160' },
		],
		name: 'initialize',
		outputs: [{ type: 'int24' }],
		stateMutability: 'nonpayable',
		type: 'function',
	},
];

const VAULT_ABI = [
	{
		inputs: [{ name: 'amount', type: 'uint256' }, { name: 'minShares', type: 'uint256' }],
		name: 'deposit',
		outputs: [{ type: 'uint256' }],
		stateMutability: 'nonpayable',
		type: 'function',
	},
	{
		inputs: [],
		name: 'shareToken',
		outputs: [{ type: 'address' }],
		stateMutability: 'view',
		type: 'function',
	},
];

// Setup clients
const account = privateKeyToAccount(PRIVATE_KEY);
const publicClient = createPublicClient({
	chain: sepolia,
	transport: http(RPC_URL),
});
const walletClient = createWalletClient({
	account,
	chain: sepolia,
	transport: http(RPC_URL),
});

console.log(`Using account: ${account.address}`);

// Helper function to send transaction and wait for receipt
async function sendTx(request) {
	const hash = await walletClient.writeContract(request);
	console.log(`  TX: ${hash}`);
	const receipt = await publicClient.waitForTransactionReceipt({ hash });
	console.log(`  Mined in block ${receipt.blockNumber}`);
	return receipt;
}

// Round tick to spacing
function roundTick(tick, spacing) {
	return Math.floor(tick / spacing) * spacing;
}

// Main setup function
async function setupLP(vaultAddress, fundingAmount) {
	const vault = getAddress(vaultAddress);
	const usdc = getAddress(USDC_ADDRESS);
	const navEngine = getAddress(NAV_ENGINE_ADDRESS);
	const distributor = getAddress(DISTRIBUTOR_ADDRESS);
	const poolManager = getAddress(POOL_MANAGER_ADDRESS);

	console.log(`\n${'='.repeat(60)}`);
	console.log(`LP SETUP FOR VAULT: ${vault}`);
	console.log(`${'='.repeat(60)}`);

	// Get share token
	const shareTokenAddress = await publicClient.readContract({
		address: vault,
		abi: VAULT_ABI,
		functionName: 'shareToken',
	});

	console.log(`\nShare Token: ${shareTokenAddress}`);
	console.log(`USDC: ${usdc}`);
	console.log(`Funding: ${formatUnits(fundingAmount, 6)} USDC`);

	// Step 1: Deposit
	console.log(`\n[1/7] Depositing USDC to vault...`);
	await sendTx({
		address: usdc,
		abi: ERC20_ABI,
		functionName: 'approve',
		args: [vault, fundingAmount],
	});
	await sendTx({
		address: vault,
		abi: VAULT_ABI,
		functionName: 'deposit',
		args: [fundingAmount, 1n],
	});

	const sharesReceived = await publicClient.readContract({
		address: shareTokenAddress,
		abi: ERC20_ABI,
		functionName: 'balanceOf',
		args: [account.address],
	});
	console.log(`  Shares received: ${sharesReceived}`);

	if (sharesReceived === 0n) {
		console.log('ERROR: No shares received. Vault may require finalization first.');
		return;
	}

	// Step 2: Get NAV
	console.log(`\n[2/7] Getting current NAV...`);
	let currentNav = await publicClient.readContract({
		address: navEngine,
		abi: NAV_ENGINE_ABI,
		functionName: 'getCurrentNAV',
		args: [vault],
	});

	if (currentNav === 0n) {
		currentNav = DEFAULT_NAV;
		console.log(`  NAV is 0, using default: $${formatUnits(DEFAULT_NAV, 6)}`);
	} else {
		console.log(`  Current NAV: $${formatUnits(currentNav, 6)}`);
	}

	const isToken0Share = BigInt(shareTokenAddress) < BigInt(usdc);
	const navTick = await publicClient.readContract({
		address: distributor,
		abi: DISTRIBUTOR_ABI,
		functionName: 'calculateTickForNAV',
		args: [currentNav, isToken0Share],
	});
	console.log(`Is share token0: ${isToken0Share}`);
	console.log(`NAV Tick: ${navTick}`);

	// Step 3: Create pool
	console.log(`\n[3/7] Creating Uniswap V4 pool...`);
	const [currency0, currency1] = isToken0Share
		? [shareTokenAddress, usdc]
		: [usdc, shareTokenAddress];

	const sqrtPrice = await publicClient.readContract({
		address: distributor,
		abi: DISTRIBUTOR_ABI,
		functionName: 'getSqrtPriceFromNAV',
		args: [currentNav, isToken0Share],
	});
	console.log(`SqrtPriceX96: ${sqrtPrice}`);

	const poolKey = {
		currency0,
		currency1,
		fee: POOL_FEE,
		tickSpacing: TICK_SPACING,
		hooks: '0x0000000000000000000000000000000000000000',
	};

	await sendTx({
		address: poolManager,
		abi: POOL_MANAGER_ABI,
		functionName: 'initialize',
		args: [poolKey, sqrtPrice],
	});
	console.log('Pool initialized!');

	// Step 4: Register pool
	console.log(`\n[4/7] Registering pool with distributor...`);
	await sendTx({
		address: distributor,
		abi: DISTRIBUTOR_ABI,
		functionName: 'registerPool',
		args: [vault, poolKey, 0n, isToken0Share],
	});
	console.log('  Pool registered!');

	// Step 5: Calculate amounts
	console.log(`\n[5/7] Calculating LP amounts...`);
	const sharesForLp = (sharesReceived * LP_ALLOCATION_BPS) / 10000n;
	const usdcForLp = (sharesForLp * currentNav) / 1000000n;
	console.log(`  Shares for LP: ${sharesForLp}`);
	console.log(`  USDC for LP: ${usdcForLp}`);

	// Step 6: Transfer to distributor
	console.log(`\n[6/7] Transferring tokens to distributor...`);
	await sendTx({
		address: shareTokenAddress,
		abi: ERC20_ABI,
		functionName: 'transfer',
		args: [distributor, sharesForLp],
	});
	await sendTx({
		address: usdc,
		abi: ERC20_ABI,
		functionName: 'transfer',
		args: [distributor, usdcForLp],
	});
	console.log('Tokens transferred!');

	// Step 7: Add liquidity
	console.log(`\n[7/7] Adding initial liquidity...`);
	const tickLower = roundTick(Number(navTick) - DEFAULT_TICK_SPREAD, TICK_SPACING);
	const tickUpper = roundTick(Number(navTick) + DEFAULT_TICK_SPREAD, TICK_SPACING);
	const liquidityAmount = sharesForLp / 100n;

	console.log(`Tick range: [${tickLower}, ${tickUpper}]`);
	console.log(`Liquidity: ${liquidityAmount}`);

	await sendTx({
		address: distributor,
		abi: DISTRIBUTOR_ABI,
		functionName: 'addInitialLiquidity',
		args: [vault, tickLower, tickUpper, liquidityAmount],
	});

	console.log(`\n${'='.repeat(60)}`);
	console.log('LP SETUP COMPLETE!');
	console.log(`${'='.repeat(60)}`);
	console.log(`  Vault:       ${vault}`);
	console.log(`  ShareToken:  ${shareTokenAddress}`);
	console.log(`  USDC:        ${usdc}`);
	console.log(`  NAVEngine:   ${navEngine}`);
	console.log(`  Distributor: ${distributor}`);
	console.log(`\nAdvance stage command:`);
	console.log(`  cast send ${navEngine} "advanceCompanyStage(address,uint256,uint32,uint32)" ${vault} 0 3 15 --rpc-url <RPC> --private-key <KEY>`);
}

// CLI
const args = process.argv.slice(2);
if (args.length < 1) {
	console.log('Usage: node setup_lp.js <VAULT_ADDRESS> [USDC_AMOUNT]');
	console.log('');
	console.log('Example:');
	console.log('  node setup_lp.js 0x367F7BF37F7E2D6EA3De96D8caDB0c3eAe4C13BE');
	console.log('  node setup_lp.js 0x367F7BF37F7E2D6EA3De96D8caDB0c3eAe4C13BE 50000');
	process.exit(1);
}

const vaultAddress = args[0];
const usdcAmount = args[1] ? parseFloat(args[1]) : 100000;
const fundingAmount = parseUnits(usdcAmount.toString(), 6);

setupLP(vaultAddress, fundingAmount).catch(console.error);
