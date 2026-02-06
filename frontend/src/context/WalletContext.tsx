import { BrowserProvider, JsonRpcProvider, ethers } from "ethers";
import type { JsonRpcSigner } from "ethers";
import type { PropsWithChildren } from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { RPC_URL } from "../config";

type WalletContextState = {
  account: string | null;
  provider: BrowserProvider | JsonRpcProvider;
  signer: JsonRpcSigner | null;
  connect: () => Promise<void>;
  isConnecting: boolean;
};

const fallbackProvider = new JsonRpcProvider(RPC_URL);
const LOCAL_STORAGE_KEY = "minestarters_last_connected";
const ETH_CURRENCY = { name: "Ether", symbol: "ETH", decimals: 18 };

type Eip1193Error = {
  code?: number;
};

const ensureCorrectNetwork = async (
  provider: BrowserProvider,
  chainId: number,
  chainName: string,
) => {
  const hexChainId = ethers.toBeHex(chainId);

  try {
    await provider.send("wallet_switchEthereumChain", [
      { chainId: hexChainId },
    ]);
    return true;
  } catch (switchError) {
    if ((switchError as Eip1193Error)?.code === 4902) {
      try {
        await provider.send("wallet_addEthereumChain", [
          {
            chainId: hexChainId,
            chainName,
            rpcUrls: [RPC_URL],
            nativeCurrency: ETH_CURRENCY,
          },
        ]);
        return true;
      } catch (addError) {
        console.error("Failed to add network", addError);
      }
    } else {
      console.error("Failed to switch network", switchError);
    }
  }

  alert(
    `Wrong network: please switch your wallet to chain ID ${chainId} to use Minestarters.`,
  );

  return false;
};

const WalletContext = createContext<WalletContextState>({
  account: null,
  provider: fallbackProvider,
  signer: null,
  connect: async () => undefined,
  isConnecting: false,
});

export const WalletProvider = ({ children }: PropsWithChildren) => {
  const [account, setAccount] = useState<string | null>(null);
  const [provider, setProvider] = useState<BrowserProvider | JsonRpcProvider>(
    fallbackProvider,
  );
  const [signer, setSigner] = useState<JsonRpcSigner | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);

  const connect = useCallback(async () => {
    if (!window.ethereum) {
      alert("MetaMask not detected");
      return;
    }

    try {
      setIsConnecting(true);
      const browserProvider = new ethers.BrowserProvider(
        window.ethereum as ethers.Eip1193Provider,
      );
      const [walletNetwork, fallbackNetwork] = await Promise.all([
        browserProvider.getNetwork(),
        fallbackProvider.getNetwork(),
      ]);
      const walletChainId = Number(walletNetwork.chainId);
      const expectedChainId = Number(fallbackNetwork.chainId);
      const fallbackNetworkName =
        fallbackNetwork.name || `Chain ${expectedChainId}`;

      if (walletChainId !== expectedChainId) {
        const switched = await ensureCorrectNetwork(
          browserProvider,
          expectedChainId,
          fallbackNetworkName,
        );
        if (!switched) {
          return;
        }
      }

      await browserProvider.send("eth_requestAccounts", []);
      const signerInstance = await browserProvider.getSigner();
      const address = await signerInstance.getAddress();
      setProvider(browserProvider);
      setSigner(signerInstance);
      setAccount(address);
      try {
        window.localStorage.setItem(LOCAL_STORAGE_KEY, "1");
      } catch {
        // ignore storage errors
      }
    } finally {
      setIsConnecting(false);
    }
  }, []);

  useEffect(() => {
    if (!window.ethereum) return;

    const handleAccountsChanged = (accounts: string[]) => {
      if (accounts.length === 0) {
        setAccount(null);
        setSigner(null);
        setProvider(fallbackProvider);
        try {
          window.localStorage.removeItem(LOCAL_STORAGE_KEY);
        } catch {
          // ignore storage errors
        }
      } else {
        setAccount(accounts[0]);
      }
    };

    window.ethereum.on?.("accountsChanged", handleAccountsChanged);
    window.ethereum.on?.("chainChanged", () => {
      // window.location.reload();
    });

    return () => {
      window.ethereum?.removeListener?.(
        "accountsChanged",
        handleAccountsChanged,
      );
    };
  }, []);

  useEffect(() => {
    if (!window.ethereum) return;

    let cancelled = false;

    const restoreConnection = async () => {
      try {
        const shouldReconnect =
          window.localStorage.getItem(LOCAL_STORAGE_KEY) === "1";
        if (!shouldReconnect) return;

        const browserProvider = new ethers.BrowserProvider(
          window.ethereum as ethers.Eip1193Provider,
        );
        const [walletNetwork, fallbackNetwork] = await Promise.all([
          browserProvider.getNetwork(),
          fallbackProvider.getNetwork(),
        ]);
        const walletChainId = Number(walletNetwork.chainId);
        const expectedChainId = Number(fallbackNetwork.chainId);

        if (walletChainId !== expectedChainId) {
          window.localStorage.removeItem(LOCAL_STORAGE_KEY);
          return;
        }

        const accounts: string[] = await browserProvider.send(
          "eth_accounts",
          [],
        );
        if (!accounts || accounts.length === 0) {
          window.localStorage.removeItem(LOCAL_STORAGE_KEY);
          return;
        }

        if (cancelled) return;

        const signerInstance = await browserProvider.getSigner();
        setProvider(browserProvider);
        setSigner(signerInstance);
        setAccount(accounts[0]);
      } catch {
        // silent failure; user can always connect manually
      }
    };

    restoreConnection();

    return () => {
      cancelled = true;
    };
  }, []);

  const value = useMemo(
    () => ({ account, provider, signer, connect, isConnecting }),
    [account, provider, signer, connect, isConnecting],
  );

  return (
    <WalletContext.Provider value={value}>{children}</WalletContext.Provider>
  );
};

export const useWallet = () => useContext(WalletContext);
