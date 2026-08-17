import { afterEach, describe, expect, it, vi } from "vitest";
import {
  checkChatGPTExtension,
  checkGeminiExtension,
  localVoxApiBaseUrl,
  startBatchInGeminiExtension,
} from "./extensionBridge";

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

function installExtensionBridgeWindow(
  responseSource: string,
  protocol: string,
) {
  const listeners = new Set<(event: MessageEvent) => void>();
  let request: Record<string, unknown> | undefined;
  const origin = "http://localhost:4175";
  const fakeWindow = {
    location: {
      protocol: "http:",
      hostname: "localhost",
      port: "4175",
      origin,
    },
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    addEventListener: (_type: string, handler: (event: MessageEvent) => void) => {
      listeners.add(handler);
    },
    removeEventListener: (_type: string, handler: (event: MessageEvent) => void) => {
      listeners.delete(handler);
    },
    postMessage: (message: Record<string, unknown>) => {
      request = message;
      const responseTypes: Record<string, string> = {
        CHECK_EXTENSION: "CHECK_EXTENSION_RESULT",
        START_CHATGPT_BATCH: "START_CHATGPT_BATCH_RESULT",
        CHECK_GEMINI_EXTENSION: "CHECK_GEMINI_EXTENSION_RESULT",
        START_GEMINI_BATCH: "START_GEMINI_BATCH_RESULT",
      };
      queueMicrotask(() => {
        for (const listener of [...listeners]) listener({
          source: fakeWindow,
          origin,
          data: {
            source: responseSource,
            protocol,
            type: responseTypes[String(message.type)],
            requestId: message.requestId,
            ok: true,
            data: {
              installed: true,
              connected: true,
              connectionMode: "local-development",
              extensionVersion: "0.7.1",
            },
          },
        } as unknown as MessageEvent);
      });
    },
  };
  vi.stubGlobal("window", fakeWindow);
  return { request: () => request };
}

describe("Gemini extension bridge", () => {
  it("keeps ChatGPT and Gemini response identities isolated", async () => {
    installExtensionBridgeWindow("auto-chatgpt-images", "vox-chatgpt/1");
    await expect(checkChatGPTExtension()).resolves.toMatchObject({ connected: true });
    vi.unstubAllGlobals();

    installExtensionBridgeWindow("auto-gemini-images", "vox-gemini/2");
    await expect(checkGeminiExtension()).resolves.toMatchObject({ connected: true });
  });

  it("falls back to the Gemini v1 bridge during a rolling extension update", async () => {
    installExtensionBridgeWindow("auto-gemini-images", "vox-gemini/1");
    await expect(checkGeminiExtension(5)).resolves.toMatchObject({
      installed: true,
      connected: true,
    });
  });

  it("sends a Gemini storyboard batch through the compatible wire contract", async () => {
    const bridge = installExtensionBridgeWindow(
      "auto-gemini-images",
      "vox-gemini/2",
    );
    await startBatchInGeminiExtension("batch-gemini-1", {
      executionMode: "auto",
      openNewChat: true,
      resetWorkspace: true,
    }, 5);
    expect(bridge.request()).toMatchObject({
      type: "START_GEMINI_BATCH",
      batchId: "batch-gemini-1",
      executionMode: "auto",
      openNewChat: true,
      resetWorkspace: true,
    });
  });
});
