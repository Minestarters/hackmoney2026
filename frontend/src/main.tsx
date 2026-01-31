import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { Toaster } from "react-hot-toast";
import App from "./App";
import "./index.css";
import { WalletProvider } from "./context/WalletContext";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <WalletProvider>
        <App />
        <Toaster position="bottom-right" toastOptions={{ duration: 5000 }} />
      </WalletProvider>
    </BrowserRouter>
  </StrictMode>
);
