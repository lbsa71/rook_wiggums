import * as path from "node:path";
import { IFileSystem } from "../../substrate/abstractions/IFileSystem";
import { NodeFileSystem } from "../../substrate/abstractions/NodeFileSystem";
import { TriggerEvaluator } from "./PlanParser";

const MAX_TRIGGER_LENGTH = 512;
const FILE_OPERATORS = new Set(["-e", "-f", "-d", "-s"]);

interface FilePredicate {
  kind: "file";
  operator: string;
  operand: string;
  negate: boolean;
}

interface ConstantPredicate {
  kind: "constant";
  value: boolean;
}

type ParsedPredicate = FilePredicate | ConstantPredicate;

/**
 * Evaluates the deliberately small, read-only predicate language accepted in
 * deferred PLAN task WHEN clauses. Despite the legacy class name, this class
 * never invokes a shell or subprocess.
 *
 * Supported forms:
 *   true | false | exit <0-255>
 *   test [!] <-e|-f|-d|-s> <path>
 *   [ [!] <-e|-f|-d|-s> <path> ]
 */
export class ShellTriggerEvaluator implements TriggerEvaluator {
  constructor(
    private readonly fs: IFileSystem = new NodeFileSystem(),
    private readonly workingDirectory: string = process.cwd()
  ) {}

  async evaluate(trigger: string): Promise<boolean> {
    const predicate = parsePredicate(trigger);
    if (!predicate) return false;
    if (predicate.kind === "constant") return predicate.value;

    const targetPath = path.isAbsolute(predicate.operand)
      ? path.normalize(predicate.operand)
      : path.resolve(this.workingDirectory, predicate.operand);

    let result = false;
    try {
      if (predicate.operator === "-e") {
        result = await this.fs.exists(targetPath);
      } else {
        const stat = await this.fs.stat(targetPath);
        switch (predicate.operator) {
          case "-f":
            result = stat.isFile;
            break;
          case "-d":
            result = stat.isDirectory;
            break;
          case "-s":
            result = stat.size > 0;
            break;
        }
      }
    } catch {
      result = false;
    }

    return predicate.negate ? !result : result;
  }
}

function parsePredicate(trigger: string): ParsedPredicate | null {
  const trimmed = trigger.trim();
  if (
    trimmed.length === 0 ||
    trimmed.length > MAX_TRIGGER_LENGTH ||
    containsForbiddenSyntax(trimmed)
  ) {
    return null;
  }

  const tokens = tokenize(trimmed);
  if (!tokens) return null;

  if (tokens.length === 1 && tokens[0] === "true") {
    return { kind: "constant", value: true };
  }
  if (tokens.length === 1 && tokens[0] === "false") {
    return { kind: "constant", value: false };
  }
  if (tokens.length === 2 && tokens[0] === "exit" && /^(?:0|[1-9]\d{0,2})$/.test(tokens[1])) {
    const exitCode = Number(tokens[1]);
    if (exitCode <= 255) {
      return { kind: "constant", value: exitCode === 0 };
    }
  }

  let body: string[];
  if (tokens[0] === "test") {
    body = tokens.slice(1);
  } else if (tokens[0] === "[" && tokens[tokens.length - 1] === "]") {
    body = tokens.slice(1, -1);
  } else {
    return null;
  }

  const negate = body[0] === "!";
  if (negate) body = body.slice(1);
  if (body.length !== 2 || !FILE_OPERATORS.has(body[0]) || body[1].length === 0) {
    return null;
  }

  return {
    kind: "file",
    operator: body[0],
    operand: body[1],
    negate,
  };
}

function containsForbiddenSyntax(trigger: string): boolean {
  // Shell expansion, control, redirection, pipelines, globbing, grouping, and
  // escape syntax are all invalid even though no shell is invoked. Rejecting
  // them explicitly keeps the accepted language reviewable and fail-closed.
  return /[\0\r\n;&|<>`$\\*?(){}]/.test(trigger);
}

function tokenize(input: string): string[] | null {
  const tokens: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let tokenStarted = false;

  for (const character of input) {
    if (quote) {
      if (character === quote) {
        quote = null;
      } else {
        current += character;
      }
      tokenStarted = true;
      continue;
    }

    if (character === "'" || character === '"') {
      quote = character;
      tokenStarted = true;
    } else if (/\s/.test(character)) {
      if (tokenStarted) {
        tokens.push(current);
        current = "";
        tokenStarted = false;
      }
    } else {
      current += character;
      tokenStarted = true;
    }
  }

  if (quote) return null;
  if (tokenStarted) tokens.push(current);
  return tokens;
}
