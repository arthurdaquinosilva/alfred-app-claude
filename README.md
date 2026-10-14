# Claude for Alfred

A native Alfred chat window for Claude that runs on your **Claude subscription** (Pro or Max). It talks to Claude through the Claude Code CLI, which signs in with your claude.ai account, so you don't need an API key and there are no per-token charges.

## Install

1. Install Claude Code and sign in once:
   ```sh
   curl -fsSL https://claude.ai/install.sh | bash
   claude        # then type /login and choose your Claude subscription
   ```
2. Build and import the workflow (Alfred 5.5+ with Powerpack):
   ```sh
   npm run install-workflow     # = python3 scripts/build.py --install
   ```
   Or double-click `dist/Claude.alfredworkflow`.

## Use

| Where | Keys | What happens |
|---|---|---|
| `cl` ‹question› | ↩ | Ask in the current chat (streams into Alfred's Text View) |
| | ⌘↩ | Start a new chat with the question |
| | ⌥↩ | Browse chat history |
| In the chat | ↩ | Send |
| | ⌘↩ | New chat |
| | ⌥↩ / ⌃↩ | Copy the last answer / the whole chat as Markdown |
| | ⇧↩ | Stop generating (keeps the partial answer) |
| `cla` | ↩ | Quick actions on the clipboard: explain, summarize, improve writing, fix grammar, translate, review code, draft a reply, or type your own ask |
| Universal Action **Ask Claude** | | The same quick actions on selected text |
| `clh` ‹search› | ↩ / ⌘↩ | Reopen / delete a past chat |
| Fallback search | | "Ask Claude '…'" when nothing else matches |

Inside the chat you can also type `/new [question]`, `/model sonnet|opus|haiku` or `/help`.

You can change the model, web search, history, keywords, timeout, system prompt and the `claude` path from **Configure Workflow** in Alfred. You can also set a hotkey on the workflow's Hotkey trigger to open the chat directly.

## How it works

- `workflow/chat.js` is the Text View script. Each question starts `claude -p --output-format stream-json --include-partial-messages` in the background. The prompt goes in on stdin and `ANTHROPIC_API_KEY` is removed, so the subscription login is always used. Alfred re-runs the script every 0.1 s to stream the reply.
- Conversations continue with `--resume <session_id>`, so Claude remembers earlier turns. Tools are off except WebSearch/WebFetch when web search is enabled. User settings, hooks and MCP servers are skipped so replies stay fast (`--setting-sources "" --strict-mcp-config`).
- Each answer runs in its own folder under the workflow cache. The raw output of the latest run stays in `last-run/` for troubleshooting.
- `workflow/actions.js` handles new chat, stop, copy, history and quick actions. `workflow/lib.js` holds the shared logic.

## Develop

```sh
npm test          # unit tests + end-to-end tests of the JXA scripts with a fake `claude`
npm run build     # regenerate workflow/info.plist and dist/Claude.alfredworkflow
npm run icon      # redraw workflow/icon.png
```
