import { describe, expect, test } from "bun:test";
import { asBotId, asDeliveryId, asToolCallId, asTurnId, type SessionEvent } from "@cbot/shared";
import type { TaskView } from "./api.ts";
import {
  GRAPH_PAD,
  GRAPH_ROW_GAP,
  GRAPH_SLOT_GAP,
  GRAPH_SLOT_H,
  GRAPH_SLOT_W,
  USER_LABEL,
  autoPlacements,
  avatarText,
  curvePoint,
  dragPlacement,
  edgeCurve,
  edgePath,
  flightProgress,
  freshFlights,
  graphLayout,
  handoffCards,
  loadGraphPlacements,
  messageFlights,
  nodeActivity,
  nodeLog,
  nodeTaskLanes,
  parseGraphPlacements,
  placeSlots,
  placedLayout,
  samePlacements,
  saveGraphPlacements,
  slotAnchor,
  stripAttribution,
  tweenPlacements,
} from "./graph.ts";
import type { TeamPane } from "./team.ts";

const lead: TeamPane = { key: "lead", handle: "leader", title: "Lead", role: "lead", sessionId: "ses_code" };
const dev: TeamPane = { key: "bot_dev", handle: "dev", title: "Dev", role: "specialist", sessionId: "ses_dev" };

function at(seq: number, time = "2026-09-11T09:00:00.000Z"): { seq: number; time: string } {
  return { seq, time };
}

function delivery(
  seq: number,
  fromHandle: string,
  id: string,
  time?: string,
): Extract<SessionEvent, { type: "bot/message" }> {
  return {
    ...at(seq, time),
    type: "bot/message",
    deliveryId: asDeliveryId(id),
    fromBotId: asBotId(`bot_${fromHandle}`),
    fromHandle,
    fromTitle: fromHandle,
    text: `Message from 🤖 ${fromHandle} (@${fromHandle}):\n\nplease review`,
  };
}

function task(partial: Partial<TaskView> & Pick<TaskView, "id" | "ownerHandle" | "status">): TaskView {
  return {
    boardId: "ses_code",
    parentId: null,
    title: partial.id,
    detail: "",
    ownerId: `bot_${partial.ownerHandle}`,
    requesterId: "bot_leader",
    requesterHandle: "leader",
    createdAt: "2026-09-11T09:00:00.000Z",
    updatedAt: "2026-09-11T09:00:00.000Z",
    ...partial,
  };
}

describe("nodeActivity", () => {
  test("lists what went through the mailbox, newest first, without the attribution line", () => {
    const turnId = asTurnId("trn_1");
    const events: SessionEvent[] = [
      { ...at(1), type: "user/message", text: "build   it", mentions: [] },
      { ...at(2), type: "turn/start", turnId },
      { ...at(3), type: "assistant/chunk", turnId, text: "on it" },
      { ...at(4), type: "assistant/message", turnId, text: "on it", toolCalls: [] },
      delivery(5, "dev", "dlv_1"),
    ];
    const items = nodeActivity(lead, events);
    expect(items.map((item) => [item.from, item.to, item.text])).toEqual([
      ["@dev", "@leader", "please review"],
      ["@leader", USER_LABEL, "on it"],
      [USER_LABEL, "@leader", "build it"],
    ]);
  });

  test("a specialist's own answer goes to no one in particular", () => {
    const turnId = asTurnId("trn_1");
    const items = nodeActivity(dev, [
      { ...at(1), type: "assistant/message", turnId, text: "done", toolCalls: [] },
      { ...at(2), type: "assistant/message", turnId, text: "   ", toolCalls: [] },
    ]);
    expect(items).toHaveLength(1);
    expect(items[0]?.to).toBe("");
  });

  test("stripAttribution leaves plain text alone", () => {
    expect(stripAttribution("hello")).toBe("hello");
  });
});

describe("nodeLog", () => {
  test("tool calls carry their outcome; ones the turn abandoned read as failed", () => {
    const turnId = asTurnId("trn_1");
    const events: SessionEvent[] = [
      { ...at(1), type: "turn/start", turnId },
      { ...at(2), type: "assistant/thinking", turnId, text: "let me " },
      { ...at(3), type: "assistant/thinking", turnId, text: "look" },
      {
        ...at(4),
        type: "tool/call",
        turnId,
        call: { id: asToolCallId("call_1"), name: "bash", arguments: '{"command":"ls"}', ui: "terminal" },
      },
      { ...at(5), type: "tool/result", turnId, callId: asToolCallId("call_1"), ok: true, content: "a" },
      {
        ...at(6),
        type: "tool/call",
        turnId,
        call: { id: asToolCallId("call_2"), name: "read_file", arguments: '{"path":"x.ts"}', ui: "generic" },
      },
      { ...at(7), type: "turn/end", turnId },
      {
        ...at(8),
        type: "tool/call",
        turnId: asTurnId("trn_2"),
        call: { id: asToolCallId("call_3"), name: "grep", arguments: '{"pattern":"TODO"}', ui: "generic" },
      },
    ];
    expect(nodeLog(events).map((item) => [item.name, item.detail, item.state])).toEqual([
      ["grep", "TODO", "live"],
      ["read_file", "x.ts", "fail"],
      ["bash", "ls", "ok"],
      ["thinking", "let me look", "ok"],
    ]);
  });
});

describe("nodeTaskLanes", () => {
  test("keeps only the bot's own jobs, one lane per status that has any, capped", () => {
    const tasks = [
      task({ id: "a", ownerHandle: "dev", status: "in_progress" }),
      task({ id: "b", ownerHandle: "dev", status: "completed" }),
      task({ id: "c", ownerHandle: "dev", status: "cancelled" }),
      task({ id: "d", ownerHandle: "qa", status: "pending" }),
      ...[1, 2, 3, 4, 5].map((n) => task({ id: `p${n}`, ownerHandle: "dev", status: "pending" })),
    ];
    const lanes = nodeTaskLanes("dev", tasks, 4);
    expect(lanes.map((lane) => [lane.lane, lane.tasks.length, lane.more])).toEqual([
      ["in_progress", 1, 0],
      ["pending", 4, 1],
      ["done", 2, 0],
    ]);
    expect(nodeTaskLanes("nobody", tasks)).toEqual([]);
  });
});

describe("graphLayout", () => {
  test("centres the lead over rows of specialists and sizes the board to fit", () => {
    const layout = graphLayout(
      [
        { key: "lead", w: 352 },
        { key: "a", w: 532 },
        { key: "b", w: 352 },
        { key: "c", w: 352 },
        { key: "d", w: 712 },
      ],
      Number.POSITIVE_INFINITY,
    );
    const row = layout.slots.slice(1, 4);
    const rowWidth = row.reduce((sum, slot) => sum + slot.w, 0) + 2 * GRAPH_SLOT_GAP;
    expect(layout.width).toBe(rowWidth + GRAPH_PAD * 2);
    const leadSlot = layout.slots[0]!;
    expect(leadSlot.x + leadSlot.w / 2).toBeCloseTo(layout.width / 2, 0);
    expect(row.map((slot) => slot.y)).toEqual(Array(3).fill(GRAPH_PAD + GRAPH_SLOT_H + GRAPH_ROW_GAP));
    expect(row[0]!.x).toBe(GRAPH_PAD);
    expect(row[1]!.x).toBe(row[0]!.x + row[0]!.w + GRAPH_SLOT_GAP);
    const last = layout.slots[4]!;
    expect(last.y).toBe(GRAPH_PAD + 2 * (GRAPH_SLOT_H + GRAPH_ROW_GAP));
    expect(last.x + last.w / 2).toBeCloseTo(layout.width / 2, 0);
    expect(layout.height).toBe(last.y + GRAPH_SLOT_H + GRAPH_PAD);
  });

  test("closes a row before it grows past the width cap", () => {
    const wide = 532;
    const layout = graphLayout(
      [
        { key: "lead", w: wide },
        { key: "a", w: wide },
        { key: "b", w: wide },
        { key: "c", w: wide },
      ],
      wide * 2 + GRAPH_SLOT_GAP,
    );
    const [, a, b, c] = layout.slots;
    expect(a!.y).toBe(b!.y);
    expect(c!.y).toBe(a!.y + GRAPH_SLOT_H + GRAPH_ROW_GAP);
    expect(c!.x + c!.w / 2).toBeCloseTo(layout.width / 2, 0);
  });

  test("a lead alone is a one-slot board", () => {
    const layout = graphLayout([{ key: "lead", w: 300 }]);
    expect(layout.slots).toHaveLength(1);
    expect(layout.height).toBe(GRAPH_PAD * 2 + GRAPH_SLOT_H);
    expect(graphLayout([]).slots).toEqual([]);
  });

  test("edges leave the avatar and bow sideways when the target sits straight below", () => {
    const from = slotAnchor({ key: "lead", x: 100, y: 0, w: 200, h: 100 });
    const to = slotAnchor({ key: "a", x: 100, y: 400, w: 200, h: 100 });
    const path = edgePath(from, to, 0);
    expect(path.startsWith(`M ${from.x} ${from.y} C 350`)).toBe(true);
    expect(path.endsWith(`, ${to.x} ${to.y}`)).toBe(true);
    expect(edgePath(from, to, 1)).toContain("C 50");
    expect(edgePath(from, { x: 600, y: 400 }, 0)).toContain(`C ${from.x}`);
  });

  test("a spark rides the same curve the edge draws, from end to end", () => {
    const curve = edgeCurve({ x: 0, y: 0 }, { x: 300, y: 400 });
    expect(curvePoint(curve, 0)).toEqual({ x: 0, y: 0 });
    expect(curvePoint(curve, 1)).toEqual({ x: 300, y: 400 });
    expect(curvePoint(curve, -1)).toEqual({ x: 0, y: 0 });
    const mid = curvePoint(curve, 0.5);
    expect(mid.x).toBeCloseTo(150, 5);
    expect(mid.y).toBeCloseTo(200, 5);
  });

  test("flight progress eases from 0 to 1 and holds at the ends", () => {
    expect(flightProgress(-50, 1000)).toBe(0);
    expect(flightProgress(500, 1000)).toBeCloseTo(0.5, 5);
    expect(flightProgress(100, 1000)).toBeLessThan(0.1);
    expect(flightProgress(1000, 1000)).toBe(1);
    expect(flightProgress(5000, 1000)).toBe(1);
  });
});

describe("placement", () => {
  const slots = (...keys: string[]) => keys.map((key) => ({ key, w: GRAPH_SLOT_W }));

  test("with nothing saved, slots take the auto layout", () => {
    expect(placeSlots(slots("lead", "a", "b"), {})).toEqual(autoPlacements(slots("lead", "a", "b")));
  });

  test("a saved spot wins over the auto layout", () => {
    const saved = { lead: { x: 500, y: 40 }, a: { x: 0, y: 900 } };
    expect(placeSlots(slots("lead", "a"), saved)).toEqual(saved);
  });

  test("a bot that joins later takes its auto spot when free and moves no one", () => {
    const before = autoPlacements(slots("lead", "a"));
    const placed = placeSlots(slots("lead", "a", "b"), before);
    expect(placed.lead).toEqual(before.lead);
    expect(placed.a).toEqual(before.a);
    expect(placed.b).toEqual(autoPlacements(slots("lead", "a", "b")).b);
  });

  test("when its auto spot is taken, a new bot starts a row under everything", () => {
    const tidy = autoPlacements(slots("lead", "a", "b"));
    const saved = { lead: tidy.b!, a: tidy.a! };
    const placed = placeSlots(slots("lead", "a", "b"), saved);
    expect(placed.lead).toEqual(tidy.b);
    expect(placed.b).toEqual({ x: GRAPH_PAD, y: tidy.b!.y + GRAPH_SLOT_H + GRAPH_ROW_GAP });
  });

  test("the board reaches the furthest slot plus the margin", () => {
    const layout = placedLayout(slots("lead", "a"), { lead: { x: 10, y: 20 }, a: { x: 600, y: 500 } });
    expect(layout.width).toBe(600 + GRAPH_SLOT_W + GRAPH_PAD);
    expect(layout.height).toBe(500 + GRAPH_SLOT_H + GRAPH_PAD);
    expect(placedLayout(slots("lead"), {}).slots).toEqual([]);
  });

  test("a dragged slot lands on the grid and stays on the board", () => {
    expect(dragPlacement({ x: 100, y: 100 }, 13, -21)).toEqual({ x: 112, y: 80 });
    expect(dragPlacement({ x: 20, y: 10 }, -200, -50)).toEqual({ x: 0, y: 0 });
  });

  test("auto arrange glides from the current spots to the tidy ones", () => {
    const mid = tweenPlacements({ a: { x: 0, y: 0 } }, { a: { x: 100, y: 50 }, b: { x: 7, y: 7 } }, 0.5);
    expect(mid).toEqual({ a: { x: 50, y: 25 }, b: { x: 7, y: 7 } });
    expect(samePlacements(["a"], { a: { x: 1, y: 2 }, z: { x: 0, y: 0 } }, { a: { x: 1, y: 2 } })).toBe(true);
    expect(samePlacements(["a", "b"], { a: { x: 1, y: 2 } }, { a: { x: 1, y: 2 }, b: { x: 0, y: 0 } })).toBe(false);
  });

  test("the layout is remembered per session and bad entries are dropped", () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
    };
    saveGraphPlacements("ses_1", { lead: { x: 10, y: 20 } }, storage);
    expect(loadGraphPlacements("ses_1", storage)).toEqual({ lead: { x: 10, y: 20 } });
    expect(loadGraphPlacements("ses_2", storage)).toEqual({});
    expect(parseGraphPlacements("{nope")).toEqual({});
    expect(
      parseGraphPlacements(JSON.stringify({ placements: { a: { x: "1", y: 2 }, b: { x: -5.4, y: 3.6 } } })),
    ).toEqual({ b: { x: 0, y: 4 } });
    const refusing = {
      getItem: (): string | null => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    };
    expect(loadGraphPlacements("ses_1", refusing)).toEqual({});
    expect(() => saveGraphPlacements("ses_1", {}, refusing)).not.toThrow();
    expect(loadGraphPlacements("ses_1", undefined)).toEqual({});
  });
});

describe("messageFlights", () => {
  const qa: TeamPane = { key: "bot_qa", handle: "qa", title: "QA", role: "specialist", sessionId: "ses_qa" };

  test("reads each delivery from the receiver's log and names both ends", () => {
    const flights = messageFlights([lead, dev, qa], [delivery(1, "dev", "dlv_reply")], {
      ses_dev: [delivery(1, "leader", "dlv_ask"), delivery(2, "ghost", "dlv_hidden")],
      ses_qa: [delivery(1, "dev", "dlv_peer")],
    });
    expect(flights.map((flight) => [flight.id, flight.from, flight.to])).toEqual([
      ["dlv_reply", "bot_dev", "lead"],
      ["dlv_ask", "lead", "bot_dev"],
      ["dlv_peer", "bot_dev", "bot_qa"],
    ]);
    expect(flights[0]?.label).toBe("please review");
    expect(flights[0]?.preview).toBe("please review");
  });

  test("a job handed to a teammate flies to its owner, and flies back once it is done", () => {
    const change = (
      seq: number,
      action: "add" | "update",
      status: "pending" | "in_progress" | "completed",
      ownerHandle = "dev",
      requesterHandle = "leader",
    ): SessionEvent => ({
      ...at(seq),
      type: "task/change",
      action,
      taskId: "tsk_1",
      title: "write tests",
      status,
      ownerHandle,
      requesterHandle,
    });
    const flights = messageFlights(
      [lead, dev],
      [
        change(1, "add", "pending"),
        change(2, "update", "in_progress"),
        change(3, "update", "completed"),
        change(4, "update", "completed"),
        change(5, "add", "pending", "leader"),
      ],
      {},
    );
    expect(flights.map((flight) => [flight.kind, flight.from, flight.to, flight.label])).toEqual([
      ["task", "lead", "bot_dev", "작업 · write tests"],
      ["task", "bot_dev", "lead", "완료 · write tests"],
    ]);
  });

  test("only unseen, recent deliveries fly", () => {
    const now = Date.parse("2026-09-11T09:00:10.000Z");
    const flights = messageFlights([lead, dev], [], {
      ses_dev: [
        delivery(1, "leader", "dlv_old", "2026-09-11T08:00:00.000Z"),
        delivery(2, "leader", "dlv_seen", "2026-09-11T09:00:05.000Z"),
        delivery(3, "leader", "dlv_new", "2026-09-11T09:00:05.000Z"),
      ],
    });
    expect(freshFlights(flights, new Set(["dlv_seen"]), now).map((flight) => flight.id)).toEqual([
      "dlv_new",
    ]);
  });
});

describe("handoffCards", () => {
  test("keeps only the newest card for each receiver", () => {
    const cards = handoffCards([
      { id: "a", to: "bot_dev", start: 10 },
      { id: "b", to: "bot_dev", start: 30 },
      { id: "c", to: "lead", start: 20 },
    ]);
    expect(cards.map((card) => card.id).sort()).toEqual(["b", "c"]);
  });
});

describe("avatarText", () => {
  test("takes the first and last letter of the handle", () => {
    expect(avatarText("dev-bot")).toBe("DT");
    expect(avatarText("test2")).toBe("T2");
    expect(avatarText("q")).toBe("Q");
    expect(avatarText("--")).toBe("--");
  });
});
