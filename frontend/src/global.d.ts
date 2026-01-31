interface Window {
  ethereum?: {
    isMetaMask?: boolean;
    request?: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
    on?: (event: string, cb: (...args: any[]) => void) => void;
    removeListener?: (event: string, cb: (...args: any[]) => void) => void;
  };
}
