import { App, normalizePath } from "obsidian";
import { MemosSyncPluginSettings } from "@/types/PluginSettings";
import * as log from "@/utils/log";
import { MemoItem } from "./MemosPaginator";

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

function formatMemoBody(item: MemoItem, createdISO: string): string {
	const frontmatter = [
		"---",
		`memo_id: ${item.timestamp}`,
		`created: ${createdISO}`,
		`tags: [${item.tags.join(", ")}]`,
		"---",
		"",
	].join("\n");
	const body = item.rawContent.trim();
	const resources = item.resourceLines.length
		? "\n\n" + item.resourceLines.join("\n")
		: "";
	const anchor = `\n\n^${item.timestamp}\n`;
	return frontmatter + body + resources + anchor;
}

export class PerMemoFileWriter {
	constructor(
		private app: App,
		private settings: MemosSyncPluginSettings
	) {}

	writeMemo = async (item: MemoItem): Promise<void> => {
		const folder = pickFolder(item, this.settings);
		await this.ensureFolder(folder);

		const createdMoment = window.moment(Number(item.timestamp) * 1000);
		const base = createdMoment.format("YYYY-MM-DD-HHmm");
		const createdISO = createdMoment.format();
		const body = formatMemoBody(item, createdISO);
		const anchor = `^${item.timestamp}`;

		// Idempotency: if a file already holds this timestamp anchor, overwrite it.
		// Otherwise append -01, -02, ... to avoid clobbering a different memo.
		for (let i = 0; i <= 99; i++) {
			const suffix = i === 0 ? "" : `-${String(i).padStart(2, "0")}`;
			const path = normalizePath(`${folder}/${base}${suffix}.md`);
			const existing = await this.app.vault.adapter.exists(path);
			if (!existing) {
				log.debug(`Per-memo: write new ${path}`);
				await this.app.vault.adapter.write(path, body);
				return;
			}
			const current = await this.app.vault.adapter.read(path);
			if (current.includes(anchor)) {
				log.debug(`Per-memo: overwrite ${path} (same memo)`);
				await this.app.vault.adapter.write(path, body);
				return;
			}
		}
		log.warn(
			`Per-memo: exhausted collision slots for ${base} in ${folder}, skipping`
		);
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
