#!/usr/bin/osascript -l JavaScript

// Everything around the chat window: new chat, stop, copy, history, quick actions.
// Usage: actions.js <mode> [argument]

ObjC.import("Foundation")
ObjC.import("AppKit")
eval($.NSString.stringWithContentsOfFileEncodingError(`${$.NSFileManager.defaultManager.currentDirectoryPath.js}/lib.js`, $.NSUTF8StringEncoding, $()).js)

function stop(cfg) {
  if (!streamActive(cfg)) return
  killStream(cfg)
  finishStream(cfg, loadChat(cfg), { stopped: true })
}

const MODES = {
  // Archive the current chat; the output becomes the first question
  new(cfg, arg) {
    stop(cfg)
    archiveCurrent(cfg)
    return arg
  },

  stop(cfg) {
    stop(cfg)
    return ""
  },

  "copy-last"(cfg) {
    return lastAnswer(loadChat(cfg))
  },

  "copy-all"(cfg) {
    return chatToMarkdown(loadChat(cfg))
  },

  history(cfg, arg) {
    return JSON.stringify({ items: historyItems(loadArchive(cfg), arg) })
  },

  // Swap an archived chat in as the current one
  restore(cfg, id) {
    const path = `${cfg.archiveDir}/${id.replace(/[^\w.-]/g, "")}.json`
    if (!exists(path)) return ""
    stop(cfg)
    const restored = readText(path)
    archiveCurrent(cfg)
    removePath(path)
    writeText(cfg.chatFile, restored)
    return ""
  },

  delete(cfg, id) {
    removePath(`${cfg.archiveDir}/${id.replace(/[^\w.-]/g, "")}.json`)
    return ""
  },

  // Script Filter: actions on selected text (Universal Action) or the clipboard
  quick(cfg, arg) {
    let text = envVar("claude_text")
    if (!text) {
      const clip = $.NSPasteboard.generalPasteboard.stringForType($.NSPasteboardTypeString)
      text = clip.isNil() ? "" : clip.js
    }
    return JSON.stringify({ variables: { claude_text: text }, items: quickActionItems(text, arg) })
  },
}

function run(argv) {
  const cfg = config()
  mkdirp(cfg.dataDir)
  const mode = MODES[argv[0]]
  if (!mode) throw new Error(`Unknown mode: ${argv[0]}`)
  // Write without the trailing newline osascript adds to return values
  const output = mode(cfg, (argv[1] || "").trim())
  $.NSFileHandle.fileHandleWithStandardOutput.writeData($(output).dataUsingEncoding($.NSUTF8StringEncoding))
}
