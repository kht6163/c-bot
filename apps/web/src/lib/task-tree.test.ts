import { describe, expect, test } from "bun:test";
import { countByStatus, laneOf, laneSize, openChildren, ownersOf, taskLanes, visibleTasks } from "./task-tree.ts";
import type { TaskView } from "./api.ts";

function task(id: string, patch: Partial<TaskView> = {}): TaskView {
  return {
    id,
    boardId: "ses_board",
    parentId: null,
    title: id,
    detail: "",
    status: "pending",
    ownerId: "bot_a",
    ownerHandle: "leader",
    requesterId: "bot_a",
    requesterHandle: "leader",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...patch,
  } as TaskView;
}

describe("taskLanes", () => {
  test("hangs subtasks under their job", () => {
    const lanes = taskLanes([
      task("job", { status: "in_progress" }),
      task("piece1", { parentId: "job" }),
      task("piece2", { parentId: "job", status: "completed" }),
    ]);
    expect(lanes.map((lane) => lane.key)).toEqual(["in_progress"]);
    expect(lanes[0]?.nodes).toHaveLength(1);
    expect(lanes[0]?.nodes[0]?.children.map((c) => c.id)).toEqual(["piece1", "piece2"]);
  });

  test("a subtask rides in its parent's lane, not its own", () => {
    const lanes = taskLanes([
      task("job", { status: "pending" }),
      task("piece", { parentId: "job", status: "in_progress" }),
    ]);
    expect(lanes.map((lane) => lane.key)).toEqual(["pending"]);
    expect(lanes[0]?.nodes[0]?.children[0]?.id).toBe("piece");
  });

  test("an orphan subtask stands on its own instead of vanishing", () => {
    const lanes = taskLanes([task("piece", { parentId: "gone" })]);
    expect(lanes[0]?.nodes.map((node) => node.task.id)).toEqual(["piece"]);
  });

  test("a filter that hides the parent promotes the child", () => {
    const all = [
      task("job", { ownerHandle: "leader", status: "in_progress" }),
      task("piece", { parentId: "job", ownerHandle: "worker" }),
    ];
    expect(taskLanes(all, "leader")[0]?.nodes[0]?.children).toEqual([]);
    const filtered = taskLanes(all, "worker");
    expect(filtered.map((lane) => lane.key)).toEqual(["pending"]);
    expect(filtered[0]?.nodes.map((node) => node.task.id)).toEqual(["piece"]);
  });

  test("keeps every task somewhere", () => {
    const all = [
      task("a", { status: "in_progress" }),
      task("b", { parentId: "a" }),
      task("c", { status: "completed" }),
      task("d", { status: "cancelled" }),
    ];
    const seen = taskLanes(all).flatMap((lane) =>
      lane.nodes.flatMap((node) => [node.task.id, ...node.children.map((c) => c.id)]),
    );
    expect(seen.sort()).toEqual(["a", "b", "c", "d"]);
  });

  test("drops empty lanes", () => {
    expect(taskLanes([])).toEqual([]);
  });
});

describe("laneOf", () => {
  test("completed and cancelled both settle in 끝난 일", () => {
    expect(laneOf(task("x", { status: "completed" }))).toBe("done");
    expect(laneOf(task("x", { status: "cancelled" }))).toBe("done");
    expect(laneOf(task("x", { status: "pending" }))).toBe("pending");
    expect(laneOf(task("x", { status: "in_progress" }))).toBe("in_progress");
  });
});

describe("ownersOf and counts", () => {
  test("lists each owner once", () => {
    expect(ownersOf([task("a", { ownerHandle: "b" }), task("c", { ownerHandle: "a" }), task("d", { ownerHandle: "b" })])).toEqual(
      ["a", "b"],
    );
  });

  test("counts unfinished pieces of a job", () => {
    const node = {
      task: task("job"),
      children: [task("x"), task("y", { status: "completed" }), task("z", { status: "in_progress" })],
    };
    expect(openChildren(node)).toBe(2);
    expect(countByStatus([task("a"), task("b", { status: "completed" })], "completed")).toBe(1);
  });
});

describe("laneSize and visibleTasks", () => {
  test("a lane heading counts pieces, not just jobs", () => {
    const lanes = taskLanes([
      task("job", { status: "in_progress" }),
      task("p1", { parentId: "job" }),
      task("p2", { parentId: "job" }),
    ]);
    expect(lanes[0]?.nodes).toHaveLength(1);
    expect(laneSize(lanes[0]!)).toBe(3);
  });

  test("the tally and the lanes read the same filtered set", () => {
    const all = [
      task("job", { ownerHandle: "leader", status: "in_progress" }),
      task("piece", { parentId: "job", ownerHandle: "worker" }),
    ];
    const shown = visibleTasks(all, "worker");
    expect(shown.map((t) => t.id)).toEqual(["piece"]);
    const total = taskLanes(all, "worker").reduce((n, lane) => n + laneSize(lane), 0);
    expect(total).toBe(shown.length);
  });

  test("with no filter the tally is the whole board", () => {
    const all = [task("a"), task("b", { parentId: "a" })];
    expect(visibleTasks(all)).toHaveLength(2);
    expect(taskLanes(all).reduce((n, lane) => n + laneSize(lane), 0)).toBe(2);
  });
});
