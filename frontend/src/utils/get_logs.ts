import type { AbiEvent, Address, GetLogsReturnType } from "viem";
import { publicClient } from "../lib/wagmi";
import { START_BLOCK } from "../config";

export const fetchLogsInChunks = async <T extends AbiEvent>(projectAddress: Address, event: AbiEvent): Promise<GetLogsReturnType<T>> => {
  const currentBlock = await publicClient.getBlockNumber();
  const CHUNK_SIZE = 9500n; // Stay under the 10,000 limit
  let allLogs: GetLogsReturnType = [];

  let from = BigInt(START_BLOCK);

  while (from < currentBlock) {
    const to = from + CHUNK_SIZE > currentBlock ? currentBlock : from + CHUNK_SIZE;

    const logs = await publicClient.getLogs({
      address: projectAddress,
      event,
      fromBlock: from,
      toBlock: to,
    });

    allLogs = [...allLogs, ...logs];
    from = to + 1n;
  }
  return allLogs as GetLogsReturnType<T>;
};