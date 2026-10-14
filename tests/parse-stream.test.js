const test = require("node:test")
const assert = require("node:assert/strict")
const { loadLib } = require("./helpers")
const { parseStream } = loadLib()

const line = obj => JSON.stringify(obj)
const delta = text => line({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text } } })

test("parseStream builds text, session and status from stream-json", async t => {
  await t.test("joins text deltas and reads the init event", () => {
    const s = parseStream([
      line({ type: "system", subtype: "init", session_id: "abc", model: "claude-opus-5-5" }),
      delta("Hel"), delta("lo"),
    ].join("\n"))
    assert.equal(s.text, "Hello")
    assert.equal(s.sessionId, "abc")
    assert.equal(s.model, "claude-opus-5-5")
    assert.equal(s.done, false)
  })

  await t.test("ignores an incomplete trailing line", () => {
    const s = parseStream(delta("Hi") + "\n" + '{"type":"stream_ev')
    assert.equal(s.text, "Hi")
  })

  await t.test("reports tool use as a status and separates messages", () => {
    const s1 = parseStream([
      delta("Let me check."),
      line({ type: "stream_event", event: { type: "content_block_start", content_block: { type: "tool_use", name: "WebSearch" } } }),
    ].join("\n"))
    assert.equal(s1.status, "Searching the web…")

    const s2 = parseStream([
      delta("Let me check."),
      line({ type: "stream_event", event: { type: "message_start" } }),
      delta("Found it."),
    ].join("\n"))
    assert.equal(s2.text, "Let me check.\n\nFound it.")
  })

  await t.test("marks success and error results", () => {
    const ok = parseStream([delta("Done"), line({ type: "result", subtype: "success", is_error: false, result: "Done", session_id: "s1" })].join("\n"))
    assert.equal(ok.done, true)
    assert.equal(ok.isError, false)
    assert.equal(ok.sessionId, "s1")

    const bad = parseStream(line({ type: "result", subtype: "success", is_error: true, result: "Not logged in" }))
    assert.equal(bad.isError, true)
    assert.equal(bad.error, "Not logged in")
  })

  await t.test("falls back to whole assistant messages without partials", () => {
    const s = parseStream([
      line({ type: "assistant", message: { content: [{ type: "text", text: "Whole answer" }] } }),
      line({ type: "result", subtype: "success", is_error: false, result: "Whole answer" }),
    ].join("\n"))
    assert.equal(s.text, "Whole answer")
  })
})
