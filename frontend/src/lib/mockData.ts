import type { CompanyDetails, CompanyDocument } from "../types";

/**
 * MOCK DATA FILE
 * 
 * This file contains mock data for company details and documents.
 * It's used for development and testing purposes.
 * 
 * TO REMOVE: Delete this entire file and remove all imports of it
 *           from CompanyDetailsPage.tsx
 */

// Mock company data by company index
export const MOCK_COMPANIES: Record<number, CompanyDetails> = {
  0: {
    name: "Kira Copper",
    weight: 50,
    resourceTonnes: 10000n,
    inventoryTonnes: 2500n,
    stage: 0, // Exploration
    navUsd: 5000000n,
    totalResourceTonnes: 10000n,
    recoveryRateBps: 8500, // 85%
    yearsToProduction: 3,
    remainingMineLife: 15,
    discountRateBps: 800, // 8%
    floorNavTotalUsd: 2000000n,
  },
  1: {
    name: "Kira Silver",
    weight: 50,
    resourceTonnes: 5000n,
    inventoryTonnes: 1200n,
    stage: 1, // Permits
    navUsd: 3000000n,
    totalResourceTonnes: 5000n,
    recoveryRateBps: 7500, // 75%
    yearsToProduction: 2,
    remainingMineLife: 10,
    discountRateBps: 900, // 9%
    floorNavTotalUsd: 1500000n,
  },
  2: {
    name: "Kira Gold",
    weight: 33,
    resourceTonnes: 3000n,
    inventoryTonnes: 1800n,
    stage: 2, // Construction
    navUsd: 8000000n,
    totalResourceTonnes: 3000n,
    recoveryRateBps: 9200, // 92%
    yearsToProduction: 1,
    remainingMineLife: 20,
    discountRateBps: 700, // 7%
    floorNavTotalUsd: 4000000n,
  },
  3: {
    name: "Kira Platinum",
    weight: 33,
    resourceTonnes: 2000n,
    inventoryTonnes: 1500n,
    stage: 3, // Production
    navUsd: 12000000n,
    totalResourceTonnes: 2000n,
    recoveryRateBps: 9800, // 98%
    yearsToProduction: 0,
    remainingMineLife: 25,
    discountRateBps: 600, // 6%
    floorNavTotalUsd: 6000000n,
  },
};

// Mock documents data
export const MOCK_DOCUMENTS: Record<string, CompanyDocument[]> = {
  // Key format: `${vaultAddress}_${companyIndex}`
  "0x123abc_0": [
    {
      id: "mock_1",
      companyIndex: 0,
      fileName: "geological_survey_2024.pdf",
      uploadedAt: Date.now() - 7 * 24 * 60 * 60 * 1000, // 7 days ago
      stage: 0, // Exploration
      localPath: "0x123abc_0/geological_survey_2024.pdf",
    },
    {
      id: "mock_2",
      companyIndex: 0,
      fileName: "mineral_assessment.pdf",
      uploadedAt: Date.now() - 5 * 24 * 60 * 60 * 1000, // 5 days ago
      stage: 0, // Exploration
      localPath: "0x123abc_0/mineral_assessment.pdf",
    },
    {
      id: "mock_3",
      companyIndex: 0,
      fileName: "initial_scope_report.pdf",
      uploadedAt: Date.now() - 30 * 24 * 60 * 60 * 1000, // 30 days ago
      stage: 0, // Exploration (previous stage)
      localPath: "0x123abc_0/initial_scope_report.pdf",
    },
  ],
  "0x123abc_1": [
    {
      id: "mock_4",
      companyIndex: 1,
      fileName: "permit_application.pdf",
      uploadedAt: Date.now() - 3 * 24 * 60 * 60 * 1000, // 3 days ago
      stage: 1, // Permits
      localPath: "0x123abc_1/permit_application.pdf",
    },
    {
      id: "mock_5",
      companyIndex: 1,
      fileName: "environmental_impact_assessment.pdf",
      uploadedAt: Date.now() - 2 * 24 * 60 * 60 * 1000, // 2 days ago
      stage: 1, // Permits
      localPath: "0x123abc_1/environmental_impact_assessment.pdf",
    },
    {
      id: "mock_6",
      companyIndex: 1,
      fileName: "geology_report.pdf",
      uploadedAt: Date.now() - 60 * 24 * 60 * 60 * 1000, // 60 days ago
      stage: 0, // Exploration (previous stage)
      localPath: "0x123abc_1/geology_report.pdf",
    },
  ],
  "0x123abc_2": [
    {
      id: "mock_7",
      companyIndex: 2,
      fileName: "construction_plan.pdf",
      uploadedAt: Date.now() - 1 * 24 * 60 * 60 * 1000, // 1 day ago
      stage: 2, // Construction
      localPath: "0x123abc_2/construction_plan.pdf",
    },
    {
      id: "mock_8",
      companyIndex: 2,
      fileName: "safety_protocols.pdf",
      uploadedAt: Date.now() - 4 * 60 * 60 * 1000, // 4 hours ago
      stage: 2, // Construction
      localPath: "0x123abc_2/safety_protocols.pdf",
    },
  ],
  "0x123abc_3": [
    {
      id: "mock_9",
      companyIndex: 3,
      fileName: "production_report_q4_2025.pdf",
      uploadedAt: Date.now() - 12 * 60 * 60 * 1000, // 12 hours ago
      stage: 3, // Production
      localPath: "0x123abc_3/production_report_q4_2025.pdf",
    },
    {
      id: "mock_10",
      companyIndex: 3,
      fileName: "operational_metrics.pdf",
      uploadedAt: Date.now() - 1 * 60 * 60 * 1000, // 1 hour ago
      stage: 3, // Production
      localPath: "0x123abc_3/operational_metrics.pdf",
    },
    {
      id: "mock_11",
      companyIndex: 3,
      fileName: "quarterly_yield_analysis.pdf",
      uploadedAt: Date.now() - 48 * 60 * 60 * 1000, // 2 days ago
      stage: 3, // Production
      localPath: "0x123abc_3/quarterly_yield_analysis.pdf",
    },
    {
      id: "mock_12",
      companyIndex: 3,
      fileName: "construction_completion_report.pdf",
      uploadedAt: Date.now() - 90 * 24 * 60 * 60 * 1000, // 90 days ago
      stage: 2, // Construction (previous stage)
      localPath: "0x123abc_3/construction_completion_report.pdf",
    },
  ],
};

/**
 * Get mock company data for testing
 * @param companyIndex - Index of the company
 * @returns CompanyDetails or undefined if not found
 */
export const getMockCompany = (companyIndex: number): CompanyDetails | undefined => {
  return MOCK_COMPANIES[companyIndex];
};

/**
 * Get mock documents for a company
 * @param vaultAddress - Vault/project address
 * @param companyIndex - Index of the company
 * @returns Array of CompanyDocument or empty array
 */
export const getMockDocuments = (
  vaultAddress: string,
  companyIndex: number
): CompanyDocument[] => {
  const key = `${vaultAddress}_${companyIndex}`;
  return MOCK_DOCUMENTS[key] || [];
};

/**
 * Add mock document (for testing document upload)
 * @param vaultAddress - Vault/project address
 * @param companyIndex - Index of the company
 * @param fileName - Name of the document file
 * @param stage - Current company stage
 */
export const addMockDocument = (
  vaultAddress: string,
  companyIndex: number,
  fileName: string,
  stage: number
): void => {
  const key = `${vaultAddress}_${companyIndex}`;
  if (!MOCK_DOCUMENTS[key]) {
    MOCK_DOCUMENTS[key] = [];
  }

  const newDoc: CompanyDocument = {
    id: `mock_${Date.now()}_${Math.random().toString(36).substring(7)}`,
    companyIndex,
    fileName,
    uploadedAt: Date.now(),
    stage,
    localPath: `${vaultAddress}_${companyIndex}/${fileName}`,
  };

  MOCK_DOCUMENTS[key].push(newDoc);
};

/**
 * Remove mock document (for testing document deletion)
 * @param vaultAddress - Vault/project address
 * @param companyIndex - Index of the company
 * @param documentId - ID of the document to remove
 */
export const removeMockDocument = (
  vaultAddress: string,
  companyIndex: number,
  documentId: string
): void => {
  const key = `${vaultAddress}_${companyIndex}`;
  if (MOCK_DOCUMENTS[key]) {
    MOCK_DOCUMENTS[key] = MOCK_DOCUMENTS[key].filter((doc) => doc.id !== documentId);
  }
};
