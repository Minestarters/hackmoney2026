import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { Toaster } from "react-hot-toast";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import "./index.css";
import { WalletProvider } from "./context/WalletContext";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60 * 1000, // 1 minute
    },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <QueryClientProvider client={queryClient}>
        <WalletProvider>
          <App />
          <Toaster position="bottom-right" toastOptions={{ duration: 5000 }} />
        </WalletProvider>
      </QueryClientProvider>
    </BrowserRouter>
  </StrictMode>,
);
