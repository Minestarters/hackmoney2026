import { useQuery } from '@tanstack/react-query';
import { gql, request } from 'graphql-request';
import type { CompanyDocument } from '../types';
import { SUBGRAPH_URL } from '../config';

const COMPANY_STAGE_ADVANCED_QUERY = gql`
  query CompanyStageAdvanceds($vault: String!, $companyIndex: Int!) {
    companyStageAdvanceds(
      first: 100
      where: {
        vault: $vault
        companyIndex: $companyIndex
      }
    ) {
      id
      vault
      companyIndex
      newStage
      ipfsHashes
      blockTimestamp
    }
  }
`;

interface CompanyStageAdvancedEvent {
  id: string;
  vault: string;
  companyIndex: number;
  newStage: number;
  ipfsHashes: string[];
  blockTimestamp: string;
}

interface SubgraphResponse {
  companyStageAdvanceds: CompanyStageAdvancedEvent[];
}

/**
 * Hook to fetch company documents from the subgraph
 * Queries CompanyStageAdvanced events which contain IPFS hashes of uploaded documents
 * @param vault - The vault contract address
 * @param companyIndex - The company index within the vault
 * @returns Query result with documents array
 */
export function useCompanyDocuments(vault: string | undefined, companyIndex: number) {
  return useQuery({
    queryKey: ['companyDocuments', vault, companyIndex],
    queryFn: async () => {
      if (!vault || companyIndex < 0) {
        return [];
      }

      try {
        const data = await request<SubgraphResponse>(
          SUBGRAPH_URL,
          COMPANY_STAGE_ADVANCED_QUERY,
          {
            vault: vault.toLowerCase(),
            companyIndex,
          }
        );

        // Transform subgraph events to CompanyDocument format
        const documents: CompanyDocument[] = [];

        data.companyStageAdvanceds.forEach((event) => {
          // Each IPFS hash represents a document submitted for this stage advancement
          event.ipfsHashes.forEach((hash, index) => {
            documents.push({
              id: `${event.id}_${index}`,
              companyIndex: event.companyIndex,
              uploadedAt: parseInt(event.blockTimestamp, 10) * 1000, // Convert seconds to milliseconds
              ipfsHash: hash,
              closedStage: event.newStage - 1,
              stage: event.newStage
            });
          });
        });

        // Sort by uploadedAt descending (newest first)
        return documents.sort((a, b) => b.uploadedAt - a.uploadedAt);
      } catch (error) {
        console.error('Failed to fetch company documents from subgraph:', error);
        throw error;
      }
    },
    enabled: !!vault && companyIndex >= 0,
    staleTime: 60 * 1000, // 1 minute
  });
}
