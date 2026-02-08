import { useCallback, useEffect, useRef } from "react";
import { useConnection } from "wagmi";
import { chain, getWalletClient } from "../lib/wagmi";

export const useDefaultChainTracker = () => {
  const { isConnected, chainId } = useConnection();

  const hasSwitched = useRef(false);

  const checkAndSwitch = useCallback(async () => {
    if (hasSwitched.current) return; // Prevent multiple attempts
    try {
      console.log("Attempting to switch to default chain", { targetChainId: chain.id });
      const client = await getWalletClient();
      client?.switchChain({ id: chain.id });
      hasSwitched.current = true;
      console.log("Successfully switched to default chain");
    } catch (error) {
      console.error("Failed to switch to default chain", error);
    }
  }, []);

  useEffect(() => {
    if (isConnected && !hasSwitched.current && chainId !== chain.id) {
      checkAndSwitch();
    }

    if (!isConnected) {
      hasSwitched.current = false;
    }
  }, [isConnected, chainId, checkAndSwitch]);
};