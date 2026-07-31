import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import express from "express";
import multer from "multer";

export const EXTENSION_PROTOCOL = "vox-chatgpt/1";

export type ExtensionTaskState =
  | "queued"
  | "claiming"
  | "uploading_references"
  | "submitting"
  | "waiting"
  | "collecting"
  | "returning"
  | "completed"
  | "failed"
  | "paused"
  | "canceled";

export interface ExtensionReference {
  id: string;
  name: string;
  url: string;
  type?: string;
  order: number;
}

export interface ExtensionTask {
  taskId: string;
  batchId: string;
  projectId: string;
  beatId: string;
  prompt: string;
  promptHash: string;
  aspectRatio: string;
  references: ExtensionReference[];
  expectedOutputName: string;
  attempt: number;
  idempotencyKey: string;
  state: ExtensionTaskState;
  revision: number;
  lease?: { token: string; expiresAt: string };
  progress?: Record<string, unknown>;
  error?: { code: string; message: string };
  result?: {
    url: string;
    checksum: string;
    mimeType: string;
    byteLength: number;
    savedAt: string;
  };
  createdAt: string;
  updatedAt: string;
}

export interface ExtensionBatch {
  protocol: typeof EXTENSION_PROTOCOL;
  batchId: string;
  projectId: string;
  sourceApplication: "vox-style-video";
  conversationStrategy: "dedicated_per_batch";
  state: "queued" | "running" | "completed" | "failed" | "paused" | "canceled";
  revision: number;
  tasks: ExtensionTask[];
  createdAt: string;
  updatedAt: string;
}

interface BatchStore {
  batches: ExtensionBatch[];
}

const MAX_RESULT_BYTES = 30 * 1024 * 1024;
const LEASE_MS = 2 * 60 * 1000;
const ACTIVE_STATES = new Set<ExtensionTaskState>([
  "claiming",
  "uploading_references",
  "submitting",
  "waiting",
  "collecting",
  "returning",
]);
const PROGRESS_STATES = new Set<ExtensionTaskState>([
  ...ACTIVE_STATES,
  "paused",
]);

function now() {
  return new Date().toISOString();
}

function safeName(value: string) {
  return path
    .basename(value || "generated.png")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+/, "")
    .slice(0, 160) || "generated.png";
}

function hash(value: string | Buffer) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function atomicWrite(filePath: string, data: unknown) {
  const temp = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(data, null, 2));
  fs.renameSync(temp, filePath);
}

function refreshBatchState(batch: ExtensionBatch) {
  if (batch.tasks.every((task) => task.state === "completed")) batch.state = "completed";
  else if (batch.tasks.every((task) => task.state === "canceled")) batch.state = "canceled";
  else if (batch.tasks.some((task) => ACTIVE_STATES.has(task.state))) batch.state = "running";
  else if (batch.tasks.some((task) => task.state === "queued")) batch.state = "queued";
  else if (batch.tasks.some((task) => task.state === "failed")) batch.state = "failed";
  batch.revision += 1;
  batch.updatedAt = now();
}

export class ExtensionBatchRepository {
  private storeFile: string;
  private assetsDir: string;

  constructor(rootDir: string) {
    const extensionDir = path.join(rootDir, "extension");
    this.assetsDir = path.join(extensionDir, "assets");
    this.storeFile = path.join(extensionDir, "batches.json");
    fs.mkdirSync(this.assetsDir, { recursive: true });
    if (!fs.existsSync(this.storeFile)) atomicWrite(this.storeFile, { batches: [] });
  }

  private read(): BatchStore {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.storeFile, "utf8"));
      return { batches: Array.isArray(parsed?.batches) ? parsed.batches : [] };
    } catch {
      return { batches: [] };
    }
  }

  private write(store: BatchStore) {
    atomicWrite(this.storeFile, store);
  }

  create(input: any): ExtensionBatch {
    if (input?.protocol !== EXTENSION_PROTOCOL) throw new Error(`protocol must be ${EXTENSION_PROTOCOL}`);
    const projectId = String(input?.projectId || "").trim();
    const tasks = Array.isArray(input?.tasks) ? input.tasks : [];
    if (!projectId) throw new Error("projectId is required");
    if (!tasks.length) throw new Error("tasks must not be empty");

    const createdAt = now();
    const batchId = crypto.randomUUID();
    const ids = new Set<string>();
    const normalized: ExtensionTask[] = tasks.map((item: any, index: number) => {
      const beatId = String(item?.beatId || "").trim();
      const prompt = String(item?.prompt || "").trim();
      if (!beatId || !prompt) throw new Error(`tasks[${index}] requires beatId and prompt`);
      if (ids.has(beatId)) throw new Error(`duplicate beatId: ${beatId}`);
      ids.add(beatId);
      const attempt = Math.max(1, Number(item?.attempt) || 1);
      const promptHash = hash(prompt);
      const idempotencyKey = hash(`${projectId}:${beatId}:${promptHash}:${attempt}`);
      return {
        taskId: crypto.randomUUID(),
        batchId,
        projectId,
        beatId,
        prompt,
        promptHash,
        aspectRatio: String(item?.aspectRatio || "9:16"),
        references: (Array.isArray(item?.references) ? item.references : []).map(
          (reference: any, order: number) => {
            const url = String(reference?.url || "");
            if (!url) throw new Error(`tasks[${index}].references[${order}].url is required`);
            return {
              id: String(reference?.id || `${beatId}-ref-${order + 1}`),
              name: String(reference?.name || `reference-${order + 1}.png`),
              url,
              type: String(reference?.type || ""),
              order,
            };
          },
        ),
        expectedOutputName: safeName(String(item?.expectedOutputName || `B${index + 1}.png`)),
        attempt,
        idempotencyKey,
        state: "queued",
        revision: 1,
        createdAt,
        updatedAt: createdAt,
      };
    });
    const batch: ExtensionBatch = {
      protocol: EXTENSION_PROTOCOL,
      batchId,
      projectId,
      sourceApplication: "vox-style-video",
      conversationStrategy: "dedicated_per_batch",
      state: "queued",
      revision: 1,
      tasks: normalized,
      createdAt,
      updatedAt: createdAt,
    };
    const store = this.read();
    store.batches.unshift(batch);
    this.write(store);
    return batch;
  }

  get(batchId: string) {
    return this.read().batches.find((batch) => batch.batchId === batchId) || null;
  }

  claim(batchId: string) {
    const store = this.read();
    const batch = store.batches.find((item) => item.batchId === batchId);
    if (!batch) return null;
    const currentTime = Date.now();
    const task = batch.tasks.find((item) => {
      if (item.state === "queued" || item.state === "failed") return true;
      return item.lease && ACTIVE_STATES.has(item.state) && Date.parse(item.lease.expiresAt) <= currentTime;
    });
    if (!task) return { batch, task: null };
    task.state = "claiming";
    task.revision += 1;
    task.updatedAt = now();
    task.error = undefined;
    task.lease = {
      token: crypto.randomUUID(),
      expiresAt: new Date(Date.now() + LEASE_MS).toISOString(),
    };
    refreshBatchState(batch);
    this.write(store);
    return { batch, task };
  }

  updateTask(taskId: string, mutate: (task: ExtensionTask) => void) {
    const store = this.read();
    const batch = store.batches.find((item) => item.tasks.some((task) => task.taskId === taskId));
    const task = batch?.tasks.find((item) => item.taskId === taskId);
    if (!batch || !task) return null;
    mutate(task);
    task.revision += 1;
    task.updatedAt = now();
    refreshBatchState(batch);
    this.write(store);
    return { batch, task };
  }

  saveResult(taskId: string, metadata: any, image: Express.Multer.File) {
    const existing = this.findTask(taskId);
    if (!existing) return null;
    const checksum = hash(image.buffer);
    const claimedChecksum = String(metadata?.checksum || "").toLowerCase();
    if (claimedChecksum && checksum !== claimedChecksum) {
      const error: any = new Error("RESULT_CHECKSUM_MISMATCH");
      error.code = "RESULT_CHECKSUM_MISMATCH";
      throw error;
    }
    if (existing.task.result) {
      if (existing.task.result.checksum !== checksum) {
        const error: any = new Error("RESULT_CONFLICT");
        error.code = "RESULT_CONFLICT";
        throw error;
      }
      return { ...existing, duplicate: true };
    }
    if (metadata?.idempotencyKey !== existing.task.idempotencyKey) {
      const error: any = new Error("IDEMPOTENCY_KEY_MISMATCH");
      error.code = "IDEMPOTENCY_KEY_MISMATCH";
      throw error;
    }
    const projectDir = path.join(this.assetsDir, safeName(existing.batch.projectId));
    fs.mkdirSync(projectDir, { recursive: true });
    const fileName = `${existing.task.taskId}-${safeName(existing.task.expectedOutputName)}`;
    const outputPath = path.join(projectDir, fileName);
    fs.writeFileSync(outputPath, image.buffer);
    const url = `/generated/extension/assets/${encodeURIComponent(safeName(existing.batch.projectId))}/${encodeURIComponent(fileName)}`;
    return this.updateTask(taskId, (task) => {
      task.state = "completed";
      task.lease = undefined;
      task.result = {
        url,
        checksum,
        mimeType: image.mimetype,
        byteLength: image.size,
        savedAt: now(),
      };
    });
  }

  findTask(taskId: string) {
    for (const batch of this.read().batches) {
      const task = batch.tasks.find((item) => item.taskId === taskId);
      if (task) return { batch, task };
    }
    return null;
  }
}

export function createExtensionRouter(generatedDir: string) {
  const repository = new ExtensionBatchRepository(generatedDir);
  const router = express.Router();
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_RESULT_BYTES, files: 1 },
  });

  router.use((request, response, next) => {
    response.setHeader("Access-Control-Allow-Origin", "*");
    response.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Vox-Extension-Protocol");
    response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    if (request.method === "OPTIONS") return response.sendStatus(204);
    next();
  });

  router.post("/batches", (request, response) => {
    try {
      const apiOrigin = `${request.protocol}://${request.get("host")}`;
      const input = {
        ...request.body,
        tasks: Array.isArray(request.body?.tasks)
          ? request.body.tasks.map((task: any) => ({
              ...task,
              references: Array.isArray(task?.references)
                ? task.references.map((reference: any) => ({
                    ...reference,
                    url:
                      typeof reference?.url === "string" && reference.url.startsWith("/")
                        ? new URL(reference.url, apiOrigin).href
                        : reference?.url,
                  }))
                : [],
            }))
          : [],
      };
      response.status(201).json(repository.create(input));
    } catch (error) {
      response.status(400).json({ message: error instanceof Error ? error.message : "Invalid batch" });
    }
  });

  router.get("/batches/:batchId", (request, response) => {
    const batch = repository.get(request.params.batchId);
    if (!batch) return response.status(404).json({ message: "Batch not found" });
    response.json(batch);
  });

  router.post("/batches/:batchId/claim", (request, response) => {
    const claimed = repository.claim(request.params.batchId);
    if (!claimed) return response.status(404).json({ message: "Batch not found" });
    response.json(claimed);
  });

  router.post("/tasks/:taskId/progress", (request, response) => {
    const state = String(request.body?.state || "") as ExtensionTaskState;
    if (!PROGRESS_STATES.has(state)) return response.status(400).json({ message: "Invalid progress state" });
    const updated = repository.updateTask(request.params.taskId, (task) => {
      task.state = state;
      task.progress = request.body?.details || {};
      if (task.lease) task.lease.expiresAt = new Date(Date.now() + LEASE_MS).toISOString();
    });
    if (!updated) return response.status(404).json({ message: "Task not found" });
    response.json(updated.task);
  });

  router.post("/tasks/:taskId/fail", (request, response) => {
    const updated = repository.updateTask(request.params.taskId, (task) => {
      task.state = "failed";
      task.lease = undefined;
      task.error = {
        code: String(request.body?.code || "INTERNAL_ERROR"),
        message: String(request.body?.message || "Task failed"),
      };
    });
    if (!updated) return response.status(404).json({ message: "Task not found" });
    response.json(updated.task);
  });

  router.post("/tasks/:taskId/cancel", (request, response) => {
    const updated = repository.updateTask(request.params.taskId, (task) => {
      task.state = "canceled";
      task.lease = undefined;
    });
    if (!updated) return response.status(404).json({ message: "Task not found" });
    response.json(updated.task);
  });

  router.post("/tasks/:taskId/result", upload.single("image"), (request, response) => {
    if (!request.file) return response.status(400).json({ message: "Image file is required" });
    if (!request.file.mimetype.startsWith("image/")) return response.status(415).json({ message: "Result must be an image" });
    try {
      const metadata = JSON.parse(String(request.body?.metadata || "{}"));
      const saved = repository.saveResult(request.params.taskId, metadata, request.file);
      if (!saved) return response.status(404).json({ message: "Task not found" });
      response.json({
        saved: true,
        duplicate: Boolean((saved as any).duplicate),
        taskId: saved.task.taskId,
        beatId: saved.task.beatId,
        result: saved.task.result,
      });
    } catch (error: any) {
      const conflict = error?.code === "RESULT_CONFLICT";
      response.status(conflict ? 409 : 400).json({ code: error?.code, message: error?.message || "Invalid result" });
    }
  });

  return router;
}
