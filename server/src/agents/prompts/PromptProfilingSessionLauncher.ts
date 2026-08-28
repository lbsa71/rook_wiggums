import type { ILogger } from "../../logging";
import type {
  ClaudeSessionRequest,
  ClaudeSessionResult,
  ISessionLauncher,
  LaunchOptions,
} from "../claude/ISessionLauncher";
import { PromptTokenProfiler } from "./PromptTokenProfiler";

/**
 * Fail-open observational decorator. It forwards the original request and options
 * objects unchanged, and never lets attribution failure affect inference routing.
 */
export class PromptProfilingSessionLauncher implements ISessionLauncher {
  constructor(
    private readonly inner: ISessionLauncher,
    private readonly logger: ILogger,
    private readonly profiler: PromptTokenProfiler = new PromptTokenProfiler(),
  ) {}

  launch(request: ClaudeSessionRequest, options?: LaunchOptions): Promise<ClaudeSessionResult> {
    try {
      const profile = this.profiler.profile(request, options);
      this.logger.debug(`[PROMPT_PROFILE] ${JSON.stringify(profile)}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`prompt profiling failed open: ${message}`);
    }

    return this.inner.launch(request, options);
  }
}
