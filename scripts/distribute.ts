import dotenv from 'dotenv';
import Papa from 'papaparse';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

// Configuration
const SUBGRAPH_URL = process.env.SUBGRAPH_URL || "https://api.studio.thegraph.com/query/1740165/minestarters-hackmoney/version/latest";
const TREASURY_PRIVATE_KEY = process.env.TREASURY_PRIVATE_KEY;
const CIRCLE_API_KEY = process.env.CIRCLE_API_KEY;

const DISTRIBUTION_AMOUNT = 100_000_000n; // 100 USDC (6 decimals)
const PROFIT_FEE_BP = 500n; // Use Basis Points (5% = 500 bps) to avoid floating point issues

interface Holder {
  id: string;
  balance: string;
  initialDepositChain: string;
}

async function fetchSnapshot(): Promise<Holder[]> {
  const query = `
    {
        holders(where: { balance_gt: "0" }) {
            id
            balance
            initialDepositChain
        }
    }
    `;

  console.log("Fetching snapshot from Subgraph...");
  const response = await fetch(SUBGRAPH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query })
  });

  const data = await response.json() as { data?: { holders: Holder[] }; errors?: unknown[] };
  if (data.errors) {
    throw new Error(JSON.stringify(data.errors));
  }
  return data.data?.holders || [];
}

async function main(): Promise<void> {
  if (!TREASURY_PRIVATE_KEY || !CIRCLE_API_KEY) {
    console.warn("Warning: TREASURY_PRIVATE_KEY or CIRCLE_API_KEY not set.");
  }

  try {
    const holders = await fetchSnapshot();
    if (holders.length === 0) {
      console.log("No holders found.");
      return;
    }

    // Calculate total balance
    const totalBalance = holders.reduce((sum, holder) => sum + BigInt(holder.balance), 0n);

    if (totalBalance === 0n) {
      throw new Error("Total balance is zero; cannot distribute profit.");
    }

    // 1. Calculate the fee (5%)
    const feeAmount = (DISTRIBUTION_AMOUNT * PROFIT_FEE_BP) / 10000n;

    // 2. Calculate the net amount to actually be shared
    const netDistributableAmount = DISTRIBUTION_AMOUNT - feeAmount;

    console.log(`Total to Distribute: ${DISTRIBUTION_AMOUNT.toString()}`);
    console.log(`Fee Deducted (5%):  ${feeAmount.toString()}`);
    console.log(`Net Pool for Users:  ${netDistributableAmount.toString()}`);

    const csvData = holders.map(holder => {
      // Logic: (Holder Balance * Net Pool) / Total Balance
      // We multiply by the netDistributableAmount to ensure the fee is already "gone"
      const share = (BigInt(holder.balance) * netDistributableAmount) / totalBalance;

      return {
        account: holder.id.includes('-') ? holder.id.split("-")[1] : holder.id,
        initialDepositChain: holder.initialDepositChain,
        profitShare: share.toString()
      };
    });

    // 3. Convert to CSV
    const csv = Papa.unparse(csvData);

    // 4. Proper ESM path resolution
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const outputPath = path.join(__dirname, 'profit_distribution_snapshot.csv');

    fs.writeFileSync(outputPath, csv);
    console.log(`Profit distribution CSV written to ${outputPath}`);

    // 5. Chain Totals (Profit Share per Chain)
    const profitTotalsByChain: Record<string, bigint> = {};

    csvData.forEach(row => {
      const chainId = row.initialDepositChain;
      const profit = BigInt(row.profitShare);
      profitTotalsByChain[chainId] = (profitTotalsByChain[chainId] || 0n) + profit;
    });

    console.log("--- Distribution Summary ---");
    console.log("Total Profit per chain:", Object.fromEntries(
      Object.entries(profitTotalsByChain).map(([k, v]) => [k, v.toString()])
    ));

    // Optional: Calculate total distributed to verify against netDistributableAmount
    const actualDistributed = Object.values(profitTotalsByChain).reduce((a, b) => a + b, 0n);
    console.log(`Actual Total Distributed (Dust included): ${actualDistributed.toString()}`);

    //TODO: Implement distribution logic here using TREASURY_PRIVATE_KEY and CIRCLE_API_KEY

  } catch (error) {
    console.error("Error executing distribution:", error);
  }
}

main();