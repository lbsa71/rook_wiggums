import { ISessionLauncher, ClaudeSessionRequest, ClaudeSessionResult, LaunchOptions } from "./ISessionLauncher";
import { ApiSemaphore } from "./ApiSemaphore";

/**
 * Wraps an ISessionLauncher with an ApiSemaphore to cap concurrent sessions.
 */
export class SemaphoreSessionLauncher implements ISessionLauncher {
  constructor(
    private readonly inner: ISessionLauncher,
    private readonly semaphore: ApiSemaphore,
  ) {}

  async launch(request: ClaudeSessionRequest, options?: LaunchOptions): Promise<ClaudeSessionResult> {
    const release = await this.semaphore.acquire();
    try {
      return await this.inner.launch(request, options);
    } finally {
      release();
    }
  }
}
