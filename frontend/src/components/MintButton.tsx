import { useState } from "react";
import { parseUnits } from "viem";
import { useAccount, useConnect } from "wagmi";
import { injected } from "wagmi/connectors";
import { USDC_ADDRESS } from "../config";
import { getWalletClient, publicClient } from "../lib/wagmi";
import { writeUsdc } from "../lib/contracts";

const MintButton = () => {
  const { isConnected, address } = useAccount();
  const { connect, isPending } = useConnect();
  const [minting, setMinting] = useState(false);

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
      const hash = await writeUsdc.mint(walletClient, address, parseUnits("1000", 6));
      await publicClient.waitForTransactionReceipt({ hash });
    } finally {
      setMinting(false);
    }
  };

  const disabled = minting || isPending;

  return (
    <button
      type="button"
      onClick={handleMint}
      disabled={disabled}
      className="rounded bg-grass px-3 py-2 text-[10px] uppercase text-night shadow-pixel disabled:cursor-not-allowed disabled:opacity-70"
    >
      {minting ? "Minting..." : "Mint 1,000 USDC"}
    </button>
  );
};

export default MintButton;
