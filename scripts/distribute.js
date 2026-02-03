const { BridgingKit } = require('@circle-fin/bridging-kit');
const fetch = require('node-fetch'); // Ensure node-fetch is available or use native fetch in Node 18+
require('dotenv').config();

// Configuration
const SUBGRAPH_URL = process.env.SUBGRAPH_URL || "https://api.thegraph.com/subgraphs/name/minestarters/hackmoney2026";
const TREASURY_PRIVATE_KEY = process.env.TREASURY_PRIVATE_KEY;
const CIRCLE_API_KEY = process.env.CIRCLE_API_KEY;

async function fetchSnapshot() {
  const query = `
    {
        holders(first: 1000) {
            id
            balance
            initialDepositChain
        }
    }
    `;

  console.log("Fetching snapshot from Subgraph...");
  // Using native fetch if available (Node 18+), else assuming node-fetch is installed
  const response = await fetch(SUBGRAPH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query })
  });

  const data = await response.json();
  if (data.errors) {
    throw new Error(JSON.stringify(data.errors));
  }
  return data.data.holders;
}

async function main() {
  if (!TREASURY_PRIVATE_KEY || !CIRCLE_API_KEY) {
    console.warn("Warning: TREASURY_PRIVATE_KEY or CIRCLE_API_KEY not set.");
  }

  try {
    const holders = await fetchSnapshot();

    // Calculate Snapshot totals per initialDepositChain
    const chainTotals = {};

    holders.forEach(holder => {
      const chainId = holder.initialDepositChain;
      const balance = BigInt(holder.balance);

      if (!chainTotals[chainId]) {
        chainTotals[chainId] = 0n;
      }
      chainTotals[chainId] += balance;
    });

    console.log("Snapshot totals per chain:", Object.fromEntries(
      Object.entries(chainTotals).map(([k, v]) => [k, v.toString()])
    ));

    // Use Circle Bridge Kit
    const bridgingKit = new BridgingKit({
      apiKey: CIRCLE_API_KEY,
      privateKey: TREASURY_PRIVATE_KEY
    });

    for (const [chainId, amount] of Object.entries(chainTotals)) {
      if (amount === 0n) continue;

      console.log(`Bridging ${amount.toString()} USDC to Chain ${chainId}...`);

      // Requirement: Use transferSpeed: 'FAST'
      const result = await bridgingKit.bridge({
        amount: amount.toString(),
        destinationChainId: parseInt(chainId),
        token: 'USDC', // Assuming USDC is the token
        transferSpeed: 'FAST'
      });

      console.log(`Bridge initiated to Chain ${chainId}:`, result);
    }

  } catch (error) {
    console.error("Error executing distribution:", error);
  }
}

if (require.main === module) {
  main();
}
