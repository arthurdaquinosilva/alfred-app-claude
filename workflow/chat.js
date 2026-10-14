#!/usr/bin/osascript -l JavaScript

// Alfred Text View script: shows the conversation and streams Claude's answer.
// Alfred re-runs it every 0.1 s while `rerun` is set, carrying `variables`.

ObjC.import("Foundation")
ObjC.import("AppKit")
eval($.NSString.stringWithContentsOfFileEncodingError(`${$.NSFileManager.defaultManager.currentDirectoryPath.js}/lib.js`, $.NSUTF8StringEncoding, $()).js)

function out(obj) { return JSON.stringify(obj) }

// One polling step while Claude is answering
function tick(cfg) {
  const sp = streamPaths(cfg)

  // First tick after a full render: append a placeholder that later ticks replace
  if (envVar("stream_marker") === "1") {
    return out({ rerun: 0.1, variables: { streaming_now: "1", stream_marker: "0" }, response: "*Thinking…*", behaviour: { response: "append", scroll: "end" } })
  }

  const chat = loadChat(cfg)
  const footer = footerFor(chat, cfg.model)

  if (!sp) {
    // Stream was stopped or cleaned up from elsewhere
    return out({ response: renderChat(chat), footer, variables: { streaming_now: "0" }, behaviour: { response: "replace", scroll: "end" } })
  }

  const state = parseStream(readText(sp.out))
  const finished = exists(sp.done) || state.done
  const stalled = !finished && Date.now() - Math.max(modifiedAt(sp.out), modifiedAt(sp.pid)) > cfg.timeout * 1000

  if (finished || stalled) {
    if (stalled) killStream(cfg)
    const message = finishStream(cfg, chat, { stalled })
    return out({
      response: renderMessage(message).replace(/^### Claude\n\n/, ""),
      footer: footerFor(chat, cfg.model),
      variables: { streaming_now: "0" },
      behaviour: { response: "replacelast", scroll: "end" },
    })
  }

  const label = modelLabel(state.model || chat.model || cfg.model)
  return out({
    rerun: 0.1,
    variables: { streaming_now: "1", stream_marker: "0" },
    response: state.text || `*${state.status || "Thinking…"}*`,
    footer: `${label} · ${state.text && state.status ? state.status : state.text ? "Writing…" : state.status || "Thinking…"} · ⇧↩ Stop`,
    behaviour: { response: "replacelast", scroll: "end" },
  })
}

function showChat(cfg, chat, extra) {
  const body = chat.messages.length ? renderChat(chat) : welcomeText(chat.model || cfg.model, cfg.web)
  return out(Object.assign({ response: body, footer: footerFor(chat, cfg.model), behaviour: { response: "replace", scroll: chat.messages.length ? "end" : "start" } }, extra || {}))
}

function ask(cfg, chat, question) {
  const claudePath = findClaude(cfg)
  if (!claudePath) {
    return out({
      response: `${chat.messages.length ? renderChat(chat) + "\n\n---\n\n" : ""}### Claude Code not found\n\nThis workflow talks to Claude through the **Claude Code** command line tool, which signs in with your Claude subscription.\n\n1. Install it: \`curl -fsSL https://claude.ai/install.sh | bash\`\n2. Run \`claude\` in Terminal and type \`/login\`\n3. If it lives somewhere unusual, set its path in the workflow's **Configure Workflow** panel.`,
      footer: "Claude Code is required",
      behaviour: { response: "replace", scroll: "end" },
    })
  }

  chat.messages.push({ role: "user", content: question })
  if (!chat.title) chat.title = makeTitle(question)
  saveChat(cfg, chat)
  startClaude(cfg, chat, question, claudePath)

  return out({
    rerun: 0.1,
    variables: { streaming_now: "1", stream_marker: "1" },
    response: renderChat(chat, { pending: true }),
    footer: `${modelLabel(chat.model || cfg.model)} · Starting Claude…`,
    behaviour: { response: "replace", scroll: "end", inputfield: "clear" },
  })
}

function run(argv) {
  const cfg = config()
  mkdirp(cfg.dataDir)
  const query = (argv[0] || "").trim()

  if (envVar("streaming_now") === "1") return tick(cfg)

  let chat = loadChat(cfg)

  // Window was closed mid-answer: redraw and pick the stream back up
  if (streamActive(cfg)) {
    return out({
      rerun: 0.1,
      variables: { streaming_now: "1", stream_marker: "1" },
      response: renderChat(chat, { pending: true }),
      footer: footerFor(chat, cfg.model),
      behaviour: { response: "replace", scroll: "end" },
    })
  }

  if (!query) return showChat(cfg, chat)

  const command = parseCommand(query)
  if (command) {
    if (command.name === "help") return out({ response: welcomeText(chat.model || cfg.model, cfg.web), footer: footerFor(chat, cfg.model), behaviour: { response: "replace", scroll: "start", inputfield: "clear" } })
    if (command.name === "model") {
      const wanted = command.arg.toLowerCase()
      if (!MODEL_LABELS[wanted]) return showChat(cfg, chat, { footer: "Use /model sonnet, /model opus or /model haiku" })
      chat.model = wanted
      chat.lastModel = ""
      saveChat(cfg, chat)
      return showChat(cfg, chat, { footer: `Switched to ${modelLabel(wanted)} · ${SHORTCUTS}`, behaviour: { response: "replace", scroll: "end", inputfield: "clear" } })
    }
    if (command.name === "new") {
      chat = archiveCurrent(cfg)
      if (!command.arg) return showChat(cfg, chat, { behaviour: { response: "replace", scroll: "start", inputfield: "clear" } })
      return ask(cfg, chat, command.arg)
    }
  }

  return ask(cfg, chat, query)
}
