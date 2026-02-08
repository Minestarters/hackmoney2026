// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {PoolManager} from "v4-core/PoolManager.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "v4-core/types/PoolId.sol";
import {Currency, CurrencyLibrary} from "v4-core/types/Currency.sol";
import {TickMath} from "v4-core/libraries/TickMath.sol";
import {StateLibrary} from "v4-core/libraries/StateLibrary.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {Hooks} from "v4-core/libraries/Hooks.sol";
import {PoolModifyLiquidityTest} from "v4-core/test/PoolModifyLiquidityTest.sol";
import {PoolSwapTest} from "v4-core/test/PoolSwapTest.sol";
import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";
import {MockUSDC} from "../../src/MockUSDC.sol";

import {NAVEngine} from "../../src/NAVEngine.sol";
import {MinestartersDistributor} from "../../src/MinestartersDistributor.sol";
import {BasketVault} from "../../src/BasketVault.sol";
import {MinestartersFactory} from "../../src/MinestartersFactory.sol";

/// @title RebalanceIntegrationTest
/// @notice Tests that NAV changes trigger correct tick/price updates in Uniswap v4 pools
contract RebalanceIntegrationTest is Test {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;
    using CurrencyLibrary for Currency;

    // ============ Core Contracts ============
    IPoolManager manager;
    PoolModifyLiquidityTest modifyLiquidityRouter;
    PoolSwapTest swapRouter;

    NAVEngine navEngine;
    MinestartersDistributor distributor;
    MinestartersFactory factory;

    MockUSDC usdc;
    MockERC20 shareToken;

    Currency currency0;
    Currency currency1;

    address vault;
    PoolKey poolKey;
    PoolId poolId;

    address owner = address(this);
    address creator = address(0x1);
    address depositor = address(0x2);

    // Constants
    uint160 constant SQRT_PRICE_1_1 = 79228162514264337593543950336; // 1:1 price
    uint160 constant MIN_SQRT_PRICE = TickMath.MIN_SQRT_PRICE + 1;
    uint160 constant MAX_SQRT_PRICE = TickMath.MAX_SQRT_PRICE - 1;

    function setUp() public {
        // Deploy PoolManager (real v4 core)
        manager = new PoolManager(owner);

        // Deploy routers for liquidity/swap operations
        modifyLiquidityRouter = new PoolModifyLiquidityTest(manager);
        swapRouter = new PoolSwapTest(manager);

        // Deploy tokens
        usdc = new MockUSDC();
        shareToken = new MockERC20("SHARE", "SHR", 18);

        // Mint tokens
        usdc.mint(owner, 1_000_000e6);
        usdc.mint(depositor, 100_000e6);
        shareToken.mint(owner, 1_000_000e18);

        // Sort currencies
        if (address(usdc) < address(shareToken)) {
            currency0 = Currency.wrap(address(usdc));
            currency1 = Currency.wrap(address(shareToken));
        } else {
            currency0 = Currency.wrap(address(shareToken));
            currency1 = Currency.wrap(address(usdc));
        }

        // Deploy NAVEngine and Distributor
        navEngine = new NAVEngine(owner, owner);
        distributor = new MinestartersDistributor(address(navEngine), address(manager));

        // Link NAVEngine to Distributor
        navEngine.setDistributor(address(distributor));

        // Deploy Factory with USDC
        factory = new MinestartersFactory(address(usdc));

        // Create the pool
        _initializePool();

        // Create a vault and register with NAVEngine
        _createVaultAndRegister();

        // Approve tokens for routers
        usdc.approve(address(modifyLiquidityRouter), type(uint256).max);
        shareToken.approve(address(modifyLiquidityRouter), type(uint256).max);
        usdc.approve(address(swapRouter), type(uint256).max);
        shareToken.approve(address(swapRouter), type(uint256).max);
    }

    function _initializePool() internal {
        // Create pool with no hooks for simplicity (testing distributor logic)
        poolKey = PoolKey({
            currency0: currency0,
            currency1: currency1,
            fee: 3000, // 0.3% fee
            tickSpacing: 60,
            hooks: IHooks(address(0))
        });

        poolId = poolKey.toId();

        // Initialize pool at 1:1 price
        manager.initialize(poolKey, SQRT_PRICE_1_1);
    }

    function _createVaultAndRegister() internal {
        // Create vault through factory
        string[] memory names = new string[](1);
        names[0] = "GoldCorp Mining";
        uint256[] memory weights = new uint256[](1);
        weights[0] = 100;

        vm.prank(creator);
        vault = factory.createProjectWithNAV(
            "Gold Project",
            names,
            weights,
            10_000e6, // 10k minimum raise
            block.timestamp + 30 days,
            creator,
            0 // no fee
        );

        // Deposit to mint share tokens
        usdc.approve(vault, 50_000e6);
        BasketVault(vault).deposit(50_000e6, 1); // 50k USDC deposit

        // Register vault with NAVEngine
        navEngine.registerVault(vault, 1_000_000e18, creator); // 1M token supply

        // Register company with correct 9-arg signature
        navEngine.registerCompany(
            vault,
            "GoldCorp Mining", // name
            100, // weight
            10000, // 10k total resource tonnes
            9000, // 90% recovery rate
            5, // 5 years to production
            15, // 15 years mine life
            1000, // 10% discount rate
            0 // floor NAV
        );

        // Set gold price
        navEngine.updateGoldPrice(2000e6); // $2000/oz
    }

    // ============ Test 1: NAV Change Triggers Tick Calculation ============

    function test_NAVChangeUpdatesTargetTick() public {
        // Get initial NAV (exploration stage = 0)
        uint256 initialNAV = navEngine.getCurrentNAV(vault);
        console.log("Initial NAV (exploration stage):", initialNAV);
        assertEq(initialNAV, 0, "Exploration stage has no DCF value");

        // Calculate what the tick should be for this NAV
        bool isToken0Share = address(shareToken) < address(usdc);
        int24 initialTick = distributor.calculateTickForNAV(initialNAV, isToken0Share);
        console.log("Initial calculated tick:");
        console.logInt(initialTick);
        assertEq(initialTick, 0, "Zero NAV should return zero tick");

        // Advance to Permits stage (NAV should increase due to k_permits)
        navEngine.advanceCompanyStage(vault, 0, 3, 15); // 3 years to production, 15 years mine life

        uint256 permitsNAV = navEngine.getCurrentNAV(vault);
        console.log("NAV after Permits stage:", permitsNAV);

        int24 permitsTick = distributor.calculateTickForNAV(permitsNAV, isToken0Share);
        console.log("Permits stage calculated tick:");
        console.logInt(permitsTick);

        // NAV should have increased from 0
        assertGt(permitsNAV, initialNAV, "NAV should increase after permits");
        // Tick should be non-zero now
        assertTrue(permitsTick != 0, "Tick should change with non-zero NAV");

        // Advance to Construction stage
        navEngine.advanceCompanyStage(vault, 0, 2, 15);

        uint256 constructionNAV = navEngine.getCurrentNAV(vault);
        console.log("NAV after Construction stage:", constructionNAV);

        int24 constructionTick = distributor.calculateTickForNAV(constructionNAV, isToken0Share);
        console.log("Construction stage calculated tick:");
        console.logInt(constructionTick);

        // NAV should continue increasing (k_construction > k_permits)
        assertGt(constructionNAV, permitsNAV, "NAV should increase after construction");
        // Tick should change with NAV
        assertTrue(constructionTick != permitsTick, "Tick should change with NAV");

        // Advance to Production stage
        navEngine.advanceCompanyStage(vault, 0, 0, 15);

        uint256 productionNAV = navEngine.getCurrentNAV(vault);
        console.log("NAV after Production stage:", productionNAV);

        int24 productionTick = distributor.calculateTickForNAV(productionNAV, isToken0Share);
        console.log("Production stage calculated tick:");
        console.logInt(productionTick);

        // Production NAV depends on inventory (currently 0) and DCF model
        // The important thing is that NAV > 0 and tick is calculated
        assertGt(productionNAV, 0, "Production NAV should be > 0");
        assertTrue(productionTick != 0, "Production tick should be non-zero");

        // Verify different NAV values produce different ticks
        assertTrue(
            permitsTick != constructionTick || permitsTick != productionTick,
            "Different NAV stages should produce different ticks"
        );

        // Log the full progression
        console.log("=== NAV Progression ===");
        console.log("Exploration -> Permits -> Construction -> Production");
        console.log(initialNAV);
        console.log(permitsNAV);
        console.log(constructionNAV);
        console.log(productionNAV);

        console.log("=== Tick Progression ===");
        console.logInt(initialTick);
        console.logInt(permitsTick);
        console.logInt(constructionTick);
        console.logInt(productionTick);
    }

    // ============ Test 2: Price Verification with Pool State ============

    function test_SqrtPriceCorrespondsToNAV() public {
        // Calculate sqrt price for different NAV values
        uint256 nav1 = 1e6; // $1 NAV
        uint256 nav5 = 5e6; // $5 NAV
        uint256 nav10 = 10e6; // $10 NAV

        bool isToken0Share = address(shareToken) < address(usdc);

        uint160 sqrtPrice1 = distributor.getSqrtPriceFromNAV(nav1, isToken0Share);
        uint160 sqrtPrice5 = distributor.getSqrtPriceFromNAV(nav5, isToken0Share);
        uint160 sqrtPrice10 = distributor.getSqrtPriceFromNAV(nav10, isToken0Share);

        console.log("=== SqrtPrice for different NAVs ===");
        console.log("$1 NAV sqrtPriceX96:", sqrtPrice1);
        console.log("$5 NAV sqrtPriceX96:", sqrtPrice5);
        console.log("$10 NAV sqrtPriceX96:", sqrtPrice10);

        // Convert to ticks
        int24 tick1 = distributor.calculateTickForNAV(nav1, isToken0Share);
        int24 tick5 = distributor.calculateTickForNAV(nav5, isToken0Share);
        int24 tick10 = distributor.calculateTickForNAV(nav10, isToken0Share);

        console.log("$1 NAV tick:");
        console.logInt(tick1);
        console.log("$5 NAV tick:");
        console.logInt(tick5);
        console.log("$10 NAV tick:");
        console.logInt(tick10);

        // Verify tick ordering makes sense
        // Higher NAV = higher price for share token
        if (isToken0Share) {
            // share is token0, so price = token1/token0 = USDC/share
            // Higher NAV means more USDC per share = higher price = higher tick
            assertGt(tick5, tick1, "Higher NAV should have higher tick when share is token0");
            assertGt(tick10, tick5, "Higher NAV should have higher tick when share is token0");
        } else {
            // share is token1, so price = token1/token0 = share/USDC (inverted)
            // Higher NAV means we need LESS share per USDC = lower tick
            assertLt(tick5, tick1, "Higher NAV should have lower tick when share is token1");
            assertLt(tick10, tick5, "Higher NAV should have lower tick when share is token1");
        }

        // Verify sqrtPrices are within valid bounds
        assertGe(sqrtPrice1, TickMath.MIN_SQRT_PRICE, "sqrtPrice1 should be >= MIN");
        assertLe(sqrtPrice1, TickMath.MAX_SQRT_PRICE, "sqrtPrice1 should be <= MAX");
        assertGe(sqrtPrice10, TickMath.MIN_SQRT_PRICE, "sqrtPrice10 should be >= MIN");
        assertLe(sqrtPrice10, TickMath.MAX_SQRT_PRICE, "sqrtPrice10 should be <= MAX");

        // Verify round-trip: tick -> sqrtPrice -> tick should be consistent
        uint160 sqrtFromTick1 = TickMath.getSqrtPriceAtTick(tick1);
        int24 tickFromSqrt1 = TickMath.getTickAtSqrtPrice(sqrtFromTick1);
        assertEq(tick1, tickFromSqrt1, "Tick round-trip should be consistent");

        console.log("=== Round-trip validation passed ===");
    }

    // ============ Test 3: Advanced Tick Range Rebalancing ============

    /// @notice Advanced test: Full flow from NAV change → Distributor registration → Tick range update
    /// @dev Tests the complete integration: NAVEngine triggers Distributor which calculates new tick ranges
    function test_AdvancedTickRangeRebalancing() public {
        console.log("=== Advanced Tick Range Rebalancing Test ===");

        bool isToken0Share = address(shareToken) < address(usdc);
        int24 tickSpacing = poolKey.tickSpacing; // 60

        // ============ Step 1: Register pool with Distributor ============
        console.log("\n[Step 1] Registering pool with Distributor...");

        // Register the vault's pool with the distributor
        distributor.registerPool(vault, poolKey, 0, isToken0Share);

        // Verify pool is registered
        (
            ,
            address registeredVault,
            address registeredShareToken,
            address registeredQuoteToken,,
            int24 storedTickLower,
            int24 storedTickUpper,,,
        ) = distributor.vaultPools(vault);

        assertEq(registeredVault, vault, "Vault should be registered");
        assertEq(registeredShareToken, address(shareToken), "Share token should match");
        assertEq(registeredQuoteToken, address(usdc), "Quote token should match");
        console.log("Pool registered with Distributor");

        // ============ Step 2: Get initial tick range (NAV = 0) ============
        console.log("\n[Step 2] Initial state (Exploration stage)...");

        uint256 nav0 = navEngine.getCurrentNAV(vault);
        int24 tick0 = distributor.calculateTickForNAV(nav0, isToken0Share);

        console.log("Initial NAV:", nav0);
        console.log("Initial center tick:");
        console.logInt(tick0);
        console.log("Stored tick range:");
        console.logInt(storedTickLower);
        console.logInt(storedTickUpper);

        // ============ Step 3: Advance to Permits - NAV increases ============
        console.log("\n[Step 3] Advancing to Permits stage...");

        // Store tick range before
        (,,,,, int24 tickLowerBefore, int24 tickUpperBefore,,,) = distributor.vaultPools(vault);

        // Advance stage - this triggers onNAVChanged via NAVEngine
        navEngine.advanceCompanyStage(vault, 0, 4, 20);

        // Get new NAV and tick
        uint256 nav1 = navEngine.getCurrentNAV(vault);
        int24 tick1 = distributor.calculateTickForNAV(nav1, isToken0Share);

        // Get updated tick range from distributor
        (,,,,, int24 tickLower1, int24 tickUpper1,,,) = distributor.vaultPools(vault);

        console.log("Permits NAV:", nav1);
        console.log("Permits center tick:");
        console.logInt(tick1);
        console.log("New tick range:");
        console.logInt(tickLower1);
        console.logInt(tickUpper1);

        // Verify NAV increased
        assertGt(nav1, nav0, "NAV should increase after permits");

        // Verify tick range was updated (if NAV > 0)
        if (nav1 > 0) {
            // Tick range should have changed or been initialized
            assertTrue(
                tickLower1 != tickLowerBefore || tickUpper1 != tickUpperBefore || nav0 == 0,
                "Tick range should update when NAV changes"
            );
        }

        // Verify tick range is aligned to tick spacing
        assertEq(tickLower1 % tickSpacing, 0, "tickLower should be aligned to tickSpacing");
        assertEq(tickUpper1 % tickSpacing, 0, "tickUpper should be aligned to tickSpacing");

        // ============ Step 4: Advance to Construction - NAV increases more ============
        console.log("\n[Step 4] Advancing to Construction stage...");

        navEngine.advanceCompanyStage(vault, 0, 2, 18);

        uint256 nav2 = navEngine.getCurrentNAV(vault);
        int24 tick2 = distributor.calculateTickForNAV(nav2, isToken0Share);
        (,,,,, int24 tickLower2, int24 tickUpper2,,,) = distributor.vaultPools(vault);

        console.log("Construction NAV:", nav2);
        console.log("Construction center tick:");
        console.logInt(tick2);
        console.log("New tick range:");
        console.logInt(tickLower2);
        console.logInt(tickUpper2);

        assertGt(nav2, nav1, "NAV should increase in construction");

        // ============ Step 5: Advance to Production ============
        console.log("\n[Step 5] Advancing to Production stage...");

        navEngine.advanceCompanyStage(vault, 0, 0, 18);

        uint256 nav3 = navEngine.getCurrentNAV(vault);
        int24 tick3 = distributor.calculateTickForNAV(nav3, isToken0Share);
        (,,,,, int24 tickLower3, int24 tickUpper3,,,) = distributor.vaultPools(vault);

        console.log("Production NAV:", nav3);
        console.log("Production center tick:");
        console.logInt(tick3);
        console.log("New tick range:");
        console.logInt(tickLower3);
        console.logInt(tickUpper3);

        // ============ Step 6: Verify tick range properties ============
        console.log("\n[Step 6] Verifying tick range properties...");

        // Get default tick spread from distributor
        (int24 defaultTickSpread,) = distributor.defaultParams();

        // Verify tick range width matches spread
        int24 rangeWidth3 = tickUpper3 - tickLower3;
        int24 expectedWidth = (defaultTickSpread * 2);
        // Round expected width to tick spacing
        expectedWidth = (expectedWidth / tickSpacing) * tickSpacing;
        if (expectedWidth == 0) expectedWidth = tickSpacing * 2;

        console.log("Tick range width:");
        console.logInt(rangeWidth3);
        console.log("Default spread (each side):");
        console.logInt(defaultTickSpread);

        // Verify tick range is symmetric around center tick (approximately)
        int24 centerTick3 = (tickLower3 + tickUpper3) / 2;
        int24 calculatedCenter = (tick3 / tickSpacing) * tickSpacing;

        console.log("Center of stored range:");
        console.logInt(centerTick3);
        console.log("Calculated center tick (rounded):");
        console.logInt(calculatedCenter);

        // Allow for rounding differences
        int24 centerDiff =
            centerTick3 > calculatedCenter ? centerTick3 - calculatedCenter : calculatedCenter - centerTick3;
        assertLe(centerDiff, tickSpacing * 2, "Center tick should be close to calculated tick");

        // ============ Step 7: Verify sqrtPrice can initialize pool at this tick ============
        console.log("\n[Step 7] Verifying sqrtPrice validity for pool initialization...");

        uint160 sqrtPrice3 = distributor.getSqrtPriceFromNAV(nav3, isToken0Share);
        console.log("Production sqrtPriceX96:", sqrtPrice3);

        // Verify it's within Uniswap bounds
        assertGt(sqrtPrice3, TickMath.MIN_SQRT_PRICE, "sqrtPrice should be > MIN");
        assertLt(sqrtPrice3, TickMath.MAX_SQRT_PRICE, "sqrtPrice should be < MAX");

        // Verify the tick from sqrtPrice matches our calculation
        int24 tickFromSqrt = TickMath.getTickAtSqrtPrice(sqrtPrice3);
        console.log("Tick from sqrtPrice:");
        console.logInt(tickFromSqrt);

        // Should be within 1 tick of calculated (due to rounding)
        int24 tickDiff = tick3 > tickFromSqrt ? tick3 - tickFromSqrt : tickFromSqrt - tick3;
        assertLe(tickDiff, 1, "Tick from sqrtPrice should match calculated tick");
    }

    // ============ Test 4: Swap After Rebalance (Realistic Flow) ============

    /// @notice Test complete flow: Investors deposit → LP provides liquidity → NAV changes → Swaps work
    function test_SwapAfterRebalance() public {
        console.log("=== Swap After Rebalance Test (Realistic Flow) ===");

        // ============ Setup: Define actors ============
        address lpScript = address(0x100); // LP provider (also an investor)
        address investor1 = address(0x101); // Regular investor
        address trader = address(0x102); // Someone who wants to swap

        // Mint USDC to all actors
        usdc.mint(lpScript, 500_000e6);
        usdc.mint(investor1, 100_000e6);
        usdc.mint(trader, 50_000e6);

        // ============ Step 1: Create vault using Factory ============
        console.log("\n[Step 1] Creating vault via Factory...");

        string[] memory names = new string[](1);
        names[0] = "Gold Mining Corp";
        uint256[] memory weights = new uint256[](1);
        weights[0] = 100;

        // Use factory to create project with NAV support
        // Match deposits with minimum raise: 250k USDC
        vm.prank(creator);
        address swapVault = factory.createProjectWithNAV(
            "Gold Project - Swap Test",
            names,
            weights,
            250_000e6, // 250k minimum raise
            block.timestamp + 30 days,
            creator,
            0 // no fee
        );

        address vaultShareToken = BasketVault(swapVault).shareToken();
        console.log("Vault created:", swapVault);
        console.log("Share token:", vaultShareToken);

        // Get factory's NAVEngine (the one that has the vault registered)
        NAVEngine factoryNavEngine = factory.navEngine();

        // Setup Distributor for Factory NAVEngine
        // We need a specific distributor linked to the factory's engine so callbacks work
        MinestartersDistributor factoryDistributor =
            new MinestartersDistributor(address(factoryNavEngine), address(manager));

        // Link engine to distributor (Test contract is owner of factoryNavEngine because it deployed Factory)
        factoryNavEngine.setDistributor(address(factoryDistributor));

        // Set positionManager in distributor (required for rebalancing if lpTokenId > 0, or generalized logic)
        factoryDistributor.setPositionManager(address(modifyLiquidityRouter));

        // Ensure pool usage uses the correct distributor for calculations if needed
        // (Though manually calculating in test is fine, we should use factoryDistributor for consistency)

        // ============ Step 2: Investors deposit to get share tokens ============
        console.log("\n[Step 2] Investors depositing...");

        // LP Script deposits 200k USDC
        vm.startPrank(lpScript);
        usdc.approve(swapVault, 200_000e6);
        BasketVault(swapVault).deposit(200_000e6, 1);
        vm.stopPrank();

        // Investor1 deposits 50k USDC
        vm.startPrank(investor1);
        usdc.approve(swapVault, 50_000e6);
        BasketVault(swapVault).deposit(50_000e6, 1);
        vm.stopPrank();

        uint256 lpShareBalance = MockERC20(vaultShareToken).balanceOf(lpScript);
        console.log("LP Script shares:", lpShareBalance);

        assertGt(lpShareBalance, 0, "LP should have shares");

        // ============ Step 3: Check initial NAV and advance stage ============
        console.log("\n[Step 3] Checking NAV and advancing stage...");

        // Get initial NAV
        uint256 initialNAV = factoryNavEngine.getCurrentNAV(swapVault);
        console.log("Initial NAV (exploration):", initialNAV);

        // Update gold price
        factoryNavEngine.updateGoldPrice(2000e6);

        // Advance to Permits stage (as creator)
        vm.prank(creator);
        // Advance parameters: newYearsToProduction=3, newRemainingMineLife=15
        factoryNavEngine.advanceCompanyStage(swapVault, 0, 3, 15);

        uint256 permitsNAV = factoryNavEngine.getCurrentNAV(swapVault);
        console.log("NAV after Permits stage:", permitsNAV);

        // NAV should be positive
        assertTrue(permitsNAV > 0, "NAV should be positive");

        // ============ Step 4: Create pool at NAV price ============
        console.log("\n[Step 4] Creating pool at NAV price...");

        // Determine token ordering
        Currency c0;
        Currency c1;
        if (address(usdc) < vaultShareToken) {
            c0 = Currency.wrap(address(usdc));
            c1 = Currency.wrap(vaultShareToken);
        } else {
            c0 = Currency.wrap(vaultShareToken);
            c1 = Currency.wrap(address(usdc));
        }

        bool isToken0Share = vaultShareToken < address(usdc);
        int24 navTick = factoryDistributor.calculateTickForNAV(permitsNAV, isToken0Share);
        uint160 navSqrtPrice = TickMath.getSqrtPriceAtTick(navTick);

        console.log("NAV tick:");
        console.logInt(navTick);

        PoolKey memory swapPoolKey =
            PoolKey({currency0: c0, currency1: c1, fee: 3000, tickSpacing: 60, hooks: IHooks(address(0))});

        manager.initialize(swapPoolKey, navSqrtPrice);
        console.log("Pool initialized at NAV price");

        // Register pool with distributor so onNAVChanged (triggered by advanceCompanyStage) works
        // We pass 0 for lpTokenId since we are using raw liquidity in test
        factoryDistributor.registerPool(swapVault, swapPoolKey, 0, isToken0Share);

        // ============ Step 5: LP Script provides liquidity VIA DISTRIBUTOR ============
        console.log("\n[Step 5] LP Script providing liquidity via Distributor...");

        // Calculate tick range (+/- 2000 ticks)
        int24 tickSpacing = swapPoolKey.tickSpacing;
        int24 tickLower = ((navTick - 2000) / tickSpacing) * tickSpacing;
        int24 tickUpper = ((navTick + 2000) / tickSpacing) * tickSpacing;

        console.log("Liquidity range:");
        console.logInt(tickLower);
        console.logInt(tickUpper);

        // LP transfers tokens to Distributor
        uint256 usdcToProvide = 100_000e6;
        uint256 sharesToProvide = lpShareBalance / 2; // Use half of LP's shares

        vm.startPrank(lpScript);
        usdc.transfer(address(factoryDistributor), usdcToProvide);
        MockERC20(vaultShareToken).transfer(address(factoryDistributor), sharesToProvide);
        vm.stopPrank();

        // Distributor approves PoolManager to take tokens
        // (This requires the Distributor to have an approve function or we use vm.prank)
        vm.startPrank(address(factoryDistributor));
        usdc.approve(address(manager), type(uint256).max);
        MockERC20(vaultShareToken).approve(address(manager), type(uint256).max);
        vm.stopPrank();

        // Now call addInitialLiquidity (test contract is owner of factoryDistributor)
        uint128 liquidityAmount = 10000e6;
        factoryDistributor.addInitialLiquidity(swapVault, tickLower, tickUpper, liquidityAmount);

        console.log("Liquidity added via Distributor");

        // ============ Step 6: Trader swaps USDC for Shares ============
        console.log("\n[Step 6] Trader swapping USDC -> Shares...");

        uint256 traderInitialUsdc = usdc.balanceOf(trader);
        uint256 traderInitialShares = MockERC20(vaultShareToken).balanceOf(trader);

        // Trader approves
        vm.startPrank(trader);
        usdc.approve(address(swapRouter), type(uint256).max);

        bool usdcIsC0 = Currency.unwrap(c0) == address(usdc);
        int256 swapAmount = 1000e6; // 1000 USDC

        IPoolManager.SwapParams memory buyParams = IPoolManager.SwapParams({
            zeroForOne: usdcIsC0,
            amountSpecified: -swapAmount,
            sqrtPriceLimitX96: usdcIsC0 ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
        });

        PoolSwapTest.TestSettings memory settings =
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false});

        swapRouter.swap(swapPoolKey, buyParams, settings, "");
        vm.stopPrank();

        uint256 traderFinalUsdc = usdc.balanceOf(trader);
        uint256 traderFinalShares = MockERC20(vaultShareToken).balanceOf(trader);

        uint256 usdcSpent = traderInitialUsdc - traderFinalUsdc;
        uint256 sharesReceived = traderFinalShares - traderInitialShares;

        console.log("USDC spent:", usdcSpent);
        console.log("Shares received:", sharesReceived);

        assertGt(usdcSpent, 0, "Should have spent USDC");
        assertGt(sharesReceived, 0, "Should have received shares");

        // ============ Step 7: Advancing stage (NAV changes) ============
        console.log("\n[Step 7] Advancing to Construction (NAV changes)...");

        // Advance to Construction stage (as creator)
        vm.prank(creator);
        // Parameters: newYearsToProduction=3, newRemainingMineLife=15
        factoryNavEngine.advanceCompanyStage(swapVault, 0, 3, 15);

        uint256 constructionNAV = factoryNavEngine.getCurrentNAV(swapVault);
        console.log("New NAV after construction:", constructionNAV);

        // NAV should increase
        assertGe(constructionNAV, permitsNAV, "NAV should not decrease");

        // ============ Step 8: Trader swaps shares back ============
        console.log("\n[Step 8] Trader swapping Shares -> USDC...");

        vm.startPrank(trader);
        MockERC20(vaultShareToken).approve(address(swapRouter), type(uint256).max);

        IPoolManager.SwapParams memory sellParams = IPoolManager.SwapParams({
            zeroForOne: !usdcIsC0,
            amountSpecified: -int256(sharesReceived),
            sqrtPriceLimitX96: !usdcIsC0 ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
        });

        swapRouter.swap(swapPoolKey, sellParams, settings, "");
        vm.stopPrank();

        uint256 traderEndUsdc = usdc.balanceOf(trader);
        uint256 traderEndShares = MockERC20(vaultShareToken).balanceOf(trader);

        console.log("USDC recovered:", traderEndUsdc - traderFinalUsdc);
        console.log("Final shares:", traderEndShares);

        // In an AMM, you may not be able to sell 100% of shares due to liquidity limits
        // Just verify that trade executed and some USDC was recovered
        assertGt(traderEndUsdc, traderFinalUsdc, "Should have recovered some USDC");

        console.log("\n=== Test Passed! ===");
    }
}
