#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const VAULT_PATH = process.env.NAPKIN_VAULT || `${process.env.HOME}/.napkin`;
const NAPKIN_BIN = process.env.NAPKIN_BIN || "napkin";
const TIMEOUT = 15_000;

// ── Helper ─────────────────────────────────────────────────────────

async function napkin(
  args: string[],
): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> {
  try {
    const { stdout } = await execFileAsync(
      NAPKIN_BIN,
      ["--vault", VAULT_PATH, "--json", ...args],
      { timeout: TIMEOUT },
    );
    return { ok: true, data: JSON.parse(stdout) };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
}

function text(value: unknown): { content: { type: "text"; text: string }[] } {
  const s = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return { content: [{ type: "text" as const, text: s }] };
}

function fail(
  msg: string,
): { content: { type: "text"; text: string }[]; isError: true } {
  return { content: [{ type: "text" as const, text: msg }], isError: true };
}

// ── Server ─────────────────────────────────────────────────────────

const server = new McpServer(
  { name: "napkin", version: "1.0.0" },
  {
    instructions: [
      "Napkin is a local-first, file-based knowledge vault.",
      "Use the progressive disclosure workflow: overview → search → read.",
      "Start with napkin_overview to orient, then napkin_search to find specific notes,",
      "then napkin_read to get full content. Write with napkin_create/napkin_append.",
      "All notes are markdown files with optional YAML frontmatter.",
    ].join(" "),
  },
);

// ── Tools ──────────────────────────────────────────────────────────

// -- Reading / Discovery --

server.registerTool(
  "napkin_overview",
  {
    title: "Vault Overview",
    description:
      "Get the vault map with TF-IDF keywords per folder. This is Level 1 progressive disclosure — use it first to orient yourself before searching.",
    inputSchema: {
      depth: z
        .number()
        .optional()
        .describe("Max folder depth (default: from config)"),
      keywords: z
        .number()
        .optional()
        .describe("Max keywords per folder (default: from config)"),
    },
  },
  async ({ depth, keywords }) => {
    const args = ["overview"];
    if (depth !== undefined) args.push("--depth", String(depth));
    if (keywords !== undefined) args.push("--keywords", String(keywords));
    const result = await napkin(args);
    return result.ok ? text(result.data) : fail(result.error);
  },
);

server.registerTool(
  "napkin_search",
  {
    title: "Search Vault",
    description:
      "Search the vault using BM25 + backlinks + recency ranking. Returns ranked results with snippets. Level 2 progressive disclosure.",
    inputSchema: {
      query: z.string().describe("Search query text"),
      limit: z
        .number()
        .optional()
        .describe("Max results (default: 30)"),
      path: z
        .string()
        .optional()
        .describe("Limit search to a specific folder"),
      snippet_lines: z
        .number()
        .optional()
        .describe("Context lines around matches (default: from config)"),
    },
  },
  async ({ query, limit, path, snippet_lines }) => {
    const args = ["search", "--query", query];
    if (limit !== undefined) args.push("--limit", String(limit));
    if (path) args.push("--path", path);
    if (snippet_lines !== undefined)
      args.push("--snippet-lines", String(snippet_lines));
    const result = await napkin(args);
    return result.ok ? text(result.data) : fail(result.error);
  },
);

server.registerTool(
  "napkin_read",
  {
    title: "Read Note",
    description:
      "Read the full contents of a note. Accepts a wikilink-style name (e.g. 'Architecture') or a path (e.g. 'decisions/auth.md'). Level 3 progressive disclosure.",
    inputSchema: {
      file: z.string().describe("File name or path to read"),
    },
  },
  async ({ file }) => {
    const result = await napkin(["read", file]);
    return result.ok ? text(result.data) : fail(result.error);
  },
);

server.registerTool(
  "napkin_vault",
  {
    title: "Vault Info",
    description: "Show vault metadata: name, path, file count, size.",
    inputSchema: {},
  },
  async () => {
    const result = await napkin(["vault"]);
    return result.ok ? text(result.data) : fail(result.error);
  },
);

// -- Writing --

server.registerTool(
  "napkin_create",
  {
    title: "Create Note",
    description: "Create a new markdown note in the vault.",
    inputSchema: {
      name: z.string().describe("Note name (becomes the filename)"),
      content: z
        .string()
        .optional()
        .describe("Initial content (markdown)"),
      path: z
        .string()
        .optional()
        .describe("Folder path from vault root (e.g. 'decisions')"),
      template: z
        .string()
        .optional()
        .describe("Template name to scaffold from"),
    },
  },
  async ({ name, content, path, template }) => {
    const args = ["create", "--name", name];
    if (content) args.push("--content", content);
    if (path) args.push("--path", path);
    if (template) args.push("--template", template);
    const result = await napkin(args);
    return result.ok ? text(result.data) : fail(result.error);
  },
);

server.registerTool(
  "napkin_append",
  {
    title: "Append to Note",
    description: "Append content to the end of an existing note.",
    inputSchema: {
      file: z.string().describe("Target file name or path"),
      content: z.string().describe("Content to append"),
    },
  },
  async ({ file, content }) => {
    const result = await napkin(["append", "--file", file, "--content", content]);
    return result.ok ? text(result.data) : fail(result.error);
  },
);

server.registerTool(
  "napkin_prepend",
  {
    title: "Prepend to Note",
    description:
      "Prepend content to a note (inserted after frontmatter if present).",
    inputSchema: {
      file: z.string().describe("Target file name or path"),
      content: z.string().describe("Content to prepend"),
    },
  },
  async ({ file, content }) => {
    const result = await napkin([
      "prepend",
      "--file",
      file,
      "--content",
      content,
    ]);
    return result.ok ? text(result.data) : fail(result.error);
  },
);

server.registerTool(
  "napkin_delete",
  {
    title: "Delete Note",
    description: "Delete a note (moves to .trash by default).",
    inputSchema: {
      file: z.string().describe("File name or path to delete"),
      permanent: z
        .boolean()
        .optional()
        .describe("Skip trash and delete permanently"),
    },
  },
  async ({ file, permanent }) => {
    const args = ["delete", "--file", file];
    if (permanent) args.push("--permanent");
    const result = await napkin(args);
    return result.ok ? text(result.data) : fail(result.error);
  },
);

server.registerTool(
  "napkin_move",
  {
    title: "Move Note",
    description: "Move a note to a different folder.",
    inputSchema: {
      file: z.string().describe("File name or path to move"),
      to: z.string().describe("Destination folder or full path"),
    },
  },
  async ({ file, to }) => {
    const result = await napkin(["move", "--file", file, "--to", to]);
    return result.ok ? text(result.data) : fail(result.error);
  },
);

server.registerTool(
  "napkin_rename",
  {
    title: "Rename Note",
    description: "Rename a note.",
    inputSchema: {
      file: z.string().describe("Current file name or path"),
      name: z.string().describe("New name"),
    },
  },
  async ({ file, name }) => {
    const result = await napkin(["rename", "--file", file, "--name", name]);
    return result.ok ? text(result.data) : fail(result.error);
  },
);

// -- Daily Notes --

server.registerTool(
  "napkin_daily_today",
  {
    title: "Create Daily Note",
    description: "Create or access today's daily note.",
    inputSchema: {},
  },
  async () => {
    const result = await napkin(["daily", "today"]);
    return result.ok ? text(result.data) : fail(result.error);
  },
);

server.registerTool(
  "napkin_daily_read",
  {
    title: "Read Daily Note",
    description: "Read today's daily note contents.",
    inputSchema: {},
  },
  async () => {
    const result = await napkin(["daily", "read"]);
    return result.ok ? text(result.data) : fail(result.error);
  },
);

server.registerTool(
  "napkin_daily_append",
  {
    title: "Append to Daily Note",
    description: "Append content to today's daily note.",
    inputSchema: {
      content: z.string().describe("Content to append"),
    },
  },
  async ({ content }) => {
    const result = await napkin(["daily", "append", "--content", content]);
    return result.ok ? text(result.data) : fail(result.error);
  },
);

// -- Metadata --

server.registerTool(
  "napkin_task_list",
  {
    title: "List Tasks",
    description: "List tasks (checkboxes) across the vault.",
    inputSchema: {
      file: z
        .string()
        .optional()
        .describe("Filter to a specific file"),
      todo: z
        .boolean()
        .optional()
        .describe("Show only incomplete tasks"),
      done: z
        .boolean()
        .optional()
        .describe("Show only completed tasks"),
      daily: z
        .boolean()
        .optional()
        .describe("Show tasks from today's daily note"),
    },
  },
  async ({ file, todo, done, daily }) => {
    const args = ["task", "list"];
    if (file) args.push("--file", file);
    if (todo) args.push("--todo");
    if (done) args.push("--done");
    if (daily) args.push("--daily");
    const result = await napkin(args);
    return result.ok ? text(result.data) : fail(result.error);
  },
);

server.registerTool(
  "napkin_tag_list",
  {
    title: "List Tags",
    description: "List all tags in the vault with optional counts.",
    inputSchema: {
      counts: z
        .boolean()
        .optional()
        .describe("Include occurrence counts"),
      sort: z
        .enum(["name", "count"])
        .optional()
        .describe("Sort by name or count"),
    },
  },
  async ({ counts, sort }) => {
    const args = ["tag", "list"];
    if (counts) args.push("--counts");
    if (sort) args.push("--sort", sort);
    const result = await napkin(args);
    return result.ok ? text(result.data) : fail(result.error);
  },
);

server.registerTool(
  "napkin_property_set",
  {
    title: "Set Property",
    description: "Set a YAML frontmatter property on a note.",
    inputSchema: {
      file: z.string().describe("Target file name or path"),
      name: z.string().describe("Property name"),
      value: z.string().describe("Property value"),
    },
  },
  async ({ file, name, value }) => {
    const result = await napkin([
      "property",
      "set",
      "--file",
      file,
      "--name",
      name,
      "--value",
      value,
    ]);
    return result.ok ? text(result.data) : fail(result.error);
  },
);

server.registerTool(
  "napkin_property_read",
  {
    title: "Read Property",
    description: "Read a specific frontmatter property from a note.",
    inputSchema: {
      file: z.string().describe("Target file name or path"),
      name: z.string().describe("Property name"),
    },
  },
  async ({ file, name }) => {
    const result = await napkin([
      "property",
      "read",
      "--file",
      file,
      "--name",
      name,
    ]);
    return result.ok ? text(result.data) : fail(result.error);
  },
);

// -- Files & Folders --

server.registerTool(
  "napkin_file_list",
  {
    title: "List Files",
    description: "List all files in the vault, optionally filtered by folder or extension.",
    inputSchema: {
      folder: z
        .string()
        .optional()
        .describe("Filter to a specific folder"),
      ext: z
        .string()
        .optional()
        .describe("Filter by file extension (e.g. 'md')"),
    },
  },
  async ({ folder, ext }) => {
    const args = ["file", "list"];
    if (folder) args.push("--folder", folder);
    if (ext) args.push("--ext", ext);
    const result = await napkin(args);
    return result.ok ? text(result.data) : fail(result.error);
  },
);

server.registerTool(
  "napkin_file_outline",
  {
    title: "File Outline",
    description:
      "Show the heading structure of a note. Useful for understanding a file before reading it fully.",
    inputSchema: {
      file: z.string().describe("File name or path"),
    },
  },
  async ({ file }) => {
    const result = await napkin(["file", "outline", "--file", file]);
    return result.ok ? text(result.data) : fail(result.error);
  },
);

// -- Links & Graph --

server.registerTool(
  "napkin_link_back",
  {
    title: "Backlinks",
    description: "List notes that link TO a given note.",
    inputSchema: {
      file: z.string().describe("Target file name or path"),
    },
  },
  async ({ file }) => {
    const result = await napkin(["link", "back", "--file", file]);
    return result.ok ? text(result.data) : fail(result.error);
  },
);

server.registerTool(
  "napkin_link_out",
  {
    title: "Outgoing Links",
    description: "List outgoing links FROM a given note.",
    inputSchema: {
      file: z.string().describe("Source file name or path"),
    },
  },
  async ({ file }) => {
    const result = await napkin(["link", "out", "--file", file]);
    return result.ok ? text(result.data) : fail(result.error);
  },
);

server.registerTool(
  "napkin_link_orphans",
  {
    title: "Orphan Notes",
    description: "Find notes with no incoming links (potentially forgotten).",
    inputSchema: {},
  },
  async () => {
    const result = await napkin(["link", "orphans"]);
    return result.ok ? text(result.data) : fail(result.error);
  },
);

// -- Bases (structured queries) --

server.registerTool(
  "napkin_base_query",
  {
    title: "Query Base",
    description:
      "Query a .base file (YAML-defined view over vault files with filters, formulas, and grouping). Returns structured results from an in-memory SQLite query.",
    inputSchema: {
      file: z.string().describe("Base file name"),
      view: z
        .string()
        .optional()
        .describe("Named view to query (defaults to first view)"),
    },
  },
  async ({ file, view }) => {
    const args = ["base", "query", "--file", file];
    if (view) args.push("--view", view);
    const result = await napkin(args);
    return result.ok ? text(result.data) : fail(result.error);
  },
);

// ── Start ──────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`napkin MCP server running (vault: ${VAULT_PATH})`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
