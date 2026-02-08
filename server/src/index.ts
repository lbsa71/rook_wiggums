export { createApplication } from "./loop/createApplication";
export type { ApplicationConfig, Application } from "./loop/createApplication";

export function getVersion(): string {
  return "0.1.0";
}

// Runtime startup when executed directly
import { startServer } from "./startup";

const substratePath = process.env["SUBSTRATE_PATH"] ?? "./substrate";
const port = parseInt(process.env["PORT"] ?? "3000", 10);

startServer({ substratePath, port }).catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
