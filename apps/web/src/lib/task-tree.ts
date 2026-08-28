import type { TaskView } from "./api.ts";

export type Lane = "in_progress" | "pending" | "done";

export interface TaskNode {
  task: TaskView;
  children: TaskView[];
}

export interface TaskLane {
  key: Lane;
  label: string;
  nodes: TaskNode[];
}

const LANES: { key: Lane; label: string }[] = [
  { key: "in_progress", label: "진행 중" },
  { key: "pending", label: "대기" },
  { key: "done", label: "끝난 일" },
];

export function laneOf(task: TaskView): Lane {
  if (task.status === "in_progress") {
    return "in_progress";
  }
  return task.status === "pending" ? "pending" : "done";
}

/**
 * The board is two levels deep, and a lane is chosen by the parent: the job is
 * the unit of work, its subtasks are the breakdown and ride along with it. A
 * subtask whose parent is filtered out — or gone — stands on its own rather
 * than disappearing.
 */
export function taskLanes(tasks: readonly TaskView[], ownerFilter = ""): TaskLane[] {
  const visible = visibleTasks(tasks, ownerFilter);
  const shown = new Set(visible.map((task) => task.id));
  const childrenOf = new Map<string, TaskView[]>();
  const roots: TaskView[] = [];

  for (const task of visible) {
    if (task.parentId && shown.has(task.parentId)) {
      const group = childrenOf.get(task.parentId);
      if (group) {
        group.push(task);
      } else {
        childrenOf.set(task.parentId, [task]);
      }
    } else {
      roots.push(task);
    }
  }

  return LANES.map((lane) => ({
    ...lane,
    nodes: roots
      .filter((task) => laneOf(task) === lane.key)
      .map((task) => ({ task, children: childrenOf.get(task.id) ?? [] })),
  })).filter((lane) => lane.nodes.length > 0);
}

/** The one filter, shared so the tally and the lanes can never disagree. */
export function visibleTasks(tasks: readonly TaskView[], ownerFilter = ""): readonly TaskView[] {
  return ownerFilter ? tasks.filter((task) => task.ownerHandle === ownerFilter) : tasks;
}

/** Counts pieces too, so a lane heading matches the tally above it. */
export function laneSize(lane: TaskLane): number {
  return lane.nodes.reduce((total, node) => total + 1 + node.children.length, 0);
}

/** Owners come from the board itself, so a bot with no work gets no chip. */
export function ownersOf(tasks: readonly TaskView[]): string[] {
  return [...new Set(tasks.map((task) => task.ownerHandle))].sort();
}

export function countByStatus(tasks: readonly TaskView[], status: TaskView["status"]): number {
  return tasks.filter((task) => task.status === status).length;
}

/** How much of a job is left, counting the job itself only when it has no pieces. */
export function openChildren(node: TaskNode): number {
  return node.children.filter((child) => laneOf(child) !== "done").length;
}
