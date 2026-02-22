import { createContext, useContext } from "react";
import type { IEnvironment } from "./IEnvironment";
import { createBrowserEnvironment } from "./BrowserEnvironment";

const defaultEnv = createBrowserEnvironment();

export const EnvironmentContext = createContext<IEnvironment>(defaultEnv);

export function useEnvironment(): IEnvironment {
  return useContext(EnvironmentContext);
}
