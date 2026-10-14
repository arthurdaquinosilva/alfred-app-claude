// Shared test helpers: load lib.js's pure functions into Node, and drive the
// JXA scripts through osascript like Alfred does.
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const vm = require("node:vm")
const { execFileSync } = require("node:child_process")

const ROOT = path.resolve(__dirname, "..")
const WORKFLOW = path.join(ROOT, "workflow")
const FAKE_CLAUDE = path.join(__dirname, "fixtures", "fake-claude")

function loadLib() {
  const ctx = vm.createContext({})
  vm.runInContext(fs.readFileSync(path.join(WORKFLOW, "lib.js"), "utf8") + "\n;this.exports = { MODEL_LABELS, QUICK_ACTIONS, modelLabel, makeTitle, newChat, parseStream, friendlyError, renderMessage, renderChat, welcomeText, footerFor, parseCommand, chatToMarkdown, lastAnswer, relativeTime, historyItems, quickActionItems, claudeArgs }", ctx)
  // Copy results out of the VM realm so assert.deepStrictEqual compares cleanly
  const plain = v => (v && typeof v === "object" ? JSON.parse(JSON.stringify(v)) : v)
  const out = {}
  for (const [k, v] of Object.entries(ctx.exports)) out[k] = typeof v === "function" ? (...a) => plain(v(...a)) : plain(v)
  return out
}

function tempEnv(extra) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "alfred-claude-test-"))
  return {
    dir,
    env: Object.assign({}, process.env, {
      alfred_workflow_data: path.join(dir, "data"),
      alfred_workflow_cache: path.join(dir, "cache"),
      claude_path: FAKE_CLAUDE,
      claude_model: "sonnet",
      FAKE_CLAUDE_LOG: path.join(dir, "fake"),
      FAKE_CLAUDE_DELAY: "0.02",
    }, extra || {}),
  }
}

function runScript(file, args, env) {
  return execFileSync(path.join(WORKFLOW, file), args, { cwd: WORKFLOW, env, encoding: "utf8" })
}

// Simulate Alfred's Text View loop: run, then re-run with the returned
// variables while the script asks for `rerun`. Returns every response.
function chatLoop(query, env, maxSteps = 200) {
  const steps = []
  let vars = {}
  let q = query
  for (let i = 0; i < maxSteps; i++) {
    const res = JSON.parse(runScript("chat.js", [q], Object.assign({}, env, vars)))
    steps.push(res)
    if (!res.rerun) return steps
    vars = res.variables || {}
    q = ""
    execFileSync("/bin/sleep", [String(res.rerun)])
  }
  throw new Error("Text View never stopped re-running")
}

function readChat(env) {
  return JSON.parse(fs.readFileSync(path.join(env.alfred_workflow_data, "chat.json"), "utf8"))
}

module.exports = { ROOT, WORKFLOW, FAKE_CLAUDE, loadLib, tempEnv, runScript, chatLoop, readChat }
