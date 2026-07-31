import {
  ArrowLeft,
  ArrowRight,
  ArrowsClockwise,
  Check,
  CheckCircle,
  ClockCounterClockwise,
  Copy,
  DownloadSimple,
  FileArrowUp,
  FileText,
  FilmStrip,
  FloppyDisk,
  FolderSimple,
  GearSix,
  ImageSquare,
  Images,
  MagnifyingGlass,
  Microphone,
  Moon,
  Play,
  Plus,
  Scroll,
  SlidersHorizontal,
  SpeakerHigh,
  Sparkle,
  Stack,
  Stop,
  Sun,
  Trash,
  UploadSimple,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import {
  type ChangeEvent,
  type DragEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  aspectResolution,
  buildProjectMarkdown,
  buildStylePrompt,
  defaultConfig,
  emptyProject,
  fullNarration,
  generateBeats,
  hydrateStoryboard,
  makeReferenceManifest,
} from "./lib/workflow";
import {
  generateKeyframe,
  generateScriptWithAI,
  analyzeReferences,
  generateVideo,
  suggestBrief,
  cacheImage,
  renderVideo,
  transcribeVoice,
  generateVoice,
  getProviderStatus,
  buildSlotPayload,
  createChatGPTBatch,
  getChatGPTBatch,
} from "./lib/api";
import { loadSettings, saveSettings } from "./lib/settings";
import {
  BottomActions,
  Field,
  PageHeading,
  SectionBlock,
  ToggleRow,
} from "./components/ui";
import { CastingStep } from "./components/CastingStep";
import { ExportPackDialog } from "./components/ExportPackDialog";
import { BeatMediaTabs, type MediaTab } from "./components/BeatMediaTabs";
import { VideoBatchDialog } from "./components/VideoBatchDialog";
import { PreviewPlayer } from "./components/PreviewPlayer";
import { TopicPickerDialog } from "./components/TopicPickerDialog";
import { ImageSearchDialog } from "./components/ImageSearchDialog";
import { COVER_LABELS } from "./lib/topics";
import { alignWordsToScript } from "./lib/align";
import { beatsWithRoleLabels } from "./lib/labels";
import {
  applyTimelineToBeats,
  assignPhrasesToBeats,
  groupWordsIntoPhrases,
  timelineIssues,
} from "./lib/timeline";
import { VIDEO_PRESETS, qualityLabels } from "./lib/video";
import { runWithLimit } from "./lib/concurrency";
import {
  imageRunContinuation,
  selectImageRunCandidates,
  splitImageRunWaves,
} from "./lib/imageRuns";
import { beatsNeedingVideo, framesForBeat, resolveVideoSettings } from "./lib/video";
import { emptyRefPlan, parseRefPlanFromAI } from "./lib/casting";
import { emptyBeatVideo } from "./lib/video";
import { projectIdFromUrl, projectUrl } from "./lib/projectUrl";
import {
  checkChatGPTExtension,
  openChatGPTExtensionPanel,
  startBatchInExtension,
} from "./lib/extensionBridge";
import {
  deleteProjectById,
  listProjects,
  loadProject,
  loadProjectById,
  normalizeProject,
  saveProject,
  updateProjectStatus,
} from "./lib/storage";
import type {
  AppSettings,
  AspectRatio,
  Beat,
  Duration,
  ProjectConfig,
  ProjectState,
  ProjectStatus,
  ProjectSummary,
  ProviderStatus,
  RefRole,
  SearchedImage,
  VideoQuality,
  VideoResolution,
  ReferenceAsset,
  StepId,
  ToastState,
} from "./types";

const navItems: Array<{
  id: StepId;
  label: string;
  description: string;
  icon: typeof SlidersHorizontal;
}> = [
  {
    id: "setup",
    label: "Cấu hình",
    description: "Brief và ảnh ref",
    icon: SlidersHorizontal,
  },
  {
    id: "script",
    label: "Kịch bản",
    description: "Lời thoại và nhịp",
    icon: Scroll,
  },
  {
    id: "casting",
    label: "Casting",
    description: "Phân ref cho từng beat",
    icon: ImageSquare,
  },
  {
    id: "storyboard",
    label: "Storyboard",
    description: "Prompt, ảnh và voice",
    icon: Images,
  },
];

const ratioOptions: Array<{
  value: AspectRatio;
  label: string;
  description: string;
}> = [
  { value: "9:16", label: "Dọc", description: "Shorts, Reels, TikTok" },
  { value: "1:1", label: "Vuông", description: "Feed đa nền tảng" },
  { value: "16:9", label: "Ngang", description: "YouTube, trình chiếu" },
];

const durationOptions: Array<{ value: Duration; label: string }> = [
  { value: 30, label: "30 giây" },
  { value: 60, label: "1 phút" },
  { value: 180, label: "3 phút" },
];

/** Số video dựng song song mỗi lượt. */
const VIDEO_CONCURRENCY = 5;

const roleLabels: Record<RefRole, string> = {
  subject: "Chủ thể chính",
  style: "Phong cách",
  character: "Nhân vật",
  environment: "Bối cảnh",
};

function App() {
  const [project, setProject] = useState<ProjectState>(() => {
    const urlProjectId = projectIdFromUrl(window.location.href);
    if (urlProjectId) {
      const linkedProject = loadProjectById(urlProjectId);
      if (linkedProject) return linkedProject;
    }
    const saved = loadProject();
    return saved ?? emptyProject();
  });
  const [theme, setTheme] = useState<"light" | "dark">(() =>
    window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light",
  );
  const [toast, setToast] = useState<ToastState | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    saveProject({ ...project, updatedAt: new Date().toISOString() });
  }, [project]);

  useEffect(() => {
    const nextUrl = projectUrl(project.id);
    if (`${window.location.pathname}${window.location.search}` !== nextUrl) {
      window.history.replaceState({ projectId: project.id }, "", nextUrl);
    }
  }, [project.id]);

  useEffect(() => {
    const openLinkedProject = () => {
      const projectId = projectIdFromUrl(window.location.href);
      if (!projectId) return;
      const linkedProject = loadProjectById(projectId);
      if (linkedProject) setProject(linkedProject);
    };
    window.addEventListener("popstate", openLinkedProject);
    return () => window.removeEventListener("popstate", openLinkedProject);
  }, []);

  useEffect(() => {
    saveSettings(settings);
  }, [settings]);

  const notify = useCallback((message: string, tone: ToastState["tone"] = "neutral") => {
    setToast({ message, tone });
    window.setTimeout(() => setToast(null), 2600);
  }, []);

  const canOpen = (step: StepId) => {
    if (step === "setup") return true;
    if (step === "script") return project.beats.length > 0;
    if (step === "casting") return project.scriptApproved;
    return project.storyboardGenerated;
  };

  const changeStep = (step: StepId) => {
    if (!canOpen(step)) {
      notify(
        step === "script"
          ? "Hãy tạo kịch bản trước."
          : step === "casting"
            ? "Hãy duyệt kịch bản trước."
            : "Hãy duyệt casting và tạo storyboard trước.",
        "error",
      );
      return;
    }
    setProject((current) => ({ ...current, activeStep: step }));
    setIsSidebarOpen(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const updateConfig = <K extends keyof ProjectConfig>(
    key: K,
    value: ProjectConfig[K],
  ) => {
    setProject((current) => ({
      ...current,
      config: { ...current.config, [key]: value },
      scriptApproved: false,
      castingApproved: false,
      storyboardGenerated: false,
    }));
  };

  const createScript = async () => {
    if (!project.config.context.trim()) {
      notify("Hãy mô tả chủ đề trước khi tạo kịch bản.", "error");
      return;
    }
    setIsGenerating(true);
    if (settings.scriptProvider === "template") {
      window.setTimeout(() => {
        setProject((current) => ({
          ...current,
          status: "in_progress",
          beats: generateBeats(current.config, current.references),
          activeStep: "script",
          scriptApproved: false,
          castingApproved: false,
          storyboardGenerated: false,
        }));
        setIsGenerating(false);
        notify("Đã tạo kịch bản bằng template cục bộ.", "success");
        window.scrollTo({ top: 0, behavior: "smooth" });
      }, 450);
      return;
    }
    try {
      const config = project.config;
      let references = project.references;
      if (references.length) {
        notify("AI đang đọc ảnh reference và trích keyword...", "neutral");
        const vision = await analyzeReferences(references);
        const byId = new Map(vision.analyses.map((item) => [item.id, item]));
        references = references.map((asset) => {
          const analysis = byId.get(asset.id);
          return analysis
            ? {
                ...asset,
                visualDescription: analysis.description,
                visualKeywords: analysis.keywords,
              }
            : asset;
        });
        setProject((current) => ({ ...current, references }));
      }
      const result = await generateScriptWithAI(config, references, settings);
      const baseBeats = generateBeats(config, references);
      const beats = baseBeats.map((beat, index) => {
        const { refPlan: rawPlan, ...script } = result.beats[index] ?? {};
        return {
          ...beat,
          ...script,
          // Không tin gợi ý của AI: index và role được kiểm chứng lại, style ref
          // do hệ thống ghim. Thiếu refPlan thì rơi về beat chỉ có style.
          refPlan: parseRefPlanFromAI(
            rawPlan,
            references,
            settings.imageSearchEnabled,
          ),
        };
      });
      setProject((current) => ({
        ...current,
        status: "in_progress",
        beats,
        activeStep: "script",
        scriptApproved: false,
        castingApproved: false,
        storyboardGenerated: false,
      }));
      notify(`Đã tạo kịch bản bằng ${result.model}. Hãy kiểm tra claim.`, "success");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Không gọi được DeepSeek.";
      setProject((current) => ({
        ...current,
        status: "in_progress",
        beats: generateBeats(current.config),
        activeStep: "script",
        scriptApproved: false,
        storyboardGenerated: false,
      }));
      notify(`${message} Đã dùng template cục bộ.`, "error");
    } finally {
      setIsGenerating(false);
    }
  };

  /** Duyệt kịch bản đưa sang Casting, chưa sinh prompt. */
  const approveScript = () => {
    setProject((current) => ({
      ...current,
      status: "in_progress",
      scriptApproved: true,
      activeStep: "casting",
    }));
    notify("Kịch bản đã duyệt. Kiểm tra ref của từng beat trước khi tạo ảnh.", "success");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const createStoryboard = () => {
    setIsGenerating(true);
    window.setTimeout(() => {
      setProject((current) => ({
        ...current,
        status: "in_progress",
        beats: hydrateStoryboard(
          current.config,
          current.references,
          current.beats,
          current.searchedImages,
        ),
        activeStep: "storyboard",
        scriptApproved: true,
        castingApproved: true,
        storyboardGenerated: true,
      }));
      setIsGenerating(false);
      notify("Storyboard và bộ prompt đã sẵn sàng.", "success");
      window.scrollTo({ top: 0, behavior: "smooth" });
    }, 700);
  };

  const createBlankProject = () => {
    const fresh = emptyProject();
    const nextProject = {
      ...fresh,
      config: {
        ...fresh.config,
        videoQuality: settings.video.quality,
      },
    };
    window.history.pushState(
      { projectId: nextProject.id },
      "",
      projectUrl(nextProject.id),
    );
    setProject(nextProject);
    setIsSidebarOpen(false);
    notify("Đã tạo video mới. Chọn Chủ đề để bắt đầu.", "success");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const loadSample = () => {
    const config: ProjectConfig = {
      ...defaultConfig,
      title: "VinFast tại Đông Nam Á",
      context:
        "Sự mở rộng hiện diện của hệ sinh thái xe điện VinFast tại Đông Nam Á, qua bán xe, dịch vụ Green SM và sản xuất địa phương. Không dùng claim thống trị nếu chưa có dữ liệu.",
      objective:
        "Giải thích cách VinFast mở rộng hiện diện qua nhiều lớp hoạt động.",
      audience: "Người Việt quan tâm kinh doanh, xe điện và Đông Nam Á.",
      callToAction: "Mở rộng hiện diện chưa đồng nghĩa thống trị.",
    };
    const refs: ReferenceAsset[] = [
      {
        id: crypto.randomUUID(),
        name: "taxi-vinfast-reference.webp",
        type: "image/webp",
        size: 0,
        previewUrl: "/samples/taxi-reference.webp",
        role: "subject",
        notes: "Khóa silhouette, góc chụp, màu cyan và nhận diện xe.",
      },
      {
        id: crypto.randomUUID(),
        name: "style-reference.png",
        type: "image/png",
        size: 0,
        previewUrl: "/samples/style-reference.png",
        role: "style",
        notes: "Khóa paper texture, halftone, cut edge và palette.",
      },
    ];
    setProject({
      ...emptyProject(),
      config,
      references: refs,
      beats: generateBeats(config),
      activeStep: "setup",
    });
    notify("Đã nạp dự án mẫu VinFast.", "success");
  };

  const exportProject = () => {
    const markdown = buildProjectMarkdown(
      project.config,
      project.references,
      project.beats,
    );
    downloadFile(
      `${slugify(project.config.title || "vox-style-video")}-prompt-pack.md`,
      markdown,
      "text/markdown;charset=utf-8",
    );
    notify("Đã xuất prompt pack Markdown.", "success");
  };

  const exportProjectFile = () => {
    downloadFile(
      `${slugify(project.config.title || "vox-style-video")}.vox.json`,
      JSON.stringify(project, null, 2),
      "application/json;charset=utf-8",
    );
    notify("Đã xuất file dự án để có thể tiếp tục sau.", "success");
  };

  const importProjectFile = async (file?: File) => {
    if (!file) return;
    try {
      const raw = await file.text();
      const parsed = JSON.parse(raw);
      const imported = normalizeProject(parsed.project || parsed);
      window.history.pushState(
        { projectId: imported.id },
        "",
        projectUrl(imported.id),
      );
      setProject(imported);
      setIsSidebarOpen(false);
      notify("Đã nhập dự án và khôi phục tiến độ.", "success");
    } catch {
      notify("File dự án không hợp lệ. Hãy chọn file .vox.json.", "error");
    }
  };

  const openHistoryProject = (id: string) => {
    const selected = loadProjectById(id);
    if (!selected) {
      notify("Không tìm thấy dự án đã lưu.", "error");
      return;
    }
    window.history.pushState(
      { projectId: selected.id },
      "",
      projectUrl(selected.id),
    );
    setProject(selected);
    setIsHistoryOpen(false);
    setIsSidebarOpen(false);
    notify("Đã mở lại dự án.", "success");
  };

  return (
    <div className="app-shell">
      <Sidebar
        project={project}
        isOpen={isSidebarOpen}
        canOpen={canOpen}
        onClose={() => setIsSidebarOpen(false)}
        onNavigate={changeStep}
        onLoadSample={loadSample}
        onReset={createBlankProject}
        onSettings={() => setIsSettingsOpen(true)}
        onHistory={() => setIsHistoryOpen(true)}
        onImport={importProjectFile}
      />

      <main className="main-shell">
        <Topbar
          project={project}
          theme={theme}
          onTheme={() => setTheme(theme === "light" ? "dark" : "light")}
          onMenu={() => setIsSidebarOpen(true)}
          onExport={exportProject}
          onSettings={() => setIsSettingsOpen(true)}
        />

        <div className="content-shell">
          <StepTabs
            active={project.activeStep}
            canOpen={canOpen}
            onNavigate={changeStep}
          />

          {project.activeStep === "setup" && (
            <SetupStep
              project={project}
              isGenerating={isGenerating}
              updateConfig={updateConfig}
              setProject={setProject}
              onGenerate={createScript}
              notify={notify}
              settings={settings}
            />
          )}

          {project.activeStep === "script" && (
            <ScriptStep
              project={project}
              isGenerating={isGenerating}
              setProject={setProject}
              onBack={() => changeStep("setup")}
              onGenerateStoryboard={approveScript}
            />
          )}

          {project.activeStep === "casting" && (
            <CastingStep
              project={project}
              setProject={setProject}
              settings={settings}
              notify={notify}
              onBack={() => changeStep("script")}
              onApprove={createStoryboard}
            />
          )}

          {project.activeStep === "storyboard" && (
            <StoryboardStep
              project={project}
              setProject={setProject}
              setSettings={setSettings}
              notify={notify}
              onBack={() => changeStep("casting")}
              onExport={exportProject}
              onExportProject={exportProjectFile}
              settings={settings}
            />
          )}
        </div>
      </main>

      {toast && (
        <div className={`toast toast-${toast.tone}`} role="status">
          {toast.tone === "success" ? (
            <CheckCircle size={18} weight="fill" />
          ) : toast.tone === "error" ? (
            <WarningCircle size={18} weight="fill" />
          ) : (
            <FloppyDisk size={18} />
          )}
          <span>{toast.message}</span>
        </div>
      )}
      {isSettingsOpen && (
        <SettingsDialog
          settings={settings}
          onChange={setSettings}
          onClose={() => setIsSettingsOpen(false)}
          notify={notify}
        />
      )}
      {isHistoryOpen && (
        <ProjectHistoryDialog
          activeProjectId={project.id}
          onOpen={openHistoryProject}
          onDelete={(id) => {
            deleteProjectById(id);
            notify("Đã xóa dự án khỏi lịch sử.", "success");
          }}
          onStatusChange={(id, status) => {
            updateProjectStatus(id, status);
            if (id === project.id) {
              setProject((current) => ({ ...current, status }));
            }
          }}
          onClose={() => setIsHistoryOpen(false)}
        />
      )}
    </div>
  );
}

interface SidebarProps {
  project: ProjectState;
  isOpen: boolean;
  canOpen: (step: StepId) => boolean;
  onClose: () => void;
  onNavigate: (step: StepId) => void;
  onLoadSample: () => void;
  onReset: () => void;
  onSettings: () => void;
  onHistory: () => void;
  onImport: (file?: File) => void;
}

function Sidebar({
  project,
  isOpen,
  canOpen,
  onClose,
  onNavigate,
  onLoadSample,
  onReset,
  onSettings,
  onHistory,
  onImport,
}: SidebarProps) {
  const importInput = useRef<HTMLInputElement>(null);
  return (
    <>
      <aside className={`sidebar ${isOpen ? "sidebar-open" : ""}`}>
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">
            V
          </div>
          <div>
            <strong>VOX STYLE</strong>
            <span>Video workbench</span>
          </div>
          <button className="icon-button sidebar-close" onClick={onClose} aria-label="Đóng menu">
            <X size={20} />
          </button>
        </div>

        <div className="project-summary">
          <div className="project-summary-top">
            <span className="project-label">Dự án hiện tại</span>
            <span className={`project-status project-status-${project.status}`}>
              {project.status === "completed"
                ? "Đã xong"
                : project.status === "in_progress"
                  ? "Đang làm"
                  : "Bản nháp"}
            </span>
          </div>
          <strong>{project.config.title}</strong>
          <small>
            {project.config.aspectRatio} / {project.config.duration}s /{" "}
            {project.config.language}
          </small>
        </div>

        <nav className="sidebar-nav" aria-label="Quy trình tạo video">
          <span className="nav-label">Quy trình</span>
          {navItems.map((item) => {
            const Icon = item.icon;
            const enabled = canOpen(item.id);
            return (
              <button
                key={item.id}
                className={`nav-item ${
                  project.activeStep === item.id ? "nav-item-active" : ""
                }`}
                disabled={!enabled}
                onClick={() => onNavigate(item.id)}
              >
                <Icon size={21} />
                <span>
                  <strong>{item.label}</strong>
                  <small>{item.description}</small>
                </span>
                {enabled && item.id !== "setup" ? (
                  <Check size={16} weight="bold" />
                ) : null}
              </button>
            );
          })}
        </nav>

        <div className="sidebar-tools">
          <span className="nav-label">Dự án</span>
          <button className="tool-link" onClick={onLoadSample}>
            <FolderSimple size={20} />
            Nạp dự án mẫu
          </button>
          <button className="tool-link" onClick={onHistory}>
            <ClockCounterClockwise size={20} />
            Lịch sử dự án
          </button>
          <button className="tool-link" onClick={() => importInput.current?.click()}>
            <FileArrowUp size={20} />
            Nhập file dự án
          </button>
          <input
            ref={importInput}
            type="file"
            accept=".json,.vox.json,application/json"
            hidden
            onChange={(event) => {
              void onImport(event.target.files?.[0]);
              event.target.value = "";
            }}
          />
          <button className="tool-link" onClick={onReset}>
            <Trash size={20} />
            Tạo dự án mới
          </button>
          <button className="tool-link" onClick={onSettings}>
            <GearSix size={20} />
            AI và model
          </button>
        </div>

        <div className="sidebar-note">
          <Sparkle size={18} weight="fill" />
          <p>
            API key chỉ tồn tại trên backend. Ảnh reference chỉ được tải lên
            nhà cung cấp khi bạn bấm tạo keyframe.
          </p>
        </div>
      </aside>
      {isOpen && <button className="sidebar-scrim" onClick={onClose} aria-label="Đóng menu" />}
    </>
  );
}

interface TopbarProps {
  project: ProjectState;
  theme: "light" | "dark";
  onTheme: () => void;
  onMenu: () => void;
  onExport: () => void;
  onSettings: () => void;
}

function Topbar({ project, theme, onTheme, onMenu, onExport, onSettings }: TopbarProps) {
  const updated = new Date(project.updatedAt);
  return (
    <header className="topbar">
      <button className="icon-button mobile-menu" onClick={onMenu} aria-label="Mở menu">
        <GearSix size={21} />
      </button>
      <div className="save-state">
        <CheckCircle size={17} weight="fill" />
        <span>
          Đã lưu cục bộ
          <small>{updated.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}</small>
        </span>
      </div>
      <div className="topbar-actions">
        <button className="button button-quiet topbar-export" onClick={onExport}>
          <DownloadSimple size={18} />
          Xuất prompt pack
        </button>
        <button className="icon-button" onClick={onSettings} aria-label="Mở cài đặt AI">
          <GearSix size={19} />
        </button>
        <button className="icon-button" onClick={onTheme} aria-label="Đổi giao diện sáng tối">
          {theme === "light" ? <Moon size={19} /> : <Sun size={19} />}
        </button>
      </div>
    </header>
  );
}

function StepTabs({
  active,
  canOpen,
  onNavigate,
}: {
  active: StepId;
  canOpen: (step: StepId) => boolean;
  onNavigate: (step: StepId) => void;
}) {
  return (
    <div className="step-tabs" role="tablist" aria-label="Các bước">
      {navItems.map((item, index) => (
        <button
          key={item.id}
          role="tab"
          aria-selected={active === item.id}
          disabled={!canOpen(item.id)}
          onClick={() => onNavigate(item.id)}
          className={active === item.id ? "step-tab-active" : ""}
        >
          <span>{index + 1}</span>
          {item.label}
        </button>
      ))}
    </div>
  );
}

interface SetupStepProps {
  project: ProjectState;
  isGenerating: boolean;
  updateConfig: <K extends keyof ProjectConfig>(
    key: K,
    value: ProjectConfig[K],
  ) => void;
  setProject: React.Dispatch<React.SetStateAction<ProjectState>>;
  onGenerate: () => void;
  notify: (message: string, tone?: ToastState["tone"]) => void;
  settings: AppSettings;
}

function SetupStep({
  project,
  isGenerating,
  updateConfig,
  setProject,
  onGenerate,
  notify,
  settings,
}: SetupStepProps) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [isTopicOpen, setIsTopicOpen] = useState(false);
  const [isRefSearchOpen, setIsRefSearchOpen] = useState(false);
  const [pickedRefImageIds, setPickedRefImageIds] = useState<string[]>([]);
  const [isSuggesting, setIsSuggesting] = useState(false);

  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    setPickedRefImageIds([]);
    setIsRefSearchOpen(false);
  }, [project.id]);

  const updateVideoTitle = (title: string) => {
    setProject((current) => ({
      ...current,
      config: {
        ...current.config,
        title,
        // Cover title is derived from the video title; there is no second field.
        coverTitle: title,
      },
      scriptApproved: false,
      castingApproved: false,
      storyboardGenerated: false,
    }));
  };

  /** Tiêu đề chưa đặt thì mọi gợi ý đều vô nghĩa — AI không biết viết về gì. */
  const hasRealTitle =
    Boolean(project.config.title.trim()) &&
    project.config.title !== defaultConfig.title;

  /** AI viết brief dựa trên tiêu đề và nhãn video đã chọn. */
  const suggestBriefFields = async () => {
    if (!hasRealTitle) {
      // Báo lỗi rồi dừng là ngõ cụt: dự án mới nào cũng chưa có tiêu đề, nên
      // bấm nút là hỏng. Mở thẳng bảng chủ đề để user đi tiếp được.
      setIsTopicOpen(true);
      notify("Chọn một chủ đề trước, rồi AI sẽ viết định hướng.", "neutral");
      return;
    }
    setIsSuggesting(true);
    try {
      const result = await suggestBrief(
        project.config.title,
        project.config.coverEyebrow,
        project.config.language,
        project.config.duration,
        settings,
      );
      setProject((current) => ({
        ...current,
        config: {
          ...current.config,
          context: result.context || current.config.context,
          objective: result.objective || current.config.objective,
          audience: result.audience || current.config.audience,
          callToAction: result.callToAction || current.config.callToAction,
        },
      }));
      notify("AI đã điền định hướng. Kiểm lại dữ kiện trước khi viết kịch bản.", "success");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Không gợi ý được.", "error");
    } finally {
      setIsSuggesting(false);
    }
  };

  /**
   * Gợi ý ảnh reference từ Pexels theo tiêu đề.
   *
   * Ảnh nạp vào với role environment và lock content: đây là ảnh chụp thật, chỉ
   * dùng làm tham chiếu bố cục, model sẽ vẽ lại thành giấy cắt.
   */
  const addSuggestedRef = async (image: SearchedImage) => {
    if (project.references.length >= 6) {
      notify("Đã đủ 6 ảnh reference.", "error");
      return;
    }
    if (pickedRefImageIds.includes(image.id)) {
      notify("Ảnh này đã được thêm.", "neutral");
      return;
    }
    try {
      const { cachedUrl } = await cacheImage(image.fullUrl);
      const asset: ReferenceAsset = {
        id: crypto.randomUUID(),
        name: image.attribution || `Ảnh ${image.source}`,
        type: "image/jpeg",
        size: 0,
        previewUrl: cachedUrl,
        role: "environment",
        notes: "Content lock: chỉ lấy bố cục và vật thể nhìn thấy trong ảnh.",
      };
      setProject((current) => ({
        ...current,
        references:
          current.references.length < 6
            ? [...current.references, asset]
            : current.references,
      }));
      setPickedRefImageIds((current) => [...current, image.id]);
      notify(`Đã thêm ảnh ${image.source} làm reference bối cảnh.`, "success");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Không thêm được ảnh.", "error");
    }
  };

  const processFiles = async (files: File[]) => {
    const valid = files.filter((file) => file.type.startsWith("image/"));
    if (!valid.length) {
      notify("Chỉ hỗ trợ file ảnh trong khu vực reference.", "error");
      return;
    }

    const remaining = Math.max(0, 6 - project.references.length);
    const accepted = valid.slice(0, remaining);
    if (!accepted.length) {
      notify("Tối đa 6 ảnh reference cho một dự án V1.", "error");
      return;
    }

    const assets = await Promise.all(
      accepted.map(async (file, index): Promise<ReferenceAsset> => ({
        id: crypto.randomUUID(),
        name: file.name,
        type: file.type,
        size: file.size,
        previewUrl: await readFileAsDataUrl(file),
        role: index === 0 && project.references.length === 0 ? "subject" : "style",
        notes: "",
      })),
    );

    setProject((current) => ({
      ...current,
      references: [...current.references, ...assets],
      storyboardGenerated: false,
    }));
    notify(`Đã thêm ${assets.length} ảnh reference.`, "success");
  };

  const pasteReferences = async () => {
    try {
      const items = await navigator.clipboard.read();
      const files: File[] = [];
      for (const item of items) {
        const type = item.types.find((value) => value.startsWith("image/"));
        if (!type) continue;
        const blob = await item.getType(type);
        files.push(new File([blob], "clipboard.png", { type }));
      }
      if (!files.length) {
        notify("Clipboard không có ảnh.", "error");
        return;
      }
      await processFiles(files);
    } catch {
      notify("Không đọc được clipboard. Hãy bấm vào vùng ảnh rồi Ctrl/Cmd+V.", "error");
    }
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    void processFiles(Array.from(event.dataTransfer.files));
  };

  const updateReference = (
    id: string,
    patch: Partial<Pick<ReferenceAsset, "role" | "notes">>,
  ) => {
    setProject((current) => ({
      ...current,
      references: current.references.map((asset) =>
        asset.id === id ? { ...asset, ...patch } : asset,
      ),
      storyboardGenerated: false,
    }));
  };

  const removeReference = (id: string) => {
    setProject((current) => ({
      ...current,
      references: current.references.filter((asset) => asset.id !== id),
      storyboardGenerated: false,
    }));
  };

  return (
    <section className="step-page">
      <PageHeading
        title="Thiết lập nền tảng cho video"
        description="Khóa format, bối cảnh và vai trò của từng ảnh ref trước khi viết một câu thoại."
      />

      <div className="setup-grid">
        <div className="setup-main">
          <SectionBlock
            title="Thông tin dự án"
            description="Những trường này đi xuyên suốt toàn bộ prompt chain."
          >
            <div className="form-grid two-cols">
              <Field label="Tiêu đề video">
                <div className="field-with-action">
                  <input
                    value={project.config.title}
                    onChange={(event) => updateVideoTitle(event.target.value)}
                    placeholder="Ví dụ: VinFast tại Đông Nam Á"
                  />
                  <button
                    className="button button-quiet button-small"
                    onClick={() => setIsTopicOpen(true)}
                  >
                    <Stack size={16} />
                    Chủ đề
                  </button>
                </div>
              </Field>
              <Field label="Nhãn cover">
                <select
                  value={project.config.coverEyebrow}
                  onChange={(event) =>
                    updateConfig("coverEyebrow", event.target.value)
                  }
                >
                  {COVER_LABELS.map((label) => (
                    <option key={label} value={label}>
                      {label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Ngôn ngữ">
                <select
                  value={project.config.language}
                  onChange={(event) => updateConfig("language", event.target.value)}
                >
                  <option>Tiếng Việt</option>
                  <option>English</option>
                  <option>Bahasa Indonesia</option>
                  <option>ภาษาไทย</option>
                  <option>Filipino</option>
                </select>
              </Field>
            </div>
          </SectionBlock>

          <SectionBlock title="Tỷ lệ video">
            <div className="ratio-grid">
              {ratioOptions.map((option) => (
                <button
                  key={option.value}
                  className={`ratio-option ${
                    project.config.aspectRatio === option.value
                      ? "option-selected"
                      : ""
                  }`}
                  onClick={() => updateConfig("aspectRatio", option.value)}
                >
                  <span className={`ratio-shape ratio-${option.value.replace(":", "-")}`} />
                  <span>
                    <strong>{option.value}</strong>
                    <small>{option.description}</small>
                  </span>
                  {project.config.aspectRatio === option.value && (
                    <CheckCircle size={19} weight="fill" />
                  )}
                </button>
              ))}
            </div>
            <p className="field-help">
              Kích thước xuất đề xuất: {aspectResolution(project.config.aspectRatio)}
            </p>
          </SectionBlock>

          <SectionBlock title="Độ dài video">
            <div className="segmented-control">
              {durationOptions.map((option) => (
                <button
                  key={option.value}
                  className={
                    project.config.duration === option.value ? "segment-active" : ""
                  }
                  onClick={() => updateConfig("duration", option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <p className="field-help">
              Hệ thống tự chia nhịp theo độ dài và giữ hook trong 3 giây đầu.
            </p>
          </SectionBlock>

          <SectionBlock
            title="Bối cảnh và định hướng"
            description="Mô tả càng cụ thể, kịch bản nháp càng ít phải sửa."
          >
            <div className="section-actions">
              <button
                className="button button-quiet button-small"
                onClick={() => void suggestBriefFields()}
                disabled={isSuggesting}
              >
                {isSuggesting ? <span className="button-loader" /> : <Sparkle size={16} />}
                AI gợi ý theo tiêu đề và nhãn
              </button>
              <span className="field-help">
                AI chỉ nêu dữ kiện phổ quát. Số liệu cụ thể vẫn phải tự kiểm.
              </span>
            </div>
            <Field label="Chủ đề và context">
              <textarea
                rows={7}
                value={project.config.context}
                onChange={(event) => updateConfig("context", event.target.value)}
                placeholder="Nêu chủ đề, dữ kiện đã có nguồn, điều không được phép khẳng định, giọng kể và kết luận mong muốn..."
              />
              <span className="char-count">
                {project.config.context.length} ký tự
              </span>
            </Field>
            <div className="form-grid two-cols">
              <Field label="Mục tiêu">
                <textarea
                  rows={3}
                  value={project.config.objective}
                  onChange={(event) => updateConfig("objective", event.target.value)}
                />
              </Field>
              <Field label="Khán giả">
                <textarea
                  rows={3}
                  value={project.config.audience}
                  onChange={(event) => updateConfig("audience", event.target.value)}
                />
              </Field>
            </div>
            <div className="form-grid two-cols">
              <Field label="Cấu trúc kể chuyện">
                <select
                  value={project.config.storyArc}
                  onChange={(event) => updateConfig("storyArc", event.target.value)}
                >
                  <option value="hook_payoff">Hook, bối cảnh, payoff</option>
                  <option value="timeline">Timeline</option>
                  <option value="myth_buster">Phá bỏ ngộ nhận</option>
                  <option value="how_it_works">Cách nó vận hành</option>
                  <option value="origin">Nguồn gốc đến hiện tại</option>
                </select>
              </Field>
              <Field label="CTA hoặc câu kết">
                <input
                  value={project.config.callToAction}
                  onChange={(event) => updateConfig("callToAction", event.target.value)}
                />
              </Field>
            </div>
          </SectionBlock>

          <SectionBlock
            title="Ảnh reference"
            description="Gán đúng vai trò để model không trộn identity với style."
          >
            <div className="section-actions">
              <button
                className="button button-quiet button-small"
                onClick={() => setIsRefSearchOpen(true)}
              >
                <MagnifyingGlass size={16} />
                Gợi ý ảnh từ Pexels
              </button>
              <button
                className="button button-quiet button-small"
                onClick={() => void pasteReferences()}
              >
                Dán ảnh
              </button>
              <span className="field-help">
                Nạp với vai trò bối cảnh: model chỉ lấy bố cục rồi vẽ lại thành giấy cắt.
              </span>
            </div>
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(event: ChangeEvent<HTMLInputElement>) => {
                void processFiles(Array.from(event.target.files ?? []));
                event.target.value = "";
              }}
            />
            <div
              className={`dropzone ${isDragging ? "dropzone-active" : ""}`}
              onDragOver={(event) => {
                event.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={onDrop}
              onPaste={(event) => {
                const files = Array.from(event.clipboardData.files).filter((file) =>
                  file.type.startsWith("image/"),
                );
                if (files.length) {
                  event.preventDefault();
                  void processFiles(files);
                }
              }}
              onClick={() => fileInput.current?.click()}
              role="button"
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  fileInput.current?.click();
                }
              }}
            >
              <UploadSimple size={28} />
              <strong>Kéo ảnh vào đây hoặc chọn từ máy</strong>
              <span>PNG, JPG, WEBP. Tối đa 6 ảnh.</span>
            </div>

            {project.references.length > 0 && (
              <div className="reference-list">
                {project.references.map((asset, index) => (
                  <article className="reference-item" key={asset.id}>
                    <img src={asset.previewUrl} alt={`Reference ${index + 1}: ${asset.name}`} />
                    <div className="reference-fields">
                      <div className="reference-title">
                        <strong>Reference {index + 1}</strong>
                        <span>{asset.name}</span>
                      </div>
                      <div className="form-grid ref-grid">
                        <Field label="Vai trò">
                          <select
                            value={asset.role}
                            onChange={(event) =>
                              updateReference(asset.id, {
                                role: event.target.value as RefRole,
                              })
                            }
                          >
                            {Object.entries(roleLabels).map(([value, label]) => (
                              <option value={value} key={value}>
                                {label}
                              </option>
                            ))}
                          </select>
                        </Field>
                        <Field label="Ghi chú khóa">
                          <input
                            value={asset.notes}
                            onChange={(event) =>
                              updateReference(asset.id, {
                                notes: event.target.value,
                              })
                            }
                            placeholder="Ví dụ: giữ nguyên khuôn mặt, trang phục..."
                          />
                        </Field>
                      </div>
                      {asset.visualDescription && (
                        <p className="reference-analysis">
                          <strong>AI nhìn thấy:</strong> {asset.visualDescription}
                          {asset.visualKeywords?.length
                            ? ` Keyword: ${asset.visualKeywords.join(", ")}`
                            : ""}
                        </p>
                      )}
                    </div>
                    <button
                      className="icon-button danger-button"
                      onClick={() => removeReference(asset.id)}
                      aria-label={`Xóa ${asset.name}`}
                    >
                      <Trash size={18} />
                    </button>
                  </article>
                ))}
              </div>
            )}
          </SectionBlock>
        </div>

        <aside className="setup-aside">
          <div className="sticky-panel">
            <h3>Khóa nhất quán</h3>
            <p>
              Các quy tắc này được lặp lại trong mọi prompt keyframe và motion.
            </p>
            <ToggleRow
              label="Giữ identity và sản phẩm"
              checked={project.config.preserveIdentity}
              onChange={(value) => updateConfig("preserveIdentity", value)}
            />
            <ToggleRow
              label="Không tạo chữ trong ảnh"
              checked={project.config.noGeneratedText}
              onChange={(value) => updateConfig("noGeneratedText", value)}
            />
            <ToggleRow
              label="Khóa paper-collage phẳng 2D"
              checked={project.config.flatPaperOnly}
              onChange={(value) => updateConfig("flatPaperOnly", value)}
            />
            <ToggleRow
              label="Một voice master duy nhất"
              checked={project.config.singleVoice}
              onChange={(value) => updateConfig("singleVoice", value)}
            />

            <div className="manifest-preview">
              <span>Reference manifest</span>
              <pre>{makeReferenceManifest(project.references)}</pre>
            </div>

            <button
              className="button button-primary full-button"
              onClick={onGenerate}
              disabled={isGenerating}
            >
              {isGenerating ? (
                <>
                  <span className="button-loader" />
                  Đang dựng nhịp
                </>
              ) : (
                <>
                  <Sparkle size={19} weight="fill" />
                  Tạo kịch bản
                  <ArrowRight size={18} />
                </>
              )}
            </button>
            <p className="safe-note">
              <WarningCircle size={17} />
              Kịch bản V1 không tự xác minh dữ kiện. Claim chưa có nguồn cần được
              sửa trước khi tạo storyboard.
            </p>
          </div>
        </aside>
      </div>

      {isTopicOpen && (
        <TopicPickerDialog
          onClose={() => setIsTopicOpen(false)}
          onPick={(title) => {
            updateVideoTitle(title);
            setIsTopicOpen(false);
            notify("Đã chọn chủ đề. Bấm AI gợi ý để điền định hướng.", "success");
          }}
        />
      )}

      {isRefSearchOpen && (
        <ImageSearchDialog
          beatLabel="Chọn ảnh reference cho toàn bộ video"
          initialQuery={hasRealTitle ? project.config.title : ""}
          aspectRatio={project.config.aspectRatio}
          count={settings.imageSearchCount}
          enabledSources={[
            ...(settings.searchPexels ? (["pexels"] as const) : []),
            ...(settings.searchSerper ? (["serper"] as const) : []),
          ]}
          selectedIds={pickedRefImageIds}
          applicationNote="Mỗi ảnh được thêm vào project với vai trò Bối cảnh và content lock. Trước khi viết script, AI sẽ đọc nội dung ảnh, trích keyword chính xác và dùng chúng để lập ref plan cho từng beat."
          onPick={addSuggestedRef}
          onClose={() => setIsRefSearchOpen(false)}
        />
      )}

    </section>
  );
}

function ScriptStep({
  project,
  isGenerating,
  setProject,
  onBack,
  onGenerateStoryboard,
}: {
  project: ProjectState;
  isGenerating: boolean;
  setProject: React.Dispatch<React.SetStateAction<ProjectState>>;
  onBack: () => void;
  onGenerateStoryboard: () => void;
}) {
  const wordCount = useMemo(
    () => fullNarration(project.beats).split(/\s+/).filter(Boolean).length,
    [project.beats],
  );

  const updateBeat = (id: string, patch: Partial<Beat>) => {
    setProject((current) => ({
      ...current,
      beats: current.beats.map((beat) =>
        beat.id === id ? { ...beat, ...patch } : beat,
      ),
      scriptApproved: false,
      castingApproved: false,
      storyboardGenerated: false,
    }));
  };

  const deleteBeat = (id: string) => {
    setProject((current) => {
      const next = current.beats
        .filter((beat) => beat.id !== id)
        .map((beat, index) => ({ ...beat, index: index + 1 }));
      return { ...current, beats: next, storyboardGenerated: false };
    });
  };

  const addBeat = () => {
    setProject((current) => {
      const last = current.beats.at(-1);
      const start = last?.end ?? 0;
      const next: Beat = {
        id: crypto.randomUUID(),
        index: current.beats.length + 1,
        start,
        end: Math.min(current.config.duration, start + 4),
        job: "Nhịp bổ sung",
        narration: "",
        visual: "",
        transition: "Nối sang beat tiếp theo bằng một motif đã khóa.",
        overlay: "",
        imagePrompt: "",
        motionPrompt: "",
        outputImage: "",
        outputName: "",
        generationStatus: "idle",
        generationError: "",
        imageProvider: "",
        refPlan: emptyRefPlan(current.references),
        video: emptyBeatVideo(),
        apiMotionPrompt: "",
      };
      return {
        ...current,
        beats: [...current.beats, next],
        storyboardGenerated: false,
      };
    });
  };

  return (
    <section className="step-page">
      <PageHeading
        title="Biên tập kịch bản trước khi tốn credit"
        description="Mỗi beat chỉ làm một việc. Chỉnh lời thoại, visual và chuyển cảnh ngay tại đây."
        aside={
          <div className="script-metrics">
            <span>
              <strong>{project.beats.length}</strong>
              beat
            </span>
            <span>
              <strong>{wordCount}</strong>
              từ
            </span>
            <span>
              <strong>{project.config.duration}s</strong>
              tổng
            </span>
          </div>
        }
      />

      <div className="claim-banner">
        <WarningCircle size={21} weight="fill" />
        <div>
          <strong>Kiểm tra claim trước khi duyệt</strong>
          <p>
            V1 tạo cấu trúc và câu nháp, không tự bổ sung số liệu hoặc nguồn.
            Xóa mọi chi tiết bạn chưa kiểm chứng.
          </p>
        </div>
      </div>

      <div className="beat-list">
        {project.beats.map((beat, index) => (
          <details className="beat-editor" key={beat.id} open={index < 2}>
            <summary>
              <span className="beat-number">B{beat.index.toString().padStart(2, "0")}</span>
              <span className="beat-summary">
                <strong>{beat.job}</strong>
                <small>
                  {formatSeconds(beat.start)}-{formatSeconds(beat.end)}
                </small>
              </span>
              <span className="beat-line-preview">
                {beat.narration || "Chưa có lời thoại"}
              </span>
            </summary>
            <div className="beat-editor-body">
              <div className="form-grid three-cols">
                <Field label="Vai trò beat">
                  <input
                    value={beat.job}
                    onChange={(event) =>
                      updateBeat(beat.id, { job: event.target.value })
                    }
                  />
                </Field>
                <Field label="Bắt đầu">
                  <input
                    type="number"
                    min={0}
                    max={project.config.duration}
                    step="0.1"
                    value={beat.start}
                    onChange={(event) =>
                      updateBeat(beat.id, { start: Number(event.target.value) })
                    }
                  />
                </Field>
                <Field label="Kết thúc">
                  <input
                    type="number"
                    min={0}
                    max={project.config.duration}
                    step="0.1"
                    value={beat.end}
                    onChange={(event) =>
                      updateBeat(beat.id, { end: Number(event.target.value) })
                    }
                  />
                </Field>
              </div>
              <Field label="Lời thoại">
                <textarea
                  rows={3}
                  value={beat.narration}
                  onChange={(event) =>
                    updateBeat(beat.id, { narration: event.target.value })
                  }
                />
              </Field>
              <div className="form-grid two-cols">
                <Field label="Visual message và metaphor">
                  <textarea
                    rows={4}
                    value={beat.visual}
                    onChange={(event) =>
                      updateBeat(beat.id, { visual: event.target.value })
                    }
                  />
                </Field>
                <Field label="Chuyển cảnh và continuity">
                  <textarea
                    rows={4}
                    value={beat.transition}
                    onChange={(event) =>
                      updateBeat(beat.id, { transition: event.target.value })
                    }
                  />
                </Field>
              </div>
              <Field label="Editor overlay">
                <input
                  value={beat.overlay}
                  onChange={(event) =>
                    updateBeat(beat.id, { overlay: event.target.value })
                  }
                  placeholder="Để trống nếu beat không cần chữ"
                />
              </Field>
              <button
                className="button button-danger button-small"
                onClick={() => deleteBeat(beat.id)}
              >
                <Trash size={17} />
                Xóa beat
              </button>
            </div>
          </details>
        ))}
      </div>

      <button className="add-beat-button" onClick={addBeat}>
        <Plus size={18} />
        Thêm beat thủ công
      </button>

      <BottomActions
        onBack={onBack}
        primary={
          <button
            className="button button-primary"
            onClick={onGenerateStoryboard}
            disabled={isGenerating || project.beats.length === 0}
          >
            {isGenerating ? (
              <>
                <span className="button-loader" />
                Đang tạo prompt
              </>
            ) : (
              <>
                <ImageSquare size={19} />
                Duyệt kịch bản và phân ref
                <ArrowRight size={18} />
              </>
            )}
          </button>
        }
      />
    </section>
  );
}

function StoryboardStep({
  project,
  setProject,
  setSettings,
  notify,
  onBack,
  onExport,
  onExportProject,
  settings,
}: {
  project: ProjectState;
  setProject: React.Dispatch<React.SetStateAction<ProjectState>>;
  setSettings: React.Dispatch<React.SetStateAction<AppSettings>>;
  notify: (message: string, tone?: ToastState["tone"]) => void;
  onBack: () => void;
  onExport: () => void;
  onExportProject: () => void;
  settings: AppSettings;
}) {
  const [activePanel, setActivePanel] = useState<
    "storyboard" | "voice" | "video"
  >("storyboard");
  const [generatingBeatIds, setGeneratingBeatIds] = useState<string[]>([]);
  const [isBatchGenerating, setIsBatchGenerating] = useState(false);
  const [isExportPackOpen, setIsExportPackOpen] = useState(false);
  const [isVideoBatchOpen, setIsVideoBatchOpen] = useState(false);
  const [isBatchVideo, setIsBatchVideo] = useState(false);
  const [extensionBatchId, setExtensionBatchId] = useState(
    () => localStorage.getItem(`vox:chatgpt-batch:${project.id}`) || "",
  );
  const [chatGPTContinuousRun, setChatGPTContinuousRun] = useState(
    () => localStorage.getItem(`vox:chatgpt-continuous:${project.id}`) === "1",
  );
  const [isCreatingExtensionBatch, setIsCreatingExtensionBatch] = useState(false);
  const [extensionBridgeError, setExtensionBridgeError] = useState("");
  const [imageFilter, setImageFilter] = useState<"all" | "failed">("all");
  const [mediaTabs, setMediaTabs] = useState<Record<string, MediaTab>>({});
  const imageAbort = useRef<AbortController | null>(null);
  const chatGPTBatchLaunch = useRef(false);
  const reportedChatGPTErrorBatch = useRef("");
  const chatGPTRetryGraceUntil = useRef(0);
  // Một controller cho cả lượt: bấm Dừng là abort hết, server nhận được và gọi
  // cancel lên Replicate cho từng prediction đang chạy.
  const videoAbort = useRef<AbortController | null>(null);
  const stylePrompt = useMemo(
    () => buildStylePrompt(project.config, project.references),
    [project.config, project.references],
  );
  const failedImageCount = project.beats.filter(
    (beat) => beat.generationStatus === "failed",
  ).length;
  const newImageCount = project.beats.filter(
    (beat) => !beat.outputImage && beat.generationStatus !== "failed",
  ).length;
  const canceledImageCount = project.beats.filter(
    (beat) => beat.generationStatus === "canceled",
  ).length;
  const canceledVideoCount = project.beats.filter(
    (beat) => beat.video.status === "canceled",
  ).length;
  const visibleBeats =
    imageFilter === "failed" && failedImageCount > 0
      ? project.beats.filter((beat) => beat.generationStatus === "failed")
      : project.beats;
  const ratioClass = `storyboard-ratio-${project.config.aspectRatio.replace(":", "-")}`;
  const updateChatGPTContinuousRun = (enabled: boolean) => {
    setChatGPTContinuousRun(enabled);
    if (enabled) {
      localStorage.setItem(`vox:chatgpt-continuous:${project.id}`, "1");
    } else {
      localStorage.removeItem(`vox:chatgpt-continuous:${project.id}`);
    }
  };

  useEffect(() => {
    if (!extensionBatchId) return;
    let stopped = false;
    const sync = async () => {
      try {
        const batch = await getChatGPTBatch(extensionBatchId);
        if (stopped) return;
        setProject((current) => ({
          ...current,
          beats: current.beats.map((beat) => {
            const task = batch.tasks.find((item) => item.beatId === beat.id);
            if (!task) return beat;
            if (task.state === "completed" && task.result?.url) {
              return {
                ...beat,
                outputImage: task.result.url,
                outputName: beat.outputName || `B${beat.index.toString().padStart(2, "0")}-chatgpt.png`,
                generationStatus: "completed",
                generationError: "",
                imageProvider: "chatgpt",
              };
            }
            if (task.state === "failed") {
              return {
                ...beat,
                generationStatus: "failed",
                generationError: task.error
                  ? `${task.error.code}: ${task.error.message}`
                  : "ChatGPT extension task failed.",
              };
            }
            if (["claiming", "uploading_references", "submitting", "waiting", "collecting", "returning"].includes(task.state)) {
              return { ...beat, generationStatus: "generating", generationError: "" };
            }
            if (task.state === "queued") {
              return { ...beat, generationStatus: "queued", generationError: "" };
            }
            return beat;
          }),
        }));
        const failedTasks = batch.tasks.filter((task) => task.state === "failed");
        if (
          failedTasks.length &&
          Date.now() >= chatGPTRetryGraceUntil.current
        ) {
          updateChatGPTContinuousRun(false);
          const message =
            `${failedTasks.length} ảnh ChatGPT bị lỗi. Chuỗi đã dừng; ` +
            "bấm Start / reconnect extension để thử lại và tiếp tục đến hết.";
          setExtensionBridgeError(message);
          if (reportedChatGPTErrorBatch.current !== batch.batchId) {
            reportedChatGPTErrorBatch.current = batch.batchId;
            notify(message, "error");
          }
        }
        if (["completed", "canceled"].includes(batch.state)) {
          localStorage.removeItem(`vox:chatgpt-batch:${project.id}`);
          setExtensionBatchId("");
          if (batch.state === "completed") {
            reportedChatGPTErrorBatch.current = "";
            setExtensionBridgeError("");
            notify(
              chatGPTContinuousRun
                ? "ChatGPT đã xong nhóm hiện tại. Đang chuẩn bị nhóm tiếp theo..."
                : "ChatGPT đã hoàn tất batch storyboard.",
              chatGPTContinuousRun ? "neutral" : "success",
            );
          } else {
            updateChatGPTContinuousRun(false);
          }
        }
      } catch {
        // A temporary API failure must not discard the durable batch identity.
      }
    };
    void sync();
    const timer = window.setInterval(() => void sync(), 2500);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [
    chatGPTContinuousRun,
    extensionBatchId,
    project.id,
    notify,
    setProject,
  ]);

  const generateWithChatGPT = async (continuation = false) => {
    if (chatGPTBatchLaunch.current) return;
    const beats =
      splitImageRunWaves(
        selectImageRunCandidates(project.beats, "failed"),
        5,
      )[0] || [];
    if (!beats.length) {
      updateChatGPTContinuousRun(false);
      notify("Mọi beat đã có keyframe.", continuation ? "success" : "neutral");
      return;
    }
    chatGPTBatchLaunch.current = true;
    updateChatGPTContinuousRun(true);
    const panelOpening = openChatGPTExtensionPanel();
    void panelOpening.catch(() => {});
    setIsCreatingExtensionBatch(true);
    setExtensionBridgeError("");
    try {
      const extension = await checkChatGPTExtension();
      await panelOpening;
      if (!extension.installed || !extension.connected) {
        throw new Error("Extension chưa sẵn sàng kết nối với VOX.");
      }
      const tasks = await Promise.all(
        beats.map(async (beat) => {
          const slots = await buildSlotPayload(
            beat.refPlan.slots,
            project.references,
            project.searchedImages,
          );
          return {
            beatId: beat.id,
            prompt: beat.imagePrompt,
            aspectRatio: project.config.aspectRatio,
            references: slots.map((slot, index) => {
              const source = slot.kind === "upload" ? slot.dataUrl : slot.url;
              return {
                id: `${beat.id}-ref-${index + 1}`,
                name: `B${beat.index.toString().padStart(2, "0")}-ref-${index + 1}.png`,
                url: source,
              };
            }),
            expectedOutputName: `B${beat.index.toString().padStart(2, "0")}-chatgpt.png`,
          };
        }),
      );
      const batch = await createChatGPTBatch({ projectId: project.id, tasks });
      localStorage.setItem(`vox:chatgpt-batch:${project.id}`, batch.batchId);
      setExtensionBatchId(batch.batchId);
      await navigator.clipboard.writeText(batch.batchId).catch(() => {});
      setProject((current) => ({
        ...current,
        beats: current.beats.map((beat) =>
          beats.some((item) => item.id === beat.id)
            ? { ...beat, generationStatus: "queued", generationError: "" }
            : beat,
        ),
      }));
      try {
        await startBatchInExtension(batch.batchId, {
          executionMode: settings.chatgptExtensionMode,
          openNewChat: settings.chatgptOpenNewConversation,
          resetWorkspace: settings.chatgptResetWorkspace,
        });
        notify(
          settings.chatgptExtensionMode === "auto"
            ? "Extension đã nhận batch. Đang mở ChatGPT và bắt đầu tạo ảnh."
            : "Extension đã nạp prompt và reference. Hãy kiểm tra rồi bấm Thêm và chạy.",
          "success",
        );
      } catch (bridgeError) {
        const message =
          bridgeError instanceof Error
            ? bridgeError.message
            : "Extension không nhận batch.";
        setExtensionBridgeError(message);
        updateChatGPTContinuousRun(false);
        notify(message, "error");
      }
    } catch (error) {
      updateChatGPTContinuousRun(false);
      notify(error instanceof Error ? error.message : "Không tạo được ChatGPT batch.", "error");
    } finally {
      chatGPTBatchLaunch.current = false;
      setIsCreatingExtensionBatch(false);
    }
  };

  const reconnectChatGPTExtension = async () => {
    if (!extensionBatchId) return;
    const panelOpening = openChatGPTExtensionPanel();
    setIsCreatingExtensionBatch(true);
    setExtensionBridgeError("");
    chatGPTRetryGraceUntil.current = Date.now() + 30_000;
    updateChatGPTContinuousRun(true);
    try {
      await panelOpening;
      await startBatchInExtension(extensionBatchId, {
        executionMode: settings.chatgptExtensionMode,
        openNewChat: settings.chatgptOpenNewConversation,
        resetWorkspace: settings.chatgptResetWorkspace,
      });
      notify("Extension đã kết nối lại và nhận ChatGPT batch.", "success");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Extension không nhận batch.";
      setExtensionBridgeError(message);
      updateChatGPTContinuousRun(false);
      notify(message, "error");
    } finally {
      setIsCreatingExtensionBatch(false);
    }
  };

  useEffect(() => {
    if (
      !chatGPTContinuousRun ||
      extensionBatchId ||
      isCreatingExtensionBatch ||
      chatGPTBatchLaunch.current
    ) {
      return;
    }
    const continuation = imageRunContinuation(project.beats);
    if (continuation === "blocked_by_error") {
      updateChatGPTContinuousRun(false);
      return;
    }
    if (continuation === "complete") {
      updateChatGPTContinuousRun(false);
      notify("ChatGPT đã tạo xong toàn bộ keyframe storyboard.", "success");
      return;
    }
    const timer = window.setTimeout(() => {
      void generateWithChatGPT(true);
    }, 500);
    return () => window.clearTimeout(timer);
  }, [
    chatGPTContinuousRun,
    extensionBatchId,
    isCreatingExtensionBatch,
    project.beats,
  ]);

  const copyText = async (text: string, label: string) => {
    try {
      await copyToClipboard(text);
      notify(`Đã copy ${label}.`, "success");
    } catch {
      notify("Trình duyệt không cho phép copy tự động.", "error");
    }
  };

  const uploadOutput = async (beatId: string, file?: File) => {
    if (!file || !file.type.startsWith("image/")) return;
    const preview = await readFileAsDataUrl(file);
    setProject((current) => ({
      ...current,
      beats: current.beats.map((beat) =>
        beat.id === beatId
          ? {
              ...beat,
              outputImage: preview,
              outputName: file.name,
              generationStatus: "completed",
              generationError: "",
              imageProvider: "manual",
            }
          : beat,
      ),
    }));
    notify("Đã gắn keyframe vào storyboard.", "success");
  };

  const pasteOutput = async (beatId: string) => {
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const type = item.types.find((value) => value.startsWith("image/"));
        if (!type) continue;
        const blob = await item.getType(type);
        await uploadOutput(
          beatId,
          new File([blob], "clipboard-keyframe.png", { type }),
        );
        return;
      }
      notify("Clipboard không có ảnh.", "error");
    } catch {
      notify("Không đọc được clipboard. Hãy bấm vào card rồi Ctrl/Cmd+V.", "error");
    }
  };

  const createKeyframe = async (
    beat: Beat,
    signal?: AbortSignal,
    quiet = false,
  ) => {
    setGeneratingBeatIds((current) => [...current, beat.id]);
    setProject((current) => ({
      ...current,
      status: "in_progress",
      beats: current.beats.map((item) =>
        item.id === beat.id
          ? {
              ...item,
              generationStatus: "generating",
              generationError: "",
            }
          : item,
      ),
    }));
    try {
      const result = await generateKeyframe(
        beat.imagePrompt,
        project.config,
        beat.refPlan.slots,
        project.references,
        project.searchedImages,
        settings,
        signal,
      );
      setProject((current) => ({
        ...current,
        beats: current.beats.map((item) =>
          item.id === beat.id
            ? {
                ...item,
                outputImage: result.imageUrl,
                outputName: `B${beat.index.toString().padStart(2, "0")}-${result.provider}.png`,
                generationStatus: "completed",
                generationError: "",
                imageProvider: result.provider,
              }
            : item,
        ),
      }));
      if (!quiet) {
        notify(
          result.fallbackUsed
            ? "Coachio không khả dụng. Đã tạo ảnh bằng Nano Banana 2."
            : `Đã tạo keyframe bằng ${result.provider === "coachio" ? "GPT Image 2" : "Nano Banana 2"}.`,
          "success",
        );
      }
      return true;
    } catch (error) {
      const aborted =
        signal?.aborted || (error instanceof Error && error.name === "AbortError");
      const message =
        error instanceof Error ? error.message : "Không tạo được keyframe.";
      setProject((current) => ({
        ...current,
        beats: current.beats.map((item) =>
          item.id === beat.id
            ? {
                ...item,
                generationStatus: aborted ? "canceled" : "failed",
                generationError: aborted ? "" : message,
              }
            : item,
        ),
      }));
      if (!quiet && !aborted) notify(message, "error");
      return false;
    } finally {
      setGeneratingBeatIds((current) =>
        current.filter((id) => id !== beat.id),
      );
    }
  };

  const setTab = (beatId: string, tab: MediaTab) =>
    setMediaTabs((current) => ({ ...current, [beatId]: tab }));

  const patchVideo = (beatId: string, patch: Partial<Beat["video"]>) =>
    setProject((current) => ({
      ...current,
      beats: current.beats.map((item) =>
        item.id === beatId
          ? { ...item, video: { ...item.video, ...patch } }
          : item,
      ),
    }));

  const createVideo = async (
    beat: Beat,
    signal?: AbortSignal,
    quiet = false,
  ) => {
    if (!beat.outputImage) {
      if (!quiet) notify("Beat này chưa có keyframe.", "error");
      return false;
    }
    // Lật sang tab Video để user thấy tiến trình ngay trên thẻ beat đó.
    setTab(beat.id, "video");
    const video = resolveVideoSettings(settings.video.quality, settings.video);
    const frames = framesForBeat(beat, video.fps);
    patchVideo(beat.id, { status: "generating", error: "" });
    try {
      const result = await generateVideo(
        // Prompt riêng cho API; motionPrompt giữ nguyên cho extension.
        beat.apiMotionPrompt || beat.motionPrompt,
        beat.outputImage,
        frames,
        { ...settings, video },
        signal,
      );
      patchVideo(beat.id, {
        ...result,
        status: "completed",
        error: "",
        createdAt: new Date().toISOString(),
      });
      if (!quiet) notify(`Đã dựng video cho B${beat.index}.`, "success");
      return true;
    } catch (error) {
      const aborted =
        signal?.aborted || (error instanceof Error && error.name === "AbortError");
      patchVideo(beat.id, {
        status: aborted ? "canceled" : "failed",
        error: aborted
          ? ""
          : error instanceof Error
            ? error.message
            : "Không dựng được video.",
      });
      if (!quiet && !aborted) {
        notify(error instanceof Error ? error.message : "Không dựng được video.", "error");
      }
      return false;
    }
  };

  const startVideoBatch = async () => {
    const targets = beatsNeedingVideo(project.beats);
    if (!targets.length) {
      notify("Không có beat nào cần dựng video.", "neutral");
      return;
    }
    setIsVideoBatchOpen(false);
    setIsBatchVideo(true);
    const controller = new AbortController();
    videoAbort.current = controller;
    targets.forEach((beat) => patchVideo(beat.id, { status: "queued", error: "" }));

    let done = 0;
    let failed = 0;
    await runWithLimit(targets, VIDEO_CONCURRENCY, async (beat) => {
      if (controller.signal.aborted) {
        patchVideo(beat.id, { status: "canceled" });
        return;
      }
      const ok = await createVideo(beat, controller.signal, true);
      if (ok) done += 1;
      else if (!controller.signal.aborted) failed += 1;
    });

    videoAbort.current = null;
    setIsBatchVideo(false);
    if (controller.signal.aborted) {
      notify(`Đã dừng. ${done} video hoàn tất trước khi dừng.`, "neutral");
    } else {
      notify(
        failed
          ? `Xong ${done}/${targets.length} video, ${failed} beat lỗi.`
          : `Đã dựng xong ${done} video.`,
        failed ? "error" : "success",
      );
    }
  };

  const stopVideoBatch = () => {
    videoAbort.current?.abort();
    notify("Đang huỷ các video đang dựng...", "neutral");
  };

  const stopImageBatch = () => {
    imageAbort.current?.abort();
    notify("Đang dừng batch ảnh...", "neutral");
  };

  const createBatch = async (mode: "new" | "failed") => {
    const candidates = selectImageRunCandidates(project.beats, mode);
    if (!candidates.length) {
      notify(
        mode === "failed"
          ? "Không có keyframe lỗi cần thử lại."
          : "Không còn keyframe mới cần tạo.",
        "neutral",
      );
      return;
    }
    setIsBatchGenerating(true);
    const controller = new AbortController();
    imageAbort.current = controller;
    let completed = 0;
    let failed = 0;
    let processed = 0;
    const waves = splitImageRunWaves(candidates, 5);
    for (const wave of waves) {
      if (controller.signal.aborted || failed > 0) break;
      setProject((current) => ({
        ...current,
        beats: current.beats.map((beat) =>
          wave.some((candidate) => candidate.id === beat.id)
            ? { ...beat, generationStatus: "queued", generationError: "" }
            : beat,
        ),
      }));
      let waveFailed = 0;
      await runWithLimit(wave, 5, async (beat) => {
        if (controller.signal.aborted) {
          setProject((current) => ({
            ...current,
            beats: current.beats.map((item) =>
              item.id === beat.id
                ? { ...item, generationStatus: "canceled" }
                : item,
            ),
          }));
          return;
        }
        const ok = await createKeyframe(beat, controller.signal, true);
        processed += 1;
        if (ok) completed += 1;
        else if (!controller.signal.aborted) {
          failed += 1;
          waveFailed += 1;
        }
      });
      if (!controller.signal.aborted && waveFailed === 0 && processed < candidates.length) {
        notify(
          `Đã xong ${completed}/${candidates.length} ảnh. Đang chạy nhóm tiếp theo...`,
          "neutral",
        );
      }
    }
    imageAbort.current = null;
    setIsBatchGenerating(false);
    if (controller.signal.aborted) {
      notify(`Đã dừng. ${completed} ảnh hoàn tất trước khi dừng.`, "neutral");
    } else {
      notify(
        failed
          ? `Đã dừng sau ${completed} ảnh thành công vì có ${failed} ảnh lỗi. ` +
            "Bấm “Thử lại và tiếp tục” để chạy tiếp đến hết."
          : mode === "failed"
            ? `Đã khôi phục và tạo xong toàn bộ ${completed} keyframe còn thiếu.`
            : `Đã tạo xong toàn bộ ${completed} keyframe còn thiếu.`,
        failed ? "error" : "success",
      );
    }
  };

  return (
    <section className="step-page">
      <PageHeading
        title="Storyboard, prompt và voice master"
        description="Nạp ref theo manifest, tạo keyframe trước, rồi mới animate từng poster."
        aside={
          <div className="heading-actions">
            <button className="button button-quiet" onClick={onExport}>
              <DownloadSimple size={18} />
              Prompt pack
            </button>
            {isBatchVideo ? (
              <button className="button button-danger" onClick={stopVideoBatch}>
                <Stop size={18} weight="fill" />
                Dừng dựng video
              </button>
            ) : (
              <button
                className="button button-quiet"
                onClick={() => setIsVideoBatchOpen(true)}
              >
                <FilmStrip size={18} />
                {canceledVideoCount ? "Tiếp tục dựng video" : "Dựng video hàng loạt"}
              </button>
            )}
            <button
              className="button button-quiet"
              onClick={() => setIsExportPackOpen(true)}
            >
              <FileArrowUp size={18} />
              Gói cho extension
            </button>
            <button className="button button-quiet" onClick={onExportProject}>
              <FloppyDisk size={18} />
              File dự án
            </button>
          </div>
        }
      />

      <div className="workspace-tabs">
        <button
          className={activePanel === "storyboard" ? "workspace-tab-active" : ""}
          onClick={() => setActivePanel("storyboard")}
        >
          <Images size={19} />
          Storyboard và prompt
        </button>
        <button
          className={activePanel === "voice" ? "workspace-tab-active" : ""}
          onClick={() => setActivePanel("voice")}
        >
          <Microphone size={19} />
          Voice over và audio
        </button>
        <button
          className={activePanel === "video" ? "workspace-tab-active" : ""}
          onClick={() => setActivePanel("video")}
        >
          <FilmStrip size={19} />
          Tạo video
        </button>
      </div>

      {activePanel === "storyboard" ? (
        <>
          <div className="prompt-foundation">
            <div>
              <span className="block-label">Nạp reference theo thứ tự</span>
              <pre>{makeReferenceManifest(project.references)}</pre>
            </div>
            <div>
              <span className="block-label">Style reference prompt</span>
              <p>
                Tạo style frame trước. Dùng nó làm visual lock cho toàn bộ
                keyframe sau.
              </p>
              <button
                className="button button-quiet button-small"
                onClick={() => void copyText(stylePrompt, "style prompt")}
              >
                <Copy size={17} />
                Copy style prompt
              </button>
            </div>
          </div>

          <div
            className={`batch-toolbar ${
              failedImageCount ? "batch-toolbar-error" : ""
            }`}
          >
            <div>
              <strong>
                {newImageCount} ảnh chưa tạo
                {failedImageCount ? `, ${failedImageCount} ảnh lỗi` : ""}
              </strong>
              <span>
                Mỗi nhóm tối đa 5 beat. Nhóm thành công sẽ tự chạy tiếp cho
                đến khi toàn bộ storyboard có ảnh.
              </span>
              {failedImageCount > 0 && (
                <span className="batch-stop-message">
                  Chuỗi đang dừng tại ảnh lỗi. Bấm “Thử lại và tiếp tục đến
                  hết” để chạy tiếp.
                </span>
              )}
              {extensionBatchId && (
                <span>
                  ChatGPT batch: {extensionBatchId}
                  {extensionBridgeError
                    ? ` · ${extensionBridgeError}`
                    : chatGPTContinuousRun
                      ? " · Đang chạy liên tục đến hết"
                      : " · Extension đang xử lý"}
                </span>
              )}
            </div>
            <div className="batch-actions">
              <label className="chatgpt-inline-check">
                <input
                  type="checkbox"
                  checked={settings.chatgptOpenNewConversation}
                  onChange={(event) =>
                    setSettings((current) => ({
                      ...current,
                      chatgptOpenNewConversation: event.target.checked,
                    }))
                  }
                />
                <span>Mở tab ChatGPT mới</span>
              </label>
              <button
                className="button button-quiet"
                disabled={isCreatingExtensionBatch}
                onClick={() =>
                  void (extensionBatchId
                    ? reconnectChatGPTExtension()
                    : generateWithChatGPT())
                }
                title={extensionBatchId ? `Batch đang chạy: ${extensionBatchId}` : undefined}
              >
                <Sparkle size={18} weight="fill" />
                {extensionBatchId
                  ? "Start / reconnect extension"
                  : isCreatingExtensionBatch
                    ? "Đang tạo batch..."
                    : "Generate all with ChatGPT"}
              </button>
              {isBatchGenerating ? (
                <button className="button button-danger" onClick={stopImageBatch}>
                  <Stop size={18} weight="fill" />
                  Dừng tạo ảnh
                </button>
              ) : (
                <>
              {failedImageCount > 0 && (
                <>
                  <button
                    className="button button-quiet"
                    onClick={() =>
                      setImageFilter((current) =>
                        current === "failed" ? "all" : "failed",
                      )
                    }
                  >
                    {imageFilter === "failed" ? "Hiện tất cả" : "Chỉ xem ảnh lỗi"}
                  </button>
                  <button
                    className="button button-danger"
                    onClick={() => void createBatch("failed")}
                  >
                    <ArrowsClockwise size={18} />
                    Thử lại và tiếp tục đến hết
                  </button>
                </>
              )}
              {newImageCount > 0 && (
                <button
                  className="button button-primary"
                  onClick={() => void createBatch("new")}
                >
                  <Stack size={18} weight="fill" />
                  {canceledImageCount
                    ? `Tiếp tục ${newImageCount} ảnh đến hết`
                    : `Tạo toàn bộ ${newImageCount} ảnh`}
                </button>
              )}
                </>
              )}
            </div>
          </div>

          {extensionBridgeError && (
            <div className="batch-error-alert" role="alert">
              <WarningCircle size={24} weight="fill" />
              <div>
                <strong>Chuỗi ChatGPT đã dừng vì lỗi</strong>
                <span>{extensionBridgeError}</span>
              </div>
              <button
                className="button button-danger"
                disabled={isCreatingExtensionBatch}
                onClick={() =>
                  void (extensionBatchId
                    ? reconnectChatGPTExtension()
                    : generateWithChatGPT())
                }
              >
                <ArrowsClockwise size={18} />
                Thử lại và tiếp tục đến hết
              </button>
            </div>
          )}

          <div className={`storyboard-grid ${ratioClass}`}>
            {visibleBeats.map((beat) => (
              <article
                className="story-card"
                key={beat.id}
                tabIndex={0}
                onPaste={(event) => {
                  const file = Array.from(event.clipboardData.files).find((item) =>
                    item.type.startsWith("image/"),
                  );
                  if (file) {
                    event.preventDefault();
                    void uploadOutput(beat.id, file);
                  }
                }}
              >
                <BeatMediaTabs
                  beat={beat}
                  aspectRatio={project.config.aspectRatio}
                  tab={mediaTabs[beat.id] || "image"}
                  onTab={(tab) => setTab(beat.id, tab)}
                  refPreviewUrl={project.references[0]?.previewUrl || ""}
                  imageBusy={beat.generationStatus === "generating"}
                  videoBusy={
                    beat.video.status === "generating" ||
                    beat.video.status === "queued"
                  }
                  canCreateVideo={
                    Boolean(beat.outputImage) &&
                    !isBatchVideo &&
                    beat.video.status !== "generating"
                  }
                  onCreateVideo={() => void createVideo(beat)}
                  onRegenerateImage={() => void createKeyframe(beat)}
                  canRegenerateImage={
                    !isBatchGenerating && !generatingBeatIds.includes(beat.id)
                  }
                />
                <div className="story-content">
                  <div className="story-title-row">
                    <h3>{beat.job}</h3>
                    <span
                      className={`generation-state generation-${beat.generationStatus}`}
                    >
                      {beat.generationStatus === "completed"
                        ? "Đã có ảnh"
                        : beat.generationStatus === "failed"
                          ? "Bị lỗi"
                          : beat.generationStatus === "generating"
                            ? "Đang tạo"
                            : beat.generationStatus === "queued"
                              ? "Đang chờ"
                              : beat.generationStatus === "canceled"
                                ? "Đã dừng"
                            : "Chưa tạo"}
                    </span>
                  </div>
                  <p>{beat.narration}</p>
                  {beat.generationError && (
                    <p className="generation-error">{beat.generationError}</p>
                  )}
                  <div className="story-actions">
                    <button
                      className="button button-quiet button-small"
                      onClick={() =>
                        void copyText(beat.imagePrompt, `image prompt B${beat.index}`)
                      }
                    >
                      <Copy size={16} />
                      Copy prompt ảnh
                    </button>
                    <button
                      className="button button-quiet button-small"
                      onClick={() =>
                        void copyText(beat.motionPrompt, `video prompt B${beat.index}`)
                      }
                    >
                      <Copy size={16} />
                      Copy prompt video
                    </button>
                  </div>
                  <label className="upload-result">
                    <UploadSimple size={17} />
                    {beat.outputName || "Nạp keyframe đã tạo"}
                    <input
                      type="file"
                      accept="image/*"
                      hidden
                      onChange={(event) => {
                        void uploadOutput(beat.id, event.target.files?.[0]);
                        event.target.value = "";
                      }}
                    />
                  </label>
                  <button
                    className="button button-quiet button-small"
                    onClick={() => void pasteOutput(beat.id)}
                  >
                    Dán ảnh
                  </button>
                </div>
              </article>
            ))}
          </div>
        </>
      ) : activePanel === "voice" ? (
        <VoiceStudio
          project={project}
          setProject={setProject}
          notify={notify}
          settings={settings}
        />
      ) : (
        <VideoGuide
              project={project}
              setProject={setProject}
              settings={settings}
              notify={notify}
            />
      )}

      <BottomActions
        onBack={onBack}
        primary={
          <button className="button button-primary" onClick={onExportProject}>
            <FloppyDisk size={19} />
            Xuất file dự án
          </button>
        }
      />

      {isVideoBatchOpen && (
        <VideoBatchDialog
          beats={beatsNeedingVideo(project.beats)}
          settings={settings}
          onConfirm={() => void startVideoBatch()}
          onClose={() => setIsVideoBatchOpen(false)}
        />
      )}

      {isExportPackOpen && (
        <ExportPackDialog
          beats={project.beats}
          title={project.config.title}
          notify={notify}
          onClose={() => setIsExportPackOpen(false)}
        />
      )}
    </section>
  );
}

function VoiceStudio({
  project,
  setProject,
  notify,
  settings,
}: {
  project: ProjectState;
  setProject: React.Dispatch<React.SetStateAction<ProjectState>>;
  notify: (message: string, tone?: ToastState["tone"]) => void;
  settings: AppSettings;
}) {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voiceUri, setVoiceUri] = useState("");
  const [rate, setRate] = useState(1);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isCreatingVoice, setIsCreatingVoice] = useState(false);
  // Khởi tạo từ project để voice sống qua F5; trước đây là object URL nên mất.
  const [cloudAudioUrl, setCloudAudioUrl] = useState(project.timeline.audioUrl);
  const script = fullNarration(project.beats);

  useEffect(() => {
    const load = () => {
      const all = window.speechSynthesis?.getVoices() ?? [];
      setVoices(all);
      if (!voiceUri && all.length) {
        const preferred =
          all.find((voice) => voice.lang.toLowerCase().startsWith("vi")) ??
          all[0];
        setVoiceUri(preferred.voiceURI);
      }
    };
    load();
    window.speechSynthesis?.addEventListener("voiceschanged", load);
    return () => {
      window.speechSynthesis?.removeEventListener("voiceschanged", load);
      window.speechSynthesis?.cancel();
    };
  }, [voiceUri]);

  // Đổi dự án thì lấy lại voice của dự án đó. Không revoke gì nữa: đây là đường
  // dẫn tĩnh trên máy chủ, không phải object URL.
  useEffect(() => {
    setCloudAudioUrl(project.timeline.audioUrl);
  }, [project.timeline.audioUrl]);

  const play = () => {
    if (!("speechSynthesis" in window)) {
      notify("Trình duyệt này không hỗ trợ nghe thử voice.", "error");
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(script);
    const selected = voices.find((voice) => voice.voiceURI === voiceUri);
    if (selected) utterance.voice = selected;
    utterance.lang = selected?.lang ?? "vi-VN";
    utterance.rate = rate;
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);
    setIsSpeaking(true);
    window.speechSynthesis.speak(utterance);
  };

  const stop = () => {
    window.speechSynthesis?.cancel();
    setIsSpeaking(false);
  };

  const downloadScript = () => {
    downloadFile(
      `${slugify(project.config.title)}-voice-master.txt`,
      script,
      "text/plain;charset=utf-8",
    );
    notify("Đã tải lời thoại voice master.", "success");
  };

  const createCloudVoice = async () => {
    setIsCreatingVoice(true);
    try {
      const result = await generateVoice(
        script,
        project.config.language,
        settings,
      );
      // Lưu đường dẫn trên máy chủ chứ không phải object URL: object URL chết
      // theo phiên trang nên F5 là mất voice, phải tạo lại và trả tiền lần nữa.
      setCloudAudioUrl(result.url);
      setProject((current) => ({
        ...current,
        audioName: `${slugify(current.config.title)}-elevenlabs.mp3`,
        timeline: {
          ...current.timeline,
          audioUrl: result.url,
          audioName: `${slugify(current.config.title)}-elevenlabs.mp3`,
          // Voice đổi thì timing cũ hết giá trị.
          status: "idle",
          phrases: [],
          durationSeconds: 0,
          error: "",
          createdAt: new Date().toISOString(),
        },
      }));
      notify("Đã tạo voice master bằng ElevenLabs.", "success");
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Không tạo được voice master.",
        "error",
      );
    } finally {
      setIsCreatingVoice(false);
    }
  };

  return (
    <div className="voice-grid">
      <div className="voice-script">
        <div className="voice-heading">
          <div>
            <span className="block-label">Master narration</span>
            <h3>Một giọng cho toàn bộ video</h3>
          </div>
          <button className="button button-quiet button-small" onClick={downloadScript}>
            <DownloadSimple size={17} />
            Tải lời thoại
          </button>
        </div>
        <textarea value={script} readOnly rows={16} />
        <p className="field-help">
          Chỉnh lời thoại ở bước Kịch bản. Voice master luôn được ghép lại từ
          toàn bộ beat đã duyệt.
        </p>
      </div>

      <aside className="voice-controls">
        <div className="speaker-visual">
          <SpeakerHigh size={31} weight="fill" />
          <span className={isSpeaking ? "wave wave-active" : "wave"} aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
            <i />
          </span>
        </div>
        <h3>
          {settings.voiceProvider === "elevenlabs"
            ? "Voice master ElevenLabs"
            : "Nghe thử trên trình duyệt"}
        </h3>
        <p>
          {settings.voiceProvider === "elevenlabs"
            ? `Model ${settings.elevenLabsModel}, Voice ID theo ngôn ngữ trong Settings.`
            : "Dùng Web Speech để kiểm tra nhịp trước khi xuất bản."}
        </p>
        {settings.voiceProvider === "elevenlabs" && (
          <div className="cloud-voice">
            <button
              className="button button-primary full-button"
              onClick={() => void createCloudVoice()}
              disabled={isCreatingVoice || !script.trim()}
            >
              {isCreatingVoice ? (
                <>
                  <span className="button-loader" />
                  Đang tạo voice
                </>
              ) : (
                <>
                  <Microphone size={18} weight="fill" />
                  Tạo voice master
                </>
              )}
            </button>
            {cloudAudioUrl && (
              <>
                <audio className="audio-player" controls src={cloudAudioUrl} />
                <a
                  className="button button-quiet full-button"
                  href={cloudAudioUrl}
                  download={project.audioName || "voice-master.mp3"}
                >
                  <DownloadSimple size={18} />
                  Tải MP3
                </a>
              </>
            )}
          </div>
        )}
        <div className="browser-voice">
          <span className="block-label">Bản nháp trên máy</span>
        <Field label="Giọng có sẵn">
          <select value={voiceUri} onChange={(event) => setVoiceUri(event.target.value)}>
            {voices.map((voice) => (
              <option key={voice.voiceURI} value={voice.voiceURI}>
                {voice.name} ({voice.lang})
              </option>
            ))}
          </select>
        </Field>
        <Field label={`Tốc độ ${rate.toFixed(1)}x`}>
          <input
            type="range"
            min="0.7"
            max="1.3"
            step="0.1"
            value={rate}
            onChange={(event) => setRate(Number(event.target.value))}
          />
        </Field>
        <div className="voice-buttons">
          <button className="button button-primary" onClick={play} disabled={isSpeaking}>
            <Play size={18} weight="fill" />
            Nghe thử
          </button>
          <button className="button button-quiet" onClick={stop} disabled={!isSpeaking}>
            <Stop size={18} weight="fill" />
            Dừng
          </button>
        </div>
        </div>
        <label className="audio-drop">
          <Microphone size={22} />
          <span>
            <strong>{project.audioName || "Nạp file voice_master.wav"}</strong>
            <small>WAV, MP3 hoặc M4A</small>
          </span>
          <input
            type="file"
            accept="audio/*"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              setProject((current) => ({ ...current, audioName: file.name }));
              notify("Đã gắn file audio vào dự án.", "success");
              event.target.value = "";
            }}
          />
        </label>
      </aside>
    </div>
  );
}

function VideoGuide({
  project,
  setProject,
  settings,
  notify,
}: {
  project: ProjectState;
  setProject: React.Dispatch<React.SetStateAction<ProjectState>>;
  settings: AppSettings;
  notify: (message: string, tone?: ToastState["tone"]) => void;
}) {
  const completedFrames = project.beats.filter((beat) => beat.outputImage).length;
  const [isMeasuring, setIsMeasuring] = useState(false);
  const [isRendering, setIsRendering] = useState(false);
  const [renderNote, setRenderNote] = useState("");
  // Kết quả render nằm trong project chứ không phải state cục bộ: state cục bộ
  // chết khi F5 trong khi file mp4 vẫn nằm nguyên trên đĩa — đúng họ lỗi từng
  // làm mất voice.
  const renderUrl = project.lastRender?.url || "";
  const captionFile = project.lastRender?.captionFile || "";
  const issues = timelineIssues(project.timeline, project.beats);
  // Dự án lưu trước khi có luật nhãn vẫn giữ nhãn cũ; nhắc user sửa thay vì âm
  // thầm hiện "MỞ ĐẦU GÂY TÒ MÒ" lên đầu video.
  const staleLabels = beatsWithRoleLabels(project.beats);

  /** Đo timing thật rồi đặt lại biên beat theo giọng đọc. */
  const measureTiming = async () => {
    if (!project.timeline.audioUrl) {
      notify("Chưa có voice master. Tạo voice ở tab Voice trước.", "error");
      return;
    }
    setIsMeasuring(true);
    setProject((current) => ({
      ...current,
      timeline: { ...current.timeline, status: "transcribing", error: "" },
    }));
    try {
      const result = await transcribeVoice(
        project.timeline.audioUrl,
        project.config.language,
      );
      // Whisper đúng về GIỜ nhưng hay sai về CHỮ — "shipper" thành "síp bơ".
      // Kịch bản là thứ đã đọc thành tiếng nên nó đúng về chữ. Gióng hai bên
      // rồi lấy chữ kịch bản ghép với giờ Whisper, không cần hỏi LLM đoán lại.
      const corrected = alignWordsToScript(
        result.words,
        fullNarration(project.beats),
      );
      const phrases = assignPhrasesToBeats(
        groupWordsIntoPhrases(corrected),
        project.beats,
      );
      setProject((current) => ({
        ...current,
        // Biên beat lấy theo giọng đọc thật, nên video dựng sau đó khớp sẵn
        // thay vì phải cắt gọt lúc render.
        beats: applyTimelineToBeats(current.beats, phrases),
        timeline: {
          ...current.timeline,
          status: "ready",
          phrases,
          durationSeconds: result.duration,
          language: result.language,
          error: "",
        },
      }));
      notify(
        `Đã đo ${result.words.length} từ trong ${result.duration.toFixed(1)} giây.`,
        "success",
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Không đo được timing.";
      setProject((current) => ({
        ...current,
        timeline: { ...current.timeline, status: "failed", error: message },
      }));
      notify(message, "error");
    } finally {
      setIsMeasuring(false);
    }
  };

  const runRender = async () => {
    setIsRendering(true);
    setRenderNote("");
    try {
      const result = await renderVideo(
        project.beats.map((beat) => ({
          index: beat.index,
          start: beat.start,
          end: beat.end,
          // Thiếu job là chip chương trên HUD trống — server không tự biết nhãn.
          job: beat.job,
          overlay: beat.overlay,
          videoUrl: beat.video.url,
          videoDuration: beat.video.durationSeconds,
        })),
        project.timeline.phrases,
        project.timeline.audioUrl,
        project.config.aspectRatio,
        settings.captionsEnabled,
        project.config.playbackRate,
        {
          eyebrow: project.config.coverEyebrow,
          title: project.config.coverTitle || project.config.title,
          seconds: project.config.coverSeconds,
        },
      );
      setProject((current) => ({
        ...current,
        lastRender: {
          url: result.url,
          captionFile: result.captionFile,
          durationSeconds: result.durationSeconds,
          speed: project.config.playbackRate,
          createdAt: new Date().toISOString(),
        },
      }));
      setRenderNote(result.captionNote);
      notify(
        `Đã render ${result.durationSeconds.toFixed(1)} giây từ ${result.clips} clip.`,
        "success",
      );
    } catch (error) {
      notify(error instanceof Error ? error.message : "Render thất bại.", "error");
    } finally {
      setIsRendering(false);
    }
  };
  const guideText = `QUY TRÌNH IMAGE-TO-VIDEO

1. Chọn keyframe đã duyệt của từng beat.
2. Mở công cụ image-to-video và nạp keyframe làm first frame hoặc image reference.
3. Copy Motion prompt của đúng beat và dán vào ô prompt.
4. Giữ tỷ lệ ${project.config.aspectRatio}. Không crop lại keyframe.
5. Đặt thời lượng theo timecode của beat, camera song song với mặt giấy và tắt audio tạo tự động.
6. Kiểm tra identity, logo, chữ, bố cục và frame cuối trước khi tải clip.
7. Đặt tên clip B01.mp4, B02.mp4 theo thứ tự rồi ghép cùng voice master trong editor.`;

  const copyGuide = async () => {
    try {
      await copyToClipboard(guideText);
      notify("Đã copy checklist image-to-video.", "success");
    } catch {
      notify("Trình duyệt không cho phép copy tự động.", "error");
    }
  };

  return (
    <div className="video-guide">
      <section className="video-guide-intro">
        <div>
          <FilmStrip size={30} weight="fill" />
          <h2>Biến keyframe thành clip</h2>
          <p>
            Luôn animate từ ảnh đã duyệt. Một beat dùng một prompt và xuất một
            clip riêng.
          </p>
        </div>
        <div className="guide-readiness">
          <strong>
            {completedFrames}/{project.beats.length}
          </strong>
          <span>keyframe sẵn sàng</span>
        </div>
      </section>

      <section className="section-block">
        <div className="section-heading">
          <h2>Xem thử và render</h2>
          <p>
            Voice là đồng hồ chủ. Đo timing trước để biên beat bám giọng đọc, rồi
            xem thử ngay trong trình duyệt trước khi render ra file.
          </p>
        </div>

        <div className="preview-actions">
          <button
            className="button button-quiet"
            onClick={() => void measureTiming()}
            disabled={isMeasuring || !project.timeline.audioUrl}
          >
            {isMeasuring ? <span className="button-loader" /> : <Sparkle size={18} />}
            Đo timing bằng Groq
          </button>
          <button
            className="button button-primary"
            onClick={() => void runRender()}
            disabled={isRendering || project.timeline.status !== "ready"}
          >
            {isRendering ? <span className="button-loader" /> : <FilmStrip size={18} />}
            Render video hoàn chỉnh
          </button>
          <label className="speed-picker">
            Tốc độ
            <select
              value={project.config.playbackRate}
              onChange={(event) =>
                setProject((current) => ({
                  ...current,
                  config: {
                    ...current.config,
                    playbackRate: Number(event.target.value),
                  },
                }))
              }
            >
              <option value={1}>x1</option>
              <option value={1.2}>x1.2</option>
              <option value={1.5}>x1.5</option>
            </select>
          </label>
          {project.timeline.status === "ready" && (
            <span className="casting-progress">
              {project.timeline.phrases.length} câu ·{" "}
              {project.timeline.durationSeconds.toFixed(1)} giây
            </span>
          )}
        </div>

        {staleLabels.length > 0 && (
          <p className="casting-issue">
            <WarningCircle size={15} />
            Beat{" "}
            {staleLabels
              .map((beat) => `B${beat.index.toString().padStart(2, "0")}`)
              .join(", ")}{" "}
            đang dùng nhãn vai trò kể chuyện ("{staleLabels[0].job}") thay vì nội
            dung. Sửa ở tab Kịch bản, hoặc tạo lại kịch bản để AI đặt nhãn mới.
          </p>
        )}

        {issues.map((issue) => (
          <p key={issue} className="casting-issue">
            <WarningCircle size={15} />
            {issue}
          </p>
        ))}

        {renderNote && <p className="export-warn">{renderNote}</p>}

        {renderUrl && (
          <div className="render-result">
            <video src={renderUrl} controls playsInline preload="metadata" />
            <div>
              <a className="button button-quiet button-small" href={renderUrl} download>
                <DownloadSimple size={16} />
                Tải mp4
              </a>
              {captionFile && (
                <a
                  className="button button-quiet button-small"
                  href={captionFile}
                  download
                >
                  <DownloadSimple size={16} />
                  Tải phụ đề .ass
                </a>
              )}
            </div>
          </div>
        )}

        <PreviewPlayer
          beats={project.beats}
          timeline={project.timeline}
          aspectRatio={project.config.aspectRatio}
          cover={{
            eyebrow: project.config.coverEyebrow,
            // Chưa đặt riêng thì lấy tên dự án, để cover không bao giờ trống.
            title: project.config.coverTitle || project.config.title,
            seconds: project.config.coverSeconds,
          }}
          speed={project.config.playbackRate}
        />
      </section>

      <div className="video-guide-grid">
        <section className="guide-steps">
          <div className="guide-step">
            <span>1</span>
            <div>
              <h3>Nạp đúng keyframe</h3>
              <p>
                Dùng ảnh của beat tương ứng làm first frame hoặc image
                reference. Không nạp lại ảnh sản phẩm gốc ở bước này.
              </p>
            </div>
          </div>
          <div className="guide-step">
            <span>2</span>
            <div>
              <h3>Dán motion prompt</h3>
              <p>
                Bấm Copy prompt video trên story card. Giữ nguyên dimensional
                lock, camera lock và phần avoid.
              </p>
            </div>
          </div>
          <div className="guide-step">
            <span>3</span>
            <div>
              <h3>Khóa thông số</h3>
              <p>
                Chọn tỷ lệ {project.config.aspectRatio}, thời lượng theo
                timecode beat, không tạo audio và không thêm caption.
              </p>
            </div>
          </div>
          <div className="guide-step">
            <span>4</span>
            <div>
              <h3>Kiểm tra rồi ghép</h3>
              <p>
                Loại clip bị morph, đổi identity, sinh chữ hoặc lệch bố cục.
                Tải clip đạt chuẩn và ghép theo thứ tự beat.
              </p>
            </div>
          </div>
        </section>

        <aside className="guide-checklist">
          <h3>Thiết lập nên giữ cố định</h3>
          <dl>
            <div>
              <dt>Tỷ lệ</dt>
              <dd>{project.config.aspectRatio}</dd>
            </div>
            <div>
              <dt>Camera</dt>
              <dd>Locked hoặc slow push</dd>
            </div>
            <div>
              <dt>Audio tạo tự động</dt>
              <dd>Tắt</dd>
            </div>
            <div>
              <dt>Caption tạo tự động</dt>
              <dd>Tắt</dd>
            </div>
            <div>
              <dt>Tên file</dt>
              <dd>B01.mp4, B02.mp4</dd>
            </div>
          </dl>
          <button className="button button-primary full-button" onClick={copyGuide}>
            <Copy size={18} />
            Copy checklist
          </button>
        </aside>
      </div>

      <section className="video-qa">
        <strong>QA trước khi đưa vào editor</strong>
        <p>
          So keyframe và frame đầu của clip. Kiểm tra silhouette, khuôn mặt,
          logo, màu chủ thể, chữ trong ảnh, hướng chuyển động và frame cuối.
        </p>
      </section>
    </div>
  );
}

function ProjectHistoryDialog({
  activeProjectId,
  onOpen,
  onDelete,
  onStatusChange,
  onClose,
}: {
  activeProjectId: string;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  onStatusChange: (id: string, status: ProjectStatus) => void;
  onClose: () => void;
}) {
  const [filter, setFilter] = useState<ProjectStatus>("in_progress");
  const [projects, setProjects] = useState<ProjectSummary[]>(() =>
    listProjects(),
  );
  const filtered = projects.filter((project) => project.status === filter);
  const statusLabels: Record<ProjectStatus, string> = {
    draft: "Bản nháp",
    in_progress: "Đang làm",
    completed: "Đã xong",
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const refresh = () => setProjects(listProjects());

  return (
    <div className="settings-layer" role="presentation" onMouseDown={onClose}>
      <section
        className="history-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="history-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="settings-header">
          <div>
            <h2 id="history-title">Lịch sử dự án</h2>
            <p>Mở lại phần đang làm hoặc phân loại dự án đã hoàn tất.</p>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Đóng lịch sử">
            <X size={20} />
          </button>
        </header>

        <div className="history-filters">
          {(["draft", "in_progress", "completed"] as ProjectStatus[]).map(
            (status) => (
              <button
                key={status}
                className={filter === status ? "history-filter-active" : ""}
                onClick={() => setFilter(status)}
              >
                {statusLabels[status]}
                <span>
                  {projects.filter((project) => project.status === status).length}
                </span>
              </button>
            ),
          )}
        </div>

        <div className="history-list">
          {filtered.length ? (
            filtered.map((item) => (
              <article
                className={`history-item ${
                  item.id === activeProjectId ? "history-item-active" : ""
                }`}
                key={item.id}
              >
                <div className="history-item-main">
                  <div className="history-icon">
                    <FileText size={21} />
                  </div>
                  <div>
                    <h3>{item.title}</h3>
                    <p>
                      {item.aspectRatio} / {item.duration}s /{" "}
                      {item.completedFrames} trên {item.beatCount} ảnh
                    </p>
                    <time>
                      Cập nhật{" "}
                      {new Date(item.updatedAt).toLocaleString("vi-VN", {
                        dateStyle: "short",
                        timeStyle: "short",
                      })}
                    </time>
                  </div>
                </div>
                <div className="history-item-actions">
                  <select
                    aria-label={`Trạng thái ${item.title}`}
                    value={item.status}
                    onChange={(event) => {
                      onStatusChange(
                        item.id,
                        event.target.value as ProjectStatus,
                      );
                      refresh();
                    }}
                  >
                    <option value="draft">Bản nháp</option>
                    <option value="in_progress">Đang làm</option>
                    <option value="completed">Đã xong</option>
                  </select>
                  <button
                    className="button button-primary button-small"
                    onClick={() => onOpen(item.id)}
                  >
                    Mở dự án
                  </button>
                  <button
                    className="icon-button danger-button"
                    aria-label={`Xóa ${item.title}`}
                    disabled={item.id === activeProjectId}
                    onClick={() => {
                      onDelete(item.id);
                      refresh();
                    }}
                  >
                    <Trash size={18} />
                  </button>
                </div>
              </article>
            ))
          ) : (
            <div className="history-empty">
              <ClockCounterClockwise size={30} />
              <h3>Chưa có dự án trong nhóm này</h3>
              <p>Đổi trạng thái dự án từ menu bên phải của từng mục.</p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function SettingsDialog({
  settings,
  onChange,
  onClose,
  notify,
}: {
  settings: AppSettings;
  onChange: React.Dispatch<React.SetStateAction<AppSettings>>;
  onClose: () => void;
  notify: (message: string, tone?: ToastState["tone"]) => void;
}) {
  const [status, setStatus] = useState<ProviderStatus | null>(null);
  const [statusError, setStatusError] = useState("");

  useEffect(() => {
    let active = true;
    void getProviderStatus()
      .then((result) => {
        if (active) setStatus(result.providers);
      })
      .catch((error) => {
        if (active) {
          setStatusError(
            error instanceof Error ? error.message : "Không kết nối được backend.",
          );
        }
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const update = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    onChange((current) => ({ ...current, [key]: value }));
  };

  const providers: Array<{
    key: keyof ProviderStatus;
    name: string;
    detail: string;
  }> = [
    { key: "deepseek", name: "DeepSeek", detail: "Kịch bản" },
    { key: "coachio", name: "Coachio", detail: "GPT Image 2" },
    { key: "gemini", name: "Gemini", detail: "Nano Banana 2" },
    { key: "elevenlabs", name: "ElevenLabs", detail: "Voice master" },
    { key: "pexels", name: "Pexels", detail: "Ảnh tham chiếu" },
    { key: "serper", name: "Serper", detail: "Ảnh web dự phòng" },
  ];

  return (
    <div className="settings-layer" role="presentation" onMouseDown={onClose}>
      <section
        className="settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="settings-header">
          <div>
            <h2 id="settings-title">AI và model</h2>
            <p>Chọn engine cho từng công đoạn. API key được giữ ở backend.</p>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Đóng cài đặt">
            <X size={20} />
          </button>
        </header>

        <div className="provider-strip" aria-label="Trạng thái nhà cung cấp">
          {providers.map((provider) => (
            <div className="provider-state" key={provider.key}>
              <i
                className={
                  status?.[provider.key]
                    ? "provider-dot provider-dot-ready"
                    : "provider-dot"
                }
                aria-hidden="true"
              />
              <span>
                <strong>{provider.name}</strong>
                <small>
                  {!status
                    ? "Đang kiểm tra"
                    : status[provider.key]
                      ? provider.detail
                      : "Thiếu API key"}
                </small>
              </span>
            </div>
          ))}
        </div>
        {statusError && <p className="settings-error">{statusError}</p>}

        <div className="settings-sections">
          <div className="settings-section">
            <div className="settings-section-title">
              <Scroll size={21} />
              <div>
                <h3>Viết kịch bản</h3>
                <p>Dùng AI khi cần nội dung theo context, hoặc template để làm nháp nhanh.</p>
              </div>
            </div>
            <div className="form-grid two-cols">
              <Field label="Engine">
                <select
                  value={settings.scriptProvider}
                  onChange={(event) =>
                    update(
                      "scriptProvider",
                      event.target.value as AppSettings["scriptProvider"],
                    )
                  }
                >
                  <option value="deepseek">DeepSeek AI</option>
                  <option value="template">Template cục bộ</option>
                </select>
              </Field>
              <Field label="Model DeepSeek">
                <input
                  value={settings.deepseekModel}
                  onChange={(event) => update("deepseekModel", event.target.value)}
                  disabled={settings.scriptProvider !== "deepseek"}
                />
              </Field>
            </div>
          </div>

          <div className="settings-section">
            <div className="settings-section-title">
              <ImageSquare size={21} />
              <div>
                <h3>Sinh keyframe</h3>
                <p>Coachio GPT Image 2 là mặc định. Gemini chỉ chạy trực tiếp hoặc fallback.</p>
              </div>
            </div>
            <div className="form-grid three-settings-cols">
              <Field label="Engine chính">
                <select
                  value={settings.imageProvider}
                  onChange={(event) =>
                    update(
                      "imageProvider",
                      event.target.value as AppSettings["imageProvider"],
                    )
                  }
                >
                  <option value="coachio">Coachio GPT Image 2</option>
                  <option value="gemini">Gemini Nano Banana 2</option>
                </select>
              </Field>
              <Field label="Độ phân giải">
                <select
                  value={settings.imageResolution}
                  onChange={(event) =>
                    update(
                      "imageResolution",
                      event.target.value as AppSettings["imageResolution"],
                    )
                  }
                >
                  <option value="1k">1K</option>
                  <option value="2k">2K</option>
                  <option value="4k">4K</option>
                </select>
              </Field>
              <Field label="Model fallback">
                <input
                  value={settings.geminiModel}
                  onChange={(event) => update("geminiModel", event.target.value)}
                />
              </Field>
            </div>
            <ToggleRow
              label="Tự chuyển sang Nano Banana 2 khi Coachio lỗi"
              checked={settings.fallbackToGemini}
              onChange={(value) => update("fallbackToGemini", value)}
            />
            <p className="field-help">
              Coachio GPT Image 2 dùng model ID cố định gpt_image_2. Tối đa 5 ảnh ref
              được upload khi bắt đầu tạo ảnh.
            </p>
            <ToggleRow
              label="Tìm ảnh nâng cao cho beat thiếu reference"
              checked={settings.imageSearchEnabled}
              onChange={(value) => update("imageSearchEnabled", value)}
            />
            <div className="form-grid two-cols">
              <ToggleRow
                label="Dùng Pexels"
                checked={settings.searchPexels}
                onChange={(value) => update("searchPexels", value)}
              />
              <ToggleRow
                label="Dùng Serper / Google Images"
                checked={settings.searchSerper}
                onChange={(value) => update("searchSerper", value)}
              />
            </div>
            <p className="field-help">
              Hai nguồn chạy độc lập theo lựa chọn. Hệ thống dịch mọi keyword
              sang tiếng Anh trước khi tìm. Ảnh Serper là ảnh web chưa rõ bản
              quyền, chỉ nên dùng làm tham chiếu bố cục.
              {status && (
                <>
                  {" "}
                  Trạng thái: Pexels {status.pexels ? "✓" : "✗"} · Serper{" "}
                  {status.serper ? "✓" : "✗"}.
                </>
              )}
            </p>
          </div>

          <div className="settings-section">
            <div className="settings-section-title">
              <Sparkle size={21} weight="fill" />
              <div>
                <h3>ChatGPT extension</h3>
                <p>Điều khiển cách VOX chuyển storyboard sang Auto ChatGPT Images.</p>
              </div>
            </div>
            <Field label="Sau khi nạp batch">
              <select
                value={settings.chatgptExtensionMode}
                onChange={(event) =>
                  update(
                    "chatgptExtensionMode",
                    event.target.value as AppSettings["chatgptExtensionMode"],
                  )
                }
              >
                <option value="auto">Tự động nạp và chạy toàn bộ</option>
                <option value="manual">Chỉ nạp vào Tạo ảnh hàng loạt</option>
              </select>
            </Field>
            <ToggleRow
              label="Mở tab ChatGPT mới cho mỗi batch VOX"
              checked={settings.chatgptOpenNewConversation}
              onChange={(value) => update("chatgptOpenNewConversation", value)}
            />
            <ToggleRow
              label="Reset workspace VOX khi nhận batch mới"
              checked={settings.chatgptResetWorkspace}
              onChange={(value) => update("chatgptResetWorkspace", value)}
            />
            <p className="field-help">
              Chế độ thủ công nạp đúng prompt và ảnh reference vào tab Tạo ảnh hàng loạt.
              Bạn kiểm tra dữ liệu rồi bấm “Thêm và chạy”. Liên kết project/beat
              vẫn được giữ để kết quả trả về đúng storyboard.
            </p>
          </div>

          <div className="settings-section">
            <div className="settings-section-title">
              <FilmStrip size={18} />
              <div>
                <strong>Video</strong>
                <span>Image-to-video bằng Replicate</span>
              </div>
            </div>
            <Field label="Model Replicate">
              <input
                value={settings.replicateModel}
                onChange={(event) => update("replicateModel", event.target.value)}
              />
            </Field>
            <Field label="Chất lượng mặc định">
              <select
                value={settings.video.quality}
                onChange={(event) => {
                  const quality = event.target.value as VideoQuality;
                  update(
                    "video",
                    quality === "custom"
                      ? { ...settings.video, quality }
                      : VIDEO_PRESETS[quality],
                  );
                }}
              >
                {(["draft", "standard", "high", "custom"] as VideoQuality[]).map(
                  (value) => (
                    <option key={value} value={value}>
                      {qualityLabels[value]}
                    </option>
                  ),
                )}
              </select>
            </Field>
            <details className="settings-advanced">
              <summary>Nâng cao</summary>
              <p className="field-help">
                Chỉ có tác dụng khi chất lượng đặt là Tuỳ chỉnh. Chọn preset sẽ
                ghi đè các ô này.
              </p>
              <div className="field-grid">
                <Field label="Resolution">
                  <select
                    value={settings.video.resolution}
                    onChange={(event) =>
                      update("video", {
                        ...settings.video,
                        resolution: event.target.value as VideoResolution,
                      })
                    }
                  >
                    <option value="480p">480p</option>
                    <option value="720p">720p</option>
                  </select>
                </Field>
                <Field label="Frames per second (5-30)">
                  <input
                    type="number"
                    min={5}
                    max={30}
                    value={settings.video.fps}
                    onChange={(event) =>
                      update("video", {
                        ...settings.video,
                        fps: Number(event.target.value),
                      })
                    }
                  />
                </Field>
                <Field label="Sample shift (1-20)">
                  <input
                    type="number"
                    min={1}
                    max={20}
                    value={settings.video.sampleShift}
                    onChange={(event) =>
                      update("video", {
                        ...settings.video,
                        sampleShift: Number(event.target.value),
                      })
                    }
                  />
                </Field>
              </div>
              <ToggleRow
                label="Nội suy lên 30fps"
                checked={settings.video.interpolate}
                onChange={(value) =>
                  update("video", { ...settings.video, interpolate: value })
                }
              />
              <ToggleRow
                label="Go fast"
                checked={settings.video.goFast}
                onChange={(value) =>
                  update("video", { ...settings.video, goFast: value })
                }
              />
            </details>
            <p className="field-help">
              Độ dài mỗi video suy từ độ dài beat, kẹp trong 81-121 frame theo
              giới hạn của Wan 2.2. Video được tải về máy chủ ngay khi dựng xong
              vì Replicate xoá file sau 1 giờ.
              {status && <> Trạng thái: Replicate {status.replicate ? "✓" : "✗"}.</>}
            </p>
          </div>

          <div className="settings-section">
            <div className="settings-section-title">
              <Microphone size={21} />
              <div>
                <h3>Voice over</h3>
                <p>Voice ID được chọn theo ngôn ngữ của dự án.</p>
              </div>
            </div>
            <div className="form-grid three-settings-cols">
              <Field label="Engine">
                <select
                  value={settings.voiceProvider}
                  onChange={(event) =>
                    update(
                      "voiceProvider",
                      event.target.value as AppSettings["voiceProvider"],
                    )
                  }
                >
                  <option value="elevenlabs">ElevenLabs cloud</option>
                  <option value="browser">Web Speech cục bộ</option>
                </select>
              </Field>
              <Field label="Model ElevenLabs">
                <input
                  value={settings.elevenLabsModel}
                  onChange={(event) => update("elevenLabsModel", event.target.value)}
                />
              </Field>
              <Field label="Voice ID tiếng Việt">
                <input
                  value={settings.voiceIdVi}
                  onChange={(event) => update("voiceIdVi", event.target.value)}
                />
              </Field>
            </div>
            <Field label="Voice ID tiếng Anh">
              <input
                value={settings.voiceIdEn}
                onChange={(event) => update("voiceIdEn", event.target.value)}
                placeholder="Để trống sẽ dùng Voice ID tiếng Việt"
              />
            </Field>
          </div>
        </div>

        <footer className="settings-footer">
          <p>Thay đổi được lưu cục bộ và áp dụng cho lần tạo tiếp theo.</p>
          <button
            className="button button-primary"
            onClick={() => {
              notify("Đã lưu cấu hình AI.", "success");
              onClose();
            }}
          >
            <Check size={18} weight="bold" />
            Lưu cài đặt
          </button>
        </footer>
      </section>
    </div>
  );
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function downloadFile(name: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

async function copyToClipboard(text: string) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Continue to the browser-compatible fallback below.
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  textarea.setAttribute("readonly", "");
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("Copy failed");
}

function slugify(value: string) {
  return (
    value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "vox-style-video"
  );
}

function formatSeconds(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.floor(seconds % 60);
  return `${minutes.toString().padStart(2, "0")}:${remainder
    .toString()
    .padStart(2, "0")}`;
}

export default App;
