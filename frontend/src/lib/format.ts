import { formatUnits } from "ethers";

export const formatUsdc = (value: bigint, decimals = 6) =>
  Number(formatUnits(value, decimals)).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

export const shortAddress = (addr?: string | null) => {
  if (!addr) return "";
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
};

export const formatBpsAsPercent = (bps: number) => {
  const percent = bps / 100;
  return `${percent.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}%`;
};
