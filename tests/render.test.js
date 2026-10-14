const test = require("node:test")
const assert = require("node:assert/strict")
const { loadLib } = require("./helpers")
const lib = loadLib()

test("chat rendering, commands and labels", async t => {
  const chat = { messages: [
    { role: "user", content: "Hi" },
    { role: "assistant", content: "Hello!" },
    { role: "user", content: "Again" },
    { role: "assistant", content: "Partial", stopped: true },
  ] }

  await t.test("renders turns with headings and separators", () => {
    const md = lib.renderChat(chat)
    assert.equal(md, "### You\n\nHi\n\n### Claude\n\nHello!\n\n---\n\n### You\n\nAgain\n\n### Claude\n\nPartial\n\n*Stopped*")
  })

  await t.test("pending render ends on an empty Claude heading", () => {
    const md = lib.renderChat({ messages: [{ role: "user", content: "Q" }] }, { pending: true })
    assert.ok(md.endsWith("### Claude\n\n"))
  })

  await t.test("errors render as a quote", () => {
    assert.equal(lib.renderMessage({ role: "assistant", content: "a\nb", error: true }), "### Claude\n\n> a\n> b")
  })

  await t.test("parses slash commands only at the start", () => {
    assert.deepEqual({ ...lib.parseCommand("/model opus") }, { name: "model", arg: "opus" })
    assert.deepEqual({ ...lib.parseCommand("/clear") }, { name: "new", arg: "" })
    assert.deepEqual({ ...lib.parseCommand("/new what is pi?") }, { name: "new", arg: "what is pi?" })
    assert.equal(lib.parseCommand("what does /new do"), null)
    assert.equal(lib.parseCommand("/newsletter ideas"), null)
  })

  await t.test("labels models and titles", () => {
    assert.equal(lib.modelLabel("claude-sonnet-5-5"), "Sonnet 5.5")
    assert.equal(lib.modelLabel("claude-opus-5-20260101"), "Opus 5")
    assert.equal(lib.modelLabel("opus"), "Opus")
    assert.equal(lib.makeTitle("  a\nb  "), "a b")
    assert.equal(lib.makeTitle("x".repeat(80)).length, 58)
  })

  await t.test("copy helpers", () => {
    assert.equal(lib.lastAnswer(chat), "Partial")
    assert.equal(lib.lastAnswer({ messages: [{ role: "assistant", content: "x", error: true }] }), "")
    assert.match(lib.chatToMarkdown(chat), /^\*\*You:\*\*\n\nHi\n\n---\n\n\*\*Claude:\*\*/)
  })

  await t.test("friendly errors point to the fix", () => {
    assert.match(lib.friendlyError("Not logged in · Please run /login", ""), /\/login/)
    assert.match(lib.friendlyError("", "Error: 429 rate_limit"), /Usage limit/)
    assert.match(lib.friendlyError("", "boom"), /```\nboom\n```/)
  })
})
