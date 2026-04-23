# Obsidian Memos Sync (Fork)

This is a fork of [RyoJerryYu/obsidian-memos-sync](https://github.com/RyoJerryYu/obsidian-memos-sync) with additional features for tag-based filtering and routing.

Syncs memos from a [Memos](https://github.com/usememos/memos) server into your Obsidian vault.

## What's different in this fork

- **Tag filter** — sync only memos that match an include-tag list, or skip memos that match an exclude-tag list. Unicode-aware, so Japanese / Cyrillic / etc. tags work.
- **Per-memo file output** — instead of appending memos under a header in each day's daily note, write one markdown file per memo with frontmatter (`memo_id`, `created`, `tags`) and a stable `^memo_id` block anchor.
- **Tag folder routing** — when using per-memo file output, route memos to different folders based on their first matching tag. Rules are plain `tag: folder` lines, evaluated top-down, first match wins.
- **Diagnostics for Memos v0.26.x / v0.27.x** — improved REST error messages when the server is behind Cloudflare Access or similar gateways.

The original daily-note output mode is still the default and behaves the same as upstream.

## Compatibility

Works with the official [Daily Notes](https://help.obsidian.md/Plugins/Daily+notes), [Calendar](https://github.com/liamcain/obsidian-calendar-plugin) and [Periodic Notes](https://github.com/liamcain/obsidian-periodic-notes) plugins.

Supports Memos API versions from v0.19.x through v0.26.x.

## Commands

- **Sync daily memos** — incremental sync since the last run.
- **Force sync daily memos** — re-sync everything, ignoring the last-run timestamp.
- **Force sync current daily memos** — re-sync memos for the day of the currently open daily note (daily-note mode only).

## Configuration

### Output mode

- **Daily note (legacy)** — append memos under a configurable header in each day's daily note. Matches upstream behaviour.
- **One file per memo** — write one markdown file per memo into a folder of your choice, with tag-based routing.

### Tag filter

- **Include tags** — comma-separated list. Only memos with at least one of these tags are synced. Leave empty to sync everything. Leading `#` is optional; matching is case-insensitive.
- **Exclude tags** — comma-separated list. Memos with any of these tags are skipped. Applied before Include tags, so exclude wins.

### Tag folder routing (per-memo file mode only)

One rule per line in `tag: folder` form. First matching rule wins; memos with no matching rule fall back to the Default folder.

```
work: Memos/Work
子育て: Memos/家族
projet: Memos/Projets
идея: Memos/Ideas
日記: Memos/Journal
```

### Memos API

- **Memos API version** — pick the range matching your server.
- **Memos API URL** — e.g. `http://localhost:5230`.
- **Memos API token** — create one from the Memos UI under Settings → My Account.

## FAQ

### "Failed to find header for xxxx"

The daily-note output mode inserts memos under a specific header. If your daily-note template doesn't contain that header, the plugin has nowhere to insert. Either update your template to include the header, or switch to per-memo file output.

## Credits

- Upstream: [RyoJerryYu/obsidian-memos-sync](https://github.com/RyoJerryYu/obsidian-memos-sync)
- The original project credits [obsidian-lifeos](https://github.com/quanru/obsidian-lifeos) as an early reference.
