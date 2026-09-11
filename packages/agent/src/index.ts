export { gitDiff, GitDiffError } from "./git-diff.ts";
export {
  WorktreeError,
  addWorktree,
  gitRepoInfo,
  removeWorktree,
  worktreeDirty,
  worktreesDir,
  type AddedWorktree,
  type WorktreeErrorCode,
} from "./git-worktree.ts";
export { sessionReview } from "./session/review.ts";
export {
  CLIPROXYAPI_ID,
  SHIPPED_PROVIDERS,
  THINKING_LEVELS,
  defaultThinking,
  isShippedId,
  looksLikeCliproxy,
  modelsQueryFor,
  sanitizeThinking,
  shippedProvider,
  type ProviderKind,
  type ShippedProvider,
  type ThinkingLevel,
} from "./catalog.ts";
export {
  DEFAULT_CONFIG,
  MAX_PROJECT_RECENTS,
  PROVIDER_ID_RE,
  allowCommand,
  configPath,
  forgetCommand,
  ensureHome,
  keyEnvName,
  loadConfig,
  projectName,
  rememberProject,
  forgetProject,
  removeProvider,
  saveConfig,
  secretsPath,
  sessionsDbPath,
  upsertProvider,
  validateProviderId,
  type AppConfig,
  type LlmProvider,
} from "./config.ts";
export {
  applyEnvFile,
  loadSecrets,
  providerKey,
  resolveLlmEndpoint,
  saveProviderKey,
  type Secrets,
} from "./secrets.ts";
export { SessionStore, type CreateSessionInput } from "./session/store.ts";
export {
  COMPACT_SYSTEM,
  compactSession,
  type CompactInput,
  type CompactResult,
} from "./compact.ts";
export { compactBoundary, contextStart, estimateTokens, historyTokens } from "./context.ts";
export { contentText, deriveMessages, type ChatMessage, type ContentPart } from "./session/derive.ts";
export {
  LlmError,
  OpenAiCompatClient,
  listRemoteModelCatalog,
  listRemoteModels,
  probeLlm,
  refreshProviderThinking,
  type LlmClient,
  type LlmProbeInput,
  type LlmProbeResult,
  type LlmRequest,
  type LlmStreamEvent,
  type RemoteModel,
} from "./llm/client.ts";

export {
  runTurn,
  sessionNeedsTurn,
  titleFromText,
  wokenByBot,
  type AutoCompactPolicy,
  type TransientRetryPolicy,
  type TurnContext,
} from "./loop.ts";
export { CODING_SYSTEM_PROMPT, codingSystemPrompt } from "./prompt.ts";
export { ApprovalGate } from "./approval.ts";
export { CODING_TOOLS, findTool } from "./tools/registry.ts";
export { schemaOf, type ToolContext, type ToolDefinition, type ToolSchema } from "./tools/types.ts";
export { isInsideWorkspace, resolveWorkspacePath } from "./tools/path.ts";
export { loadMentionedFiles, searchWorkspaceFiles } from "./workspace-files.ts";
export {
  IMAGE_EDGE_LIMIT,
  attachableImageMime,
  encodeImageForModel,
  loadMentionedImages,
  type EncodedImage,
} from "./images.ts";
export {
  gitCommit,
  gitStatus,
  gitView,
  isCommitSha,
  parseGitNumstat,
  parseGitShow,
  parseGitLog,
  parseGitRefs,
  parseGitStatus,
  type GitCommit,
  type GitCommitDetail,
  type GitCommitFile,
  type GitFile,
  type GitRef,
  type GitRefKind,
  type GitStatusView,
  type GitView,
} from "./git-status.ts";
export {
  imageMime,
  listWorkspaceDir,
  readWorkspaceImage,
  readWorkspacePreview,
  type DirEntryView,
  type FilePreview,
  type RawImage,
} from "./workspace-inspect.ts";
