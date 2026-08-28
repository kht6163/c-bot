export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
  missing?: boolean;
}

export type CommandRunner = (cmd: string, args: string[]) => Promise<CommandResult>;

export async function pickNativeDirectory(
  platform: NodeJS.Platform = process.platform,
  run: CommandRunner = runCommand,
): Promise<string | null> {
  if (platform === "darwin") {
    const result = await run("osascript", [
      "-e",
      'set selectedFolder to choose folder with prompt "프로젝트 폴더"',
      "-e",
      "POSIX path of selectedFolder",
    ]);
    if (result.missing) {
      throw new Error("native folder picker unavailable");
    }
    if (result.code !== 0) {
      if (/(?:User canceled|-128)/i.test(result.stderr)) {
        return null;
      }
      throw new Error(result.stderr.trim() || "folder picker failed");
    }
    return normalizePicked(result.stdout);
  }

  if (platform === "win32") {
    const result = await run("powershell.exe", ["-NoProfile", "-STA", "-Command", WIN32_PICK]);
    if (result.missing) {
      throw new Error("native folder picker unavailable");
    }
    if (result.code !== 0) {
      throw new Error(result.stderr.trim() || "folder picker failed");
    }
    return normalizePicked(result.stdout);
  }

  if (platform === "linux") {
    const zenity = await run("zenity", [
      "--file-selection",
      "--directory",
      "--title=프로젝트 폴더",
    ]);
    if (!zenity.missing) {
      if (zenity.code === 1) {
        return null;
      }
      if (zenity.code !== 0) {
        throw new Error(zenity.stderr.trim() || "folder picker failed");
      }
      return normalizePicked(zenity.stdout);
    }
    const kdialog = await run("kdialog", ["--getexistingdirectory", ".", "--title", "프로젝트 폴더"]);
    if (kdialog.missing) {
      throw new Error("native folder picker unavailable");
    }
    if (kdialog.code === 1) {
      return null;
    }
    if (kdialog.code !== 0) {
      throw new Error(kdialog.stderr.trim() || "folder picker failed");
    }
    return normalizePicked(kdialog.stdout);
  }

  throw new Error(`native folder picker unavailable on ${platform}`);
}

const WIN32_PICK = `
Add-Type -AssemblyName System.Windows.Forms
$d = New-Object System.Windows.Forms.FolderBrowserDialog
$d.Description = "프로젝트 폴더"
$d.ShowNewFolderButton = $false
if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
  [Console]::Out.Write($d.SelectedPath)
}
`.trim();

function normalizePicked(stdout: string): string | null {
  const raw = stdout.replace(/[\r\n]+$/g, "").trim();
  if (!raw) {
    return null;
  }
  if (/^[A-Za-z]:\\$/.test(raw) || raw === "/") {
    return raw;
  }
  return raw.replace(/[/\\]+$/, "");
}

async function runCommand(cmd: string, args: string[]): Promise<CommandResult> {
  try {
    const proc = Bun.spawn([cmd, ...args], { stdout: "pipe", stderr: "pipe", stdin: "ignore" });
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { code, stdout, stderr };
  } catch (err) {
    const code = typeof err === "object" && err !== null && "code" in err ? (err as { code?: unknown }).code : undefined;
    if (code === "ENOENT") {
      return { code: 127, stdout: "", stderr: "", missing: true };
    }
    throw err;
  }
}
