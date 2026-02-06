/**
 * Yellow Network Faucet API
 * Requests test tokens (ytest.USD) for sandbox environment
 */

const FAUCET_URL = "https://clearnet-sandbox.yellow.com/faucet/requestTokens";

export type FaucetResponse = {
  success: boolean;
  message?: string;
  error?: string;
};

/**
 * Request test tokens from the Yellow Network sandbox faucet
 * Tokens are credited directly to the unified balance on the Sandbox Clearnode
 * @param userAddress - The wallet address to receive test tokens
 */
export const requestFaucetTokens = async (
  userAddress: `0x${string}`
): Promise<FaucetResponse> => {
  try {
    const response = await fetch(FAUCET_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ userAddress }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return {
        success: false,
        error: `Faucet request failed: ${response.status} - ${errorText}`,
      };
    }

    const data = await response.json();
    return {
      success: true,
      message: data.message || "Tokens requested successfully",
      ...data,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return {
      success: false,
      error: `Faucet request error: ${message}`,
    };
  }
};
