import { VIDEO_PRESETS } from "./video";
import type { AppSettings } from "../types";

const SETTINGS_KEY = "vox-style-video-settings-v2";

export const defaultSettings: AppSettings = {
  scriptProvider: "deepseek",
  deepseekModel: "deepseek-v4-flash",
  imageProvider: "coachio",
  coachioModel: "gpt_image_2",
  geminiModel: "gemini-3.1-flash-image",
  imageResolution: "1k",
  fallbackToGemini: true,
  voiceProvider: "elevenlabs",
  elevenLabsModel: "eleven_v3",
  voiceIdVi: "JxmKvRaNYFidf0N27Vng",
  voiceIdEn: "",
  imageSearchEnabled: false,
  searchPexels: true,
  searchSerper: true,
  imageSearchCount: 6,
  chatgptExtensionMode: "auto",
  chatgptOpenNewConversation: true,
  chatgptResetWorkspace: true,
  replicateModel: "wan-video/wan-2.2-i2v-fast",
  video: VIDEO_PRESETS.draft,
  groqModel: "whisper-large-v3",
  captionsEnabled: true,
};

export function loadSettings(): AppSettings {
  try {
    const saved = localStorage.getItem(SETTINGS_KEY);
    if (!saved) return defaultSettings;
    const parsed = JSON.parse(saved) as Partial<AppSettings>;
    return {
      ...defaultSettings,
      ...parsed,
      // v4-pro từng là mặc định của app, nhưng bật model lớn cho JSON kịch bản
      // ngắn làm thời gian chờ tăng mạnh. Tự chuyển bản mặc định cũ sang Flash;
      // các model tuỳ chỉnh khác của user vẫn được giữ nguyên.
      deepseekModel:
        parsed.deepseekModel === "deepseek-v4-pro"
          ? "deepseek-v4-flash"
          : parsed.deepseekModel || defaultSettings.deepseekModel,
      // Merge nông sẽ ghi đè cả object video bằng bản lưu thiếu field.
      video: { ...defaultSettings.video, ...(parsed.video || {}) },
    };
  } catch {
    return defaultSettings;
  }
}

export function saveSettings(settings: AppSettings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}
