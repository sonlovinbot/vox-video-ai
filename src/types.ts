export type StepId = "setup" | "script" | "casting" | "storyboard";
export type AspectRatio = "9:16" | "1:1" | "16:9";
export type Duration = 30 | 60 | 180;
export type RefRole = "subject" | "style" | "character" | "environment";
export type ProjectStatus = "draft" | "in_progress" | "completed";
export type GenerationStatus =
  | "idle"
  | "queued"
  | "generating"
  | "completed"
  | "failed"
  | "canceled";

export interface ReferenceAsset {
  id: string;
  name: string;
  type: string;
  size: number;
  previewUrl: string;
  role: RefRole;
  notes: string;
  /** Mô tả thị giác do Gemini đọc trực tiếp từ ảnh trước khi viết script. */
  visualDescription?: string;
  /** Cụm từ tiếng Anh cụ thể để DeepSeek dùng khi lập searchQuery. */
  visualKeywords?: string[];
}

export type RefLock = "identity" | "style" | "content";
export type RefKind = "upload" | "searched";
export type RefPlanStatus = "pending" | "searching" | "ready" | "failed";
export type SearchSource = "pexels" | "serper";

export interface SearchedImage {
  id: string;
  source: SearchSource;
  thumbUrl: string;
  fullUrl: string;
  cachedUrl: string;
  attribution: string;
  sourcePage: string;
}

export interface BeatRefSlot {
  id: string;
  kind: RefKind;
  assetId: string;
  lock: RefLock;
  reason: string;
  pinned: boolean;
}

export interface BeatRefPlan {
  status: RefPlanStatus;
  slots: BeatRefSlot[];
  searchQuery: string;
  candidates: SearchedImage[];
  newElements: string[];
  error: string;
}

export type VideoStatus =
  | "idle"
  | "queued"
  | "generating"
  | "completed"
  | "failed"
  | "canceled";
export type VideoQuality = "draft" | "standard" | "high" | "custom";
export type VideoResolution = "480p" | "720p";

export interface BeatVideo {
  status: VideoStatus;
  /** "/generated/videos/<id>.mp4" — nguồn sự thật, tồn tại lâu dài. */
  url: string;
  /** Link Replicate. Chỉ để đối chiếu; Replicate xoá file sau 1 giờ. */
  remoteUrl: string;
  predictionId: string;
  /** frames / fps. Bước ráp video cuối cần đúng con số này. */
  durationSeconds: number;
  frames: number;
  fps: number;
  resolution: string;
  error: string;
  createdAt: string;
}

export interface VideoSettings {
  quality: VideoQuality;
  resolution: VideoResolution;
  fps: number;
  interpolate: boolean;
  goFast: boolean;
  sampleShift: number;
}

export interface CaptionWord {
  text: string;
  start: number;
  end: number;
}

export interface CaptionPhrase {
  text: string;
  start: number;
  end: number;
  /** Beat được gán; 0 nghĩa là chưa gán được vào beat nào. */
  beatIndex: number;
  words: CaptionWord[];
}

export interface VoiceTimeline {
  status: "idle" | "transcribing" | "ready" | "failed";
  /** "/generated/audio/<id>.mp3" — sống qua F5, khác hẳn object URL cũ. */
  audioUrl: string;
  audioName: string;
  durationSeconds: number;
  language: string;
  phrases: CaptionPhrase[];
  error: string;
  createdAt: string;
}

export interface Beat {
  id: string;
  index: number;
  start: number;
  end: number;
  job: string;
  narration: string;
  visual: string;
  transition: string;
  overlay: string;
  imagePrompt: string;
  motionPrompt: string;
  outputImage: string;
  outputName: string;
  generationStatus: GenerationStatus;
  generationError: string;
  imageProvider: string;
  refPlan: BeatRefPlan;
  video: BeatVideo;
  /** Prompt riêng cho Replicate; motionPrompt giữ nguyên cho extension. */
  apiMotionPrompt: string;
}

export interface ProjectConfig {
  title: string;
  aspectRatio: AspectRatio;
  duration: Duration;
  language: string;
  context: string;
  objective: string;
  audience: string;
  callToAction: string;
  storyArc: string;
  preserveIdentity: boolean;
  noGeneratedText: boolean;
  flatPaperOnly: boolean;
  singleVoice: boolean;
  videoQuality: VideoQuality;
  /** Nhãn nhỏ màu vàng phía trên tiêu đề cover, ví dụ "GIẢI THÍCH". */
  coverEyebrow: string;
  /** Tiêu đề lớn của cover, cũng là khung dùng làm thumbnail. */
  coverTitle: string;
  /** Cover hiện bao nhiêu giây đầu video. */
  coverSeconds: number;
  /** Tốc độ phát: 1, 1.2 hoặc 1.5. Áp cho cả preview lẫn render. */
  playbackRate: number;
}

export interface RenderOutput {
  /** "/generated/renders/<job>/output.mp4" — nằm trên đĩa, sống qua F5. */
  url: string;
  captionFile: string;
  durationSeconds: number;
  speed: number;
  createdAt: string;
}

export interface ProjectState {
  id: string;
  status: ProjectStatus;
  createdAt: string;
  config: ProjectConfig;
  references: ReferenceAsset[];
  beats: Beat[];
  activeStep: StepId;
  scriptApproved: boolean;
  castingApproved: boolean;
  storyboardGenerated: boolean;
  searchedImages: SearchedImage[];
  timeline: VoiceTimeline;
  lastRender: RenderOutput | null;
  updatedAt: string;
  audioName: string;
}

export interface ProjectSummary {
  id: string;
  title: string;
  status: ProjectStatus;
  aspectRatio: AspectRatio;
  duration: Duration;
  beatCount: number;
  completedFrames: number;
  updatedAt: string;
}

export interface ToastState {
  message: string;
  tone: "success" | "error" | "neutral";
}

export type ScriptProvider = "deepseek" | "template";
export type ImageProvider = "coachio" | "gemini";
export type VoiceProvider = "elevenlabs" | "browser";
export type ImageResolution = "1k" | "2k" | "4k";
export type ChatGPTExtensionMode = "auto" | "manual";

export interface AppSettings {
  scriptProvider: ScriptProvider;
  deepseekModel: string;
  imageProvider: ImageProvider;
  coachioModel: "gpt_image_2";
  geminiModel: string;
  imageResolution: ImageResolution;
  fallbackToGemini: boolean;
  voiceProvider: VoiceProvider;
  elevenLabsModel: string;
  voiceIdVi: string;
  voiceIdEn: string;
  imageSearchEnabled: boolean;
  searchPexels: boolean;
  searchSerper: boolean;
  imageSearchCount: number;
  chatgptExtensionMode: ChatGPTExtensionMode;
  chatgptOpenNewConversation: boolean;
  chatgptResetWorkspace: boolean;
  replicateModel: string;
  video: VideoSettings;
  groqModel: string;
  captionsEnabled: boolean;
}

export interface ProviderStatus {
  coachio: boolean;
  gemini: boolean;
  deepseek: boolean;
  elevenlabs: boolean;
  pexels: boolean;
  serper: boolean;
  replicate: boolean;
  groq: boolean;
}
