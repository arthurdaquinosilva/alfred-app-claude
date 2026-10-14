// End-to-end: drive chat.js through osascript with a fake `claude` binary.
const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const { tempEnv, chatLoop, readChat, runScript } = require("./helpers")

test("Text View chat streams, resumes sessions and handles failures", { skip: process.platform !== "darwin" }, async t => {
  await t.test("empty chat shows the welcome screen", () => {
    const { env } = tempEnv()
    const res = JSON.parse(runScript("chat.js", [""], env))
    assert.match(res.response, /^## Claude/)
    assert.equal(res.rerun, undefined)
  })

  await t.test("streams an answer and remembers the session", () => {
    const { env } = tempEnv({ FAKE_CLAUDE_DELAY: "0.3" })
    const steps = chatLoop("What is up?", env)
    assert.match(steps[0].response, /### You\n\nWhat is up\?\n\n### Claude\n\n$/)
    assert.equal(steps[1].behaviour.response, "append")
    assert.ok(steps.some(s => s.behaviour.response === "replacelast" && s.rerun && /^Hello/.test(s.response)), "shows partial text while streaming")
    const last = steps.at(-1)
    assert.equal(last.response, "Hello from the fake Claude.")
    assert.match(last.footer, /^Sonnet 5\.5 · /)

    const chat = readChat(env)
    assert.equal(chat.title, "What is up?")
    assert.equal(chat.session_id, "11111111-2222-3333-4444-555555555555")
    assert.deepEqual(chat.messages.map(m => m.role), ["user", "assistant"])
    assert.equal(fs.readFileSync(env.FAKE_CLAUDE_LOG + ".stdin", "utf8"), "What is up?")
    assert.ok(!fs.existsSync(path.join(env.alfred_workflow_cache, "active")), "clears the active run")
    assert.deepEqual(fs.readdirSync(path.join(env.alfred_workflow_cache, "runs")), [], "moves finished runs out")

    chatLoop("And then?", env)
    const args = fs.readFileSync(env.FAKE_CLAUDE_LOG + ".args", "utf8").split("\n")
    assert.equal(args[args.indexOf("--resume") + 1], "11111111-2222-3333-4444-555555555555")
    assert.equal(readChat(env).messages.length, 4)
  })

  await t.test("a lingering previous run can't end the next answer early", () => {
    const { env } = tempEnv({ FAKE_CLAUDE_LINGER: "1.5" })
    chatLoop("one", env)
    const second = chatLoop("two", env)
    assert.equal(second.at(-1).response, "Hello from the fake Claude.")
  })

  await t.test("never passes an API key so the subscription login is used", () => {
    const { env } = tempEnv({ ANTHROPIC_API_KEY: "sk-should-not-leak" })
    fs.writeFileSync(env.FAKE_CLAUDE_LOG + ".env-probe", "")
    chatLoop("hi", Object.assign({}, env, { FAKE_CLAUDE_MODE: "ok" }))
    // The fake records its args; check the environment through a second fake run
    const out = runScriptEnvProbe(env)
    assert.equal(out, "unset")
  })

  await t.test("shows sign-in help when Claude Code is logged out", () => {
    const { env } = tempEnv({ FAKE_CLAUDE_MODE: "auth" })
    const last = chatLoop("hi", env).at(-1)
    assert.match(last.response, /isn't signed in/)
    assert.equal(readChat(env).messages[1].error, true)
  })

  await t.test("shows stderr when Claude Code crashes", () => {
    const { env } = tempEnv({ FAKE_CLAUDE_MODE: "crash" })
    assert.match(chatLoop("hi", env).at(-1).response, /boom: something exploded/)
  })

  await t.test("explains how to install when claude is missing", () => {
    const { env } = tempEnv({ claude_path: "/nonexistent/claude", HOME: "/nonexistent-home", PATH: "/usr/bin:/bin" })
    const res = JSON.parse(runScript("chat.js", ["hi"], env))
    assert.match(res.response, /Claude Code not found/)
    assert.equal(res.rerun, undefined)
  })

  await t.test("/model and /new commands", () => {
    const { env } = tempEnv()
    chatLoop("first", env)
    const switched = JSON.parse(runScript("chat.js", ["/model opus"], env))
    assert.match(switched.footer, /Switched to Opus/)
    assert.equal(readChat(env).model, "opus")

    const fresh = JSON.parse(runScript("chat.js", ["/new"], env))
    assert.match(fresh.response, /^## Claude/)
    assert.equal(readChat(env).messages.length, 0)
    assert.equal(fs.readdirSync(path.join(env.alfred_workflow_data, "archive")).length, 1)
  })
})

// Run the real launcher against a probe binary that reports ANTHROPIC_API_KEY
function runScriptEnvProbe(env) {
  const probe = path.join(path.dirname(env.FAKE_CLAUDE_LOG), "probe-claude")
  const marker = env.FAKE_CLAUDE_LOG + ".key"
  fs.writeFileSync(probe, `#!/bin/bash\ncat >/dev/null\necho "\${ANTHROPIC_API_KEY:-unset}" > "${marker}"\necho '{"type":"result","subtype":"success","is_error":false,"result":"ok"}'\n`, { mode: 0o755 })
  chatLoop("probe", Object.assign({}, env, { claude_path: probe }))
  return fs.readFileSync(marker, "utf8").trim()
}
