import { AgentSdkLauncher, SdkQueryFn } from "../../../src/agents/claude/AgentSdkLauncher";
import { ISessionLauncher } from "../../../src/agents/claude/ISessionLauncher";
import { FixedClock } from "../../../src/substrate/abstractions/FixedClock";

describe("ISessionLauncher", () => {
  it("AgentSdkLauncher satisfies the interface", () => {
    const clock = new FixedClock(new Date("2025-01-01T00:00:00.000Z"));
    const queryFn: SdkQueryFn = () => (async function* () {})();
    const launcher: ISessionLauncher = new AgentSdkLauncher(queryFn, clock);
    expect(launcher).toBeDefined();
    expect(typeof launcher.launch).toBe("function");
  });
});
