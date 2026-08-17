import { buildReferenceOrderBlock, emptyRefPlan } from "./casting";
import { emptyBeatVideo } from "./video";
import { emptyTimeline } from "./timeline";
import type {
  AspectRatio,
  Beat,
  Duration,
  ProjectConfig,
  ReferenceAsset,
  SearchedImage,
} from "../types";

const beatCounts: Record<Duration, number> = {
  30: 6,
  60: 11,
  180: 36,
};

/**
 * Nhãn chương hiện lên đầu video nên phải tả NỘI DUNG, không phải vai trò kể
 * chuyện. Người xem không quan tâm beat này là "móc câu" hay "cao trào"; họ cần
 * biết đang xem công đoạn nào.
 */
const narrativeJobs = [
  "Mở đầu",
  "Bối cảnh",
  "Điểm nghẽn",
  "Cách vận hành",
  "Dẫn chứng",
  "Chốt lại",
];

const storyPatterns = [
  {
    job: "Móc câu",
    narration: (topic: string) =>
      `Có một chi tiết về ${topic} đáng để nhìn kỹ hơn.`,
    visual: (topic: string) =>
      `Biến chủ thể chính của ${topic} thành một photographic cutout mở ra câu chuyện.`,
  },
  {
    job: "Bối cảnh",
    narration: () =>
      "Câu chuyện bắt đầu từ một thay đổi đang diễn ra ngay trước mắt.",
    visual: () =>
      "Một đường hành trình bằng giấy nối điểm xuất phát với bối cảnh rộng hơn.",
  },
  {
    job: "Vấn đề",
    narration: () =>
      "Nhưng điều dễ thấy chưa chắc là điều quan trọng nhất.",
    visual: () =>
      "Lớp newsprint bị xé mở, để lộ cơ chế nằm phía sau bề mặt.",
  },
  {
    job: "Cơ chế",
    narration: () =>
      "Muốn hiểu đúng, cần tách câu chuyện thành từng lớp có thể kiểm chứng.",
    visual: () =>
      "Ba lớp giấy khóa vào nhau: nguyên nhân, hành động và kết quả.",
  },
  {
    job: "Bằng chứng",
    narration: () =>
      "Mỗi con số và mốc thời gian chỉ được giữ lại khi có nguồn rõ ràng.",
    visual: () =>
      "Các thẻ dữ kiện trống chờ editor điền nội dung đã xác minh.",
  },
  {
    job: "Kết luận",
    narration: () =>
      "Điều đáng nhớ không phải là lời hứa lớn, mà là cách các mảnh ghép vận hành cùng nhau.",
    visual: () =>
      "Các lớp giấy hoàn tất một poster kết, chừa vùng CTA rõ ràng.",
  },
];

const formatTime = (seconds: number) => {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, "0")}:${secs
    .toString()
    .padStart(2, "0")}`;
};

const voxPalettes = [
  "warm ivory, ink black and signal red",
  "cobalt blue, butter yellow and ink black",
  "vermilion, dusty pink and charcoal",
  "deep teal, ochre and warm cream",
  "midnight navy, cyan and off-white",
  "forest green, coral and cream",
];

const voxShotRhythm = [
  {
    size: "CLOSE hero crop",
    layout: "asymmetric diagonal composition with an oversized focal cutout",
    camera: "one very slow push-in",
  },
  {
    size: "WIDE system view",
    layout: "horizontal foreground-midground-background layers with strong negative space",
    camera: "one slow left-to-right lateral move",
  },
  {
    size: "MEDIUM explanatory view",
    layout: "modular editorial grid with one clearly separated mechanism",
    camera: "locked camera with subtle depth parallax between paper layers",
  },
  {
    size: "DETAIL emphasis",
    layout: "off-centre focal detail with a single directional paper trail",
    camera: "one very slow push-in",
  },
  {
    size: "WIDE reveal",
    layout: "stacked paper bands revealing cause, action and result",
    camera: "one slow vertical rise",
  },
  {
    size: "MEDIUM resolved poster",
    layout: "stable centred composition with generous negative space for the takeaway",
    camera: "locked-off camera",
  },
];

function buildVoxDirection(beat: Beat) {
  const rhythm = voxShotRhythm[(beat.index - 1) % voxShotRhythm.length];
  const palette = voxPalettes[(beat.index - 1) % voxPalettes.length];
  const isLastBeat = /kết|cta|chốt|takeaway/i.test(beat.job);

  return {
    size: isLastBeat ? "WIDE resolved poster" : rhythm.size,
    layout: isLastBeat
      ? "stable centred composition with generous negative space for the takeaway"
      : rhythm.layout,
    camera: isLastBeat ? "locked-off camera" : rhythm.camera,
    palette,
  };
}

export const defaultConfig: ProjectConfig = {
  title: "Dự án chưa đặt tên",
  aspectRatio: "9:16",
  duration: 30,
  language: "Tiếng Việt",
  context: "",
  objective: "Giải thích một chủ đề phức tạp bằng video paper-collage dễ hiểu.",
  audience: "Người xem short video 18-40 tuổi.",
  callToAction: "Theo dõi để xem phần tiếp theo.",
  storyArc: "hook_payoff",
  preserveIdentity: true,
  noGeneratedText: true,
  flatPaperOnly: true,
  singleVoice: true,
  videoQuality: "draft",
  coverEyebrow: "GIẢI THÍCH",
  coverTitle: "",
  coverSeconds: 3.2,
  playbackRate: 1,
};

export const emptyProject = () => ({
  id: crypto.randomUUID(),
  status: "draft" as const,
  createdAt: new Date().toISOString(),
  config: defaultConfig,
  references: [],
  beats: [],
  activeStep: "setup" as const,
  scriptApproved: false,
  castingApproved: false,
  storyboardGenerated: false,
  searchedImages: [],
  timeline: emptyTimeline(),
  lastRender: null,
  updatedAt: new Date().toISOString(),
  audioName: "",
});

export function extractTopic(context: string) {
  const cleaned = context.trim().replace(/\s+/g, " ");
  if (!cleaned) return "chủ đề này";
  const firstSentence = cleaned.split(/[.!?\n]/)[0].trim();
  return firstSentence.length > 74
    ? `${firstSentence.slice(0, 71).trim()}...`
    : firstSentence;
}

export function generateBeats(
  config: ProjectConfig,
  references: ReferenceAsset[] = [],
): Beat[] {
  const count = beatCounts[config.duration];
  const beatDuration = config.duration / count;
  const topic =
    config.title.trim() && config.title !== defaultConfig.title
      ? config.title.trim()
      : extractTopic(config.context);

  return Array.from({ length: count }, (_, index) => {
    const pattern = storyPatterns[index % storyPatterns.length];
    const start = Number((index * beatDuration).toFixed(2));
    const end = Number(((index + 1) * beatDuration).toFixed(2));
    const suffix =
      count > storyPatterns.length
        ? ` Đây là nhịp ${index + 1} trong tuyến kể dài.`
        : "";

    return {
      id: crypto.randomUUID(),
      index: index + 1,
      start,
      end,
      job: narrativeJobs[Math.min(index, narrativeJobs.length - 1)] ?? pattern.job,
      narration: `${pattern.narration(topic)}${suffix}`,
      visual: pattern.visual(topic),
      transition:
        index === count - 1
          ? "Giữ poster kết đủ lâu để đọc CTA."
          : "Đường cyan hướng về beat tiếp theo.",
      overlay:
        index === 0
          ? topic.toUpperCase()
          : index === count - 1
            ? config.callToAction.toUpperCase()
            : "",
      imagePrompt: "",
      motionPrompt: "",
      outputImage: "",
      outputName: "",
      generationStatus: "idle" as const,
      generationError: "",
      imageProvider: "",
      refPlan: emptyRefPlan(references),
      video: emptyBeatVideo(),
      apiMotionPrompt: "",
    };
  });
}

export function makeReferenceManifest(references: ReferenceAsset[]) {
  if (!references.length) {
    return "Chưa có reference. Hãy nạp ít nhất một ảnh chủ thể và một ảnh style.";
  }

  const priority = { subject: 1, character: 2, style: 3, environment: 4 };
  return [...references]
    .sort((a, b) => priority[a.role] - priority[b.role])
    .map(
      (asset, index) =>
        `Reference ${index + 1}: ${asset.name} | role=${asset.role} | ${
          asset.notes || "không có ghi chú"
        }`,
    )
    .join("\n");
}

export function buildStylePrompt(
  config: ProjectConfig,
  references: ReferenceAsset[],
) {
  return `Create a premium editorial paper-collage explainer style frame.

PROJECT
Topic: ${extractTopic(config.context)}
Language: ${config.language}
Format: ${config.aspectRatio}, ${config.duration} seconds.

REFERENCE ORDER
${makeReferenceManifest(references)}

LOCKED VISUAL LANGUAGE
Mixed-media hand-cut editorial paper collage photographed straight-on. Use scissor-cut and selectively torn fibre edges, visible uncoated paper grain, black-and-white halftone photographic cutouts, restrained risograph overprint and slight ink misregistration, small tape corners, photocopied newsprint scraps and shallow physical paper shadows. Keep the image strictly flat 2D and construct it from 3-6 clearly separable foreground, midground and background paper groups.

ART DIRECTION
Use one dominant subject, one visual mechanism and at most 2-3 supporting scraps. Establish a clear poster hierarchy at thumbnail size: hero silhouette first, mechanism second, overlay safe-zone third. Give each beat one bold flat paper background and a limited palette of two chromatic inks plus black or cream. Alternate crop, layout and palette across adjacent beats while keeping paper grain, edge roughness, halftone density and shadow direction identical throughout the film.

REFERENCE RULES
Treat subject and character references as photographic cutout layers. Preserve identity, silhouette, proportions, colors and visible markings. Use style references only to guide medium, palette and texture. Do not merge or duplicate reference subjects.

SURFACE RULE
Every paper surface is blank stock: texture, fibre and halftone dots only. Signs, screens, packaging, labels and torn scraps all stay wordless, with clean empty areas where copy would sit. This frame will later be animated, and any lettering baked into it warps into garbled shapes as soon as it moves.

QUALITY BAR
The result should feel art-directed and physically assembled, not like an adjective-heavy AI collage: crisp readable silhouettes, intentional overlap, controlled empty space, tactile print imperfections and no decorative clutter.

CONSTRAINTS
One focal subject, strong hierarchy, useful negative space and safe zones for ${config.aspectRatio}. No glossy CGI, plastic clay, smooth vector gradients, 3D diorama, perspective room, full-frame photoreal scene, fake text, invented logos, watermark or UI.`;
}

export function buildBeatPrompts(
  config: ProjectConfig,
  references: ReferenceAsset[],
  beat: Beat,
  searched: SearchedImage[] = [],
) {
  const direction = buildVoxDirection(beat);
  const referenceOrder = buildReferenceOrderBlock(
    beat.refPlan,
    references,
    searched,
  );
  const createFromScratch = beat.refPlan.newElements.length
    ? `\n\nCREATE FROM SCRATCH\nBuild these elements with no reference, in the locked paper-collage style: ${beat.refPlan.newElements.join(
        ", ",
      )}.`
    : "";
  const imagePrompt = `Create the finished keyframe for beat B${beat.index
    .toString()
    .padStart(2, "0")}.

TIMECODE
${formatTime(beat.start)}-${formatTime(beat.end)}

MESSAGE
The viewer must understand in one glance: ${beat.visual}

REFERENCE ORDER
Images are supplied in exactly this order. Apply each rule to its numbered image only.
${referenceOrder}${createFromScratch}

COMPOSITION
Shot framing: ${direction.size}.
Layout: ${direction.layout}.
One dominant subject, one visual mechanism, one clean label area and one transition cue. Add at most 2-3 supporting scraps. Build the scene from 3-6 distinct foreground, midground and background paper groups; every group has a readable silhouette, visible edge and its own shallow drop shadow.

COLOR SCRIPT
One bold flat paper background using a limited palette of ${direction.palette}. Black-and-white halftone photography may act as the neutral. Keep color blocks flat, clean and high-contrast; no muddy gradients.

BUILT FOR MOTION
This frame gets animated afterwards, so build it to move: keep every group a whole, unbroken paper shape with clear space around it, sitting on its own layer against a calm background. Silhouettes read cleanly at a glance. Avoid dense overlapping clusters, hair-thin filaments, tiny scattered confetti and crowds of small repeated objects — those shred and smear the moment anything shifts. Fewer, larger, well-separated pieces animate cleanly. Reserve clean space for editor overlay: "${
    beat.overlay || "no overlay in this beat"
  }".

LOCKED STYLE
Mixed-media hand-cut editorial paper collage, straight-on scanned-flat camera, scissor-cut and selectively torn fibre edges, uncoated paper grain, black-and-white halftone photographic cutouts, restrained risograph overprint with slight ink misregistration, small tape corners, photocopied newsprint scraps, shallow consistent paper shadows, strictly flat 2D. The finish is tactile, intentional and editorial — never glossy, plastic, vector-smooth or CGI.

CONTINUITY
${beat.transition}

SURFACE RULE
Every paper surface stays blank stock: texture, fibre and halftone dots only. Signs, screens, packaging, labels and torn paper scraps are wordless, leaving clean empty areas where copy would sit. This keyframe gets animated afterwards, and lettering baked into it warps into garbled shapes the moment it moves, so the frame must ship wordless and the editor adds real copy on top.

OUTPUT
One clean ${config.aspectRatio} poster frame, no mockup border, no UI.`;

  const motionPrompt = `Animate the supplied approved keyframe for beat B${beat.index
    .toString()
    .padStart(2, "0")} as a tactile flat 2D editorial paper-collage motion graphic.

CAMERA
${direction.camera}. Camera remains parallel to the poster with no perspective change. Use one smooth continuous camera behaviour for the entire shot.

ACTION
Animate one principal rigid-paper action that communicates: ${beat.transition || beat.visual}
Let foreground, midground and background groups move at slightly different speeds only when needed for tactile parallax. One secondary accent may flutter, hinge or pulse once, then settle. Keep the overlay safe-zone still.

MOTION FEEL
Confident editorial pacing, tactile stop-motion restraint and high contrast in ${direction.palette}. The frame should feel like a living printed poster, not a camera flying through a 3D scene.

DIMENSIONAL LOCK
Every piece remains a rigid flat paper layer. No bending, morphing, inflation, 3D rotation or photoreal transformation.

STABILITY
Preserve the exact composition, palette, subject identity, product silhouette, printed texture and negative space. Do not redraw faces, hands, logos or labels. Create no new objects.

TIMING
${Math.max(4, Math.ceil(beat.end - beat.start))} seconds. Ease in during the opening 20%, perform and hold the readable action through the middle 60%, then settle completely during the final 20%. Hold the final composition for at least the last 0.75 second.

AUDIO
Silent video. No narration, dialogue, music or generated captions.

AVOID
No cuts, abrupt zooms, orbit, camera roll, morphing, melting, fake text, watermark, UI or scene change.`;

  /**
   * Prompt riêng cho Replicate. motionPrompt ở trên GIỮ NGUYÊN từng ký tự vì
   * phần copy prompt và gói ZIP cho extension phải không đổi.
   *
   * Ba khác biệt, đều nhắm vào việc Wan hay làm méo hình:
   * 1. Không có khối AVOID. Diffusion model xử lý phủ định kém; viết "no
   *    morphing, no melting" trong prompt dương chính là gọi khái niệm đó vào.
   *    Mọi ràng buộc ở đây viết thành khẳng định.
   * 2. Một đoạn liền, không khối chữ HOA. Wan phản hồi tốt với prompt cô đọng.
   * 3. Nói rõ camera khoá và song song với mặt phẳng poster, để không bị diễn
   *    thành cú xoay quanh vật thể.
   */
  const apiMotionPrompt = [
    `A flat two-dimensional paper-collage poster, photographed straight on.`,
    `The shot keeps its ${direction.size.toLowerCase()} framing and its limited`,
    `${direction.palette} print palette from beginning to end.`,
    `${beat.visual}`,
    // Chỉ MỘT chuyển động, biên độ nhỏ. Wan càng được giao ít việc thì càng ít
    // méo; yêu cầu nhiều lớp cùng động là cách nhanh nhất để ra hình nhoè.
    `Exactly one small, slow, gentle movement happens in the whole shot, and`,
    `nothing else changes: ${beat.transition.toLowerCase()}`,
    `The movement travels only a short distance and eases to a stop.`,
    `Every element stays a rigid flat paper cutout with clean scissor-cut edges,`,
    `holding its exact printed shape, colour, texture and position throughout.`,
    `Layers slide and settle as whole pieces, the way real cut paper moves on a table.`,
    `Foreground, midground and background paper groups remain visibly separate through`,
    `their crisp cut edges and shallow physical shadows. The tactile risograph grain,`,
    `slight ink misregistration and photocopied newsprint texture stay perfectly stable.`,
    `The camera stays locked and parallel to the poster for the entire shot.`,
    `The composition, the subject and every surface marking remain exactly as they`,
    `appear in the source image, pixel for pixel where nothing is meant to move.`,
    // Wan hay "vẽ thêm" chữ vào vùng trống. Nói rõ vùng trống PHẢI ở nguyên
    // trạng thái trống, thay vì cấm suông "no text".
    `Every surface that is blank in the source image stays blank for the whole shot,`,
    `keeping its plain paper texture with nothing written or drawn onto it.`,
    `HARD RULE, NO EXCEPTIONS: every letter, digit, word, logo, icon and symbol`,
    `visible in the source image is permanently frozen — identical pixels, identical`,
    `shape, identical position in every single frame, as printed ink on paper.`,
    `Motion is allowed only for whole paper layers sliding, drifting or settling;`,
    `if a layer carries text or a symbol, the layer may move as one rigid piece but`,
    `its printed marks never bend, warp, ripple, redraw or dissolve.`,
    `The action eases in gently, reads clearly through the middle of the shot, then`,
    `settles completely and holds for the final moment with confident editorial pacing.`,
    `The frame ends exactly as it began, apart from that single small movement.`,
    `Silent footage.`,
  ].join(" ");

  return { imagePrompt, motionPrompt, apiMotionPrompt };
}

export function hydrateStoryboard(
  config: ProjectConfig,
  references: ReferenceAsset[],
  beats: Beat[],
  searched: SearchedImage[] = [],
) {
  return beats.map((beat) => {
    const prompts = buildBeatPrompts(config, references, beat, searched);
    return { ...beat, ...prompts };
  });
}

export function fullNarration(beats: Beat[]) {
  return beats
    .map((beat) => beat.narration.trim())
    .filter(Boolean)
    .join(" ");
}

export function buildProjectMarkdown(
  config: ProjectConfig,
  references: ReferenceAsset[],
  beats: Beat[],
) {
  const stylePrompt = buildStylePrompt(config, references);
  const beatBlocks = beats
    .map(
      (beat) => `## B${beat.index.toString().padStart(2, "0")}

**Timecode:** ${formatTime(beat.start)}-${formatTime(beat.end)}

**Narration:** ${beat.narration}

**Overlay:** ${beat.overlay || "Không có"}

### Image prompt

\`\`\`text
${beat.imagePrompt}
\`\`\`

### Motion prompt

\`\`\`text
${beat.motionPrompt}
\`\`\``,
    )
    .join("\n\n");

  return `# ${config.title}

## Creative brief

- Tỷ lệ: ${config.aspectRatio}
- Độ dài: ${config.duration} giây
- Ngôn ngữ: ${config.language}
- Mục tiêu: ${config.objective}
- Khán giả: ${config.audience}
- Chủ đề: ${config.context}

## Reference manifest

\`\`\`text
${makeReferenceManifest(references)}
\`\`\`

## Master narration

${fullNarration(beats)}

## Style reference prompt

\`\`\`text
${stylePrompt}
\`\`\`

${beatBlocks}
`;
}

export function aspectResolution(aspect: AspectRatio) {
  if (aspect === "1:1") return "1080 × 1080";
  if (aspect === "16:9") return "1920 × 1080";
  return "1080 × 1920";
}
