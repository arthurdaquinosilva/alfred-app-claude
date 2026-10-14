const test = require("node:test")
const assert = require("node:assert/strict")
const { loadLib } = require("./helpers")
const { historyItems, quickActionItems, QUICK_ACTIONS } = loadLib()

test("history and quick action items for Script Filters", async t => {
  const now = 1_800_000_000_000
  const chats = [
    { id: "a", title: "Old chat", updated: now - 3 * 86400_000, model: "", messages: [{ role: "user", content: "pasta recipe" }, { role: "assistant", content: "Boil water" }] },
    { id: "b", title: "New chat", updated: now - 120_000, model: "opus", messages: [{ role: "user", content: "rust lifetimes" }] },
    { id: "c", title: "Empty", updated: now, messages: [] },
  ]

  await t.test("sorts newest first, skips empty chats", () => {
    const items = historyItems(chats, "", now)
    assert.deepEqual(items.map(i => i.arg), ["b", "a"])
    assert.equal(items[0].subtitle, "2 min ago · 1 message · Opus")
    assert.equal(items[0].mods.cmd.arg, "b")
  })

  await t.test("searches titles and message content", () => {
    assert.deepEqual(historyItems(chats, "WATER", now).map(i => i.arg), ["a"])
    assert.equal(historyItems(chats, "zzz", now)[0].valid, false)
  })

  await t.test("quick actions wrap the source text and offer a custom ask", () => {
    const all = quickActionItems("Some text", "")
    assert.equal(all.length, QUICK_ACTIONS.length)
    assert.match(all[0].arg, /"""\nSome text\n"""$/)

    const custom = quickActionItems("Some text", "sum")
    assert.equal(custom[0].title, "Ask: sum")
    assert.ok(custom.some(i => i.title === "Summarize"))

    assert.equal(quickActionItems("  ", "")[0].valid, false)
  })
})
