const UNPROCESSED_BADGE_PATTERN = /\*\*\[UNPROCESSED(?:\s+([^\]]+))?\]\*\*/;
const ENVELOPE_ID_PATTERN = /(?:^|\s)envelopeId=([^\s\]]+)/;

export function hasUnprocessedMarker(line: string): boolean {
  return UNPROCESSED_BADGE_PATTERN.test(line);
}

export function getUnprocessedEnvelopeId(line: string): string | null {
  const match = line.match(UNPROCESSED_BADGE_PATTERN);
  if (!match?.[1]) {
    return null;
  }
  return match[1].match(ENVELOPE_ID_PATTERN)?.[1] ?? null;
}

export function removeUnprocessedMarker(line: string): string {
  return line.replace(/\s*\*\*\[UNPROCESSED(?:\s+[^\]]+)?\]\*\*/g, "").replace(/\s{2,}/g, " ").trimEnd();
}

export function isActionableUnprocessedLine(line: string): boolean {
  if (!hasUnprocessedMarker(line)) {
    return false;
  }
  if (/\bannounce:\s*\*\*\[UNPROCESSED(?:\s+[^\]]+)?\]\*\*/.test(line)) {
    return false;
  }
  return /:\s*\*\*\[UNPROCESSED(?:\s+[^\]]+)?\]\*\*/.test(line)
    || /\([^)]+\)\s*\*\*\[UNPROCESSED(?:\s+[^\]]+)?\]\*\*/.test(line);
}
