const test = require("node:test")
const assert = require("node:assert/strict")
const { loadLib } = require("./helpers")
const { claudeArgs } = loadLib()

test("claudeArgs builds a subscription-friendly print-mode command", () => {
  const base = claudeArgs({ model: "sonnet", systemPrompt: "Be brief", web: false })
  assert.deepEqual(base.slice(0, 5), ["-p", "--output-format", "stream-json", "--verbose", "--include-partial-messages"])
  assert.ok(!base.includes("--bare"), "--bare skips OAuth, so subscriptions would not work")
  assert.deepEqual(base.slice(base.indexOf("--model"), base.indexOf("--model") + 2), ["--model", "sonnet"])
  assert.deepEqual(base.slice(base.indexOf("--tools"), base.indexOf("--tools") + 2), ["--tools", ""])
  assert.ok(!base.includes("--resume"))

  const web = claudeArgs({ model: "default", web: true, sessionId: "s1" })
  assert.ok(!web.includes("--model"))
  assert.ok(web.includes("WebSearch,WebFetch"))
  assert.deepEqual(web.slice(-2), ["--resume", "s1"])
})
