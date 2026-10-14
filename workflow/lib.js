// Shared code for the Claude Alfred workflow.
//
// Pure helpers (parsing, rendering, filtering) at the top work in any JavaScript
// runtime and are unit-tested with Node. The macOS helpers further down use the
// JXA Objective-C bridge (`$`) and only run under `osascript -l JavaScript`.
// Top-level constants use `var` so they stay visible after chat.js/actions.js
// `eval` this file (a `const` would be scoped to the eval).

var MODEL_LABELS = { sonnet: "Sonnet", opus: "Opus", haiku: "Haiku", default: "Default model" }

var DEFAULT_SYSTEM_PROMPT = "You are Claude, answering inside the Alfred launcher on macOS. Be direct and concise. Format with Markdown: short paragraphs, lists, and fenced code blocks with a language tag. Avoid tables and avoid preambles."

var SHORTCUTS = "⌘↩ New chat · ⌥↩ Copy answer · ⌃↩ Copy chat · ⇧↩ Stop"

var QUICK_ACTIONS = [
  { id: "explain", title: "Explain", subtitle: "Explain this clearly and simply", prompt: "Explain the following clearly and simply:" },
  { id: "summarize", title: "Summarize", subtitle: "Key points in a few bullets", prompt: "Summarize the following in a few concise bullet points:" },
  { id: "improve", title: "Improve writing", subtitle: "Clearer, tighter, same meaning", prompt: "Improve the writing of the following text. Keep the meaning and tone, make it clearer and tighter. Reply with only the improved text:" },
  { id: "grammar", title: "Fix grammar", subtitle: "Correct spelling and grammar only", prompt: "Fix spelling and grammar in the following text without changing its style. Reply with only the corrected text:" },
  { id: "shorter", title: "Make shorter", subtitle: "Cut it to about half", prompt: "Rewrite the following to about half its length, keeping the essentials. Reply with only the rewritten text:" },
  { id: "translate", title: "Translate to English", subtitle: "Natural, idiomatic English", prompt: "Translate the following into natural, idiomatic English. Reply with only the translation:" },
  { id: "code", title: "Review code", subtitle: "Bugs, edge cases and improvements", prompt: "Review the following code. Point out bugs, edge cases and concrete improvements:" },
  { id: "reply", title: "Draft a reply", subtitle: "A friendly, concise response", prompt: "Draft a friendly, concise reply to the following message:" },
]

function modelLabel(model) {
  if (!model) return MODEL_LABELS.default
  if (MODEL_LABELS[model]) return MODEL_LABELS[model]
  // "claude-sonnet-5-5" -> "Sonnet 5.5"
  const m = /^claude-([a-z]+)-(\d+)(?:-(\d+))?/.exec(model)
  if (!m) return model
  const name = m[1].charAt(0).toUpperCase() + m[1].slice(1)
  return m[3] && m[3].length <= 2 ? `${name} ${m[2]}.${m[3]}` : `${name} ${m[2]}`
}

function makeTitle(text) {
  const line = String(text).replace(/\s+/g, " ").trim()
  return line.length > 60 ? `${line.slice(0, 57).trimEnd()}…` : line
}

function newChat(now) {
  const ts = now || Date.now()
  return { id: `chat-${ts}`, created: ts, updated: ts, title: "", model: "", session_id: "", messages: [] }
}

// Read Claude Code `--output-format stream-json` output (one JSON object per
// line, possibly with an incomplete last line) into a display-ready state.
function parseStream(raw) {
  const state = { text: "", sessionId: "", model: "", status: "", done: false, isError: false, error: "", sawPartial: false }
  const assistantTexts = []
  let pendingBreak = false

  for (const line of String(raw || "").split("\n")) {
    if (!line.trim()) continue
    let ev
    try { ev = JSON.parse(line) } catch { continue }

    if (ev.session_id) state.sessionId = ev.session_id

    if (ev.type === "system" && ev.subtype === "init") {
      if (ev.model) state.model = ev.model
    } else if (ev.type === "stream_event" && ev.event) {
      const e = ev.event
      if (e.type === "message_start") {
        if (state.text) pendingBreak = true
      } else if (e.type === "content_block_start") {
        const block = e.content_block || {}
        if (block.type === "tool_use" || block.type === "server_tool_use") state.status = toolStatus(block.name)
        else if (block.type === "thinking") state.status = "Thinking…"
        else if (block.type === "text") state.status = ""
      } else if (e.type === "content_block_delta" && e.delta && e.delta.type === "text_delta") {
        state.sawPartial = true
        if (pendingBreak && !state.text.endsWith("\n\n")) state.text += "\n\n"
        pendingBreak = false
        state.text += e.delta.text
        state.status = ""
      }
    } else if (ev.type === "assistant" && ev.message && Array.isArray(ev.message.content)) {
      const text = ev.message.content.filter(c => c.type === "text").map(c => c.text).join("")
      if (text) assistantTexts.push(text)
    } else if (ev.type === "result") {
      state.done = true
      state.isError = Boolean(ev.is_error) || (ev.subtype && ev.subtype !== "success")
      if (state.isError) {
        state.error = ev.result || (Array.isArray(ev.errors) ? ev.errors.join("\n") : "") || ev.subtype || "Unknown error"
      } else if (!state.sawPartial && !assistantTexts.length && ev.result) {
        assistantTexts.push(ev.result)
      }
    }
  }

  // Older CLIs without partial messages still send whole assistant messages
  if (!state.sawPartial && assistantTexts.length) state.text = assistantTexts.join("\n\n")
  return state
}

function toolStatus(name) {
  if (name === "WebSearch" || name === "web_search") return "Searching the web…"
  if (name === "WebFetch" || name === "web_fetch") return "Reading a web page…"
  return name ? `Using ${name}…` : "Working…"
}

// Turn CLI failures into something a person can act on.
function friendlyError(message, stderr) {
  const text = `${message || ""}\n${stderr || ""}`
  if (/not logged in|please run \/login|invalid api key|authentication|oauth|unauthori[sz]ed|401/i.test(text)) {
    return "**Claude Code isn't signed in.** Open Terminal, run `claude`, then type `/login` and pick your Claude subscription. Come back here when you're done."
  }
  if (/rate.?limit|usage limit|limit reached|429|overloaded/i.test(text)) {
    return `**Usage limit reached.** Your subscription's limit resets soon.\n\n${(message || "").trim()}`
  }
  const detail = (message || stderr || "").trim().split("\n").slice(-6).join("\n")
  return `**Something went wrong.**\n\n\`\`\`\n${detail || "Claude Code exited without a reply."}\n\`\`\``
}

function renderMessage(m) {
  if (m.role === "user") return `### You\n\n${m.content}`
  let body = m.content || ""
  if (m.error) body = `> ${body.split("\n").join("\n> ")}`
  if (m.stopped) body = `${body}${body ? "\n\n" : ""}*Stopped*`
  return `### Claude\n\n${body}`
}

// The whole conversation as Markdown. With `pending`, ends on an empty Claude
// heading so the streaming answer can be appended right below it.
function renderChat(chat, opts) {
  const pending = opts && opts.pending
  const parts = []
  chat.messages.forEach((m, i) => {
    if (m.role === "user" && i > 0) parts.push("---")
    parts.push(renderMessage(m))
  })
  if (pending) parts.push("### Claude")
  return parts.join("\n\n") + (pending ? "\n\n" : "")
}

function welcomeText(model, web) {
  return [
    "## Claude",
    "Ask anything. Answers stream here, powered by your Claude subscription through Claude Code.",
    `Model **${modelLabel(model)}**${web ? " · web search on" : ""}`,
    "#### Shortcuts",
    "- **↩** Send message\n- **⌘↩** New chat (with whatever you typed)\n- **⌥↩** Copy last answer\n- **⌃↩** Copy the whole chat\n- **⇧↩** Stop generating",
    "#### Commands",
    "- `/new` Start over, optionally with a question\n- `/model sonnet|opus|haiku` Switch model for this chat\n- `/help` Show this screen",
  ].join("\n\n")
}

function footerFor(chat, configuredModel) {
  return `${modelLabel(chat.lastModel || chat.model || configuredModel)} · ${SHORTCUTS}`
}

// Parse "/model opus", "/new what is x". Returns null for regular messages.
function parseCommand(text) {
  const m = /^\/(new|clear|model|help)\b\s*([\s\S]*)$/i.exec(String(text).trim())
  return m ? { name: m[1].toLowerCase() === "clear" ? "new" : m[1].toLowerCase(), arg: m[2].trim() } : null
}

function chatToMarkdown(chat) {
  return chat.messages.map(m => `${m.role === "user" ? "**You:**" : "**Claude:**"}\n\n${m.content}`).join("\n\n---\n\n")
}

function lastAnswer(chat) {
  for (let i = chat.messages.length - 1; i >= 0; i--) {
    const m = chat.messages[i]
    if (m.role === "assistant" && !m.error && m.content) return m.content
  }
  return ""
}

function relativeTime(ts, now) {
  const s = Math.max(0, Math.round(((now || Date.now()) - ts) / 1000))
  if (s < 60) return "just now"
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`
  if (s < 86400 * 7) return `${Math.floor(s / 86400)} d ago`
  return new Date(ts).toISOString().slice(0, 10)
}

function historyItems(chats, query, now) {
  const q = String(query || "").toLowerCase().trim()
  const matches = chats
    .filter(c => c.messages && c.messages.length)
    .filter(c => !q || `${c.title}\n${c.messages.map(m => m.content).join("\n")}`.toLowerCase().includes(q))
    .sort((a, b) => b.updated - a.updated)
  if (!matches.length) {
    return [{ title: q ? "No chats match" : "No saved chats yet", subtitle: "Chats are saved here when you start a new one", valid: false }]
  }
  return matches.map(c => {
    const turns = c.messages.filter(m => m.role === "user").length
    return {
      uid: c.id,
      title: c.title || "Untitled chat",
      subtitle: `${relativeTime(c.updated, now)} · ${turns} ${turns === 1 ? "message" : "messages"} · ${modelLabel(c.model)}`,
      arg: c.id,
      autocomplete: c.title,
      text: { copy: chatToMarkdown(c), largetype: lastAnswer(c) },
      mods: { cmd: { subtitle: "Delete this chat", arg: c.id } },
    }
  })
}

function quickActionItems(text, query) {
  const source = String(text || "").trim()
  const q = String(query || "").trim()
  if (!source) {
    return [{ title: "Nothing to work with", subtitle: "Select text and use the Universal Action, or copy something first", valid: false }]
  }
  const preview = makeTitle(source)
  const items = []
  if (q) items.push({ title: `Ask: ${q}`, subtitle: `About “${preview}”`, arg: `${q}\n\n"""\n${source}\n"""` })
  QUICK_ACTIONS
    .filter(a => !q || `${a.title} ${a.subtitle}`.toLowerCase().includes(q.toLowerCase()))
    .forEach(a => items.push({ uid: a.id, title: a.title, subtitle: `${a.subtitle} · “${preview}”`, arg: `${a.prompt}\n\n"""\n${source}\n"""` }))
  return items
}

// Arguments for one `claude -p` turn. The prompt itself goes in on stdin so
// text starting with "-" can't be mistaken for a flag.
function claudeArgs(opts) {
  const args = [
    "-p", "--output-format", "stream-json", "--verbose", "--include-partial-messages",
    "--strict-mcp-config", "--setting-sources", "", "--disable-slash-commands",
  ]
  if (opts.model && opts.model !== "default") args.push("--model", opts.model)
  if (opts.systemPrompt) args.push("--system-prompt", opts.systemPrompt)
  if (opts.web) args.push("--tools", "WebSearch,WebFetch", "--allowedTools", "WebSearch,WebFetch")
  else args.push("--tools", "")
  if (opts.sessionId) args.push("--resume", opts.sessionId)
  return args
}

// ---------------------------------------------------------------------------
// macOS (JXA) helpers
// ---------------------------------------------------------------------------

function envVar(name) {
  const v = $.NSProcessInfo.processInfo.environment.objectForKey(name)
  return v && !v.isNil() ? v.js : ""
}

function fm() { return $.NSFileManager.defaultManager }
function exists(path) { return fm().fileExistsAtPath(path) }
function mkdirp(path) { fm().createDirectoryAtPathWithIntermediateDirectoriesAttributesError(path, true, $(), $()) }
function removePath(path) { if (exists(path)) fm().removeItemAtPathError(path, $()) }

function readText(path) {
  if (!exists(path)) return ""
  const s = $.NSString.stringWithContentsOfFileEncodingError(path, $.NSUTF8StringEncoding, $())
  return s.isNil() ? "" : s.js
}

function writeText(path, text) {
  $(String(text)).writeToFileAtomicallyEncodingError(path, true, $.NSUTF8StringEncoding, $())
}

function modifiedAt(path) {
  const attrs = fm().attributesOfItemAtPathError(path, $())
  return attrs.isNil() ? 0 : attrs.js.NSFileModificationDate.js.getTime()
}

function listDir(path) {
  const items = fm().contentsOfDirectoryAtPathError(path, $())
  return items.isNil() ? [] : items.js.map(x => x.js)
}

function setClipboard(text) {
  const pb = $.NSPasteboard.generalPasteboard
  pb.clearContents
  pb.setStringForType($(text), $.NSPasteboardTypeString)
}

function expandHome(p) { return p.replace(/^~(?=\/|$)/, envVar("HOME")) }

function config() {
  const data = envVar("alfred_workflow_data") || `${envVar("HOME")}/Library/Application Support/Alfred/Workflow Data/claude-alfred`
  const cache = envVar("alfred_workflow_cache") || `${envVar("HOME")}/Library/Caches/claude-alfred`
  return {
    dataDir: data,
    archiveDir: `${data}/archive`,
    chatFile: `${data}/chat.json`,
    cacheDir: cache,
    activeFile: `${cache}/active`,
    model: envVar("claude_model") || "sonnet",
    web: envVar("claude_web") !== "0",
    keepHistory: envVar("claude_history") !== "0",
    timeout: parseInt(envVar("claude_timeout"), 10) || 60,
    systemPrompt: envVar("claude_system_prompt") || DEFAULT_SYSTEM_PROMPT,
    claudePath: envVar("claude_path"),
  }
}

// Each answer runs in its own folder; `active` points at the one in progress.
// Separate folders matter: Claude Code can linger for a moment after its final
// event, and must never write into the next answer's files.
function streamPaths(cfg) {
  const d = readText(cfg.activeFile).trim()
  if (!d || !exists(d)) return null
  return { dir: d, out: `${d}/out.jsonl`, err: `${d}/err.txt`, done: `${d}/exit.txt`, pid: `${d}/pid.txt`, prompt: `${d}/prompt.txt` }
}

function loadChat(cfg) {
  try {
    const chat = JSON.parse(readText(cfg.chatFile))
    if (chat && Array.isArray(chat.messages)) return chat
  } catch {}
  return newChat()
}

function saveChat(cfg, chat) {
  mkdirp(cfg.dataDir)
  chat.updated = Date.now()
  writeText(cfg.chatFile, JSON.stringify(chat))
}

// Move the current chat into the archive (if it has content) and start fresh.
function archiveCurrent(cfg) {
  const chat = loadChat(cfg)
  if (chat.messages.length && cfg.keepHistory) {
    mkdirp(cfg.archiveDir)
    writeText(`${cfg.archiveDir}/${chat.id}.json`, JSON.stringify(chat))
  }
  const fresh = newChat()
  saveChat(cfg, fresh)
  return fresh
}

function loadArchive(cfg) {
  return listDir(cfg.archiveDir)
    .filter(f => f.endsWith(".json"))
    .flatMap(f => { try { return [JSON.parse(readText(`${cfg.archiveDir}/${f}`))] } catch { return [] } })
}

function findClaude(cfg) {
  const home = envVar("HOME")
  const candidates = [
    cfg.claudePath && expandHome(cfg.claudePath),
    `${home}/.local/bin/claude`,
    `${home}/.claude/local/claude`,
    "/opt/homebrew/bin/claude",
    "/usr/local/bin/claude",
    `${home}/.npm-global/bin/claude`,
    `${home}/.bun/bin/claude`,
  ].filter(Boolean)
  const found = candidates.find(p => fm().isExecutableFileAtPath(p))
  if (found) return found
  // Last resort: ask a login shell, which knows about nvm, asdf and friends
  try {
    const p = Application.currentApplication()
    p.includeStandardAdditions = true
    const out = p.doShellScript("/bin/zsh -lc 'command -v claude' 2>/dev/null || true").trim()
    if (out && fm().isExecutableFileAtPath(out)) return out
  } catch {}
  return ""
}

function streamActive(cfg) {
  return Boolean(streamPaths(cfg))
}

// Launch `claude -p` in the background. It writes events to out.jsonl and its
// exit code to exit.txt; the Text View polls those files.
function startClaude(cfg, chat, prompt, claudePath) {
  const dir = `${cfg.cacheDir}/runs/${Date.now()}`
  mkdirp(dir)
  writeText(cfg.activeFile, dir)
  const sp = streamPaths(cfg)
  writeText(sp.prompt, prompt)
  writeText(sp.out, "")

  const env = $.NSMutableDictionary.dictionaryWithDictionary($.NSProcessInfo.processInfo.environment)
  env.removeObjectForKey("ANTHROPIC_API_KEY") // use the subscription login, never a stray API key
  env.removeObjectForKey("CLAUDECODE")
  env.setObjectForKey($(`${claudePath.replace(/\/[^/]+$/, "")}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin`), "PATH")
  env.setObjectForKey($(sp.prompt), "CA_PROMPT")
  env.setObjectForKey($(sp.out), "CA_OUT")
  env.setObjectForKey($(sp.err), "CA_ERR")
  env.setObjectForKey($(sp.done), "CA_DONE")

  const args = claudeArgs({ model: chat.model || cfg.model, systemPrompt: cfg.systemPrompt, web: cfg.web, sessionId: chat.session_id })
  const task = $.NSTask.alloc.init
  task.executableURL = $.NSURL.fileURLWithPath("/bin/zsh")
  task.arguments = $(["-fc", '"$0" "$@" < "$CA_PROMPT" > "$CA_OUT" 2> "$CA_ERR"; print -r -- $? > "$CA_DONE.tmp"; mv "$CA_DONE.tmp" "$CA_DONE"', claudePath].concat(args))
  task.environment = env
  task.currentDirectoryURL = $.NSURL.fileURLWithPath(cfg.dataDir)
  task.standardInput = $.NSFileHandle.fileHandleWithNullDevice
  task.standardOutput = $.NSFileHandle.fileHandleWithNullDevice
  task.standardError = $.NSFileHandle.fileHandleWithNullDevice
  task.launchAndReturnError($())
  writeText(sp.pid, String(task.processIdentifier))
}

function killStream(cfg) {
  const sp = streamPaths(cfg)
  const pid = sp && parseInt(readText(sp.pid), 10)
  if (!pid) return
  try {
    const p = Application.currentApplication()
    p.includeStandardAdditions = true
    p.doShellScript(`/usr/bin/pkill -TERM -P ${pid}; /bin/kill -TERM ${pid}; true`)
  } catch {}
}

// Save whatever the stream produced into the chat and clean up the stream.
function finishStream(cfg, chat, opts) {
  const sp = streamPaths(cfg)
  if (!sp) return null
  const state = parseStream(readText(sp.out))
  if (state.sessionId) chat.session_id = state.sessionId
  if (state.model) chat.lastModel = state.model

  const exitCode = exists(sp.done) ? parseInt(readText(sp.done), 10) : null
  const message = { role: "assistant", content: state.text }
  if (opts && opts.stopped) message.stopped = true
  else if (opts && opts.stalled) message.content = `${state.text}${state.text ? "\n\n" : ""}> Claude stopped responding. Ask it to continue.`
  else if (state.isError || (!state.text && exitCode !== 0)) {
    message.content = friendlyError(state.error, readText(sp.err))
    message.error = true
  } else if (!state.text) {
    message.content = "Claude sent an empty reply. Ask again or rephrase."
    message.error = true
  }

  const last = chat.messages[chat.messages.length - 1]
  if (last && last.role === "user") chat.messages.push(message)
  saveChat(cfg, chat)

  // Keep the raw output of the latest run around for troubleshooting
  removePath(cfg.activeFile)
  const keep = `${cfg.cacheDir}/last-run`
  removePath(keep)
  fm().moveItemAtPathToPathError(sp.dir, keep, $())
  removePath(sp.dir)
  return message
}
