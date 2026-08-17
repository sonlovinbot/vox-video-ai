const CHATGPT_PROTOCOL = "vox-chatgpt/1";
const GEMINI_PROTOCOL = "vox-gemini/2";

interface ExtensionStatus {
  installed: boolean;
  connected: boolean;
  connectionMode: "local-development" | "oauth";
  extensionVersion: string;
}

export interface StartExtensionBatchOptions {
  executionMode: "auto" | "manual";
  openNewChat: boolean;
  resetWorkspace: boolean;
}

interface BridgeContract {
  protocol: string;
  responseSource: string;
  check: [string, string];
  open: [string, string];
  start: [string, string];
  label: string;
}

const CHATGPT_BRIDGE: BridgeContract = {
  protocol: CHATGPT_PROTOCOL,
  responseSource: "auto-chatgpt-images",
  check: ["CHECK_EXTENSION", "CHECK_EXTENSION_RESULT"],
  open: ["OPEN_CHATGPT_EXTENSION", "OPEN_CHATGPT_EXTENSION_RESULT"],
  start: ["START_CHATGPT_BATCH", "START_CHATGPT_BATCH_RESULT"],
  label: "ChatGPT",
};

const GEMINI_BRIDGE: BridgeContract = {
  protocol: GEMINI_PROTOCOL,
  responseSource: "auto-gemini-images",
  check: ["CHECK_GEMINI_EXTENSION", "CHECK_GEMINI_EXTENSION_RESULT"],
  open: ["OPEN_GEMINI_EXTENSION", "OPEN_GEMINI_EXTENSION_RESULT"],
  start: ["START_GEMINI_BATCH", "START_GEMINI_BATCH_RESULT"],
  label: "Gemini",
};

const GEMINI_LEGACY_BRIDGE: BridgeContract = {
  ...GEMINI_BRIDGE,
  protocol: "vox-gemini/1",
};

let detectedGeminiBridge: BridgeContract | null = null;

export function localVoxApiBaseUrl() {
  if (import.meta.env.DEV) {
    return `${window.location.protocol}//${window.location.hostname}:4174`;
  }
  return window.location.origin;
}

function requestExtension<T>(
  contract: BridgeContract,
  [type, responseType]: [string, string],
  payload: Record<string, unknown>,
  timeoutMs: number,
): Promise<T> {
  const requestId = crypto.randomUUID();
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      window.removeEventListener("message", onMessage);
      reject(
        new Error(
          `Không phát hiện Auto ${contract.label} Images trên tab VOX này. ` +
            "Hãy reload extension hoặc reload riêng trang VOX rồi thử lại.",
        ),
      );
    }, timeoutMs);

    function onMessage(event: MessageEvent) {
      const message = event.data;
      if (
        event.source !== window ||
        event.origin !== window.location.origin ||
        message?.source !== contract.responseSource ||
        message?.protocol !== contract.protocol ||
        message?.type !== responseType ||
        message?.requestId !== requestId
      ) {
        return;
      }
      window.clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      if (message.ok) resolve(message.data as T);
      else {
        const error = new Error(message.error || "Extension không nhận batch.") as Error & {
          code?: string;
        };
        error.code = message.code || "EXTENSION_REQUEST_FAILED";
        reject(error);
      }
    }

    window.addEventListener("message", onMessage);
    window.postMessage(
      {
        source: "vox-style-video",
        protocol: contract.protocol,
        type,
        requestId,
        ...payload,
      },
      window.location.origin,
    );
  });
}

function checkExtension(contract: BridgeContract, timeoutMs: number) {
  return requestExtension<ExtensionStatus>(contract, contract.check, {}, timeoutMs);
}

function openExtensionPanel(contract: BridgeContract, timeoutMs: number) {
  return requestExtension<{ opened: boolean }>(contract, contract.open, {}, timeoutMs);
}

async function requestGeminiWithFallback<T>(
  operation: (contract: BridgeContract) => Promise<T>,
) {
  if (!detectedGeminiBridge) {
    try {
      const detected = await Promise.any(
        [GEMINI_BRIDGE, GEMINI_LEGACY_BRIDGE].map(async (contract) => ({
          contract,
          result: await operation(contract),
        })),
      );
      detectedGeminiBridge = detected.contract;
      return detected.result;
    } catch (error) {
      if (error instanceof AggregateError && error.errors.length) {
        throw error.errors[0];
      }
      throw error;
    }
  }
  const candidates = detectedGeminiBridge
    ? [
        detectedGeminiBridge,
        detectedGeminiBridge.protocol === GEMINI_BRIDGE.protocol
          ? GEMINI_LEGACY_BRIDGE
          : GEMINI_BRIDGE,
      ]
    : [GEMINI_BRIDGE, GEMINI_LEGACY_BRIDGE];
  let firstError: unknown;
  for (const contract of candidates) {
    try {
      const result = await operation(contract);
      detectedGeminiBridge = contract;
      return result;
    } catch (error) {
      firstError ??= error;
    }
  }
  throw firstError;
}

async function startBatch(
  contract: BridgeContract,
  batchId: string,
  options: StartExtensionBatchOptions,
  timeoutMs: number,
) {
  await requestExtension<void>(
    contract,
    contract.start,
    {
      batchId,
      voxBaseUrl: localVoxApiBaseUrl(),
      executionMode: options.executionMode,
      openNewChat: options.openNewChat,
      resetWorkspace: options.resetWorkspace,
    },
    timeoutMs,
  );
}

export function checkChatGPTExtension(timeoutMs = 2500) {
  return checkExtension(CHATGPT_BRIDGE, timeoutMs);
}

export function openChatGPTExtensionPanel(timeoutMs = 5000) {
  return openExtensionPanel(CHATGPT_BRIDGE, timeoutMs);
}

export function startBatchInChatGPTExtension(
  batchId: string,
  options: StartExtensionBatchOptions,
  timeoutMs = 10000,
) {
  return startBatch(CHATGPT_BRIDGE, batchId, options, timeoutMs);
}

export function checkGeminiExtension(timeoutMs = 2500) {
  return requestGeminiWithFallback((contract) =>
    checkExtension(contract, timeoutMs),
  );
}

export function openGeminiExtensionPanel(timeoutMs = 5000) {
  return requestGeminiWithFallback((contract) =>
    openExtensionPanel(contract, timeoutMs),
  );
}

export function startBatchInGeminiExtension(
  batchId: string,
  options: StartExtensionBatchOptions,
  timeoutMs = 10000,
) {
  return requestGeminiWithFallback((contract) =>
    startBatch(contract, batchId, options, timeoutMs),
  );
}
