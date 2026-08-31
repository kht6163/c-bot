import { describe, expect, test } from "bun:test";
import { clearQueue, dropQueued, enqueue, queuedFor, type Queues } from "./queue.ts";

const empty: Queues = {};

describe("composer queue", () => {
  test("keeps typing order per session", () => {
    let queues = enqueue(empty, "s1", { id: "a", text: "첫" });
    queues = enqueue(queues, "s1", { id: "b", text: "둘" });
    queues = enqueue(queues, "s2", { id: "c", text: "다른 세션" });
    expect(queuedFor(queues, "s1").map((item) => item.text)).toEqual(["첫", "둘"]);
    expect(queuedFor(queues, "s2").map((item) => item.text)).toEqual(["다른 세션"]);
  });

  test("dropping one leaves the rest in order", () => {
    let queues = enqueue(empty, "s1", { id: "a", text: "첫" });
    queues = enqueue(queues, "s1", { id: "b", text: "둘" });
    queues = enqueue(queues, "s1", { id: "c", text: "셋" });
    queues = dropQueued(queues, "s1", "b");
    expect(queuedFor(queues, "s1").map((item) => item.id)).toEqual(["a", "c"]);
  });

  test("an emptied session leaves no entry behind", () => {
    const queues = dropQueued(enqueue(empty, "s1", { id: "a", text: "첫" }), "s1", "a");
    expect(Object.keys(queues)).toEqual([]);
    expect(queuedFor(queues, "s1")).toEqual([]);
  });

  test("clearing a session leaves other sessions untouched", () => {
    let queues = enqueue(empty, "s1", { id: "a", text: "첫" });
    queues = enqueue(queues, "s2", { id: "b", text: "둘" });
    queues = clearQueue(queues, "s1");
    expect(queuedFor(queues, "s1")).toEqual([]);
    expect(queuedFor(queues, "s2").map((item) => item.id)).toEqual(["b"]);
  });

  test("an unknown session has an empty queue", () => {
    expect(queuedFor(empty, undefined)).toEqual([]);
    expect(queuedFor(empty, "nope")).toEqual([]);
  });
});
