#!/usr/bin/env python3
"""Generate workflow/info.plist and package dist/Claude.alfredworkflow.

Usage: python3 scripts/build.py [--install]
  --install  also open the package so Alfred imports it
"""
import plistlib
import subprocess
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WORKFLOW = ROOT / "workflow"
DIST = ROOT / "dist"
VERSION = "1.0.0"

CMD, ALT, CTRL, SHIFT = 1048576, 524288, 262144, 131072

# Stable UIDs so rebuilding never breaks a user's hotkey or keyword settings
UID = {
    "keyword": "C1A0D0E1-0001-4C1A-9DE0-000000000001",
    "textview": "C1A0D0E1-0002-4C1A-9DE0-000000000002",
    "new": "C1A0D0E1-0003-4C1A-9DE0-000000000003",
    "open_call": "C1A0D0E1-0004-4C1A-9DE0-000000000004",
    "open_trigger": "C1A0D0E1-0005-4C1A-9DE0-000000000005",
    "stop": "C1A0D0E1-0006-4C1A-9DE0-000000000006",
    "copy_last": "C1A0D0E1-0007-4C1A-9DE0-000000000007",
    "copy_all": "C1A0D0E1-0008-4C1A-9DE0-000000000008",
    "clipboard": "C1A0D0E1-0009-4C1A-9DE0-000000000009",
    "history": "C1A0D0E1-0010-4C1A-9DE0-000000000010",
    "restore": "C1A0D0E1-0011-4C1A-9DE0-000000000011",
    "delete": "C1A0D0E1-0012-4C1A-9DE0-000000000012",
    "history_call": "C1A0D0E1-0013-4C1A-9DE0-000000000013",
    "history_trigger": "C1A0D0E1-0014-4C1A-9DE0-000000000014",
    "quick": "C1A0D0E1-0015-4C1A-9DE0-000000000015",
    "ua": "C1A0D0E1-0016-4C1A-9DE0-000000000016",
    "ua_arg": "C1A0D0E1-0017-4C1A-9DE0-000000000017",
    "fallback": "C1A0D0E1-0018-4C1A-9DE0-000000000018",
    "hotkey": "C1A0D0E1-0019-4C1A-9DE0-000000000019",
}

FOOTER = "↩ Send · ⌘↩ New chat · ⌥↩ Copy answer · ⌃↩ Copy chat · ⇧↩ Stop"


def run_script(action):
    return {
        "concurrently": False,
        "escaping": 102,
        "script": f'/usr/bin/osascript -l JavaScript ./actions.js {action} "$1"',
        "scriptargtype": 1,
        "scriptfile": "",
        "type": 0,
    }


def script_filter(keyword, title, subtext, action, running):
    return {
        "alfredfiltersresults": False,
        "alfredfiltersresultsmatchmode": 0,
        "argumenttreatemptyqueryasnil": False,
        "argumenttrimmode": 0,
        "argumenttype": 1,
        "escaping": 102,
        "keyword": keyword,
        "queuedelaycustom": 3,
        "queuedelayimmediatelyinitially": True,
        "queuedelaymode": 0,
        "queuemode": 1,
        "runningsubtext": running,
        "script": f'/usr/bin/osascript -l JavaScript ./actions.js {action} "$1"',
        "scriptargtype": 1,
        "scriptfile": "",
        "skipuniversalaction": True,
        "subtext": subtext,
        "title": title,
        "type": 0,
        "withspace": True,
    }


def call_trigger(trigger_id):
    return {"externaltriggerid": trigger_id, "passinputasargument": True, "passvariables": False, "workflowbundleid": "self"}


OBJECTS = [
    ("keyword", "alfred.workflow.input.keyword", 1, {
        "argumenttype": 1,
        "keyword": "{var:claude_keyword}",
        "skipuniversalaction": True,
        "subtext": "↩ Continue chat · ⌘↩ New chat · ⌥↩ Chat history",
        "text": "Ask Claude",
        "withspace": True,
    }),
    ("textview", "alfred.workflow.userinterface.text", 1, {
        "behaviour": 2,
        "fontmode": 0,
        "fontsizing": 0,
        "footertext": FOOTER,
        "inputfile": "chat.js",
        "inputtype": 1,
        "loadingtext": "Connecting to Claude…",
        "outputmode": 1,
        "scriptinput": 2,
        "spellchecking": 0,
        "stackview": False,
    }),
    ("new", "alfred.workflow.action.script", 2, run_script("new")),
    ("open_call", "alfred.workflow.output.callexternaltrigger", 1, call_trigger("open_chat")),
    ("open_trigger", "alfred.workflow.trigger.external", 1, {"availableviaurlhandler": False, "triggerid": "open_chat"}),
    ("stop", "alfred.workflow.action.script", 2, run_script("stop")),
    ("copy_last", "alfred.workflow.action.script", 2, run_script("copy-last")),
    ("copy_all", "alfred.workflow.action.script", 2, run_script("copy-all")),
    ("clipboard", "alfred.workflow.output.clipboard", 3, {
        "autopaste": False, "clipboardtext": "{query}", "ignoredynamicplaceholders": False, "transient": False,
    }),
    ("history", "alfred.workflow.input.scriptfilter", 3, script_filter(
        "{var:claude_history_keyword}", "Claude chat history", "Search and reopen past chats", "history", "Loading chats…")),
    ("restore", "alfred.workflow.action.script", 2, run_script("restore")),
    ("delete", "alfred.workflow.action.script", 2, run_script("delete")),
    ("history_call", "alfred.workflow.output.callexternaltrigger", 1, call_trigger("history")),
    ("history_trigger", "alfred.workflow.trigger.external", 1, {"availableviaurlhandler": False, "triggerid": "history"}),
    ("quick", "alfred.workflow.input.scriptfilter", 3, script_filter(
        "{var:claude_quick_keyword}", "Claude quick actions", "Explain, summarize, rewrite or ask about the clipboard",
        "quick", "Reading text…")),
    ("ua", "alfred.workflow.trigger.universalaction", 1, {
        "acceptsfiles": False, "acceptsmulti": 0, "acceptstext": True, "acceptsurls": False, "name": "Ask Claude",
    }),
    ("ua_arg", "alfred.workflow.utility.argument", 1, {
        "argument": "", "passthroughargument": False, "variables": {"claude_text": "{query}"},
    }),
    ("fallback", "alfred.workflow.trigger.fallback", 1, {"text": "Ask Claude '{query}'"}),
    ("hotkey", "alfred.workflow.trigger.hotkey", 1, {
        "action": 0, "argument": 0,
        "hotkey": 0, "hotmod": 0, "hotstring": "", "leftcursor": False, "modsmode": 0, "relatedAppsMode": 0,
    }),
]

# source -> [(destination, modifier, subtext, keep Alfred open)]
CONNECTIONS = {
    "keyword": [("textview", 0, "", True), ("new", CMD, "Start a new chat", True), ("history", ALT, "Browse chat history", True)],
    "textview": [
        ("new", CMD, "Start a new chat", True),
        ("copy_last", ALT, "Copy last answer", False),
        ("copy_all", CTRL, "Copy whole chat", False),
        ("stop", SHIFT, "Stop generating", True),
    ],
    "new": [("open_call", 0, "", False)],
    "stop": [("open_call", 0, "", False)],
    "restore": [("open_call", 0, "", False)],
    "open_trigger": [("textview", 0, "", False)],
    "copy_last": [("clipboard", 0, "", False)],
    "copy_all": [("clipboard", 0, "", False)],
    "history": [("restore", 0, "", True), ("delete", CMD, "Delete this chat", True)],
    "delete": [("history_call", 0, "", False)],
    "history_trigger": [("history", 0, "", False)],
    "quick": [("new", 0, "", True)],
    "ua": [("ua_arg", 0, "", True)],
    "ua_arg": [("quick", 0, "", False)],
    "fallback": [("new", 0, "", True)],
    "hotkey": [("textview", 0, "", True)],
}

LAYOUT = {
    "hotkey": (30, 30), "keyword": (30, 160), "fallback": (30, 290), "ua": (30, 420), "history_trigger": (30, 550),
    "ua_arg": (230, 450), "quick": (330, 400), "history": (330, 550),
    "new": (560, 290), "restore": (560, 550), "delete": (560, 680), "history_call": (760, 680),
    "open_call": (760, 290), "open_trigger": (560, 30), "textview": (760, 110),
    "stop": (1000, 30), "copy_last": (1000, 160), "copy_all": (1000, 290), "clipboard": (1200, 220),
}

USER_CONFIG = [
    {"type": "popupbutton", "variable": "claude_model", "label": "Model", "description": "Which Claude model answers. Switch per chat with /model.",
     "config": {"default": "sonnet", "pairs": [["Sonnet (fast, great default)", "sonnet"], ["Opus (most capable)", "opus"],
                                                ["Haiku (fastest)", "haiku"], ["Claude Code default", "default"]]}},
    {"type": "checkbox", "variable": "claude_web", "label": "Web", "description": "",
     "config": {"default": True, "required": False, "text": "Let Claude search the web for current information"}},
    {"type": "checkbox", "variable": "claude_history", "label": "History", "description": "",
     "config": {"default": True, "required": False, "text": "Save chats to history when starting a new one"}},
    {"type": "textfield", "variable": "claude_keyword", "label": "Chat keyword", "description": "",
     "config": {"default": "cl", "placeholder": "cl", "required": True, "trim": True}},
    {"type": "textfield", "variable": "claude_quick_keyword", "label": "Quick actions keyword", "description": "Explain, summarize or rewrite the clipboard. Selected text works through the Ask Claude Universal Action.",
     "config": {"default": "cla", "placeholder": "cla", "required": True, "trim": True}},
    {"type": "textfield", "variable": "claude_history_keyword", "label": "History keyword", "description": "",
     "config": {"default": "clh", "placeholder": "clh", "required": True, "trim": True}},
    {"type": "slider", "variable": "claude_timeout", "label": "Timeout", "description": "Seconds without any output before giving up on an answer.",
     "config": {"defaultvalue": 60, "markercount": 8, "maxvalue": 180, "minvalue": 20, "onlystoponmarkers": True, "showmarkers": True}},
    {"type": "textarea", "variable": "claude_system_prompt", "label": "System prompt", "description": "How Claude should answer. Leave empty for the built-in concise style.",
     "config": {"default": "", "required": False, "trim": True, "verticalsize": 4}},
    {"type": "textfield", "variable": "claude_path", "label": "Claude Code path", "description": "Only needed if `claude` isn't found automatically.",
     "config": {"default": "", "placeholder": "~/.local/bin/claude", "required": False, "trim": True}},
]

README = """# Claude for Alfred

Chat with Claude right inside Alfred, using your **Claude subscription** (Pro or Max) through the Claude Code CLI. No API key needed.

## Setup
1. Install Claude Code: `curl -fsSL https://claude.ai/install.sh | bash`
2. Run `claude` in Terminal once and sign in with `/login`.

## Use
- **cl** ‹question› opens the chat. ↩ continues, ⌘↩ starts a new chat, ⌥↩ opens history.
- In the chat: ↩ send · ⌘↩ new chat · ⌥↩ copy last answer · ⌃↩ copy chat · ⇧↩ stop.
- Commands: `/new`, `/model sonnet|opus|haiku`, `/help`.
- **cla** runs quick actions (explain, summarize, improve writing…) on the clipboard. Select text anywhere and use the **Ask Claude** Universal Action for the same on a selection.
- **clh** searches past chats. ↩ reopens one, ⌘↩ deletes it.
- Add a hotkey in the workflow to jump straight into the chat.
"""


def build_plist():
    uid_of = {k: UID[k] for k, *_ in OBJECTS}
    objects = [{"config": cfg, "type": typ, "uid": UID[key], "version": ver} for key, typ, ver, cfg in OBJECTS]
    connections = {
        UID[src]: [{"destinationuid": UID[dst], "modifiers": mod, "modifiersubtext": sub, "vitoclose": keep}
                   for dst, mod, sub, keep in dests]
        for src, dests in CONNECTIONS.items()
    }
    uidata = {UID[k]: {"xpos": x, "ypos": y} for k, (x, y) in LAYOUT.items()}
    assert set(uidata) == set(uid_of.values()), "every object needs a layout position"
    return {
        "bundleid": "com.arthurdaquino.alfred-claude",
        "category": "Productivity",
        "connections": connections,
        "createdby": "Arthur Daquino",
        "description": "Chat with Claude using your Claude subscription",
        "disabled": False,
        "name": "Claude",
        "objects": objects,
        "readme": README,
        "uidata": uidata,
        "userconfigurationconfig": USER_CONFIG,
        "variablesdontexport": [],
        "version": VERSION,
        "webaddress": "",
    }


def main():
    with open(WORKFLOW / "info.plist", "wb") as f:
        plistlib.dump(build_plist(), f, sort_keys=True)

    DIST.mkdir(exist_ok=True)
    package = DIST / "Claude.alfredworkflow"
    files = ["info.plist", "icon.png", "lib.js", "chat.js", "actions.js"]
    with zipfile.ZipFile(package, "w", zipfile.ZIP_DEFLATED) as z:
        for name in files:
            path = WORKFLOW / name
            info = zipfile.ZipInfo(name)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = ((0o755 if name.endswith(".js") else 0o644) | 0o100000) << 16
            z.writestr(info, path.read_bytes())
    print(f"Built {package.relative_to(ROOT)}")

    if "--install" in sys.argv:
        subprocess.run(["open", str(package)], check=True)


if __name__ == "__main__":
    main()
