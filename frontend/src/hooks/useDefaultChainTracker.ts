import { useCallback, useEffect, useRef } from "react";
import { useAccount, useSwitchChain } from "wagmi";
import { chain } from "../lib/wagmi";

export const useDefaultChainTracker = () => {
  const { isConnected, chainId } = useAccount();
  const { switchChain } = useSwitchChain();

  const hasSwitched = useRef(false);

  const checkAndSwitch = useCallback(() => {
    if (hasSwitched.current) return;
    try {
      switchChain({ chainId: chain.id });
      hasSwitched.current = true;
    } catch (error) {
      console.error("Failed to switch to default chain", error);
    }
  }, [switchChain]);

  useEffect(() => {
    if (isConnected && !hasSwitched.current && chainId !== chain.id) {
      checkAndSwitch();
    }

    if (!isConnected) {
      hasSwitched.current = false;
    }
  }, [isConnected, chainId, checkAndSwitch]);
};
