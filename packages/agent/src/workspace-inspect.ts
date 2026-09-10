import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { SKIP_DIR_NAMES } from "./tools/search.ts";
import { resolveWorkspacePath } from "./tools/path.ts";

const FILE_CAP = 512 * 1024;
/** Images are served whole to the browser, so the ceiling is what a preview can bear, not a text cap. */
const IMAGE_CAP = 16 * 1024 * 1024;
const BINARY_NAME = /\.(png|jpe?g|gif|webp|pdf|zip|gz|woff2?|exe|dylib|so|bin|ico|wasm)$/i;

const IMAGE_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  bmp: "image/bmp",
  ico: "image/x-icon",
  svg: "image/svg+xml",
};

/** The MIME type a browser can show inline for this path, or undefined for anything else. */
export function imageMime(path: string): string | undefined {
  const ext = /\.([a-z0-9]+)$/i.exec(path)?.[1]?.toLowerCase();
  return ext ? IMAGE_MIME[ext] : undefined;
}

export interface DirEntryView {
  name: string;
  path: string;
  kind: "file" | "dir";
}

export interface FilePreview {
  path: string;
  /** `image` carries no bytes: the browser fetches them from the raw route. */
  kind: "text" | "image" | "binary" | "missing";
  text: string;
  bytes: number;
}

export async function listWorkspaceDir(workspace: string, rel: string): Promise<DirEntryView[]> {
  const abs = resolveWorkspacePath(workspace, rel);
  const info = await stat(abs);
  if (!info.isDirectory()) {
    throw new Error("not a directory");
  }
  const names = await readdir(abs);
  const entries: DirEntryView[] = [];
  for (const name of names.sort((a, b) => a.localeCompare(b))) {
    if (SKIP_DIR_NAMES.has(name) || name === "." || name === "..") {
      continue;
    }
    const child = join(abs, name);
    const childInfo = await stat(child).catch(() => null);
    if (!childInfo) {
      continue;
    }
    const kind = childInfo.isDirectory() ? "dir" : "file";
    const path = relative(workspace, child).replaceAll("\\", "/") || ".";
    entries.push({ name, path, kind });
  }
  entries.sort((a, b) => Number(a.kind !== "dir") - Number(b.kind !== "dir") || a.name.localeCompare(b.name));
  return entries;
}

export async function readWorkspacePreview(workspace: string, rel: string): Promise<FilePreview> {
  const abs = resolveWorkspacePath(workspace, rel);
  const path = relative(workspace, abs).replaceAll("\\", "/") || rel;
  const info = await stat(abs).catch(() => null);
  if (!info || !info.isFile()) {
    return { path, kind: "missing", text: "", bytes: 0 };
  }
  if (imageMime(path) && info.size <= IMAGE_CAP) {
    return { path, kind: "image", text: "", bytes: info.size };
  }
  if (BINARY_NAME.test(path) || info.size > FILE_CAP) {
    return { path, kind: "binary", text: "", bytes: info.size };
  }
  const buf = await readFile(abs);
  if (buf.includes(0)) {
    return { path, kind: "binary", text: "", bytes: buf.byteLength };
  }
  return { path, kind: "text", text: buf.toString("utf8"), bytes: buf.byteLength };
}

export interface RawImage {
  mime: string;
  bytes: Uint8Array;
}

/** The bytes of an image inside the workspace, or undefined when the path is not a previewable image. */
export async function readWorkspaceImage(workspace: string, rel: string): Promise<RawImage | undefined> {
  const abs = resolveWorkspacePath(workspace, rel);
  const mime = imageMime(abs);
  if (!mime) {
    return undefined;
  }
  const info = await stat(abs).catch(() => null);
  if (!info || !info.isFile() || info.size > IMAGE_CAP) {
    return undefined;
  }
  return { mime, bytes: new Uint8Array(await readFile(abs)) };
}
