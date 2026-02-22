import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { EnvironmentContext } from "./environment/EnvironmentContext";
import { createBrowserEnvironment } from "./environment/BrowserEnvironment";

const env = createBrowserEnvironment();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <EnvironmentContext.Provider value={env}>
      <App />
    </EnvironmentContext.Provider>
  </StrictMode>
);
