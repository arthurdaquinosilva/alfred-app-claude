// The generated info.plist must be internally consistent and point at real files.
const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const { execFileSync } = require("node:child_process")
const { ROOT, WORKFLOW } = require("./helpers")

test("info.plist wires every object to something real", { skip: process.platform !== "darwin" }, () => {
  execFileSync("python3", [path.join(ROOT, "scripts", "build.py")], { cwd: ROOT })
  const plist = JSON.parse(execFileSync("plutil", ["-convert", "json", "-o", "-", path.join(WORKFLOW, "info.plist")], { encoding: "utf8" }))
  const uids = new Set(plist.objects.map(o => o.uid))

  for (const [src, dests] of Object.entries(plist.connections)) {
    assert.ok(uids.has(src), `connection source ${src} exists`)
    for (const d of dests) assert.ok(uids.has(d.destinationuid), `connection target ${d.destinationuid} exists`)
  }

  const hasIncoming = new Set(Object.values(plist.connections).flat().map(d => d.destinationuid))
  const hasOutgoing = new Set(Object.keys(plist.connections))
  for (const o of plist.objects) {
    const isEntry = /\.(input|trigger)\./.test(o.type)
    const isExit = /\.(output|userinterface)\./.test(o.type)
    if (!isEntry) assert.ok(hasIncoming.has(o.uid), `${o.type} ${o.uid} is reachable`)
    if (!isExit) assert.ok(hasOutgoing.has(o.uid), `${o.type} ${o.uid} leads somewhere`)
  }

  const textView = plist.objects.find(o => o.type === "alfred.workflow.userinterface.text")
  const file = path.join(WORKFLOW, textView.config.inputfile)
  assert.ok(fs.statSync(file).mode & 0o111, "Text View script is executable")

  const triggers = plist.objects.filter(o => o.type.endsWith("trigger.external")).map(o => o.config.triggerid)
  for (const call of plist.objects.filter(o => o.type.endsWith("callexternaltrigger"))) {
    assert.ok(triggers.includes(call.config.externaltriggerid), `external trigger ${call.config.externaltriggerid} exists`)
  }

  const vars = new Set(plist.userconfigurationconfig.map(c => c.variable))
  for (const o of plist.objects) {
    for (const m of JSON.stringify(o.config).matchAll(/\{var:(\w+)\}/g)) {
      assert.ok(vars.has(m[1]), `{var:${m[1]}} is configurable`)
    }
  }
  assert.ok(fs.existsSync(path.join(ROOT, "dist", "Claude.alfredworkflow")))
})
