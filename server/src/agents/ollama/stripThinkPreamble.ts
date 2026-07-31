/**
 * Strip a leading `<think>...</think>` chain-of-thought preamble emitted by
 * reasoning models (e.g. deepseek-r1, qwen3 with thinking enabled) so that
 * downstream consumers receive the actual answer rather than the model's raw
 * reasoning tokens.
 *
 * Behavior contract (single source of truth for every Ollama code path):
 * - Removes a single leading `<think>...</think>` block (case-insensitive,
 *   multiline) plus following whitespace, then trims leading whitespace.
 * - If stripping would leave an EMPTY string (the model returned only a think
 *   block and no answer), returns the ORIGINAL content unchanged so callers
 *   see the raw output rather than nothing. This preserves fail-open behavior
 *   for quality gates: a think-only response is visible and can be rejected,
 *   not silently blanked.
 *
 * This was previously implemented inline only in OllamaSessionLauncher; the
 * OllamaInferenceClient path used for CONVERSATION.md compaction offload did
 * not strip, so with a thinking default model (qwen3:14b) raw `<think>` tokens
 * could be written into the durable substrate. Extracting a shared helper
 * removes that inconsistency at its root.
 */
export function stripThinkPreamble(content: string): string {
  const stripped = content.replace(/^<think>[\s\S]*?<\/think>\s*/i, "").trimStart();
  return stripped.length > 0 ? stripped : content;
}
