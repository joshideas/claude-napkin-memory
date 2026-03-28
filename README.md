# Claude Code + Napkin: Automatic Vault Context Recall

A hook-based system that gives Claude Code **automatic, persistent memory** by searching a [Napkin](https://github.com/bcdavasconcelos/napkin) knowledge vault on every user message.

## The Problem

Claude Code has no long-term memory between sessions. You can store notes in a knowledge vault (like Napkin), but Claude won't check them unless you explicitly ask. If you researched something three weeks ago, Claude has no idea it exists.

CLAUDE.md instructions ("always check napkin") are unreliable — Claude may forget, deprioritize, or lose the instruction after context compression.

## The Solution

A `UserPromptSubmit` hook that fires **on every message you send**. It injects a context instruction that tells Claude to search the Napkin vault for relevant notes. The hook is deterministic (it's code, not a suggestion), so it never forgets.

### How It Works

```
You send a message
    |
    v
Hook fires (UserPromptSubmit) -----> Injects search instruction into context
    |
    v
Claude sees the instruction --------> Searches napkin vault (napkin_search via MCP)
    |
    v
Relevant results found? ------------> Claude incorporates them into response
No results? ------------------------> Claude proceeds normally, says nothing about it
```

The key insight: **the hook provides the reliable trigger, Claude provides the smart search**. The hook is just a shell script that echoes an instruction — but because it runs on every prompt submission, Claude always sees it.

## Setup

### Prerequisites

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI
- [Napkin MCP server](https://github.com/bcdavasconcelos/napkin) configured in Claude Code
- `jq` installed (`sudo apt install jq` / `brew install jq`)

### 1. Create the hook script

```bash
mkdir -p ~/.claude/hooks
```

Copy `hooks/napkin-context.sh` to `~/.claude/hooks/napkin-context.sh`:

```bash
cp hooks/napkin-context.sh ~/.claude/hooks/napkin-context.sh
chmod +x ~/.claude/hooks/napkin-context.sh
```

### 2. Add the hook to settings.json

Add the following to your `~/.claude/settings.json` (global) or `.claude/settings.json` (per-project):

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "~/.claude/hooks/napkin-context.sh",
            "timeout": 15,
            "statusMessage": "Searching napkin vault..."
          }
        ]
      }
    ]
  }
}
```

If you already have a `settings.json`, merge the `hooks` key into your existing config.

### 3. Done

Start a new Claude Code session. Every message you send will now trigger a vault search. Store notes with `napkin_create` / `napkin_append` during sessions, and they'll be automatically recalled in future conversations when relevant.

## Files

```
hooks/
  napkin-context.sh    # The hook script (runs on every prompt)
settings-example.json  # Example settings.json with the hook configured
```

## How the Hook Script Works

```bash
#!/bin/bash
INPUT=$(cat)
PROMPT=$(echo "$INPUT" | jq -r '.prompt')

# Skip empty prompts or slash commands
if [ -z "$PROMPT" ] || [[ "$PROMPT" == /* ]]; then
  exit 0
fi

echo "NAPKIN VAULT CONTEXT: Spawn a background agent to search the napkin vault..."
exit 0
```

1. Reads the JSON payload from stdin (Claude Code passes `{"prompt": "user's message", ...}`)
2. Extracts the prompt text
3. Skips slash commands and empty prompts
4. Echoes an instruction that gets injected into Claude's context

The echoed text is what Claude sees. It acts as a deterministic reminder to search the vault.

## Why Not Other Approaches?

| Approach | Reliability | Intelligence | Overhead |
|----------|------------|-------------|----------|
| CLAUDE.md instruction | Low - Claude may forget | High - full MCP access | None |
| Shell grep hook | High - code runs every time | Low - basic text matching | ~1s |
| **This approach (command hook + MCP search)** | **High - code triggers every time** | **High - BM25 ranked MCP search** | **~2-5s** |
| Agent hook | N/A | High | N/A - not supported for UserPromptSubmit |

We get the best of both worlds: the hook guarantees the trigger, Claude's MCP tools provide intelligent search.

## Customization

### Adjust the injected instruction

Edit `napkin-context.sh` to change what Claude sees. For example, to make it more aggressive about surfacing results:

```bash
echo "NAPKIN VAULT CONTEXT: Search the napkin vault for ALL notes related to this message. Always report what you find, even partial matches."
```

### Disable temporarily

Remove or comment out the hook in `settings.json`, or set `"disableAllHooks": true`.

### Per-project only

Put the hook config in `.claude/settings.json` inside a specific project instead of the global `~/.claude/settings.json`.

## Tips for Building Your Vault

- **Research notes**: When investigating a technology, library, or approach, have Claude write findings to napkin with `napkin_create`
- **Architecture decisions**: Store the "why" behind choices — code shows what, napkin stores why
- **Daily notes**: Use `napkin_daily_append` to log work — future sessions can reference your history
- **Tag everything**: Frontmatter tags make search more effective

## License

MIT
