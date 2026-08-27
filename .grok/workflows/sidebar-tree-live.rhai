let meta = #{
    name: "sidebar-tree-live",
    description: "Project-session tree, live thinking row, Hermes-flat restyle",
    when_to_use: "When the left rail or live turn UI needs to match Hermes nested projects",
    phases: [
        #{ title: "Implement", detail: "tree API, thinking rows, sidebar restyle in parallel" },
        #{ title: "Verify", detail: "tests and contract check" },
    ],
};

phase("Implement");

let root = "/Users/hantaekim/project/c-bot";
let rules = "";
rules += "Workspace: " + root + ". Follow AGENTS.md. example-project/ is read-only; copy UX not source trees. ";
rules += "Bun only. Atomic Korean Conventional Commits are NOT yours — do not git commit. ";
rules += "Do not edit files outside your allowed list. Read AGENTS.md before writing. ";
rules += "Korean UI copy: 프로젝트, 세션, 봇, 생각 중, 새 세션. No cute labels. ";

let a1 = "";
a1 += rules;
a1 += "YOU OWN: apps/server/src/routes.ts, apps/server/tests/sessions.test.ts, ";
a1 += "apps/web/src/lib/api.ts, apps/web/src/lib/path.ts, apps/web/src/lib/path.test.ts. ";
a1 += "GOAL: GET /api/sessions returns ALL coding sessions (every workspace), not filtered to current project. ";
a1 += "Empty recents still allowed. POST /api/sessions accepts optional JSON workspace path: if set, resolve dir, rememberProject, create session there; else current project; still 400 if neither. ";
a1 += "createSession(workspace?: string) in api.ts sends that body. ";
a1 += "path.ts: keep folderName, projectPaths, timeAgo. Add projectTree(project, sessions) returning ";
a1 += "{ path, name, sessions }[] — union of current+recents plus any session.workspace not already listed; ";
a1 += "current first; each branch's sessions are that workspace, newest first. ";
a1 += "Tests: GET lists two workspaces at once; POST {workspace} creates there; projectTree grouping. ";
a1 += "Existing tests must still pass. Run: bun test --path-ignore-patterns=example-project. ";
a1 += "Use read_file/grep before edit. Do not touch Sidebar, App, styles, rows.ts.";

let a2 = "";
a2 += rules;
a2 += "YOU OWN: apps/web/src/lib/rows.ts, apps/web/src/lib/rows.test.ts. ";
a2 += "GOAL: while a turn is open the transcript is never silent. ";
a2 += "Add ChatRow | { key, kind: \"status\", text: string, live: true }. ";
a2 += "visibleRows: track turn/start without turn/end as open. ";
a2 += "If an open turn has no live assistant/chunk text yet, append status row key live-status-{turnId} text \"생각 중\". ";
a2 += "If live chunks exist, do not also add the empty status row. ";
a2 += "Tool rows with tool/call and no tool/result: add live: true on the tool ChatRow (default false). ";
a2 += "Existing tests must still pass. Add tests for open turn with only turn/start, and for live chunks suppressing status. ";
a2 += "Do not edit App or CSS.";

let a3 = "";
a3 += rules;
a3 += "YOU OWN: apps/web/src/components/Sidebar.tsx, apps/web/src/App.tsx, apps/web/src/styles.css, AGENTS.md, README.md. ";
a3 += "TREE: left rail is a tree. Each project is a parent; coding sessions nest under that project. ";
a3 += "Clicking a project does NOT replace the session list. It sets cwd (openProject) and expands. ";
a3 += "Clicking a session opens it and sets cwd to session.workspace if needed. ";
a3 += "Do not deselect the open chat just because cwd changed. ";
a3 += "Use projectTree from lib/path.ts (sibling agent adds it — import that API). ";
a3 += "Default expand all branches. Project row + creates a session in THAT path via createSession(path). ";
a3 += "Section + on 프로젝트 opens the folder picker. 봇 stay a separate section below the tree, not nested. ";
a3 += "LIVE: after sendMessage, set busy until events contain turn/end for the open turn. ";
a3 += "If busy and visibleRows has no live assistant/status/tool.live, still show a 생각 중 status in the log. ";
a3 += "Render kind===\"status\" as a scaffold line (muted, aria-live polite, pulsing dots CSS). ";
a3 += "live assistant text gets a caret. Composer disabled while busy; placeholder 생각 중. ";
a3 += "STYLE from hermes-agent apps/desktop DESIGN.md and styles.css tokens, not a costume theme. ";
a3 += "bg #041c1c. --ui-base cream #ffe6cb. text-primary mix 94%, secondary 74%, tertiary 54%, quaternary 36%. ";
a3 += "row hover/active = cream mixed at ~5% like --ui-row-active-background. NO left 2px cream stripe. ";
a3 += "NO uppercase tracking on Korean labels (letter-spacing <= 0.04em). Section label ~11px. ";
a3 += "Row min-height 26px, title 13px. Nested sessions pl 18px. Flat: no boxed tabs, no card-in-card. ";
a3 += "Composer: soft fill mix cream 6%, not underline-only. User bubbles: modest fill, not tiny pills. ";
a3 += "Thinking: conversation-scaffold color mix base 64%. Pulse 1s opacity. ";
a3 += "AGENTS.md: update 웹 UI 계약 — rail is project tree (sessions hang under projects), not 세션/봇 tabs; ";
a3 += "open turn must show 생각 중/streaming; visual follows Hermes flat tokens. ";
a3 += "Add a 워크플로 section: multi-file independent work uses the workflow tool with parallel() agents, disjoint file lists, then the parent integrates; do not serialize independent reads. ";
a3 += "README features/run: left tree, thinking indicator. Do not invent features. ";
a3 += "Read hermes overview-row.tsx nested SidebarRowNest and thread/status.tsx ResponseLoadingIndicator before styling.";

let jobs = [];
jobs.push(#{
    prompt: a1,
    label: "api-tree",
    capability_mode: "all",
    agent_type: "backend-developer",
});
jobs.push(#{
    prompt: a2,
    label: "thinking-rows",
    capability_mode: "all",
    agent_type: "general-purpose",
});
jobs.push(#{
    prompt: a3,
    label: "sidebar-style",
    capability_mode: "all",
    agent_type: "general-purpose",
});
let implemented = parallel(jobs);

phase("Verify");
let v = "";
v += rules;
v += "Read git diff in " + root + " (run_terminal_command git diff). ";
v += "Confirm: GET sessions is unfiltered coding list; Sidebar nests sessions under projects; ";
v += "visibleRows emits 생각 중 for open turns; AGENTS.md has tree + live + workflow parallel rules. ";
v += "Run bun test --path-ignore-patterns=example-project and bun run typecheck. ";
v += "Fix only broken tests/types you caused if they fail, staying in already-touched files. ";
v += "Do not commit.";
let checked = agent(v, #{
    label: "verify",
    capability_mode: "all",
    agent_type: "general-purpose",
});

let ok1 = implemented[0] != () && implemented[0].success;
let ok2 = implemented[1] != () && implemented[1].success;
let ok3 = implemented[2] != () && implemented[2].success;
let okv = checked != () && checked.success;
complete(#{
    api_tree: ok1,
    thinking_rows: ok2,
    sidebar_style: ok3,
    verify: okv,
});
