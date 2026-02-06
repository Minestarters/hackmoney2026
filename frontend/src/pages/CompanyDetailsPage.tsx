import { useCallback, useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import {
  fetchProjectInfo,
  advanceCompanyStage,
  fetchCompanyDetails,
} from "../lib/contracts";
import { formatUsdc, shortAddress } from "../lib/format";
import { COMPANY_STAGE_LABELS } from "../types";
import {
  NAV_ENGINE_ADDRESS,
  EXPLORER_URL,
  getExplorerUrl,
  API_BASE_URL,
} from "../config";
import type { ProjectInfo, CompanyDetails, CompanyDocument } from "../types";
import { DocumentManager } from "../components/DocumentManager";
import { useCompanyDocuments } from "../hooks/useCompanyDocuments";
import type { Address } from "viem";
import { useEthersProvider } from "../utils/ethers-adapter";

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

  const [project, setProject] = useState<ProjectInfo | null>(null);
  const [company, setCompany] = useState<CompanyDetails | null>(null);
  const [documents, setDocuments] = useState<CompanyDocument[]>([]);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [explorerBaseUrl, setExplorerBaseUrl] = useState(() =>
    sanitizeExplorerUrl(getExplorerUrl()),
  );

  const companyIndex = companyIndexStr ? parseInt(companyIndexStr, 10) : -1;

  const provider = useEthersProvider();

  // Fetch documents from subgraph
  const { data: subgraphDocuments, isLoading: documentsLoading } =
    useCompanyDocuments(address, companyIndex);

  // const invalidate = useInvalidateKey()

  // Update explorer URL based on network
  useEffect(() => {
    if (EXPLORER_URL) return;
    let cancelled = false;

    const resolveExplorer = async () => {
      try {
        const network = await provider?.getNetwork();
        if (!cancelled) {
          setExplorerBaseUrl(
            sanitizeExplorerUrl(getExplorerUrl(network?.chainId)),
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
      if (!address || companyIndex < 0) {
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
          projectInfo = await fetchProjectInfo(address as Address);
          setProject(projectInfo);
        } catch (err) {
          console.warn("Failed to fetch project info:", err);
          // Continue anyway
        }

        // Fetch company details from contract
        let companyData: CompanyDetails | null = null;

        if (!NAV_ENGINE_ADDRESS) {
          setError("NAV Engine address not configured");
          setLoading(false);
          return;
        }

        try {
          companyData = await fetchCompanyDetails(address, companyIndex);
        } catch (err) {
          const message =
            err instanceof Error ? err.message : "Failed to fetch company data";
          throw new Error(message);
        }

        setCompany(companyData);
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
  }, [address, companyIndex]);

  // Update documents when subgraph data is loaded
  useEffect(() => {
    if (subgraphDocuments) {
      setDocuments(subgraphDocuments);
    }
  }, [subgraphDocuments]);

  const handleAddDocuments = useCallback((files: File[]) => {
    setPendingFiles((prev) => [...prev, ...files]);
  }, []);

  const handleRemovePendingFile = useCallback((fileName: string) => {
    setPendingFiles((prev) => prev.filter((f) => f.name !== fileName));
  }, []);

  const handleDeleteDocument = useCallback(
    async (documentId: string) => {
      if (!address || companyIndex < 0) {
        toast.error("Invalid project or company");
        return;
      }

      try {
        const updatedDocs = documents.filter((doc) => doc.id !== documentId);
        setDocuments(updatedDocs);
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

    // Don't allow submission if already submitting
    if (isSubmitting) {
      return;
    }

    try {
      setIsSubmitting(true);
      let uploadedDocs = [...documents];

      // Step 1: Upload pending files to IPFS
      if (pendingFiles.length > 0) {
        toast.loading(`Uploading ${pendingFiles.length} file(s) to IPFS...`);

        const formData = new FormData();
        pendingFiles.forEach((file) => {
          formData.append("files", file);
        });

        const response = await fetch(`${API_BASE_URL}/upload`, {
          method: "POST",
          body: formData,
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || "Failed to upload documents");
        }

        const uploadResult = await response.json();

        // Create document records for uploaded files
        if (uploadResult.uploads && Array.isArray(uploadResult.uploads)) {
          const newDocs = uploadResult.uploads
            .filter((upload: { cid: string; fileName: string }) => upload.cid) // Only include successful uploads
            .map((upload: { cid: string; fileName: string }) => ({
              id: `${Date.now()}_${Math.random().toString(36).substring(7)}`,
              companyIndex,
              fileName: upload.fileName,
              uploadedAt: Date.now(),
              stage: company.stage,
              ipfsHash: upload.cid,
            }));

          uploadedDocs = [...uploadedDocs, ...newDocs];
          setPendingFiles([]); // Clear pending files
          toast.success(`${newDocs.length} file(s) uploaded successfully`);
        }
      }

      // Update documents state
      setDocuments(uploadedDocs);

      // Step 2: Get current company data to determine next stage parameters
      // For now, we'll use reasonable defaults based on test files
      // These parameters would normally come from user input or company data
      const yearsToProduction = Math.max(0, company.yearsToProduction - 1);
      const remainingMineLife = Math.max(0, company.remainingMineLife);

      // Collect IPFS hashes from newly uploaded documents
      const ipfsHashes = uploadedDocs
        .filter((doc) => doc.ipfsHash)
        .map((doc) => doc.ipfsHash || "");

      // Show progress
      toast.loading("Advancing company stage on-chain...");

      // Step 3: Call advanceCompanyStage
      const result = await advanceCompanyStage(
        address,
        companyIndex,
        yearsToProduction,
        remainingMineLife,
        ipfsHashes,
      );

      if (result) {
        toast.success(
          `Stage advanced successfully! Tx: ${result?.slice(0, 10)}...`,
        );

        // Reload company data
        if (NAV_ENGINE_ADDRESS) {
          try {
            const updatedCompany = await fetchCompanyDetails(
              address,
              companyIndex,
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
  }, [address, companyIndex, company, isSubmitting, documents, pendingFiles]);

  if (loading || documentsLoading) {
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
            currentStage={company.stage}
            documents={documents}
            pendingFiles={pendingFiles}
            onAddDocuments={handleAddDocuments}
            onRemovePendingFile={handleRemovePendingFile}
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
