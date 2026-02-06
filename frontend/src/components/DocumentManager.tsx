import { useState, useRef } from "react";
import toast from "react-hot-toast";
import { COMPANY_STAGE_LABELS } from "../types";
import type { CompanyDocument } from "../types";
import { API_BASE_URL } from "../config";
import { PDFViewer } from "./PDFViewer";

interface DocumentManagerProps {
  currentStage: number;
  documents: CompanyDocument[];
  pendingFiles?: File[];
  onAddDocuments?: (files: File[]) => void;
  onRemovePendingFile?: (fileName: string) => void;
  onDeleteDocument?: (documentId: string) => Promise<void>;
  onSubmit?: () => Promise<void>;
  isSubmitting?: boolean;
}

export const DocumentManager = ({
  currentStage,
  documents,
  pendingFiles = [],
  onAddDocuments,
  onRemovePendingFile,
  onDeleteDocument,
  onSubmit,
  isSubmitting = false,
}: DocumentManagerProps) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [previewDoc, setPreviewDoc] = useState<CompanyDocument | null>(null);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const validFiles: File[] = [];

    // Validate all files
    for (let i = 0; i < files.length; i++) {
      const file = files[i];

      // Validate file type
      if (!file.name.toLowerCase().endsWith(".pdf")) {
        toast.error(`${file.name}: Only PDF files are allowed`);
        continue;
      }

      // Validate file size (max 10MB)
      if (file.size > 10 * 1024 * 1024) {
        toast.error(`${file.name}: File size must be less than 10MB`);
        continue;
      }

      validFiles.push(file);
    }

    if (validFiles.length > 0) {
      onAddDocuments?.(validFiles);
      toast.success(`${validFiles.length} file(s) selected for upload`);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleDelete = async (documentId: string) => {
    if (!confirm("Are you sure you want to delete this document?")) return;

    try {
      await onDeleteDocument?.(documentId);
      toast.success("Document deleted successfully");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to delete document";
      toast.error(message);
    }
  };

  const stageDocuments = documents.filter(
    (doc) => doc.closedStage === undefined || doc.closedStage >= currentStage,
  );
  const completedStageDocuments = documents.filter(
    (doc) => doc.closedStage !== undefined && doc.closedStage < currentStage,
  );

  // Create a preview URL for the document
  const getPreviewUrl = (doc: CompanyDocument): string => {
    if (doc.localPath) {
      return `file://${doc.localPath}`;
    }
    // For IPFS documents, use the server gateway endpoint
    if (doc.ipfsHash) {
      return `${API_BASE_URL}/${doc.ipfsHash}`;
    }
    return "";
  };

  return (
    <div className="mt-6 rounded border-4 border-dirt bg-stone-900/50 p-4">
      <div className="mb-4">
        <h3 className="mb-1 text-sm font-semibold text-stone-100">
          Documents for {COMPANY_STAGE_LABELS[currentStage]}
        </h3>
        <p className="text-xs text-stone-400">
          Manage documents for the {COMPANY_STAGE_LABELS[currentStage]} stage
        </p>
      </div>

      {/* Pre-uploaded Documents Section */}
      {(stageDocuments.length > 0 || completedStageDocuments.length > 0) && (
        <>
          {/* Current Stage Documents */}
          {stageDocuments.length > 0 && (
            <div className="mb-4">
              <h4 className="mb-2 text-xs font-semibold text-stone-300">
                {COMPANY_STAGE_LABELS[currentStage]} Documents (
                {stageDocuments.length})
              </h4>
              <div className="space-y-2">
                {stageDocuments.map((doc) => (
                  <div
                    key={doc.id}
                    className="flex items-center justify-between rounded bg-stone-800 p-3"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="truncate text-xs font-medium text-sky-100">
                        {doc.fileName ||
                          `IPFS: ${doc.ipfsHash?.slice(0, 16) || "Unknown"}...`}
                      </p>
                      <p className="text-xs text-stone-400">
                        {new Date(doc.uploadedAt).toLocaleDateString()}
                      </p>
                    </div>
                    <div className="ml-3 flex gap-2">
                      {doc.ipfsHash && (
                        <button
                          onClick={() => setPreviewDoc(doc)}
                          className="rounded bg-sky-600 px-2 py-1 text-xs font-medium text-white hover:bg-sky-700 transition-colors"
                          title="Preview PDF"
                        >
                          View
                        </button>
                      )}
                      <button
                        onClick={() => handleDelete(doc.id)}
                        className="rounded bg-red-600/80 px-2 py-1 text-xs font-medium text-white hover:bg-red-700 transition-colors"
                        title="Delete document"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Completed Stage Documents */}
          {completedStageDocuments.length > 0 && (
            <div className="mb-4">
              <h4 className="mb-2 text-xs font-semibold text-emerald-400">
                ✓ Closed Stages Documentation ({completedStageDocuments.length})
              </h4>
              <div className="space-y-2">
                {completedStageDocuments.map((doc) => (
                  <div
                    key={doc.id}
                    className="flex items-center justify-between rounded bg-emerald-900/30 border border-emerald-700/40 p-3"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-xs font-medium text-emerald-200">
                          {doc.fileName ||
                            `IPFS: ${doc.ipfsHash?.slice(0, 16) || "Unknown"}...`}
                        </p>
                        <span className="shrink-0 inline-block rounded-full bg-emerald-600/40 px-2 py-0.5 text-[10px] font-semibold text-emerald-100">
                          Closed {COMPANY_STAGE_LABELS[doc.closedStage]}
                        </span>
                      </div>
                      <p className="text-xs text-stone-500">
                        {doc.stage
                          ? COMPANY_STAGE_LABELS[doc.stage]
                          : "Unknown stage"}{" "}
                        • {new Date(doc.uploadedAt).toLocaleDateString()}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {doc.ipfsHash && (
                        <button
                          onClick={() => setPreviewDoc(doc)}
                          className="rounded bg-emerald-700/60 px-2 py-1 text-xs font-medium text-emerald-100 hover:bg-emerald-700 transition-colors"
                          title="Preview PDF"
                        >
                          View
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Divider */}
          <div className="my-6 border-t border-stone-700/60" />
        </>
      )}

      {/* Upload Section */}
      <div className="mb-6">
        <label className="flex cursor-pointer items-center justify-center rounded border-2 border-dashed border-stone-600 p-6 hover:border-sky-400 hover:bg-stone-800/30 transition-colors">
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf"
            multiple
            onChange={handleFileSelect}
            className="hidden"
          />
          <div className="text-center">
            <svg
              className="mx-auto mb-2 h-8 w-8 text-stone-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
              />
            </svg>
            <p className="text-xs font-medium text-stone-200">
              Click to upload or drag PDF files
            </p>
            <p className="text-xs text-stone-500">Max 10MB per file</p>
          </div>
        </label>
      </div>

      {/* Pending Files Section */}
      {pendingFiles.length > 0 && (
        <div className="mb-6 rounded bg-amber-900/30 border border-amber-700/40 p-3">
          <h4 className="mb-2 text-xs font-semibold text-amber-300">
            📋 Pending Upload ({pendingFiles.length})
          </h4>
          <div className="space-y-2">
            {pendingFiles.map((file) => (
              <div
                key={file.name}
                className="flex items-center justify-between rounded bg-stone-800/50 p-2"
              >
                <p className="text-xs text-amber-100">{file.name}</p>
                <button
                  onClick={() => onRemovePendingFile?.(file.name)}
                  className="rounded bg-red-600/60 px-2 py-1 text-xs font-medium text-red-100 hover:bg-red-700 transition-colors"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-amber-200">
            Files will be uploaded when you click Submit
          </p>
        </div>
      )}

      {/* PDF Viewer Modal */}
      {previewDoc && (
        <PDFViewer
          fileUrl={getPreviewUrl(previewDoc)}
          fileName={previewDoc.fileName}
          onClose={() => setPreviewDoc(null)}
        />
      )}

      {/* Submit Button - Always shown, disabled if submitting */}
      {onSubmit && (
        <div className="mt-6 flex gap-3">
          <button
            onClick={() => onSubmit()}
            disabled={isSubmitting}
            className="flex-1 rounded bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:bg-stone-600 disabled:text-stone-400 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
          >
            {isSubmitting ? (
              <>
                <div className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white border-t-emerald-200" />
                Submitting...
              </>
            ) : (
              <>
                <svg
                  className="h-4 w-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 9v2m0 4v2m0-6a4 4 0 11-8 0 4 4 0 018 0z"
                  />
                </svg>
                Submit Documents & Advance Stage
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
};
