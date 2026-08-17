import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  EXTENSION_PROTOCOL,
  ExtensionBatchRepository,
} from "./extensionBatches";

const temporaryRoots: string[] = [];

function repository() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vox-extension-batches-"));
  temporaryRoots.push(root);
  return new ExtensionBatchRepository(root);
}

function batchInput() {
  return {
    protocol: EXTENSION_PROTOCOL,
    projectId: "project-1",
    tasks: [
      {
        beatId: "beat-1",
        prompt: "Generate one self-contained storyboard frame.",
        aspectRatio: "9:16",
        references: [
          { id: "ref-2", name: "second.png", url: "data:image/png;base64,Ag==" },
          { id: "ref-1", name: "first.png", url: "data:image/png;base64,AQ==" },
        ],
        expectedOutputName: "B01-gemini.png",
      },
    ],
  };
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("ExtensionBatchRepository", () => {
  it("creates a durable batch and preserves reference order", () => {
    const repo = repository();
    const batch = repo.create(batchInput());
    expect(repo.get(batch.batchId)?.batchId).toBe(batch.batchId);
    expect(batch.tasks[0].references.map((reference) => reference.id)).toEqual([
      "ref-2",
      "ref-1",
    ]);
    expect(batch.tasks[0].references.map((reference) => reference.order)).toEqual([
      0,
      1,
    ]);
  });

  it("claims only one task and issues a lease", () => {
    const repo = repository();
    const batch = repo.create(batchInput());
    const claimed = repo.claim(batch.batchId);
    expect(claimed?.task?.state).toBe("claiming");
    expect(claimed?.task?.lease?.token).toBeTruthy();
    expect(repo.claim(batch.batchId)?.task).toBeNull();
  });

  it("saves bytes before marking a task completed and accepts an idempotent replay", () => {
    const repo = repository();
    const batch = repo.create(batchInput());
    const task = repo.claim(batch.batchId)!.task!;
    const buffer = Buffer.from("fake png bytes");
    const checksum = crypto.createHash("sha256").update(buffer).digest("hex");
    const image = {
      buffer,
      size: buffer.byteLength,
      mimetype: "image/png",
    } as Express.Multer.File;
    const metadata = { idempotencyKey: task.idempotencyKey, checksum };
    const saved = repo.saveResult(task.taskId, metadata, image);
    expect(saved?.task.state).toBe("completed");
    expect(saved?.task.result?.checksum).toBe(checksum);
    expect(repo.get(batch.batchId)?.state).toBe("completed");
    expect((repo.saveResult(task.taskId, metadata, image) as any)?.duplicate).toBe(true);
  });

  it("rejects conflicting bytes for an existing idempotency key", () => {
    const repo = repository();
    const batch = repo.create(batchInput());
    const task = repo.claim(batch.batchId)!.task!;
    const first = Buffer.from("first");
    repo.saveResult(
      task.taskId,
      {
        idempotencyKey: task.idempotencyKey,
        checksum: crypto.createHash("sha256").update(first).digest("hex"),
      },
      { buffer: first, size: first.length, mimetype: "image/png" } as Express.Multer.File,
    );
    const second = Buffer.from("second");
    expect(() =>
      repo.saveResult(
        task.taskId,
        {
          idempotencyKey: task.idempotencyKey,
          checksum: crypto.createHash("sha256").update(second).digest("hex"),
        },
        { buffer: second, size: second.length, mimetype: "image/png" } as Express.Multer.File,
      ),
    ).toThrow("RESULT_CONFLICT");
  });
});
