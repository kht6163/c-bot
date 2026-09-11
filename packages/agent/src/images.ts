import { readFile, stat } from "node:fs/promises";
import sharp from "sharp";
import type { AttachedImage } from "@cbot/shared";
import { resolveWorkspacePath } from "./tools/path.ts";
import { imageMime } from "./workspace-inspect.ts";

/** Each edge of what the model sees stays below this many pixels. */
export const IMAGE_EDGE_LIMIT = 2000;
/** A source file above this is not even decoded. */
export const IMAGE_SOURCE_CAP = 32 * 1024 * 1024;
/** Pictures one message may carry; the rest of the mentions are ignored. */
export const IMAGES_PER_MESSAGE = 8;

/** Formats chat APIs accept as image parts. Everything else is rasterized to PNG. */
const WIRE_FORMATS = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
/** Formats sharp can decode here; bmp and ico are not among them. */
const DECODABLE = new Set([...WIRE_FORMATS, "image/svg+xml", "image/avif"]);

/** The MIME of a file that can be attached as a picture, or undefined. */
export function attachableImageMime(path: string): string | undefined {
  const mime = imageMime(path);
  return mime && DECODABLE.has(mime) ? mime : undefined;
}

export interface EncodedImage {
  mime: string;
  data: string;
  width: number;
  height: number;
}

/**
 * Re-encodes a picture for the model: shrunk to fit inside the edge limit
 * (never enlarged) and in a wire format. Bytes that already fit pass through
 * untouched so a small PNG stays byte-identical.
 */
export async function encodeImageForModel(bytes: Uint8Array, mime: string): Promise<EncodedImage> {
  const meta = await sharp(bytes).metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  const fits = width < IMAGE_EDGE_LIMIT && height < IMAGE_EDGE_LIMIT;
  if (fits && WIRE_FORMATS.has(mime)) {
    return { mime, data: Buffer.from(bytes).toString("base64"), width, height };
  }
  const outMime = WIRE_FORMATS.has(mime) ? mime : "image/png";
  let pipeline = sharp(bytes, { animated: false });
  if (!fits) {
    pipeline = pipeline.resize({
      width: IMAGE_EDGE_LIMIT - 1,
      height: IMAGE_EDGE_LIMIT - 1,
      fit: "inside",
      withoutEnlargement: true,
    });
  }
  const { data, info } = await pipeline.toFormat(formatOf(outMime)).toBuffer({ resolveWithObject: true });
  return { mime: outMime, data: data.toString("base64"), width: info.width, height: info.height };
}

function formatOf(mime: string): "png" | "jpeg" | "gif" | "webp" {
  switch (mime) {
    case "image/jpeg":
      return "jpeg";
    case "image/gif":
      return "gif";
    case "image/webp":
      return "webp";
    default:
      return "png";
  }
}

/** Pictures the user pointed at with `@path`, in mention order, ready for the model. */
export async function loadMentionedImages(
  workspace: string,
  tokens: readonly string[],
  skip: ReadonlySet<string>,
): Promise<AttachedImage[]> {
  const images: AttachedImage[] = [];
  const seen = new Set<string>();
  for (const token of tokens) {
    if (images.length >= IMAGES_PER_MESSAGE) {
      break;
    }
    const mime = attachableImageMime(token);
    if (skip.has(token) || !mime || seen.has(token)) {
      continue;
    }
    seen.add(token);
    try {
      const abs = resolveWorkspacePath(workspace, token);
      const info = await stat(abs);
      if (!info.isFile() || info.size > IMAGE_SOURCE_CAP) {
        continue;
      }
      const encoded = await encodeImageForModel(new Uint8Array(await readFile(abs)), mime);
      images.push({ path: token.replace(/\\/g, "/"), ...encoded });
    } catch {
      // an unreadable or undecodable picture is left out, like a missing text file
      continue;
    }
  }
  return images;
}
