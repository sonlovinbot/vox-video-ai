import { afterEach, describe, expect, it, vi } from "vitest";
import { localVoxApiBaseUrl } from "./extensionBridge";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("extension bridge URL", () => {
  it("uses the VOX API port even when Vite moves the frontend to port 4175", () => {
    vi.stubGlobal("window", {
      location: {
        protocol: "http:",
        hostname: "localhost",
        port: "4175",
        origin: "http://localhost:4175",
      },
    });

    expect(localVoxApiBaseUrl()).toBe("http://localhost:4174");
  });
});
