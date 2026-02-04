import { useCallback, useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { useWallet } from "../context/WalletContext";
import {
  fetchProjectInfo,
  fetchFullCompanyData,
  advanceCompanyStage,
} from "../lib/contracts";
import { formatUsdc, shortAddress } from "../lib/format";
import { COMPANY_STAGE_LABELS } from "../types";
import { NAV_ENGINE_ADDRESS, EXPLORER_URL, getExplorerUrl } from "../config";
import type { ProjectInfo, CompanyDetails, CompanyDocument } from "../types";
import { DocumentManager } from "../components/DocumentManager";
import {
  getMockCompany,
  getMockDocuments,
  addMockDocument,
  removeMockDocument,
} from "../lib/mockData";

// Set to true to use mock data, false to fetch from contract
const USE_MOCK_DATA = true;

const COMPANY_COLORS = ["#5EBD3E", "#6ECFF6", "#836953", "#9E9E9E", "#E3A008"];

const sanitizeExplorerUrl = (url: string) => url.replace(/\/$/, "");

const explorerAddressUrl = (baseUrl: string, address: string) =>
  `${baseUrl}/address/${address}`;

interface RouteParams extends Record<string, string | undefined> {
  address?: string;
  companyIndex?: string;
}

export const CompanyDetailsPage = () => {
  const { address, companyIndex: companyIndexStr } = useParams<RouteParams>();
  const navigate = useNavigate();
  const { provider, signer } = useWallet();

  const [project, setProject] = useState<ProjectInfo | null>(null);
  const [company, setCompany] = useState<CompanyDetails | null>(null);
  const [documents, setDocuments] = useState<CompanyDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [explorerBaseUrl, setExplorerBaseUrl] = useState(() =>
    sanitizeExplorerUrl(getExplorerUrl()),
  );

  const companyIndex = companyIndexStr ? parseInt(companyIndexStr, 10) : -1;

  // Update explorer URL based on network
  useEffect(() => {
    if (EXPLORER_URL) return;
    let cancelled = false;

    const resolveExplorer = async () => {
      if (!provider) return;
      try {
        const network = await provider.getNetwork();
        if (!cancelled) {
          setExplorerBaseUrl(
            sanitizeExplorerUrl(getExplorerUrl(network.chainId)),
          );
        }
      } catch (error) {
        console.error("Failed to determine explorer URL", error);
        if (!cancelled) {
          setExplorerBaseUrl(sanitizeExplorerUrl(getExplorerUrl()));
        }
      }
    };

    resolveExplorer();

    return () => {
      cancelled = true;
    };
  }, [provider]);

  // Load data
  useEffect(() => {
    const loadData = async () => {
      if (!address || !provider || companyIndex < 0) {
        setError("Invalid parameters");
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        setError(null);

        // Fetch project info
        let projectInfo: ProjectInfo | null = null;
        try {
          projectInfo = await fetchProjectInfo(address, provider);
          setProject(projectInfo);
        } catch (err) {
          console.warn("Failed to fetch project info:", err);
          // Continue anyway - might be using mock data
        }

        // Fetch company details - from contract or mock
        let companyData: CompanyDetails | null = null;

        if (USE_MOCK_DATA) {
          // Use mock data
          companyData = getMockCompany(companyIndex) || null;
          if (!companyData) {
            setError(
              `Mock data not available for company index ${companyIndex}`,
            );
            setLoading(false);
            return;
          }
        } else {
          // Fetch from contract
          if (!NAV_ENGINE_ADDRESS) {
            setError("NAV Engine address not configured");
            setLoading(false);
            return;
          }

          try {
            companyData = await fetchFullCompanyData(
              address,
              companyIndex,
              NAV_ENGINE_ADDRESS,
              provider,
            );
          } catch (err) {
            console.warn(
              "Failed to fetch company data from contract, using mock:",
              err,
            );
            // Fallback to mock data
            companyData = getMockCompany(companyIndex) || null;
            if (!companyData) {
              throw new Error("No contract data and no mock data available");
            }
          }
        }

        setCompany(companyData);

        // Load documents from localStorage or mock
        let docs: CompanyDocument[] = [];

        if (USE_MOCK_DATA) {
          // Use mock documents
          docs = getMockDocuments(address, companyIndex);
        } else {
          // Try to load from localStorage
          const storedDocs = localStorage.getItem(
            `company_docs_${address}_${companyIndex}`,
          );
          if (storedDocs) {
            try {
              const parsed = JSON.parse(storedDocs);
              docs = Array.isArray(parsed) ? parsed : [];
            } catch {
              docs = [];
            }
          }
        }

        setDocuments(docs);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to load company details";
        setError(message);
        toast.error(message);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [address, companyIndex, provider]);

  const handleAddDocument = useCallback(
    async (file: File) => {
      if (!address || companyIndex < 0 || !company) {
        toast.error("Invalid project or company");
        return;
      }

      try {
        const newDoc: CompanyDocument = {
          id: `${Date.now()}_${Math.random().toString(36).substring(7)}`,
          companyIndex,
          fileName: file.name,
          uploadedAt: Date.now(),
          stage: company.stage,
          localPath: `${address}_${companyIndex}/${file.name}`,
        };

        const updatedDocs = [...documents, newDoc];
        setDocuments(updatedDocs);

        if (USE_MOCK_DATA) {
          // Add to mock data
          addMockDocument(address, companyIndex, file.name, company.stage);
        } else {
          // Store in localStorage (in production, this would be IPFS/backend)
          localStorage.setItem(
            `company_docs_${address}_${companyIndex}`,
            JSON.stringify(updatedDocs),
          );
        }
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to upload document";
        throw new Error(message);
      }
    },
    [address, companyIndex, documents, company],
  );

  const handleDeleteDocument = useCallback(
    async (documentId: string) => {
      if (!address || companyIndex < 0) {
        toast.error("Invalid project or company");
        return;
      }

      try {
        const updatedDocs = documents.filter((doc) => doc.id !== documentId);
        setDocuments(updatedDocs);

        if (USE_MOCK_DATA) {
          // Remove from mock data
          removeMockDocument(address, companyIndex, documentId);
        } else {
          // Update localStorage
          localStorage.setItem(
            `company_docs_${address}_${companyIndex}`,
            JSON.stringify(updatedDocs),
          );
        }
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to delete document";
        throw new Error(message);
      }
    },
    [address, companyIndex, documents],
  );

  const handleSubmit = useCallback(async () => {
    if (!address || companyIndex < 0 || !company) {
      toast.error("Invalid project or company");
      return;
    }

    if (!signer) {
      toast.error("Please connect your wallet");
      return;
    }

    // Don't allow submission if already submitting
    if (isSubmitting) {
      return;
    }

    try {
      setIsSubmitting(true);

      // Step 1: Submit documents (mock)
      toast.loading("Submitting documents...");
      await new Promise((resolve) => setTimeout(resolve, 1000));
      toast.success("Documents submitted successfully");

      // Step 2: Get current company data to determine next stage parameters
      // For now, we'll use reasonable defaults based on test files
      // These parameters would normally come from user input or company data
      const yearsToProduction = Math.max(0, company.yearsToProduction - 1);
      const remainingMineLife = Math.max(0, company.remainingMineLife);

      // Show progress
      toast.loading("Advancing company stage on-chain...");

      // Step 3: Call advanceCompanyStage
      const result = await advanceCompanyStage(
        address,
        companyIndex,
        yearsToProduction,
        remainingMineLife,
        signer,
      );

      if (result.status === "success") {
        toast.success(
          `Stage advanced successfully! Tx: ${result.transactionHash?.slice(0, 10)}...`,
        );

        // Reload company data
        if (NAV_ENGINE_ADDRESS) {
          try {
            const updatedCompany = await fetchFullCompanyData(
              address,
              companyIndex,
              NAV_ENGINE_ADDRESS,
              provider,
            );
            setCompany(updatedCompany);
          } catch (err) {
            console.warn("Failed to reload company data:", err);
          }
        }
      } else {
        toast.error("Stage advancement failed");
      }
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "Failed to submit and advance stage";
      console.error("Submit error:", err);
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  }, [address, companyIndex, company, isSubmitting, signer, provider]);

  if (loading) {
    return (
      <div className="min-h-screen bg-stone-950 p-4 sm:p-8">
        <div className="mx-auto max-w-4xl">
          <div className="flex items-center justify-center py-12">
            <div className="text-center">
              <div className="mb-2 inline-block h-8 w-8 animate-spin rounded-full border-2 border-stone-600 border-t-sky-400" />
              <p className="text-sm text-stone-400">
                Loading company details...
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (error || !company) {
    return (
      <div className="min-h-screen bg-stone-950 p-4 sm:p-8">
        <div className="mx-auto max-w-4xl">
          <button
            onClick={() => navigate(-1)}
            className="mb-4 rounded bg-stone-700 px-3 py-2 text-xs font-medium text-stone-200 hover:bg-stone-600 transition-colors"
          >
            ← Back
          </button>
          <div className="rounded border-2 border-red-500/30 bg-red-500/10 p-4">
            <p className="text-sm text-red-400">
              {error || "Failed to load company details"}
            </p>
          </div>
        </div>
      </div>
    );
  }

  const companyColor = COMPANY_COLORS[companyIndex % COMPANY_COLORS.length];

  return (
    <div className="min-h-screen bg-gradient-to-b from-stone-950 to-stone-900">
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-8">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <button
            onClick={() => navigate(-1)}
            className="rounded bg-stone-700 px-3 py-2 text-xs font-medium text-stone-200 hover:bg-stone-600 transition-colors"
          >
            ← Back
          </button>
        </div>

        {/* Company Info Card */}
        <div className="mb-6 rounded border-4 border-dirt bg-stone-900/80 p-6">
          <div className="mb-4 flex items-start gap-4">
            <div
              className="h-12 w-12 rounded-lg"
              style={{ backgroundColor: companyColor }}
            />
            <div className="flex-1 min-w-0">
              <h1 className="text-2xl font-bold text-stone-100">
                {company.name}
              </h1>
              <p className="text-sm text-stone-400">
                Company Details • {project?.name}
              </p>
            </div>
          </div>

          {/* Stage Badge */}
          <div className="mb-6">
            <span className="inline-block rounded-full bg-sky-600 px-3 py-1 text-xs font-semibold text-white">
              {COMPANY_STAGE_LABELS[company.stage]} Stage
            </span>
          </div>

          {/* Key Metrics Grid */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            <MetricBox label="Weight" value={`${company.weight}%`} icon="⚖️" />
            <MetricBox
              label="NAV (USD)"
              value={`$${formatUsdc(company.navUsd)}`}
              icon="💰"
            />
            <MetricBox
              label="Resource (tonnes)"
              value={company.totalResourceTonnes.toString()}
              icon="⛏️"
            />
            <MetricBox
              label="Inventory (tonnes)"
              value={company.inventoryTonnes.toString()}
              icon="📦"
            />
            <MetricBox
              label="Recovery Rate"
              value={`${(company.recoveryRateBps / 100).toFixed(2)}%`}
              icon="♻️"
            />
            <MetricBox
              label="Discount Rate"
              value={`${(company.discountRateBps / 100).toFixed(2)}%`}
              icon="📊"
            />
            <MetricBox
              label="Years to Production"
              value={company.yearsToProduction.toString()}
              icon="⏱️"
            />
            <MetricBox
              label="Remaining Mine Life"
              value={company.remainingMineLife.toString()}
              icon="🕐"
            />
          </div>

          {/* Floor NAV */}
          <div className="mt-6 rounded bg-stone-800/50 p-4">
            <p className="text-xs text-stone-400">Floor NAV</p>
            <p className="text-lg font-semibold text-sky-100">
              ${formatUsdc(company.floorNavTotalUsd)}
            </p>
          </div>
        </div>

        {/* Document Manager */}
        {company && (
          <DocumentManager
            companyIndex={companyIndex}
            companyName={company.name}
            currentStage={company.stage}
            documents={documents}
            onAddDocument={handleAddDocument}
            onDeleteDocument={handleDeleteDocument}
            onSubmit={handleSubmit}
            isSubmitting={isSubmitting}
          />
        )}

        {/* Contract Details */}
        {project && (
          <div className="mt-6 rounded border-4 border-dirt bg-stone-900/50 p-4">
            <p className="mb-3 text-[10px] text-stone-400">CONTRACT DETAILS</p>
            <div className="space-y-2 text-[10px]">
              {[
                { label: "Vault", value: project.address },
                { label: "Share Token", value: project.shareToken },
                { label: "Creator", value: project.creator },
              ].map(({ label, value }) => (
                <div key={label} className="flex items-center gap-2">
                  <span className="w-24 shrink-0 text-stone-500">{label}</span>
                  <span className="min-w-0 flex-1 break-all">
                    {explorerBaseUrl ? (
                      <a
                        href={explorerAddressUrl(explorerBaseUrl, value)}
                        target="_blank"
                        rel="noreferrer"
                        className="font-mono text-sky-200 underline decoration-sky-200/40 underline-offset-2 hover:text-sky-100"
                        title={value}
                      >
                        {shortAddress(value)}
                      </a>
                    ) : (
                      <span className="font-mono text-stone-400" title={value}>
                        {shortAddress(value)}
                      </span>
                    )}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const MetricBox = ({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon: string;
}) => (
  <div className="rounded bg-stone-800/50 p-3">
    <p className="text-2xl">{icon}</p>
    <p className="mt-1 text-[10px] text-stone-400">{label}</p>
    <p className="mt-1 text-xs font-semibold text-stone-100">{value}</p>
  </div>
);
