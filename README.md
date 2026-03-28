# Claude Code + Napkin: Automatic Vault Context Recall

A hook-based system that gives Claude Code **automatic, persistent memory** by searching a [Napkin](https://github.com/Michaelliv/napkin) knowledge vault on every user message. Includes a custom MCP server that bridges the napkin CLI to Claude Code.

## The Problem

Claude Code has no long-term memory between sessions. You can store notes in a knowledge vault (like Napkin), but Claude won't check them unless you explicitly ask. If you researched something three weeks ago, Claude has no idea it exists.

CLAUDE.md instructions ("always check napkin") are unreliable — Claude may forget, deprioritize, or lose the instruction after context compression.

## The Solution

Two components working together:

1. **MCP Server** — A TypeScript server that wraps the napkin CLI, exposing all vault operations (search, read, create, append, etc.) as MCP tools that Claude Code can use.

2. **UserPromptSubmit Hook** — A shell script that fires on every message you send, injecting a context instruction that tells Claude to search the vault. The hook is deterministic (it's code, not a suggestion), so it never forgets.

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

## Installation

### Prerequisites

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI installed
- [Node.js](https://nodejs.org/) v20+
- `jq` installed (`sudo apt install jq` / `brew install jq`)

### Step 1: Install Napkin CLI

```bash
npm install -g napkin
```

Initialize a vault (default location: `~/.napkin`):

```bash
napkin init
```

You can choose a template during init (`coding`, `personal`, etc.) or start with a blank vault. The vault is just a folder of markdown files — you can also open it in Obsidian if you want a GUI.

### Step 2: Build and Register the MCP Server

Clone this repo and build the MCP server:

```bash
git clone https://github.com/joshideas/claude-napkin-memory.git
cd claude-napkin-memory/mcp-server
npm install
npm run build
```

Register it with Claude Code:

```bash
claude mcp add napkin -s user -- node /path/to/claude-napkin-memory/mcp-server/build/index.js
```

Replace `/path/to/` with the actual path where you cloned the repo. The `-s user` flag makes it available globally across all projects.

Verify it's connected:

```bash
claude mcp list
```

You should see:

```
napkin: node /path/to/claude-napkin-memory/mcp-server/build/index.js - ✓ Connected
```

#### Environment Variables (Optional)

The MCP server supports these environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `NAPKIN_VAULT` | `~/.napkin` | Path to your napkin vault |
| `NAPKIN_BIN` | `napkin` | Path to the napkin CLI binary |

### Step 3: Install the Hook

```bash
mkdir -p ~/.claude/hooks
cp hooks/napkin-context.sh ~/.claude/hooks/napkin-context.sh
chmod +x ~/.claude/hooks/napkin-context.sh
```

### Step 4: Configure settings.json

Add the hook to your `~/.claude/settings.json` (global) or `.claude/settings.json` (per-project):

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

If you already have a `settings.json`, merge the `hooks` key into your existing config. See `settings-example.json` for reference.

### Step 5: Done

Start a new Claude Code session. Every message you send will now trigger a vault search. Store notes with `napkin_create` / `napkin_append` during sessions, and they'll be automatically recalled in future conversations when relevant.

## Project Structure

```
hooks/
  napkin-context.sh       # UserPromptSubmit hook (runs on every prompt)
mcp-server/
  src/
    index.ts              # MCP server source — wraps napkin CLI
  package.json
  tsconfig.json
settings-example.json     # Example settings.json with the hook configured
```

## MCP Server

The MCP server (`mcp-server/`) wraps the napkin CLI and exposes 24 tools to Claude Code:

### Reading / Discovery
| Tool | Description |
|------|-------------|
| `napkin_overview` | Vault map with TF-IDF keywords per folder (Level 1) |
| `napkin_search` | BM25 + backlinks + recency ranked search (Level 2) |
| `napkin_read` | Read full note contents (Level 3) |
| `napkin_vault` | Vault metadata (path, file count, size) |

### Writing
| Tool | Description |
|------|-------------|
| `napkin_create` | Create a new note (with optional template) |
| `napkin_append` | Append content to a note |
| `napkin_prepend` | Prepend content after frontmatter |
| `napkin_delete` | Delete a note (trash or permanent) |
| `napkin_move` | Move a note to a different folder |
| `napkin_rename` | Rename a note |

### Daily Notes
| Tool | Description |
|------|-------------|
| `napkin_daily_today` | Create/access today's daily note |
| `napkin_daily_read` | Read today's daily note |
| `napkin_daily_append` | Append to today's daily note |

### Metadata
| Tool | Description |
|------|-------------|
| `napkin_task_list` | List tasks (checkboxes) across the vault |
| `napkin_tag_list` | List all tags with optional counts |
| `napkin_property_set` | Set YAML frontmatter property |
| `napkin_property_read` | Read a frontmatter property |

### Files & Links
| Tool | Description |
|------|-------------|
| `napkin_file_list` | List files (filter by folder/extension) |
| `napkin_file_outline` | Show heading structure of a note |
| `napkin_link_back` | Find backlinks to a note |
| `napkin_link_out` | Find outgoing links from a note |
| `napkin_link_orphans` | Find notes with no incoming links |
| `napkin_base_query` | Query structured .base files |

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
- **Let it compound**: The more you store, the more context Claude can surface automatically

## License

MIT
