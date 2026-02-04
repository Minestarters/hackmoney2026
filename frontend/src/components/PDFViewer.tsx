import { useState, useRef, useEffect } from "react";
import toast from "react-hot-toast";

interface PDFViewerProps {
  fileUrl: string;
  fileName: string;
  onClose: () => void;
}

export const PDFViewer = ({ fileUrl, fileName, onClose }: PDFViewerProps) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Handle local file:// URLs
  useEffect(() => {
    const loadLocalFile = async () => {
      if (fileUrl.startsWith("file://")) {
        try {
          // For local files, we need to show a warning that we can't access file system directly
          // Browser security restrictions prevent reading file:// URLs
          setError(
            "Local files must be downloaded to view. Use the Download button below.",
          );
          setLoading(false);
        } catch {
          setError("Failed to load local PDF. Please try downloading instead.");
          setLoading(false);
        }
      } else {
        // For non-file URLs, let iframe handle it normally
        setLoading(true);
      }
    };

    loadLocalFile();
  }, [fileUrl]);

  const handleIframeLoad = () => {
    setLoading(false);
  };

  const handleIframeError = () => {
    setLoading(false);
    setError("Failed to load PDF. Please try downloading instead.");
  };

  const handleDownload = () => {
    const link = document.createElement("a");
    // For local files, we still attempt download with the path
    link.href = fileUrl;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success("Download started");
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
      <div className="flex h-full max-h-screen w-full max-w-4xl flex-col rounded-lg bg-stone-900 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-stone-700 bg-stone-800/50 p-4">
          <div className="flex-1 min-w-0">
            <h3 className="truncate text-sm font-semibold text-stone-100">
              {fileName}
            </h3>
          </div>
          <div className="ml-4 flex gap-2">
            <button
              onClick={handleDownload}
              className="rounded bg-sky-600 px-3 py-2 text-xs font-medium text-white hover:bg-sky-700 transition-colors"
              title="Download PDF"
            >
              Download
            </button>
            <button
              onClick={onClose}
              className="rounded bg-stone-700 px-3 py-2 text-xs font-medium text-stone-100 hover:bg-stone-600 transition-colors"
            >
              Close
            </button>
          </div>
        </div>

        {/* Viewer */}
        <div className="flex-1 overflow-hidden">
          {loading && !error && (
            <div className="flex h-full items-center justify-center bg-stone-900">
              <div className="text-center">
                <div className="mb-2 inline-block h-6 w-6 animate-spin rounded-full border-2 border-stone-600 border-t-sky-400" />
                <p className="text-sm text-stone-400">Loading PDF...</p>
              </div>
            </div>
          )}

          {error ? (
            <div className="flex h-full items-center justify-center bg-stone-900">
              <div className="text-center">
                <p className="mb-4 text-sm text-red-400">{error}</p>
                <button
                  onClick={handleDownload}
                  className="rounded bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700 transition-colors"
                >
                  Download PDF Instead
                </button>
              </div>
            </div>
          ) : (
            <iframe
              ref={iframeRef}
              src={fileUrl}
              className="h-full w-full"
              title={fileName}
              onLoad={handleIframeLoad}
              onError={handleIframeError}
            />
          )}
        </div>
      </div>
    </div>
  );
};
