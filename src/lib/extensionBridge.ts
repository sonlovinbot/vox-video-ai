const PROTOCOL = "vox-chatgpt/1";

interface ExtensionStatus {
  installed: boolean;
  connected: boolean;
  connectionMode: "local-development" | "oauth";
  extensionVersion: string;
}

export interface StartChatGPTBatchOptions {
  executionMode: "auto" | "manual";
  openNewChat: boolean;
  resetWorkspace: boolean;
}

export function localVoxApiBaseUrl() {
  if (import.meta.env.DEV) {
    return `${window.location.protocol}//${window.location.hostname}:4174`;
  }
  return window.location.origin;
}

function requestExtension<T>(
  type:
    | "CHECK_EXTENSION"
    | "OPEN_CHATGPT_EXTENSION"
    | "START_CHATGPT_BATCH",
  responseType:
    | "CHECK_EXTENSION_RESULT"
    | "OPEN_CHATGPT_EXTENSION_RESULT"
    | "START_CHATGPT_BATCH_RESULT",
  payload: Record<string, unknown>,
  timeoutMs: number,
): Promise<T> {
  const requestId = crypto.randomUUID();
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      window.removeEventListener("message", onMessage);
      const timeoutMessage = {
        CHECK_EXTENSION:
          "Không phát hiện extension trên tab VOX này. Extension có thể vừa được reload; hãy thử lại hoặc reload riêng trang VOX.",
        OPEN_CHATGPT_EXTENSION:
          "Extension không xác nhận được việc mở sidebar. Hãy kiểm tra lỗi Service worker trong chrome://extensions.",
        START_CHATGPT_BATCH:
          "Extension không xác nhận batch trong thời gian cho phép. Batch vẫn được VOX lưu để có thể kết nối lại.",
      }[type];
      reject(
        new Error(timeoutMessage),
      );
    }, timeoutMs);

    function onMessage(event: MessageEvent) {
      const message = event.data;
      if (
        event.source !== window ||
        event.origin !== window.location.origin ||
        message?.source !== "auto-chatgpt-images" ||
        message?.protocol !== PROTOCOL ||
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
        protocol: PROTOCOL,
        type,
        requestId,
        ...payload,
      },
      window.location.origin,
    );
  });
}

export function checkChatGPTExtension(timeoutMs = 2500) {
  return requestExtension<ExtensionStatus>(
    "CHECK_EXTENSION",
    "CHECK_EXTENSION_RESULT",
    {},
    timeoutMs,
  );
}

export function openChatGPTExtensionPanel(timeoutMs = 5000) {
  return requestExtension<{ opened: boolean }>(
    "OPEN_CHATGPT_EXTENSION",
    "OPEN_CHATGPT_EXTENSION_RESULT",
    {},
    timeoutMs,
  );
}

export async function startBatchInExtension(
  batchId: string,
  options: StartChatGPTBatchOptions,
  timeoutMs = 10000,
): Promise<void> {
  await requestExtension<void>(
    "START_CHATGPT_BATCH",
    "START_CHATGPT_BATCH_RESULT",
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
