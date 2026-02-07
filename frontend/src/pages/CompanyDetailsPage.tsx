import { useCallback, useEffect, useState, type FC } from "react";
import { useParams, useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import {
  fetchProjectInfo,
  advanceCompanyStage,
  fetchCompanyDetails,
} from "../lib/contracts";
import { shortAddress } from "../lib/format";
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
import { useConnection } from "wagmi";
import { Gem, Pickaxe, ScrollText, Telescope } from "lucide-react";

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
  const [company, setCompany] = useState<Partial<CompanyDetails> | null>(null);
  const [documents, setDocuments] = useState<CompanyDocument[]>([]);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [explorerBaseUrl, setExplorerBaseUrl] = useState(() =>
    sanitizeExplorerUrl(getExplorerUrl()),
  );

  const {isConnected, chainId} = useConnection()

  const companyIndex = companyIndexStr ? parseInt(companyIndexStr, 10) : -1;

  // Fetch documents from subgraph
  const { data: subgraphDocuments, isLoading: documentsLoading } =
    useCompanyDocuments(address, companyIndex);

  // Update explorer URL based on network
  useEffect(() => {
    if (EXPLORER_URL) return;
    let cancelled = false;

    const resolveExplorer = async () => {
      if (!chainId) return;

      try {
        if (!cancelled) {
          setExplorerBaseUrl(
            sanitizeExplorerUrl(getExplorerUrl(chainId)),
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
  }, [chainId]);

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
        let companyData: Partial<CompanyDetails> | null = null;

        if (!NAV_ENGINE_ADDRESS) {
          setError("NAV Engine address not configured");
          setLoading(false);
          return;
        }

        try {
          companyData = await fetchCompanyDetails(
            address,
            companyIndex,
          );
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

    if (!isConnected) {
      toast.error("Please connect your wallet");
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

      const yearsToProduction = 5;
      const remainingMineLife = 10;

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
  }, [
    address,
    companyIndex,
    company,
    isSubmitting,
    documents,
    pendingFiles,
    isConnected
  ]);

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
        <HeroSection 
          companyName={company?.name || ""}
          companyColor={companyColor}
          projectName={project?.name || ""}
          stage={company?.stage || 0}
        />




        {/* Document Manager */}
        {company && (
          <DocumentManager
            currentStage={company?.stage || 0}
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

const HeroSection:FC<{stage: number, companyName: string, companyColor: string, projectName: string}> = ({stage, companyName, companyColor, projectName}) => {
  const navigate = useNavigate()
  return (
    <>
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
        <div className="mb-6 rounded border-4 border-dirt bg-stone-900/80 p-6 backdrop-blur-sm">
          <div className="mb-8 flex items-start gap-4">
            {/* Retro Company Avatar */}
            <div
              className="flex h-12 w-12 items-center justify-center rounded-md border-2 border-stone-700 shadow-inner"
              style={{ backgroundColor: companyColor }}
            >
               <span className="text-xl font-black text-stone-900/50 mix-blend-overlay">
                  {companyName.charAt(0)}
               </span>
            </div>
            
            <div className="flex-1 min-w-0">
              <h1 className="text-2xl font-bold tracking-tight text-stone-100 uppercase">
                {companyName}
              </h1>
              <p className="flex items-center gap-2 text-sm font-medium text-stone-500">
                <span className="text-amber-500/80">{projectName}</span>
              </p>
            </div>
          </div>

          {/* New Timeline Section */}
          <div className="mt-8 px-0">
            <ProjectTimeline currentStage={stage} />
          </div>
        </div>
    </>
  )
}

const ProjectTimeline = ({ currentStage = 0 }) => {
  const stages = [
    { 
      id: 0, 
      label: 'Exploration', 
      icon: Telescope, 
      color: 'text-blue-400', 
      activeBorder: 'border-blue-500',
      activeShadow: 'shadow-[0_0_20px_rgba(14,165,233,0.3)]',
      activeBg: 'bg-blue-500/10',
      hoverAnimation: 'group-hover:animate-scan origin-bottom'
    },
    { 
      id: 1, 
      label: 'Permits', 
      icon: ScrollText, 
      color: 'text-amber-400', 
      activeBorder: 'border-amber-500',
      activeShadow: 'shadow-[0_0_20px_rgba(245,158,11,0.3)]',
      activeBg: 'bg-amber-500/10',
      hoverAnimation: 'group-hover:animate-float'
    },
    { 
      id: 2, 
      label: 'Construction', 
      icon: Pickaxe, 
      color: 'text-orange-400', 
      activeBorder: 'border-orange-500',
      activeShadow: 'shadow-[0_0_20px_rgba(249,115,22,0.3)]',
      activeBg: 'bg-orange-500/10',
      hoverAnimation: 'group-hover:animate-hammer origin-bottom-left'
    },
    { 
      id: 3, 
      label: 'Production', 
      icon: Gem, 
      color: 'text-emerald-400', 
      activeBorder: 'border-emerald-500',
      activeShadow: 'shadow-[0_0_20px_rgba(16,185,129,0.3)]',
      activeBg: 'bg-emerald-500/10',
      hoverAnimation: 'group-hover:animate-shine'
    },
  ];

  const isProjectComplete = currentStage === stages.length - 1

  return (
    <div className="w-full py-10 px-4">
      {/* Container needs relative positioning to act as the anchor for absolute elements */}
      <div className="relative mx-auto max-w-4xl">

        {/* --- STAGES ICON LAYER (Foreground) --- */}
        {/* z-10 ensures these sit ON TOP of the lines */}
        <div className="relative z-10 flex justify-between">
          {stages.map((stage, index) => {
            const Icon = stage.icon;
            const isActive = index === currentStage;
            const isCompleted = index < currentStage;
            const isFuture = index >= currentStage;
            const isLast = index === (stages.length - 1)
            
            return (
              <>
                <div 
                  key={stage.id} 
                  className="group flex flex-col items-center cursor-default"
                  style={{ width: '4rem' }} 
                >
                  {/* ICON BOX */}
                  <div 
                    className={`
                      relative flex h-14 w-14 items-center justify-center rounded-xl border-2 transition-all duration-500 ease-out
                      z-20
                      ${isActive 
                        ? `${stage.activeBorder} ${stage.color} scale-110 ${stage.activeShadow} bg-stone-900` 
                        : isCompleted 
                          ? 'border-green-700 text-green-500 bg-green-900' // Completed: Dark bg, dimmed text
                          : 'border-cyan-800/75 text-cyan-700/75 bg-cyan-950/75' // Future: Darker bg, dark text
                      }
                    `}
                  >
                    {/* Inner Glow (Active only) */}
                    {isActive && (
                      <div className={`absolute inset-0 rounded-xl ${stage.activeBg} blur-md`} />
                    )}

                    {/* Icon SVG */}
                    <Icon 
                      size={isActive ? 24 : 20} 
                      strokeWidth={isActive ? 2.5 : 2}
                      className={`transition-all duration-300 ${stage.hoverAnimation}`} 
                    />
                  </div>

                  {/* TEXT LABEL */}
                  <div className={`
                    mt-4 font-mono text-xs font-bold tracking-widest uppercase transition-all duration-300 text-center whitespace-nowrap
                    ${isActive 
                      ? 'text-white translate-y-0 opacity-100' 
                      : isCompleted 
                        ? 'text-stone-500' 
                        : 'text-stone-700'
                    }
                  `}>
                    {stage.label}
                  </div>

                  {/* ACTIVE DOT INDICATOR */}
                  <div className={`
                      mt-2 h-1.5 w-1.5 rounded-full transition-all duration-500
                      ${isActive ? 'bg-white shadow-[0_0_10px_white] scale-100 opacity-100' : 'scale-0 opacity-0'}
                    `}
                  />
                </div>

                {/* progress line */}
                {
                  !isLast && (
                    <hr className={`h-0 flex-1 border-t-2 rounded-full mt-6 ${isFuture ? "border-dotted" : ""} ${isProjectComplete ? "border-green-700" : "border-white/55"}`} />
                  )
                }
              </>
            );
          })}
        </div>
      </div>
    </div>
  )
};