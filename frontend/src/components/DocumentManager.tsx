import { useState, useRef } from "react";
import toast from "react-hot-toast";
import { COMPANY_STAGE_LABELS } from "../types";
import type { CompanyDocument } from "../types";
import { PDFViewer } from "./PDFViewer";

interface DocumentManagerProps {
  companyIndex: number;
  companyName: string;
  currentStage: number;
  documents: CompanyDocument[];
  onAddDocument: (file: File) => Promise<void>;
  onDeleteDocument: (documentId: string) => Promise<void>;
  onSubmit?: () => Promise<void>;
  isSubmitting?: boolean;
}

export const DocumentManager = ({
  companyIndex,
  companyName,
  currentStage,
  documents,
  onAddDocument,
  onDeleteDocument,
  onSubmit,
  isSubmitting = false,
}: DocumentManagerProps) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [previewDoc, setPreviewDoc] = useState<CompanyDocument | null>(null);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      toast.error("Only PDF files are allowed");
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    // Validate file size (max 10MB)
    if (file.size > 10 * 1024 * 1024) {
      toast.error("File size must be less than 10MB");
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    setUploading(true);
    try {
      await onAddDocument(file);
      toast.success("Document uploaded successfully");
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to upload document";
      toast.error(message);
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (documentId: string) => {
    if (!confirm("Are you sure you want to delete this document?")) return;

    try {
      await onDeleteDocument(documentId);
      toast.success("Document deleted successfully");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to delete document";
      toast.error(message);
    }
  };

  const stageDocuments = documents.filter((doc) => doc.stage === currentStage);
  const otherStageDocuments = documents.filter(
    (doc) => doc.stage !== currentStage,
  );

  // Create a mock URL for preview (in real app, this would be the actual file URL)
  const getPreviewUrl = (doc: CompanyDocument): string => {
    if (doc.localPath) {
      return `file://${doc.localPath}`;
    }
    // For IPFS or other URLs
    return doc.ipfsHash || "";
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

      {/* Upload Section */}
      <div className="mb-6">
        <label className="flex cursor-pointer items-center justify-center rounded border-2 border-dashed border-stone-600 p-6 hover:border-sky-400 hover:bg-stone-800/30 transition-colors">
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf"
            onChange={handleFileSelect}
            disabled={uploading}
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
              {uploading ? "Uploading..." : "Click to upload or drag PDF files"}
            </p>
            <p className="text-xs text-stone-500">Max 10MB</p>
          </div>
        </label>
      </div>

      {/* Current Stage Documents */}
      <div className="mb-4">
        <h4 className="mb-2 text-xs font-semibold text-stone-300">
          {COMPANY_STAGE_LABELS[currentStage]} Documents (
          {stageDocuments.length})
        </h4>

        {stageDocuments.length === 0 ? (
          <p className="text-xs text-stone-400">No documents uploaded yet</p>
        ) : (
          <div className="space-y-2">
            {stageDocuments.map((doc) => (
              <div
                key={doc.id}
                className="flex items-center justify-between rounded bg-stone-800 p-3"
              >
                <div className="flex-1 min-w-0">
                  <p className="truncate text-xs font-medium text-sky-100">
                    {doc.fileName}
                  </p>
                  <p className="text-xs text-stone-400">
                    {new Date(doc.uploadedAt).toLocaleDateString()}
                  </p>
                </div>
                <div className="ml-3 flex gap-2">
                  <button
                    onClick={() => setPreviewDoc(doc)}
                    className="rounded bg-sky-600 px-2 py-1 text-xs font-medium text-white hover:bg-sky-700 transition-colors"
                    title="Preview PDF"
                  >
                    View
                  </button>
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
        )}
      </div>

      {/* Other Stage Documents */}
      {otherStageDocuments.length > 0 && (
        <div>
          <h4 className="mb-2 text-xs font-semibold text-stone-300">
            Previous Stage Documents ({otherStageDocuments.length})
          </h4>
          <div className="space-y-2">
            {otherStageDocuments.map((doc) => (
              <div
                key={doc.id}
                className="flex items-center justify-between rounded bg-stone-800/50 p-3"
              >
                <div className="flex-1 min-w-0">
                  <p className="truncate text-xs font-medium text-stone-300">
                    {doc.fileName}
                  </p>
                  <p className="text-xs text-stone-500">
                    {COMPANY_STAGE_LABELS[doc.stage]} •{" "}
                    {new Date(doc.uploadedAt).toLocaleDateString()}
                  </p>
                </div>
                <button
                  onClick={() => setPreviewDoc(doc)}
                  className="ml-3 rounded bg-stone-700 px-2 py-1 text-xs font-medium text-stone-200 hover:bg-stone-600 transition-colors"
                  title="Preview PDF"
                >
                  View
                </button>
              </div>
            ))}
          </div>
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

      {/* Submit Button - Always shown, disabled if no documents or submitting */}
      {onSubmit && (
        <div className="mt-6 flex gap-3">
          <button
            onClick={onSubmit}
            disabled={stageDocuments.length === 0 || isSubmitting}
            className="flex-1 rounded bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:bg-stone-600 disabled:text-stone-400 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
          >
            {isSubmitting ? (
              <>
                <div className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white border-t-emerald-200" />
                Submitting...
              </>
            ) : stageDocuments.length === 0 ? (
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
                Add Documents to Submit
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
                    d="M5 13l4 4L19 7"
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
