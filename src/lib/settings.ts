import { VIDEO_PRESETS } from "./video";
import type { AppSettings } from "../types";

const SETTINGS_KEY = "vox-style-video-settings-v2";

export const defaultSettings: AppSettings = {
  scriptProvider: "deepseek",
  deepseekModel: "deepseek-v4-pro",
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
  imageSearchCount: 6,
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
