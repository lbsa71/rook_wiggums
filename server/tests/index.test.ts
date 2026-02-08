import { getVersion } from "../src/index";

describe("server", () => {
  it("returns the application version", () => {
    expect(getVersion()).toBe("0.1.0");
  });
});
