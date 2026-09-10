import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { imageMime, readWorkspaceImage, readWorkspacePreview } from "../src/workspace-inspect.ts";

const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);

describe("workspace image preview", () => {
  test("an image file previews as image and serves its bytes with the right MIME", async () => {
    const root = await mkdtemp(join(tmpdir(), "cbot-inspect-"));
    await Bun.write(join(root, "다운로드.webp"), WEBP);
    const preview = await readWorkspacePreview(root, "다운로드.webp");
    expect(preview.kind).toBe("image");
    expect(preview.bytes).toBe(WEBP.byteLength);
    const raw = await readWorkspaceImage(root, "다운로드.webp");
    expect(raw?.mime).toBe("image/webp");
    expect(raw?.bytes).toEqual(WEBP);
  });

  test("text and archives are not images", async () => {
    const root = await mkdtemp(join(tmpdir(), "cbot-inspect-"));
    await Bun.write(join(root, "notes.txt"), "hello");
    await Bun.write(join(root, "bundle.zip"), "PK");
    expect((await readWorkspacePreview(root, "notes.txt")).kind).toBe("text");
    expect((await readWorkspacePreview(root, "bundle.zip")).kind).toBe("binary");
    expect(await readWorkspaceImage(root, "notes.txt")).toBeUndefined();
    expect(await readWorkspaceImage(root, "missing.png")).toBeUndefined();
    expect(imageMime("photo.JPG")).toBe("image/jpeg");
    expect(imageMime("photo.jpg.txt")).toBeUndefined();
  });

  test("a path outside the workspace is refused", async () => {
    const root = await mkdtemp(join(tmpdir(), "cbot-inspect-"));
    await expect(readWorkspaceImage(root, "../escape.png")).rejects.toThrow("path escapes workspace");
  });
});
