export type PickedFolder =
  | { kind: "path"; path: string }
  | { kind: "hint"; name: string; children: string[] }
  | { kind: "cancelled" };

export function folderFromAbsoluteFile(abs: string, relative: string): string | undefined {
  const normAbs = abs.replace(/\\/g, "/");
  const normRel = relative.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normAbs || !normRel) {
    return undefined;
  }
  const top = normRel.split("/")[0];
  if (!top) {
    return undefined;
  }
  if (normAbs.endsWith(`/${normRel}`) || normAbs === normRel) {
    const root = normAbs.slice(0, Math.max(0, normAbs.length - normRel.length)).replace(/\/+$/, "");
    if (!root) {
      return `/${top}`;
    }
    return `${root}/${top}`;
  }
  return undefined;
}

type DirectoryHandle = {
  name: string;
  entries: () => AsyncIterableIterator<[string, unknown]>;
};

type DirectoryPicker = (options?: { mode?: "read" | "readwrite" }) => Promise<DirectoryHandle>;

export async function pickFolderInBrowser(): Promise<PickedFolder> {
  const picker = (window as Window & { showDirectoryPicker?: DirectoryPicker }).showDirectoryPicker;
  if (typeof picker === "function") {
    try {
      const handle = await picker({ mode: "read" });
      return hintFromDirectoryHandle(handle);
    } catch (err) {
      if (isAbort(err)) {
        return { kind: "cancelled" };
      }
      // Do not fall back to <input webkitdirectory>. That API uploads the
      // whole tree, and macOS/Chrome then claims it is making a copy.
      throw err;
    }
  }
  return pickViaInput();
}

async function hintFromDirectoryHandle(handle: DirectoryHandle): Promise<PickedFolder> {
  const children: string[] = [];
  for await (const [name] of handle.entries()) {
    children.push(name);
    if (children.length >= 40) {
      break;
    }
  }
  return { kind: "hint", name: handle.name, children };
}

function pickViaInput(): Promise<PickedFolder> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.setAttribute("webkitdirectory", "true");
    input.setAttribute("directory", "true");
    input.multiple = true;
    let settled = false;
    const finish = (value: PickedFolder) => {
      if (settled) {
        return;
      }
      settled = true;
      window.removeEventListener("focus", onFocus);
      input.remove();
      resolve(value);
    };
    const onFocus = () => {
      window.setTimeout(() => {
        if (!settled && !input.files?.length) {
          finish({ kind: "cancelled" });
        }
      }, 400);
    };
    input.addEventListener("change", () => {
      const files = input.files;
      if (!files || files.length === 0) {
        finish({ kind: "cancelled" });
        return;
      }
      finish(fromFileList(files));
    });
    window.addEventListener("focus", onFocus);
    input.click();
  });
}

export function fromFileList(files: FileList | File[]): PickedFolder {
  const list = Array.from(files);
  const first = list[0];
  if (!first) {
    return { kind: "cancelled" };
  }
  const rel = first.webkitRelativePath;
  const abs = "path" in first && typeof (first as File & { path?: string }).path === "string"
    ? (first as File & { path?: string }).path ?? ""
    : "";
  if (abs && rel) {
    const path = folderFromAbsoluteFile(abs, rel);
    if (path) {
      return { kind: "path", path };
    }
  }
  const name = rel.replace(/\\/g, "/").split("/")[0] || first.name;
  const children = new Set<string>();
  for (const file of list) {
    const parts = file.webkitRelativePath.replace(/\\/g, "/").split("/");
    if (parts[0] === name && parts[1]) {
      children.add(parts[1]);
    }
  }
  return { kind: "hint", name, children: [...children].slice(0, 40) };
}

function isAbort(err: unknown): boolean {
  return (
    (err instanceof DOMException && err.name === "AbortError") ||
    (err instanceof Error && err.name === "AbortError")
  );
}
