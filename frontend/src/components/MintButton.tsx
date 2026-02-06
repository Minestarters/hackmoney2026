import { useState } from "react";
import { parseUnits } from "viem";
import { useAccount, useConnect } from "wagmi";
import { injected } from "wagmi/connectors";
import { USDC_ADDRESS } from "../config";
import { getWalletClient, publicClient } from "../lib/wagmi";
import { writeUsdc } from "../lib/contracts";
import { requestFaucetTokens } from "../lib/yellowFaucet";

const MintButton = () => {
  const { isConnected, address } = useAccount();
  const { connect, isPending } = useConnect();
  const [minting, setMinting] = useState(false);
  const [faucetStatus, setFaucetStatus] = useState<string | null>(null);

  const handleMint = async () => {
    if (!isConnected) {
      connect({ connector: injected() });
      return;
    }
    if (!USDC_ADDRESS) {
      alert("Set VITE_USDC_ADDRESS in the frontend .env");
      return;
    }
    if (!address) {
      alert("No address found");
      return;
    }

    const walletClient = await getWalletClient();
    if (!walletClient) {
      alert("Could not get wallet client");
      return;
    }

    try {
      setMinting(true);
      setFaucetStatus(null);

      // Mint USDC on-chain (1000 USDC)
      setFaucetStatus("Minting 1000 USDC...");
      const hash = await writeUsdc.mint(walletClient, address, parseUnits("1000", 6));
      await publicClient.waitForTransactionReceipt({ hash });

      // Also request Yellow Network faucet tokens (ytest.USD)
      setFaucetStatus("Requesting Yellow ytest.USD...");
      const faucetResult = await requestFaucetTokens(address);
      if (faucetResult.success) {
        setFaucetStatus("Done! USDC + ytest.USD received");
        setTimeout(() => setFaucetStatus(null), 3000);
      } else {
        setFaucetStatus(`USDC minted. Yellow: ${faucetResult.error}`);
        setTimeout(() => setFaucetStatus(null), 5000);
      }
    } finally {
      setMinting(false);
    }
  };

  const disabled = minting || isPending;

  return null;

  return (
    <div className="flex flex-col items-center gap-1">
      <button
        type="button"
        onClick={handleMint}
        disabled={disabled}
        className="rounded bg-grass px-3 py-2 text-[10px] uppercase text-night shadow-pixel disabled:cursor-not-allowed disabled:opacity-70"
      >
        {minting ? "Requesting..." : "Request Test Tokens"}
      </button>
      {faucetStatus && (
        <p className="text-[9px] text-amber-300">{faucetStatus}</p>
      )}
    </div>
  );
};

export default MintButton;
