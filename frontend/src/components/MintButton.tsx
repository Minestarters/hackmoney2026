import { useState } from "react";
import { Contract, parseUnits } from "ethers";
import { erc20Abi } from "../contracts/abis";
import { USDC_ADDRESS } from "../config";
import { useWallet } from "../context/WalletContext";

const MintButton = () => {
  const { signer, connect, isConnecting } = useWallet();
  const [minting, setMinting] = useState(false);

  const handleMint = async () => {
    if (!signer) {
      await connect();
      return;
    }
    if (!USDC_ADDRESS) {
      alert("Set VITE_USDC_ADDRESS in the frontend .env");
      return;
    }

    try {
      setMinting(true);
      const contract = new Contract(USDC_ADDRESS, erc20Abi, signer);
      const user = await signer.getAddress();
      const tx = await contract.mint(user, parseUnits("1000", 6));
      await tx.wait();
    } finally {
      setMinting(false);
    }
  };

  const disabled = minting || isConnecting;

  return null;

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
