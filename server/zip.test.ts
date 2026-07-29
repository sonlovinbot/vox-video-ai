import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createZip, crc32 } from "./zip";

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "vox-zip-"));

afterAll(() => {
  fs.rmSync(workDir, { recursive: true, force: true });
});

function writeZip(name: string, buffer: Buffer) {
  const target = path.join(workDir, name);
  fs.writeFileSync(target, buffer);
  return target;
}

describe("crc32", () => {
  it("khớp giá trị chuẩn của chuỗi rỗng và 'a'", () => {
    expect(crc32(Buffer.alloc(0))).toBe(0);
    expect(crc32(Buffer.from("a"))).toBe(0xe8b7be43);
  });

  it("khớp vector kiểm chuẩn '123456789'", () => {
    expect(crc32(Buffer.from("123456789"))).toBe(0xcbf43926);
  });
});

describe("createZip", () => {
  const entries = [
    { name: "B01.png", data: Buffer.from("giả lập bytes ảnh 1") },
    { name: "B02.png", data: Buffer.from("giả lập bytes ảnh 2") },
    { name: "prompts.txt", data: Buffer.from("một\n\nhai\n") },
  ];

  it("bắt đầu bằng chữ ký local header và kết thúc bằng end-of-central", () => {
    const buffer = createZip(entries);
    expect(buffer.readUInt32LE(0)).toBe(0x04034b50);
    expect(buffer.readUInt32LE(buffer.length - 22)).toBe(0x06054b50);
    expect(buffer.readUInt16LE(buffer.length - 14)).toBe(entries.length);
  });

  it("unzip -t của hệ điều hành báo file hợp lệ", () => {
    const target = writeZip("valid.zip", createZip(entries));
    const output = execFileSync("unzip", ["-t", target], { encoding: "utf8" });
    expect(output).toContain("No errors detected");
  });

  it("unzip -l liệt kê đúng tên và kích thước từng file", () => {
    const target = writeZip("listing.zip", createZip(entries));
    const output = execFileSync("unzip", ["-l", target], { encoding: "utf8" });
    for (const entry of entries) {
      expect(output).toContain(entry.name);
      expect(output).toContain(String(entry.data.length));
    }
  });

  it("giải nén ra đúng nội dung từng file, byte khớp byte", () => {
    const target = writeZip("roundtrip.zip", createZip(entries));
    const outDir = path.join(workDir, "extracted");
    execFileSync("unzip", ["-o", "-q", target, "-d", outDir]);
    for (const entry of entries) {
      expect(fs.readFileSync(path.join(outDir, entry.name))).toEqual(entry.data);
    }
  });

  it("giữ nguyên dữ liệu nhị phân, không hỏng byte cao", () => {
    const binary = Buffer.from(
      Array.from({ length: 512 }, (_, index) => index % 256),
    );
    const target = writeZip("binary.zip", createZip([{ name: "b.bin", data: binary }]));
    const outDir = path.join(workDir, "binary-out");
    execFileSync("unzip", ["-o", "-q", target, "-d", outDir]);
    expect(fs.readFileSync(path.join(outDir, "b.bin"))).toEqual(binary);
  });

  it("gói rỗng là end-of-central hợp lệ, unzip coi là rỗng chứ không hỏng", () => {
    const buffer = createZip([]);
    expect(buffer.length).toBe(22);
    expect(buffer.readUInt32LE(0)).toBe(0x06054b50);
    expect(buffer.readUInt16LE(8)).toBe(0);

    // unzip thoát mã 1 với cảnh báo "empty" — khác hẳn "cannot find zipfile
    // directory" của file hỏng. UI chặn xuất gói rỗng nên nhánh này không xảy ra.
    const target = writeZip("empty.zip", buffer);
    try {
      execFileSync("unzip", ["-l", target], { encoding: "utf8", stdio: "pipe" });
      throw new Error("unzip lẽ ra phải cảnh báo gói rỗng");
    } catch (error) {
      const message = String((error as { stderr?: string }).stderr || "");
      expect(message).toContain("zipfile is empty");
    }
  });

  it("thời điểm sửa cố định cho ra byte giống hệt nhau", () => {
    const at = new Date("2026-07-28T10:30:00Z");
    expect(createZip(entries, at)).toEqual(createZip(entries, at));
  });
});
