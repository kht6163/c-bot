import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { asBotId } from "@cbot/shared";
import { MemoryStore } from "../src/memory-store.ts";

describe("MemoryStore", () => {
  test("stores entries per bot and finds two-character korean by bm25", async () => {
    const home = await mkdtemp(join(tmpdir(), "cbot-mem-"));
    const store = await MemoryStore.open(home, asBotId("bot_a"));
    store.create({ title: "세션 계약", body: "세션 로그가 진실이다. 모델이 본 입력은 로그에 남긴다." });
    store.create({ title: "영어", body: "workspace path must stay inside the project folder" });
    const korean = store.search("세션");
    expect(korean.some((item) => item.title === "세션 계약")).toBe(true);
    const latin = store.search("workspace");
    expect(latin.some((item) => item.title === "영어")).toBe(true);
    expect(store.search("일본")).toEqual([]);
    store.close();
  });

  test("updates and removes without leaking the old text", async () => {
    const home = await mkdtemp(join(tmpdir(), "cbot-memu-"));
    const store = await MemoryStore.open(home, asBotId("bot_a"));
    const created = store.create({ title: "옛 이름", body: "지울 내용 알파" });
    store.update(created.id, { title: "새 이름", body: "남을 내용 베타" });
    expect(store.search("알파")).toEqual([]);
    expect(store.search("베타")[0]?.title).toBe("새 이름");
    expect(store.remove(created.id)).toBe(true);
    expect(store.list()).toEqual([]);
    store.close();
  });
});
