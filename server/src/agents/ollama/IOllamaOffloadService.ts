import type { OffloadTask, OffloadResult } from "./OllamaOffloadService";

/**
 * Interface for the Ollama offload service — allows test doubles.
 *
 * The offload service handles selective task offloading to a local Ollama
 * instance with automatic backoff, recovery probes, and quality gates.
 */
export interface IOllamaOffloadService {
  /**
   * Attempt to offload a task to Ollama.
   * Never throws — always returns an OffloadResult.
   */
  offload(task: OffloadTask): Promise<OffloadResult>;

  /**
   * Check if the service is currently in backoff mode
   * (3+ consecutive failures, polling every 3rd call).
   */
  isInBackoff(): boolean;
}
