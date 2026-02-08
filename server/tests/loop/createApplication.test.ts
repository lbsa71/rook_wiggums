import { createApplication, ApplicationConfig } from "../../src/loop/createApplication";
import { LoopState } from "../../src/loop/types";

describe("createApplication", () => {
  it("creates an application with all components wired", () => {
    const config: ApplicationConfig = {
      substratePath: "/tmp/test-substrate",
      httpPort: 0,
      cycleDelayMs: 1000,
      superegoAuditInterval: 10,
      maxConsecutiveIdleCycles: 5,
    };

    const app = createApplication(config);

    expect(app).toBeDefined();
    expect(app.orchestrator).toBeDefined();
    expect(app.httpServer).toBeDefined();
    expect(app.wsServer).toBeDefined();
  });

  it("orchestrator starts in STOPPED state", () => {
    const config: ApplicationConfig = {
      substratePath: "/tmp/test-substrate",
      httpPort: 0,
      cycleDelayMs: 500,
      superegoAuditInterval: 5,
      maxConsecutiveIdleCycles: 3,
    };

    const app = createApplication(config);

    expect(app.orchestrator.getState()).toBe(LoopState.STOPPED);
  });

  it("provides start and stop methods", async () => {
    const config: ApplicationConfig = {
      substratePath: "/tmp/test-substrate",
      httpPort: 0,
      cycleDelayMs: 1000,
      superegoAuditInterval: 10,
      maxConsecutiveIdleCycles: 5,
    };

    const app = createApplication(config);

    expect(typeof app.start).toBe("function");
    expect(typeof app.stop).toBe("function");
  });

  it("uses default config for optional fields", () => {
    const config: ApplicationConfig = {
      substratePath: "/tmp/test-substrate",
    };

    const app = createApplication(config);
    expect(app).toBeDefined();
    expect(app.orchestrator.getState()).toBe(LoopState.STOPPED);
  });
});
