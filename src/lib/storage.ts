import { defaultConfig } from "./workflow";
import { emptyRefPlan } from "./casting";
import { emptyBeatVideo } from "./video";
import { emptyTimeline } from "./timeline";
import type {
  Beat,
  BeatRefPlan,
  BeatVideo,
  ProjectState,
  ProjectStatus,
  ProjectSummary,
} from "../types";

const LEGACY_STORAGE_KEY = "vox-style-video-project-v1";
const LIBRARY_KEY = "vox-style-video-library-v2";

interface ProjectLibrary {
  activeProjectId: string;
  projects: ProjectState[];
}

function normalizeRefPlan(plan: Partial<BeatRefPlan> | undefined): BeatRefPlan {
  const base = emptyRefPlan([]);
  if (!plan) return base;
  return {
    ...base,
    status: plan.status === "searching" ? "pending" : plan.status || "pending",
    slots: Array.isArray(plan.slots) ? plan.slots : [],
    searchQuery: plan.searchQuery || "",
    candidates: Array.isArray(plan.candidates) ? plan.candidates : [],
    newElements: Array.isArray(plan.newElements) ? plan.newElements : [],
    error: plan.error || "",
  };
}

function normalizeVideo(video: Partial<BeatVideo> | undefined): BeatVideo {
  const base = emptyBeatVideo();
  if (!video) return base;
  // Trạng thái đang chạy không sống qua reload — tiến trình nằm ở server, không
  // ở tab này. Giữ lại chỉ tạo thẻ beat kẹt vòng quay vĩnh viễn.
  const inFlight = video.status === "generating" || video.status === "queued";
  return {
    ...base,
    ...video,
    status: inFlight ? "idle" : video.status || "idle",
    remoteUrl: "",
  };
}

function normalizeBeat(beat: Partial<Beat>, index: number): Beat {
  return {
    id: beat.id || crypto.randomUUID(),
    index: beat.index || index + 1,
    start: Number(beat.start || 0),
    end: Number(beat.end || 0),
    job: beat.job || "Nhịp chưa đặt tên",
    narration: beat.narration || "",
    visual: beat.visual || "",
    transition: beat.transition || "",
    overlay: beat.overlay || "",
    imagePrompt: beat.imagePrompt || "",
    motionPrompt: beat.motionPrompt || "",
    outputImage: beat.outputImage || "",
    outputName: beat.outputName || "",
    generationStatus:
      beat.generationStatus ||
      (beat.outputImage ? "completed" : "idle"),
    generationError: beat.generationError || "",
    imageProvider: beat.imageProvider || "",
    refPlan: normalizeRefPlan(beat.refPlan),
    video: normalizeVideo(beat.video),
    apiMotionPrompt: beat.apiMotionPrompt || "",
  };
}

export function normalizeProject(value: Partial<ProjectState>): ProjectState {
  const now = new Date().toISOString();
  return {
    id: value.id || crypto.randomUUID(),
    status: value.status || (value.beats?.length ? "in_progress" : "draft"),
    createdAt: value.createdAt || now,
    config: { ...defaultConfig, ...(value.config || {}) },
    references: Array.isArray(value.references) ? value.references : [],
    beats: Array.isArray(value.beats)
      ? value.beats.map((beat, index) => normalizeBeat(beat, index))
      : [],
    activeStep: value.activeStep || "setup",
    scriptApproved: Boolean(value.scriptApproved),
    castingApproved: Boolean(value.castingApproved),
    storyboardGenerated: Boolean(value.storyboardGenerated),
    autoKeyframeBatchStarted:
      value.autoKeyframeBatchStarted ?? Boolean(value.storyboardGenerated),
    searchedImages: Array.isArray(value.searchedImages)
      ? value.searchedImages
      : [],
    timeline: {
      ...emptyTimeline(),
      ...(value.timeline || {}),
      // Transcribe dở dang không sống qua reload.
      status:
        value.timeline?.status === "transcribing"
          ? "idle"
          : value.timeline?.status || "idle",
      phrases: Array.isArray(value.timeline?.phrases)
        ? value.timeline.phrases
        : [],
    },
    // Chỉ tin đường dẫn local trên máy chủ; thứ khác không sống qua F5.
    lastRender:
      value.lastRender && String(value.lastRender.url || "").startsWith("/generated/")
        ? value.lastRender
        : null,
    updatedAt: value.updatedAt || now,
    audioName: value.audioName || "",
  };
}

function serializeProject(project: ProjectState): ProjectState {
  return {
    ...project,
    beats: project.beats.map((beat) => ({
      ...beat,
      // candidates là 6 ảnh × tối đa 36 beat. Giữ lại là vỡ quota localStorage;
      // cần thì search lại, rẻ hơn nhiều so với mất cả dự án.
      // remoteUrl của Replicate chết sau 1 giờ; giữ lại chỉ gây hiểu nhầm là
      // vẫn tải được. url local mới là bản dùng cho bước ráp video.
      video: {
        ...beat.video,
        remoteUrl: "",
        url: beat.video.url.startsWith("/generated/") ? beat.video.url : "",
        status:
          beat.video.status === "generating" || beat.video.status === "queued"
            ? "idle"
            : beat.video.status,
      },
      refPlan: {
        ...beat.refPlan,
        candidates: [],
        status:
          beat.refPlan.status === "searching" ? "pending" : beat.refPlan.status,
      },
      outputImage:
        beat.outputImage.startsWith("http") ||
        beat.outputImage.startsWith("/generated/")
          ? beat.outputImage
          : "",
    })),
    references: project.references.map((asset) => ({
      ...asset,
      previewUrl:
        asset.previewUrl.startsWith("data:") ||
        asset.previewUrl.startsWith("/samples/")
          ? asset.previewUrl
          : "",
    })),
  };
}

function readLibrary(): ProjectLibrary {
  try {
    const raw = localStorage.getItem(LIBRARY_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<ProjectLibrary>;
      const projects = Array.isArray(parsed.projects)
        ? parsed.projects.map(normalizeProject)
        : [];
      return {
        activeProjectId: parsed.activeProjectId || projects[0]?.id || "",
        projects,
      };
    }

    const legacyRaw = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (legacyRaw) {
      const project = normalizeProject(JSON.parse(legacyRaw));
      return { activeProjectId: project.id, projects: [project] };
    }
  } catch {
    // Return an empty library below.
  }
  return { activeProjectId: "", projects: [] };
}

function writeLibrary(library: ProjectLibrary) {
  localStorage.setItem(LIBRARY_KEY, JSON.stringify(library));
}

export function loadProject(): ProjectState | null {
  const library = readLibrary();
  return (
    library.projects.find((project) => project.id === library.activeProjectId) ||
    library.projects[0] ||
    null
  );
}

export function saveProject(project: ProjectState) {
  const library = readLibrary();
  const serializable = serializeProject(project);
  const existingIndex = library.projects.findIndex(
    (item) => item.id === project.id,
  );
  const projects = [...library.projects];
  if (existingIndex >= 0) projects[existingIndex] = serializable;
  else projects.unshift(serializable);
  writeLibrary({
    activeProjectId: project.id,
    projects: projects.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
  });
}

export function listProjects(): ProjectSummary[] {
  return readLibrary().projects.map((project) => ({
    id: project.id,
    title: project.config.title,
    status: project.status,
    aspectRatio: project.config.aspectRatio,
    duration: project.config.duration,
    beatCount: project.beats.length,
    completedFrames: project.beats.filter(
      (beat) => beat.generationStatus === "completed" || beat.outputImage,
    ).length,
    updatedAt: project.updatedAt,
  }));
}

export function loadProjectById(id: string) {
  const library = readLibrary();
  const project = library.projects.find((item) => item.id === id);
  if (!project) return null;
  writeLibrary({ ...library, activeProjectId: id });
  return normalizeProject(project);
}

export function deleteProjectById(id: string) {
  const library = readLibrary();
  const projects = library.projects.filter((project) => project.id !== id);
  writeLibrary({
    activeProjectId:
      library.activeProjectId === id
        ? projects[0]?.id || ""
        : library.activeProjectId,
    projects,
  });
}

export function updateProjectStatus(id: string, status: ProjectStatus) {
  const library = readLibrary();
  writeLibrary({
    ...library,
    projects: library.projects.map((project) =>
      project.id === id
        ? { ...project, status, updatedAt: new Date().toISOString() }
        : project,
    ),
  });
}

export function clearProject() {
  localStorage.removeItem(LEGACY_STORAGE_KEY);
}
