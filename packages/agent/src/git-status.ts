export interface GitFile {
  path: string;
  index: string;
  worktree: string;
  label: string;
}

export interface GitStatusView {
  repo: boolean;
  branch: string;
  upstream: string | null;
  ahead: number;
  behind: number;
  files: GitFile[];
}

export function parseGitStatus(out: string): Omit<GitStatusView, "repo"> {
  const files: GitFile[] = [];
  let branch = "";
  let upstream: string | null = null;
  let ahead = 0;
  let behind = 0;
  for (const line of out.split("\n")) {
    if (line.length === 0) {
      continue;
    }
    if (line.startsWith("## ")) {
      const rest = line.slice(3);
      ahead = Number(/\[ahead (\d+)/.exec(rest)?.[1] ?? 0);
      behind = Number(/behind (\d+)/.exec(rest)?.[1] ?? 0);
      const noMeta = rest.replace(/\s*\[.*$/, "").trim();
      const parts = noMeta.split("...");
      branch = parts[0] ?? "";
      upstream = parts[1] && parts[1].length > 0 ? parts[1] : null;
      continue;
    }
    const index = line[0] ?? " ";
    const worktree = line[1] ?? " ";
    const path = line.slice(3);
    if (path.length === 0) {
      continue;
    }
    files.push({ path, index, worktree, label: gitLabel(index, worktree) });
  }
  return { branch, upstream, ahead, behind, files };
}

export async function gitStatus(workspace: string): Promise<GitStatusView> {
  const proc = Bun.spawn(["git", "status", "--porcelain=v1", "-b"], {
    cwd: workspace,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, , code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) {
    return { repo: false, branch: "", upstream: null, ahead: 0, behind: 0, files: [] };
  }
  return { repo: true, ...parseGitStatus(stdout) };
}

function gitLabel(index: string, worktree: string): string {
  const code = `${index}${worktree}`;
  if (code === "??") {
    return "추적 안 함";
  }
  if (index === "A" || worktree === "A") {
    return "추가";
  }
  if (index === "D" || worktree === "D") {
    return "삭제";
  }
  if (index === "R" || worktree === "R") {
    return "이름 변경";
  }
  if (index === "M" || worktree === "M") {
    return "수정";
  }
  return code.trim() || "변경";
}
