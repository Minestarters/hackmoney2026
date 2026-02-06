import { useAccount, useConnect } from "wagmi";
import { injected } from "wagmi/connectors";
import { shortAddress } from "../lib/format";

const WalletMenu = () => {
  const { address, isConnected } = useAccount();
  const { connect, isPending } = useConnect();

  if (!isConnected) {
    return (
      <button
        onClick={() => connect({ connector: injected() })}
        className="button-blocky rounded px-4 py-2 text-xs uppercase"
        disabled={isPending}
      >
        {isPending ? "Connecting..." : "Connect Wallet"}
      </button>
    );
  }

  return (
    <span className="button-blocky inline-block rounded px-4 py-2 text-xs uppercase">
      {shortAddress(address ?? "")}
    </span>
  );
};

export default WalletMenu;
