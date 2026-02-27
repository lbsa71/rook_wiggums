export interface HesitationMatch {
  pattern: string;
  context: string;
  index: number;
}

const DEFAULT_PATTERNS: RegExp[] = [
  /I should (?:check with|ask|verify with) (?:my )?partner/i,
  /(?:need|require|want) (?:permission|approval|confirmation)/i,
  /not sure if I (?:should|can|have permission)/i,
  /let me (?:ask|check with|confirm with)/i,
];

const CONTEXT_WINDOW = 100;

export class HesitationDetector {
  private readonly patterns: RegExp[];

  constructor(patterns?: RegExp[]) {
    this.patterns = patterns ?? DEFAULT_PATTERNS;
  }

  detect(text: string): HesitationMatch | null {
    for (const pattern of this.patterns) {
      const match = pattern.exec(text);
      if (match) {
        const start = Math.max(0, match.index - CONTEXT_WINDOW);
        const end = Math.min(text.length, match.index + match[0].length + CONTEXT_WINDOW);
        return {
          pattern: pattern.source,
          context: text.slice(start, end).trim(),
          index: match.index,
        };
      }
    }
    return null;
  }
}
