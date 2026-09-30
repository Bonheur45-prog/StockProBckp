import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "./styles/tokens.css";
import "./styles/table.css";
import App from "./App.jsx";
import { AuthProvider } from "./context/AuthContext.jsx";
import { initSyncLoop } from "./lib/sync.js";

initSyncLoop();

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>
);
