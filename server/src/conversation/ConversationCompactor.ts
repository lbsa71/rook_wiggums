import { IConversationCompactor } from "./IConversationCompactor";
import { ISessionLauncher, ClaudeSessionRequest } from "../agents/claude/ISessionLauncher";
import type { IOllamaOffloadService } from "../agents/ollama/IOllamaOffloadService";
import type { ILogger } from "../logging";

/**
 * Compacts CONVERSATION.md by summarizing older content.
 *
 * Phase 2: Optionally offloads summarization to a local Ollama instance
 * via OllamaOffloadService. Falls back to the primary session launcher
 * (Claude/Gemini) when Ollama is unavailable or quality gate fails.
 */
export class ConversationCompactor implements IConversationCompactor {
  constructor(
    private readonly sessionLauncher: ISessionLauncher,
    private readonly cwd?: string,
    private readonly offloadService?: IOllamaOffloadService,
    private readonly logger?: ILogger,
  ) {}

  async compact(currentContent: string, oneHourAgo: string): Promise<string> {
    // Split the conversation into recent (last hour) and old (before that)
    const lines = currentContent.split('\n');
    const recentLines: string[] = [];
    const oldLines: string[] = [];
    const headerLines: string[] = [];

    for (const line of lines) {
      // Extract headers separately to avoid duplication
      if (line.startsWith('#')) {
        headerLines.push(line);
        continue;
      }

      // Parse timestamp from line format: [ISO-timestamp] content
      const timestampMatch = line.match(/^\[([^\]]+)\]/);
      if (timestampMatch) {
        const timestamp = timestampMatch[1];
        if (timestamp >= oneHourAgo) {
          recentLines.push(line);
        } else {
          oldLines.push(line);
        }
      } else {
        // Lines without timestamps (non-headers) go with recent
        recentLines.push(line);
      }
    }

    // If there's nothing old to compact, return as-is
    if (oldLines.length === 0) {
      return currentContent;
    }

    const oldContent = oldLines.join('\n');

    // Build the summarization prompt (shared between offload and primary paths)
    const summarizationPrompt =
      `You are helping to compact a CONVERSATION.md file to conserve tokens.\n` +
      `You will be given conversation history older than one hour.\n` +
      `Summarize it concisely in the form: "I said X, then you said Y, we decided Z, I did W, etc."\n` +
      `Keep it brief but capture key decisions, actions, and context.\n` +
      `Respond with ONLY the summary text — no JSON, no markdown code blocks, no wrapper.\n\n` +
      `Summarize this conversation history:\n\n${oldContent}`;

    let summary: string | undefined;

    // Phase 2: Try Ollama offload first when available
    if (this.offloadService) {
      summary = await this.tryOllamaOffload(summarizationPrompt);
    }

    // Fallback: use primary session launcher (Claude/Gemini)
    if (!summary) {
      summary = await this.trySessionLauncher(oldContent, oldLines.length);
    }

    // Build the compacted conversation:
    // 1. Header (if present)
    // 2. Summary of old content
    // 3. Recent detailed content
    const header = headerLines.length > 0 ? headerLines.join('\n') + '\n\n' : '';

    const compacted =
      header +
      `## Summary of Earlier Conversation\n\n` +
      summary + '\n\n' +
      `## Recent Conversation (Last Hour)\n\n` +
      recentLines.join('\n');

    return compacted;
  }

  /**
   * Attempt compaction via Ollama offload service.
   * Returns the summary string on success, or undefined on failure.
   */
  private async tryOllamaOffload(prompt: string): Promise<string | undefined> {
    try {
      this.logger?.debug("[COMPACTION] Attempting Ollama offload for conversation compaction");

      const result = await this.offloadService!.offload({
        taskType: "compaction",
        input: prompt,
        qualityGate: compactionQualityGate,
      });

      if (result.ok) {
        this.logger?.debug("[COMPACTION] Ollama offload succeeded");
        return result.result;
      }

      this.logger?.debug(`[COMPACTION] Ollama offload failed: ${result.reason} — falling back to session launcher`);
      return undefined;
    } catch (err) {
      // Safety net — offload() should never throw, but just in case
      const msg = err instanceof Error ? err.message : String(err);
      this.logger?.debug(`[COMPACTION] Ollama offload unexpected error: ${msg} — falling back to session launcher`);
      return undefined;
    }
  }

  /**
   * Fallback: use the primary session launcher for summarization.
   */
  private async trySessionLauncher(oldContent: string, lineCount: number): Promise<string> {
    const systemPrompt =
      `You are helping to compact a CONVERSATION.md file to conserve tokens.\n` +
      `You will be given conversation history older than one hour.\n` +
      `Summarize it concisely in the form: "I said X, then you said Y, we decided Z, I did W, etc."\n` +
      `Keep it brief but capture key decisions, actions, and context.\n` +
      `Respond with ONLY the summary text — no JSON, no markdown code blocks, no wrapper.`;

    const message = `Summarize this conversation history:\n\n${oldContent}`;

    const request: ClaudeSessionRequest = {
      systemPrompt,
      message
    };

    const result = await this.sessionLauncher.launch(request, {
      cwd: this.cwd
    });

    if (result.success && result.rawOutput) {
      return result.rawOutput.trim();
    }

    // If summarization fails entirely, use a simple note
    return `[Previous conversation history compacted - ${lineCount} lines summarized]`;
  }
}

/**
 * Quality gate for conversation compaction.
 * Ensures the summary is non-trivial and reasonably sized.
 */
function compactionQualityGate(summary: string): boolean {
  return (
    typeof summary === "string" &&
    summary.length > 20 &&          // Must be substantive (not just "ok" or "done")
    summary.length < 50_000 &&      // Guard against hallucination loops
    summary.split('\n').length >= 1  // At least one line of content
  );
}
