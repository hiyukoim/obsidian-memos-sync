import { App, Modal, Setting, TFile, normalizePath } from "obsidian";
import { MemosSyncPluginSettings } from "@/types/PluginSettings";
import * as log from "@/utils/log";
import { MemoItem } from "./MemosPaginator";

export type OrphanSummary = {
	marked: number;
	deleted: number;
	kept: number;
};

// Keys the plugin owns and rewrites on every sync. Everything else in an
// existing file's frontmatter is treated as user-owned and preserved verbatim.
const MANAGED_KEYS = new Set(["memo_id", "created", "memo_url", "deleted"]);

// Route a memo to a folder by the first matching tag rule, else the default.
// Matching is case-insensitive; both sides are stored lowercased by settings parsing.
function pickFolder(
	item: MemoItem,
	settings: MemosSyncPluginSettings
): string {
	for (const rule of settings.tagFolderRules) {
		if (!rule.tag || !rule.folder) continue;
		if (item.tags.includes(rule.tag)) {
			return rule.folder;
		}
	}
	return settings.perMemoFolder || "Memos";
}

// Strip `/api/v1` suffix and trailing slash, then append `/m/<uid>`.
export function buildMemoUrl(apiUrl: string, uid: string): string {
	const host = apiUrl.replace(/\/api\/v1\/?$/, "").replace(/\/$/, "");
	return `${host}/m/${uid}`;
}

// Split a file into (frontmatter lines, body). The frontmatter lines are the
// raw lines between the leading `---` and the closing `---`, verbatim. If no
// valid frontmatter block is present, returns an empty array and the entire
// input as body. The closing `---` and the newline after it are consumed.
export function splitFrontmatter(md: string): {
	fmLines: string[];
	body: string;
} {
	if (!md.startsWith("---\n")) return { fmLines: [], body: md };
	const rest = md.slice(4);
	const closeIdx = rest.indexOf("\n---");
	if (closeIdx === -1) return { fmLines: [], body: md };
	const fmBlock = rest.slice(0, closeIdx);
	let after = rest.slice(closeIdx + 4); // skip "\n---"
	if (after.startsWith("\n")) after = after.slice(1);
	return { fmLines: fmBlock.split("\n"), body: after };
}

// Return the top-level key on a YAML frontmatter line, or null if the line is
// a list item, continuation, comment, or blank. We only need to recognise the
// managed scalar keys — anything more complex (user's nested structures) just
// passes through untouched because its top-level key isn't in MANAGED_KEYS.
function topLevelKey(line: string): string | null {
	if (!line || line.startsWith(" ") || line.startsWith("\t")) return null;
	if (line.startsWith("#")) return null;
	const m = line.match(/^([A-Za-z_][A-Za-z0-9_-]*)\s*:/);
	return m ? m[1] : null;
}

// Drop managed keys from existing frontmatter, preserving everything else
// (including user-added `tags:` in any form, custom keys, comments, blank lines).
// A managed scalar key line like `memo_id: 123` is removed; multi-line values
// under managed keys aren't produced by this plugin, so we only drop the single line.
function stripManagedKeys(fmLines: string[]): string[] {
	const out: string[] = [];
	for (const line of fmLines) {
		const key = topLevelKey(line);
		if (key && MANAGED_KEYS.has(key)) continue;
		out.push(line);
	}
	return out;
}

// Build the full file contents. Managed keys are written first; preserved
// user lines follow. Body is overwritten from server state.
function formatMemoBody(
	item: MemoItem,
	createdISO: string,
	preservedFmLines: string[],
	memoUrl?: string
): string {
	const managed: string[] = [
		`memo_id: ${item.uid || item.timestamp}`,
		`created: ${createdISO}`,
	];
	if (memoUrl) managed.push(`memo_url: ${memoUrl}`);

	const fmInner = [...managed, ...preservedFmLines].join("\n");
	const frontmatter = `---\n${fmInner}\n---\n`;
	const body = item.rawContent.trim();
	const resources = item.resourceLines.length
		? "\n\n" + item.resourceLines.join("\n")
		: "";
	const anchor = `\n\n^${item.timestamp}\n`;
	return frontmatter + body + resources + anchor;
}

// True if `path` is equal to, or a descendant of, `root`.
function isUnder(path: string, root: string): boolean {
	if (!root) return false;
	return path === root || path.startsWith(root + "/");
}

export class PerMemoFileWriter {
	// memo_id -> current vault path. Built lazily per sync, scans .md files
	// under the configured scan scope so an existing memo can be located and
	// updated in place regardless of which folder the user has placed it in.
	private memoIndex: Map<string, string> | null = null;

	constructor(
		private app: App,
		private settings: MemosSyncPluginSettings
	) {}

	// Folders searched when locating an existing memo by memo_id.
	// Defaults to perMemoFolder + all routing folders when user hasn't configured.
	private scanScope = (): string[] => {
		const configured = this.settings.scanFolders ?? [];
		if (configured.length > 0) return configured;
		const defaultFolder = this.settings.perMemoFolder || "Memos";
		const ruleFolders = this.settings.tagFolderRules
			.map((r) => r.folder)
			.filter((f) => !!f);
		return [defaultFolder, ...ruleFolders];
	};

	private isInScope = (path: string): boolean =>
		this.scanScope().some((root) => isUnder(path, root));

	writeMemo = async (item: MemoItem): Promise<void> => {
		const folder = pickFolder(item, this.settings);
		await this.ensureFolder(folder);

		const createdMoment = window.moment(Number(item.timestamp) * 1000);
		const base = createdMoment.format("YYYY-MM-DD-HHmm");
		const createdISO = createdMoment.format();
		const anchor = `^${item.timestamp}`;
		const memoUrl = item.uid
			? buildMemoUrl(this.settings.memosAPIURL, item.uid)
			: undefined;

		const index = await this.buildIndex();
		// Prefer uid lookup (new memo_id format) for already-migrated files; fall
		// back to timestamp (legacy format) so old files still match in place.
		const memoIdKey = item.uid || item.timestamp;
		const existingPath =
			(item.uid && index.get(item.uid)) ||
			index.get(String(item.timestamp));

		let targetPath: string;

		if (existingPath) {
			// Existing memo — always update in place. Folder routing only affects
			// new memos, so the user is free to reorganise files after sync.
			targetPath = existingPath;
		} else {
			const slot = await this.findOpenSlot(
				folder,
				base,
				anchor,
				String(memoIdKey)
			);
			if (!slot) {
				log.warn(
					`Per-memo: exhausted collision slots for ${base} in ${folder}, skipping`
				);
				return;
			}
			targetPath = slot;
		}

		let preservedFmLines: string[] = [];
		if (await this.app.vault.adapter.exists(targetPath)) {
			const current = await this.app.vault.adapter.read(targetPath);
			if (current.includes(anchor)) {
				const { fmLines } = splitFrontmatter(current);
				preservedFmLines = stripManagedKeys(fmLines);
			}
		}

		const body = formatMemoBody(item, createdISO, preservedFmLines, memoUrl);
		await this.app.vault.adapter.write(targetPath, body);
		// Index by the memo_id we just wrote so subsequent same-sync lookups find it.
		index.set(String(memoIdKey), targetPath);
		log.debug(
			`Per-memo: wrote ${targetPath} (${preservedFmLines.length} user fm lines preserved)`
		);
	};

	// Returns a path in `folder` that is either free or already holds this memo.
	// "Holds this memo" means: file's frontmatter `memo_id` equals the expected
	// one, OR (legacy fallback for files written before the memo_id was managed)
	// the body contains the timestamp anchor AND no memo_id is present.
	// Two memos created in the same minute that share a base filename get
	// distinct suffixes (`-01`, `-02`, …) iff their memo_ids differ — which is
	// the case for v0.22+ uids even when the underlying timestamp collides.
	// Returns null if all 100 slots are taken by *other* memos.
	private findOpenSlot = async (
		folder: string,
		base: string,
		anchor: string,
		expectedMemoId: string
	): Promise<string | null> => {
		for (let i = 0; i <= 99; i++) {
			const suffix = i === 0 ? "" : `-${String(i).padStart(2, "0")}`;
			const path = normalizePath(`${folder}/${base}${suffix}.md`);
			if (!(await this.app.vault.adapter.exists(path))) return path;
			const current = await this.app.vault.adapter.read(path);
			const { fmLines } = splitFrontmatter(current);
			const existingMemoId = fmLines
				.map((line) => {
					const m = line.match(/^memo_id:\s*(.+?)\s*$/);
					return m ? m[1] : null;
				})
				.find((v) => v != null);
			if (existingMemoId) {
				// Frontmatter memo_id is authoritative — exact match means ours.
				if (existingMemoId === expectedMemoId) return path;
				continue; // collision: same minute slot, different memo
			}
			// Legacy file with no managed memo_id: fall back to anchor heuristic
			// only when the caller's identity is the timestamp itself (no uid).
			if (
				expectedMemoId === anchor.slice(1) &&
				current.includes(anchor)
			) {
				return path;
			}
		}
		return null;
	};

	// Scans all vault markdown files once per sync, indexing by frontmatter memo_id.
	// Uses metadataCache when available; falls back to reading frontmatter directly.
	private buildIndex = async (): Promise<Map<string, string>> => {
		if (this.memoIndex) return this.memoIndex;
		const index = new Map<string, string>();
		const files = this.app.vault.getMarkdownFiles();
		for (const file of files) {
			if (!this.isInScope(file.path)) continue;
			const cached = this.app.metadataCache.getFileCache(file);
			const memoId = cached?.frontmatter?.memo_id;
			if (memoId != null) {
				index.set(String(memoId), file.path);
			}
		}
		this.memoIndex = index;
		log.debug(
			`Per-memo: indexed ${index.size} memo files across ${this.scanScope().length} scan folder(s)`
		);
		return index;
	};

	// Called after a force sync to reconcile local files against the seen server
	// memos. Any indexed file whose memo_id isn't in `seen` is treated as an orphan
	// and handled per settings.orphanHandling.
	handleOrphans = async (
		seenTimestamps: Set<string>
	): Promise<OrphanSummary> => {
		const mode = this.settings.orphanHandling ?? "keep";
		const summary: OrphanSummary = { marked: 0, deleted: 0, kept: 0 };
		if (mode === "keep") return summary;

		const index = await this.buildIndex();
		const orphans: Array<{ memoId: string; path: string }> = [];
		for (const [memoId, path] of index) {
			if (!seenTimestamps.has(memoId)) {
				orphans.push({ memoId, path });
			}
		}
		if (orphans.length === 0) return summary;

		if (mode === "mark") {
			const tag = (this.settings.orphanMarkerTag || "memos-deleted")
				.replace(/^#/, "")
				.trim();
			for (const { path } of orphans) {
				if (!(await this.app.vault.adapter.exists(path))) continue;
				const current = await this.app.vault.adapter.read(path);
				const { fmLines, body } = splitFrontmatter(current);
				const alreadyMarked = fmLines.some(
					(line) => topLevelKey(line) === "deleted"
				);
				if (alreadyMarked) {
					summary.kept += 1;
					continue;
				}
				const nowISO = window.moment().format();
				const userFm = stripManagedKeys(fmLines);
				const managed: string[] = [];
				for (const line of fmLines) {
					const key = topLevelKey(line);
					if (key && MANAGED_KEYS.has(key) && key !== "deleted") {
						managed.push(line);
					}
				}
				managed.push(`deleted: ${nowISO}`);
				const newFm = `---\n${[...managed, ...userFm].join("\n")}\n---\n`;
				const marker = `#${tag}`;
				const bodyTrimmed = body.replace(/\s+$/, "");
				const needsMarker = !bodyTrimmed.includes(marker);
				const newBody = needsMarker
					? `${bodyTrimmed}\n\n${marker}\n`
					: body;
				await this.app.vault.adapter.write(path, newFm + newBody);
				summary.marked += 1;
				log.debug(`Orphan marked: ${path}`);
			}
			return summary;
		}

		// mode === "delete" — confirm first, then trash on approval
		const confirmed = await confirmOrphanDelete(this.app, orphans);
		if (!confirmed) {
			summary.kept = orphans.length;
			return summary;
		}
		for (const { path } of orphans) {
			const file = this.app.vault.getAbstractFileByPath(path);
			if (file instanceof TFile) {
				await this.app.vault.trash(file, true);
				summary.deleted += 1;
				log.debug(`Orphan trashed: ${path}`);
			}
		}
		return summary;
	};

	private ensureFolder = async (folder: string) => {
		const normalized = normalizePath(folder);
		if (!this.app.vault.getFolderByPath(normalized)) {
			log.info(`Creating folder: ${normalized}`);
			await this.app.vault.createFolder(normalized).catch((e) => {
				// another async write may have created it first
				log.debug(`createFolder ${normalized}: ${e}`);
			});
		}
	};
}

// Simple promise-based confirmation modal listing orphan paths.
// Resolves true on confirm, false on cancel / close.
function confirmOrphanDelete(
	app: App,
	orphans: Array<{ memoId: string; path: string }>
): Promise<boolean> {
	return new Promise((resolve) => {
		const modal = new (class extends Modal {
			private decided = false;
			onOpen() {
				this.titleEl.setText(
					`Delete ${orphans.length} orphan memo file(s)?`
				);
				const p = this.contentEl.createEl("p");
				p.setText(
					"These files correspond to memos that no longer exist on the Memos server. They will be moved to the system trash."
				);
				const list = this.contentEl.createEl("ul");
				const preview = orphans.slice(0, 10);
				for (const o of preview) {
					list.createEl("li", { text: o.path });
				}
				if (orphans.length > preview.length) {
					this.contentEl.createEl("p", {
						text: `…and ${orphans.length - preview.length} more.`,
					});
				}
				new Setting(this.contentEl)
					.addButton((b) =>
						b.setButtonText("Cancel").onClick(() => {
							this.decided = true;
							this.close();
							resolve(false);
						})
					)
					.addButton((b) =>
						b
							.setButtonText("Move to trash")
							.setWarning()
							.onClick(() => {
								this.decided = true;
								this.close();
								resolve(true);
							})
					);
			}
			onClose() {
				if (!this.decided) resolve(false);
				this.contentEl.empty();
			}
		})(app);
		modal.open();
	});
}
