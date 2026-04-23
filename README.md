# Memos Sync Plus

A fork of [RyoJerryYu/obsidian-memos-sync](https://github.com/RyoJerryYu/obsidian-memos-sync) with additional features for tag-based filtering, per-memo file output, and user-owned frontmatter.

Syncs memos from a [Memos](https://github.com/usememos/memos) server into your Obsidian vault.

## What's different in this fork

- **Tag filter** — sync only memos that match an include-tag list, or skip memos that match an exclude-tag list. Unicode-aware, so Japanese / Cyrillic / etc. tags work.
- **Per-memo file output** — instead of appending memos under a header in each day's daily note, write one markdown file per memo with managed frontmatter (`memo_id`, `created`, `memo_url`) and a stable `^memo_id` block anchor.
- **Tag folder routing** — when using per-memo file output, route new memos to different folders based on their first matching tag. Rules are plain `tag: folder` lines, evaluated top-down, first match wins.
- **Manual file moves respected** — move memo files anywhere inside the configured scan scope and the plugin finds them again on re-sync by frontmatter `memo_id`. Routing rules only affect where *new* memos land; existing memos update in place.
- **User-owned frontmatter preserved** — the plugin only rewrites `memo_id`, `created`, and `memo_url`. Any other frontmatter you add (your own `tags:`, custom keys, notes) survives re-syncs unchanged. Server-side tags stay as `#hashtag` in the body, so Obsidian's tag pane picks them up natively.
- **Memo URL backlink** — frontmatter includes a `memo_url:` pointing at the memo in the Memos web UI, so you can jump from Obsidian back to the server to edit. Requires Memos v0.22+ (skipped on v0.19.x).
- **Diagnostics for Memos v0.26.x / v0.27.x** — improved REST error messages when the server is behind Cloudflare Access or similar gateways.

The original daily-note output mode is still the default and behaves the same as upstream.

## Compatibility

Works with the official [Daily Notes](https://help.obsidian.md/Plugins/Daily+notes), [Calendar](https://github.com/liamcain/obsidian-calendar-plugin) and [Periodic Notes](https://github.com/liamcain/obsidian-periodic-notes) plugins (daily-note mode only — per-memo mode has no daily-note dependency).

Supports Memos API versions from v0.19.x through v0.26.x.

## Commands

- **Sync memos** — incremental sync since the last run.
- **Force sync memos** — re-sync everything, ignoring the last-run timestamp.
- **Force sync today's memos** — re-sync memos for the day of the currently open daily note (daily-note mode only).

## Configuration

### Output mode

- **Daily note (legacy)** — append memos under a configurable header in each day's daily note. Matches upstream behaviour.
- **One file per memo** — write one markdown file per memo into a folder of your choice, with optional tag-based routing.

### Per-memo file mode

- **Default folder** — where memos go when no routing rule matches.
- **Tag folder routing** — one rule per line in `tag: folder` form. First matching rule wins; memos with no matching rule fall back to the Default folder. Leading `#` is optional.

  ```
  work: Memos/Work
  가족: Memos/가족
  projet: Memos/Projets
  идея: Memos/Ideas
  日記: Memos/Journal
  ```

- **Scan folders** — comma-separated folders (with descendants) to scan for existing memo files by frontmatter `memo_id`. Existing files are updated in place wherever they live inside scope — routing folders only affect where *new* memos land. Leave empty to auto-scan the Default folder and all routing folders.

  Example: `Memos, Archive, Projects/Notes`

### Frontmatter contract

In per-memo file mode, the plugin owns exactly three frontmatter keys and rewrites them on every sync:

- `memo_id` — stable identifier used to locate the file on later syncs.
- `created` — ISO timestamp.
- `memo_url` — link back to the memo in the Memos web UI (v0.22+ only).

Everything else in the frontmatter block is user-owned and preserved verbatim. Add your own `tags:`, `rating:`, `source:`, whatever — it will survive re-syncs. The body (memo content + attachment links + `^memo_id` anchor) is always overwritten from the server.

**Rule of thumb:** edit the memo body in Memos; annotate with frontmatter in Obsidian.

### Tag filter

- **Include tags** — comma-separated list. Only memos with at least one of these tags are synced. Leave empty to sync everything. Leading `#` is optional; matching is case-insensitive.
- **Exclude tags** — comma-separated list. Memos with any of these tags are skipped. Applied before Include tags, so exclude wins.

### Memos API

- **Memos API version** — pick the range matching your server.
- **Memos API URL** — e.g. `http://localhost:5230`.
- **Memos API token** — create one from the Memos UI under Settings → My Account.

## FAQ

### Can I edit memos in Obsidian and push back to Memos?

No — sync is one-way (Memos → Obsidian). Any body edits you make in Obsidian will be overwritten on the next sync. Use the `memo_url` frontmatter link to jump back to the Memos UI for editing.

### What happens if I move a memo file to a different folder?

Nothing breaks — as long as the destination is inside the configured scan scope, the plugin finds the file again by `memo_id` and updates it in place. Routing rules only apply to memos the plugin has never seen before.

### Will my Obsidian-added frontmatter survive a sync?

Yes. Only `memo_id`, `created`, and `memo_url` are managed by the plugin. Any other keys (including a user-added `tags:` list) are preserved verbatim.

### "Failed to find header for xxxx"

The daily-note output mode inserts memos under a specific header. If your daily-note template doesn't contain that header, the plugin has nowhere to insert. Either update your template to include the header, or switch to per-memo file output.

## Credits

- Upstream: [RyoJerryYu/obsidian-memos-sync](https://github.com/RyoJerryYu/obsidian-memos-sync)
- The original project credits [obsidian-lifeos](https://github.com/quanru/obsidian-lifeos) as an early reference.
