import { createHash } from "node:crypto";
import oracle from "./fixtures/comparator-s-experimental-oracle.json";
import baseline from "./fixtures/current-runtime-causal-baseline.json";

const ORACLE_SHA256 = "4c59b00441fee570853f1303b222064cddf9f19243dd1aa8b121f58ba84e6e87";

describe("retired Comparator S experimental oracle", () => {
  it("preserves the complete, ordered S00-S20 recovery oracle", () => {
    expect(oracle.packets.map(({ id }) => id)).toEqual(
      Array.from({ length: 21 }, (_, index) => `S${String(index).padStart(2, "0")}`),
    );
    expect(new Set(oracle.packets.map(({ id }) => id)).size).toBe(21);
    expect(oracle.packets.every(({ phase, status, nextAction }) =>
      Boolean(phase && status && nextAction))).toBe(true);
  });

  it("preserves exact Stage-0 parity coverage without importing retired code", () => {
    expect(oracle.stage0Parity).toEqual(Object.keys(baseline.interventions));
    expect(oracle.authority).toBe("none");
    expect(oracle.architectureExpansion).toBe("stopped");
  });

  it("preserves both held checks and the effective-confinement falsification", () => {
    expect(oracle.confinement.verdict).toBe("falsified");
    expect(oracle.confinement.held).toEqual([
      "lexical_alias", "direct_target_symlink", "simple_stale_preimage",
    ]);
    expect(oracle.confinement.failed).toEqual([
      "parent_symlink_redirection",
      "hard_link_temp_substitution",
      "final_check_rename_toctou",
      "aba_history_loss",
      "verifier_ambient_privilege",
      "capability_reuse",
      "alternate_write_bypass",
    ]);
  });

  it("freezes the protocol-independent oracle bytes", () => {
    const digest = createHash("sha256").update(JSON.stringify(oracle)).digest("hex");
    expect(digest).toBe(ORACLE_SHA256);
  });
});
