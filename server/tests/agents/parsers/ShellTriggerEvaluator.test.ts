import { ShellTriggerEvaluator } from "../../../src/agents/parsers/ShellTriggerEvaluator";
import { InMemoryFileSystem } from "../../../src/substrate/abstractions/InMemoryFileSystem";

describe("ShellTriggerEvaluator", () => {
  let fs: InMemoryFileSystem;
  let evaluator: ShellTriggerEvaluator;

  beforeEach(async () => {
    fs = new InMemoryFileSystem();
    await fs.mkdir("/workspace/data", { recursive: true });
    await fs.writeFile("/workspace/data/ready.txt", "ready");
    await fs.writeFile("/workspace/data/empty.txt", "");
    evaluator = new ShellTriggerEvaluator(fs, "/workspace");
  });

  it.each([
    ["true", true],
    ["false", false],
    ["exit 0", true],
    ["exit 1", false],
    ["exit 255", false],
  ])("evaluates deterministic constant predicate %s", async (trigger, expected) => {
    await expect(evaluator.evaluate(trigger)).resolves.toBe(expected);
  });

  it.each([
    ["test -e data/ready.txt", true],
    ["test -f data/ready.txt", true],
    ["test -d data", true],
    ["test -s data/ready.txt", true],
    ["test -s data/empty.txt", false],
    ["test ! -e data/missing.txt", true],
    ["[ -f 'data/ready.txt' ]", true],
    ['[ -f "data/ready.txt" ]', true],
  ])("evaluates allowlisted file predicate %s", async (trigger, expected) => {
    await expect(evaluator.evaluate(trigger)).resolves.toBe(expected);
  });

  it.each([
    "test -e data/ready.txt $(touch /tmp/pwned)",
    "test -e data/ready.txt `touch /tmp/pwned`",
    "test -e data/ready.txt > /tmp/result",
    "test -e data/ready.txt < /tmp/input",
    "test -e data/ready.txt; touch /tmp/pwned",
    "test -e data/ready.txt && touch /tmp/pwned",
    "test -e data/missing.txt || touch /tmp/pwned",
    "rm -rf /tmp/target",
    "touch /tmp/pwned",
    "test -e data/ready.txt | cat",
    "gh pr list --state open | grep -q foo",
  ])("rejects unsafe or ambiguous expression %s", async (trigger) => {
    await expect(evaluator.evaluate(trigger)).resolves.toBe(false);
  });

  it.each([
    "",
    "test",
    "test -e",
    "test -x data/ready.txt",
    "test -e data/ready.txt extra",
    "[ -e data/ready.txt",
    "[ -e data/ready.txt ] trailing",
    "test -e 'unterminated",
    "exit -1",
    "exit 256",
  ])("fails closed for malformed predicate %s", async (trigger) => {
    await expect(evaluator.evaluate(trigger)).resolves.toBe(false);
  });
});
