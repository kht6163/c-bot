import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import sharp from "sharp";
import { deriveMessages, contentText } from "../src/session/derive.ts";
import { historyTokens } from "../src/context.ts";
import { IMAGE_EDGE_LIMIT, encodeImageForModel, loadMentionedImages } from "../src/images.ts";
import { readFileTool } from "../src/tools/fs.ts";

async function solid(width: number, height: number, format: "png" | "webp" | "jpeg"): Promise<Uint8Array> {
  const buf = await sharp({ create: { width, height, channels: 3, background: "#3366cc" } })
    .toFormat(format)
    .toBuffer();
  return new Uint8Array(buf);
}

async function dims(base64: string): Promise<{ width?: number; height?: number; format?: string }> {
  const meta = await sharp(Buffer.from(base64, "base64")).metadata();
  return { width: meta.width, height: meta.height, format: meta.format };
}

describe("encodeImageForModel", () => {
  test("a picture that fits passes through byte for byte", async () => {
    const png = await solid(640, 480, "png");
    const out = await encodeImageForModel(png, "image/png");
    expect(out).toMatchObject({ mime: "image/png", width: 640, height: 480 });
    expect(Buffer.from(out.data, "base64")).toEqual(Buffer.from(png));
  });

  test("every edge ends up below the limit, in the same format, keeping the aspect", async () => {
    const wide = await solid(2400, 1200, "webp");
    const out = await encodeImageForModel(wide, "image/webp");
    expect(out.width).toBeLessThan(IMAGE_EDGE_LIMIT);
    expect(out.height).toBeLessThan(IMAGE_EDGE_LIMIT);
    expect(out.width / out.height).toBeCloseTo(2, 1);
    expect(await dims(out.data)).toMatchObject({ width: out.width, height: out.height, format: "webp" });

    const tall = await solid(1000, 2000, "jpeg");
    const tallOut = await encodeImageForModel(tall, "image/jpeg");
    expect(tallOut.height).toBe(IMAGE_EDGE_LIMIT - 1);
    expect(tallOut.width).toBeLessThan(1000);
  });

  test("svg is rasterized to png so the wire format is one a chat API accepts", async () => {
    const svg = new TextEncoder().encode(
      '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200"><rect width="300" height="200" fill="red"/></svg>',
    );
    const out = await encodeImageForModel(svg, "image/svg+xml");
    expect(out.mime).toBe("image/png");
    expect(await dims(out.data)).toMatchObject({ width: 300, height: 200, format: "png" });
  });
});

describe("loadMentionedImages", () => {
  test("attaches mentioned pictures once each and leaves text, handles, and strangers out", async () => {
    const root = await mkdtemp(join(tmpdir(), "cbot-images-"));
    await Bun.write(join(root, "shot.png"), await solid(20, 10, "png"));
    await Bun.write(join(root, "notes.txt"), "text");
    await Bun.write(join(root, "broken.png"), "not a picture");
    const images = await loadMentionedImages(
      root,
      ["shot.png", "shot.png", "notes.txt", "broken.png", "missing.webp", "leader"],
      new Set(["leader"]),
    );
    expect(images.map((image) => image.path)).toEqual(["shot.png"]);
    expect(images[0]).toMatchObject({ mime: "image/png", width: 20, height: 10 });
    expect(images[0]?.data.length).toBeGreaterThan(0);
  });

  test("a picture outside the workspace is not attached", async () => {
    const root = await mkdtemp(join(tmpdir(), "cbot-images-"));
    const outside = await mkdtemp(join(tmpdir(), "cbot-images-out-"));
    await Bun.write(join(outside, "leak.png"), await solid(4, 4, "png"));
    expect(await loadMentionedImages(root, [join(outside, "leak.png")], new Set())).toEqual([]);
  });
});

describe("images in model history", () => {
  test("a user message with pictures becomes text plus image_url parts, and the estimate charges for them", () => {
    const messages = deriveMessages([
      {
        seq: 1,
        time: "2026-01-01T00:00:00.000Z",
        type: "user/message",
        text: "이 그림 뭐야",
        mentions: [],
        images: [{ path: "a.webp", mime: "image/webp", data: "AAAA", width: 2, height: 2 }],
      },
    ]);
    const content = messages[0]?.content;
    expect(Array.isArray(content)).toBe(true);
    if (!Array.isArray(content)) throw new Error("parts expected");
    expect(content[0]).toEqual({ type: "text", text: "이 그림 뭐야\n\nAttached image: `a.webp`" });
    expect(content[1]).toEqual({ type: "image_url", image_url: { url: "data:image/webp;base64,AAAA" } });
    expect(contentText(content)).toContain("이 그림 뭐야");
    const withPicture = historyTokens(messages);
    const withoutPicture = historyTokens([{ role: "user", content: contentText(content) }]);
    expect(withPicture).toBeGreaterThan(withoutPicture + 1000);
  });
});

describe("read_file and pictures", () => {
  test("refuses an image with a hint to attach it, and refuses NUL bytes", async () => {
    const root = await mkdtemp(join(tmpdir(), "cbot-read-"));
    await Bun.write(join(root, "shot.webp"), await solid(4, 4, "webp"));
    await Bun.write(join(root, "blob.dat"), new Uint8Array([1, 0, 2]));
    const ctx = { workspace: root, approvalMode: "allow" as const };
    await expect(readFileTool.execute({ path: "shot.webp" }, ctx)).rejects.toThrow("@shot.webp");
    await expect(readFileTool.execute({ path: "blob.dat" }, ctx)).rejects.toThrow("binary");
  });
});
