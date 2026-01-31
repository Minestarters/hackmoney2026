import { useWallet } from "../context/WalletContext";
import { shortAddress } from "../lib/format";

const WalletMenu = () => {
  const { account, connect, isConnecting } = useWallet();

  if (!account) {
    return (
      <button
        onClick={connect}
        className="button-blocky rounded px-4 py-2 text-xs uppercase"
        disabled={isConnecting}
      >
        {isConnecting ? "Connecting..." : "Connect Wallet"}
      </button>
    );
  }

  return (
    <span className="button-blocky inline-block rounded px-4 py-2 text-xs uppercase">
      {shortAddress(account)}
    </span>
  );
};

export default WalletMenu;
