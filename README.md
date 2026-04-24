# Memos Sync Plus

A fork of [RyoJerryYu/obsidian-memos-sync](https://github.com/RyoJerryYu/obsidian-memos-sync) that syncs memos from a [Memos](https://github.com/usememos/memos) server into your Obsidian vault.

## Why this fork

I love Memos. It's so frictionless for capturing everything. Thoughts, links, half-formed ideas... that it became my default dump for anything that crossed my mind.

But over time I wanted those captures to integrate with my Obsidian notes, where I can connect them to my existing knowledge base and feed them into LLM workflows. The original plugin got me most of the way there, but I needed more control over where things landed: complex tag routing, per-memo files with stable identities, frontmatter I could annotate without losing on the next sync.

So I forked it, and here we are :)

## What it does

One-way sync from a Memos server into your Obsidian vault. Two output modes:

- **Daily note mode** *(default)* — memos are appended under a configurable header inside each day's daily note.
- **Per-memo file mode** — each memo becomes its own `.md` file with managed frontmatter, optional folder routing by tag, and user-owned metadata that survives re-syncs.

Edit memos in Memos, annotate them with frontmatter in Obsidian. Syncing is Memos → Obsidian only; the plugin never writes back to the server.

## Compatibility

- Memos API: v0.19.x through v0.26.x (v0.27.x supported via REST path with improved diagnostics when the server is behind Cloudflare Access).
- Daily note mode requires the official [Daily Notes](https://help.obsidian.md/Plugins/Daily+notes), [Calendar](https://github.com/liamcain/obsidian-calendar-plugin), or [Periodic Notes](https://github.com/liamcain/obsidian-periodic-notes) plugin. Per-memo mode has no daily-note dependency.
- Desktop only.

## Commands

| Command | What it does |
| --- | --- |
| **Sync memos** | Incremental sync since the last run. |
| **Force sync memos** | Re-sync everything, ignoring the last-run timestamp. Also the trigger for orphan handling. |
| **Force sync today's memos** | Daily-note mode only — re-sync memos for the day of the currently open daily note. |

---

## Output modes

### Daily note mode

Appends each synced memo as a bullet under a configurable header inside that day's daily note.

Settings:

- **Daily memos header** — the markdown header the plugin inserts under (e.g. `## Memos`). Your daily-note template must include this header, otherwise the plugin has nowhere to insert.

### Per-memo file mode

Writes one markdown file per memo. Each file has managed frontmatter (`memo_id`, `created`, `memo_url`), user-owned everything-else, and a stable `^<memo_id>` block anchor at the bottom.

Filename pattern: `YYYY-MM-DD-HHmm.md` in the target folder, with numeric suffixes on collision (`-01`, `-02`, …).

Settings:

- **Default folder** — where memos go when no routing rule matches.

---

## Features (per-memo file mode)

### Tag folder routing

Route new memos into different folders based on their tags. One rule per line, `tag: folder`. Evaluated top-down, first match wins; memos with no matching rule fall back to the default folder. Leading `#` is optional, matching is case-insensitive, Unicode-aware.

```
work: Memos/Work
読書: Memos/読書
projet: Memos/Projets
идея: Memos/идея
日記: Memos/Journal
papala: Song Writing Projects/Lyrics & Drafts/papala/Idea Notes/
```

Folder paths can contain spaces, mixed scripts, and as many `/`-separated levels as you want — the plugin creates the whole tree for you. Only the first `:` on a line separates the tag from the folder, so `:` is safe inside folder names too.

Routing only affects **where new memos land**. Existing memos update in place wherever they currently live (see *Manual file moves*).

### Manual file moves respected

Move any synced memo file anywhere inside the configured scan scope and the plugin will find it again by frontmatter `memo_id` on the next sync. Useful when reorganising files, or when your routing rules change — old memos don't get migrated or re-routed.

Settings:

- **Scan folders** — comma-separated folders (with descendants) the plugin searches for existing `memo_id`s. Leave empty to auto-derive from the default folder + all routing-rule folders.

  Example: `Memos, Archive, Projects/Notes`

### User-owned frontmatter

The plugin owns exactly four frontmatter keys and rewrites them on every sync:

| Key | Meaning |
| --- | --- |
| `memo_id` | Stable identifier the plugin uses to locate the file on later syncs. |
| `created` | ISO timestamp of the memo's creation. |
| `memo_url` | Deep link back to the memo in the Memos web UI (v0.22+). |
| `deleted` | ISO timestamp added when the memo is detected as an orphan (see *Orphan handling*). Stripped on un-deletion. |

**Everything else in the frontmatter block is user-owned and preserved verbatim.** Add your own `tags:`, `rating:`, `source:`, whatever — it survives re-syncs. The body (memo content + attachment links + `^<memo_id>` anchor) is always overwritten from the server.

Server-side hashtags like `#work` live in the body, not in `tags:`, so Obsidian's tag pane picks them up natively while you keep full control of the `tags:` frontmatter list.

### Memo URL backlink

Each synced file's frontmatter includes `memo_url: https://<your-memos-host>/m/<uid>`, a one-click jump back to the memo in the Memos web UI for editing. Requires Memos v0.22+; skipped on v0.19.x.

### Orphan handling

When a memo is deleted on the Memos server, its corresponding local `.md` file is orphaned — the plugin never fetches it again, so the file sits silently stale. Orphan handling lets you opt in to doing something about it.

Orphan detection runs **only during force sync** (when the full server list is walked). Scope is limited to the configured scan folders. Nothing happens during regular `Sync memos`.

Options (setting: **Orphan handling**):

| Option | What happens to orphan files |
| --- | --- |
| **Keep** *(default)* | Nothing. Files stay as-is. |
| **Mark** | Plugin adds `deleted: <ISO>` to managed frontmatter and appends a `#memos-deleted` hashtag to the body. File stays in place, shows up in Obsidian's tag pane for easy filtering. |
| **Delete** | File is moved to the system trash (reversible via OS). Shown in a confirmation dialog listing affected files before anything is touched. |

Additional setting (mark mode only):

- **Orphan marker tag** — customise the hashtag (default `memos-deleted`).

**Un-deletion recovers automatically.** If a memo re-appears on the server (un-archived, or you recreate it and paste the same content), the next sync overwrites the local file as usual, which strips the `deleted:` key and the marker. No manual cleanup needed.

### Tag filter

Applies to both output modes — controls which memos get synced at all.

Settings:

- **Include tags** — comma-separated. Only memos carrying at least one of these tags are synced. Empty = sync everything.
- **Exclude tags** — comma-separated. Memos carrying any of these tags are skipped. Applied before include (exclude wins).

Leading `#` is optional, matching is case-insensitive, Unicode-aware.

---

## Memos API settings

- **Memos API version** — pick the range matching your server. Routes internally to the right REST/gRPC adapter.
- **Memos API URL** — e.g. `http://localhost:5230`. No trailing slash needed.
- **Memos API token** — create one from the Memos UI under Settings → My Account.

### Attachment folder

Where downloaded attachments go. Default `Attachments`.

---

## FAQ

### Can I edit memos in Obsidian and push back to Memos?

No — sync is one-way (Memos → Obsidian). Any body edits you make in Obsidian will be overwritten on the next sync. Use the `memo_url` frontmatter link to jump back to the Memos UI for editing.

### What happens if I move a memo file to a different folder?

Nothing breaks — as long as the destination is inside the configured scan scope, the plugin finds the file again by `memo_id` and updates it in place. Routing rules only apply to memos the plugin has never seen before.

### Will my Obsidian-added frontmatter survive a sync?

Yes. Only `memo_id`, `created`, `memo_url`, and `deleted` are managed by the plugin. Any other keys (including a user-added `tags:` list) are preserved verbatim.

### How do I find all orphan files?

Set Orphan handling to **Mark**, then click Obsidian's tag pane and filter by `#memos-deleted` — or run a search query for `tag:#memos-deleted`.

### "Failed to find header for xxxx"

Daily-note mode only. The plugin inserts memos under a specific header; if your daily-note template doesn't include it, there's nowhere to insert. Either update your template, or switch to per-memo file mode.

---

## Credits

- Upstream: [RyoJerryYu/obsidian-memos-sync](https://github.com/RyoJerryYu/obsidian-memos-sync)
- The original project credits [obsidian-lifeos](https://github.com/quanru/obsidian-lifeos) as an early reference.
