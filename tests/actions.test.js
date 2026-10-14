// End-to-end: actions.js modes used by the workflow's Run Scripts and Script Filters.
const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const { tempEnv, chatLoop, readChat, runScript } = require("./helpers")

test("actions: new, copy, history, restore, delete, stop, quick", { skip: process.platform !== "darwin" }, async t => {
  const { env } = tempEnv()
  chatLoop("Tell me about tea", env)
  const firstId = readChat(env).id

  await t.test("copy-last and copy-all output without a trailing newline", () => {
    assert.equal(runScript("actions.js", ["copy-last"], env), "Hello from the fake Claude.")
    assert.equal(runScript("actions.js", ["copy-all"], env), "**You:**\n\nTell me about tea\n\n---\n\n**Claude:**\n\nHello from the fake Claude.")
  })

  await t.test("new archives the chat and echoes the question", () => {
    assert.equal(runScript("actions.js", ["new", "  Next question "], env), "Next question")
    assert.equal(readChat(env).messages.length, 0)
    const items = JSON.parse(runScript("actions.js", ["history", ""], env)).items
    assert.equal(items.length, 1)
    assert.equal(items[0].arg, firstId)
    assert.equal(items[0].title, "Tell me about tea")
  })

  await t.test("restore swaps an archived chat back in", () => {
    chatLoop("Coffee?", env)
    runScript("actions.js", ["restore", firstId], env)
    assert.equal(readChat(env).id, firstId)
    const archived = JSON.parse(runScript("actions.js", ["history", ""], env)).items
    assert.deepEqual(archived.map(i => i.title), ["Coffee?"])
  })

  await t.test("delete removes an archived chat", () => {
    const id = JSON.parse(runScript("actions.js", ["history", ""], env)).items[0].arg
    runScript("actions.js", ["delete", id], env)
    assert.equal(JSON.parse(runScript("actions.js", ["history", ""], env)).items[0].valid, false)
  })

  await t.test("stop keeps the partial answer and marks it stopped", () => {
    const hang = Object.assign({}, env, { FAKE_CLAUDE_MODE: "hang" })
    runScript("chat.js", ["Long question"], hang)
    execSleep(1)
    runScript("actions.js", ["stop"], hang)
    const chat = readChat(env)
    assert.equal(chat.messages.at(-1).stopped, true)
    assert.ok(!fs.existsSync(path.join(env.alfred_workflow_cache, "active")))
  })

  await t.test("quick actions read the selected text variable", () => {
    const out = JSON.parse(runScript("actions.js", ["quick", "explain"], Object.assign({}, env, { claude_text: "E = mc^2" })))
    assert.equal(out.items[0].title, "Ask: explain")
    assert.ok(out.items.some(i => i.title === "Explain" && i.arg.includes("E = mc^2")))
  })
})

function execSleep(s) { require("node:child_process").execFileSync("/bin/sleep", [String(s)]) }
