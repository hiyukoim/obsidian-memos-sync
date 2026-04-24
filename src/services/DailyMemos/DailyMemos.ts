import {
	createDailyNote,
	getAllDailyNotes,
	getDailyNote,
	getDateFromFile,
} from "obsidian-daily-notes-interface";
import type { Moment } from "moment";
import { App, MarkdownView, Notice, TFile, normalizePath } from "obsidian";
import { MemosSyncPluginSettings } from "@/types/PluginSettings";
import * as log from "@/utils/log";
import { MemosPaginator } from "./MemosPaginator";
import { DailyNoteModifier } from "./DailyNoteModifier";
import { MemosResourceFetcher } from "./MemosResourceFetcher";
import { APIResource, generateResourceName } from "./MemosResource";
import { MemosAbstractFactory } from "./MemosVersionFactory";
import { PerMemoFileWriter } from "./PerMemoFileWriter";

class DailyNoteManager {
	private allDailyNotes: Record<string, TFile>;
	constructor() {
		this.allDailyNotes = getAllDailyNotes();
	}

	getOrCreateDailyNote = async (date: Moment) => {
		const dailyNote = getDailyNote(date, this.allDailyNotes);
		if (!dailyNote) {
			log.info(`Failed to find daily note for ${date}, creating...`);
			const newDailyNote = await createDailyNote(date);
			this.allDailyNotes = getAllDailyNotes();
			return newDailyNote;
		}

		return dailyNote;
	};

	reload = () => {
		this.allDailyNotes = getAllDailyNotes();
	};
}

export class DailyMemos {
	private app: App;
	private settings: MemosSyncPluginSettings;
	private localKey: string;
	private memosFactory: MemosAbstractFactory;
	private memosPaginator: MemosPaginator;
	private memosResourceFetcher: MemosResourceFetcher;
	// Reentrancy guard. Sync entry points share localStorage[lastTime] and write
	// to the same files; concurrent runs would race and double-write.
	private syncing = false;

	constructor(app: App, settings: MemosSyncPluginSettings) {
		if (!settings.memosAPIURL) {
			log.error(
				"Please set the usememosAPI setting in the plugin settings.",
			);
			return;
		}

		this.app = app;
		this.settings = settings;

		this.memosFactory = new MemosAbstractFactory(this.settings);

		this.localKey = `obsidian-memos-sync-last-time-${this.settings.memosAPIToken}`;
		const lastTime = window.localStorage.getItem(this.localKey) || "";
		this.memosPaginator = this.memosFactory.createMemosPaginator(lastTime);
		this.memosResourceFetcher = this.memosFactory.createResourceFetcher();
	}

	/**
	 * Force syncing memos, ignore the lastTime.
	 * After syncing, save the lastTime to localStorage, and reload the memosPaginator.
	 */
	forceSync = async () => {
		if (this.syncing) {
			new Notice("Memos sync already in progress");
			return;
		}
		this.syncing = true;
		try {
			log.info("Force syncing memos...");
			const forcePaginator = this.memosFactory.createMemosPaginator("");
			const referenced = new Map<string, APIResource>();
			await this.insertDailyMemos(
				forcePaginator,
				/* collectSeen */ true,
				(r) => referenced.set(generateResourceName(r), r),
			);
			await this.downloadReferencedResources([...referenced.values()]);
			this.memosPaginator = forcePaginator;
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			new Notice(`Memos sync failed: ${msg}`);
			log.error(`Force sync failed: ${msg}`);
		} finally {
			this.syncing = false;
		}
	};

	/**
	 * Sync memos, only sync the memos after the lastTime.
	 * After syncing, save the lastTime to localStorage.
	 */
	sync = async () => {
		if (this.syncing) {
			new Notice("Memos sync already in progress");
			return;
		}
		this.syncing = true;
		try {
			log.info("Syncing memos...");
			const referenced = new Map<string, APIResource>();
			await this.insertDailyMemos(
				this.memosPaginator,
				false,
				(r) => referenced.set(generateResourceName(r), r),
			);
			await this.downloadReferencedResources([...referenced.values()]);
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			new Notice(`Memos sync failed: ${msg}`);
			log.error(`Sync failed: ${msg}`);
		} finally {
			this.syncing = false;
		}
	};

	/**
	 * Sync daily memos for the current daily note file.
	 * If the current file is not a daily note, do nothing.
	 */
	syncForCurrentFile = async () => {
		if (this.syncing) {
			new Notice("Memos sync already in progress");
			return;
		}
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view) {
			log.debug("No active view found.");
			return;
		}
		if (!(view.file instanceof TFile)) {
			log.debug("Active view is not a file.");
			return;
		}

		const file = view.file;

		const currentDate = getDateFromFile(file, "day")?.format("YYYY-MM-DD");
		if (!currentDate) {
			log.debug("Failed to get date from file.");
			return;
		}
		const currentMomentMmemosPaginator =
			this.memosFactory.createMemosPaginator(
				"",
				(date) => date === currentDate,
			);

		this.syncing = true;
		try {
			const referenced = new Map<string, APIResource>();
			await this.insertDailyMemos(
				currentMomentMmemosPaginator,
				false,
				(r) => referenced.set(generateResourceName(r), r),
			);
			await this.downloadReferencedResources([...referenced.values()]);
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			new Notice(`Memos sync failed: ${msg}`);
			log.error(`Sync (current file) failed: ${msg}`);
		} finally {
			this.syncing = false;
		}
	};

	/**
	 * Download only the attachments referenced by memos that survived the tag
	 * filter. Skipping the global list endpoint avoids pulling orphaned
	 * attachments from filtered-out or deleted memos.
	 */
	private downloadReferencedResources = async (
		resources: APIResource[],
	): Promise<void> => {
		if (!resources.length) return;

		const folder = this.settings.attachmentFolder;
		if (!this.app.vault.getFolderByPath(folder)) {
			log.info(`Creating folder: ${folder}`);
			await this.app.vault.createFolder(folder);
		}
		await Promise.all(
			resources.map(async (resource) => {
				if (resource.externalLink) {
					log.debug(
						`External resource, skip download: ${resource.externalLink}`,
					);
					return;
				}

				const resourcePath = normalizePath(
					`${folder}/${generateResourceName(resource)}`,
				);

				const isResourceExists = await this.app.vault.adapter.exists(
					resourcePath,
				);
				if (isResourceExists) {
					log.debug(
						`Resource exists, skip download: ${resourcePath}`,
					);
					return;
				}

				const data = await this.memosResourceFetcher.fetchResource(
					resource,
				);

				if (!data) {
					log.warn(`Failed to fetch resource: ${resource}`);
					return;
				}

				log.debug(`Download resource: ${resourcePath}`);
				await this.app.vault.adapter.writeBinary(resourcePath, data);
			}),
		);
	};

	private insertDailyMemos = async (
		memosPaginator: MemosPaginator,
		collectSeen = false,
		onResourceReferenced?: (r: APIResource) => void,
	) => {
		const mode = this.settings.outputMode ?? "daily-note";
		// Only collect in per-memo-file mode with a non-keep orphan policy.
		// Daily-note mode has no per-file concept, so orphan detection doesn't apply.
		const orphanMode = this.settings.orphanHandling ?? "keep";
		const shouldCollect =
			collectSeen && mode === "per-memo-file" && orphanMode !== "keep";
		const seen = shouldCollect ? new Set<string>() : null;

		const lastTime =
			mode === "per-memo-file"
				? await this.writePerMemoFiles(memosPaginator, seen, onResourceReferenced)
				: await this.writeDailyNotes(memosPaginator, onResourceReferenced);

		log.info(`Synced memos, lastTime: ${lastTime}`);
		window.localStorage.setItem(this.localKey, lastTime);
	};

	private writeDailyNotes = async (
		memosPaginator: MemosPaginator,
		onResourceReferenced?: (r: APIResource) => void,
	) => {
		const dailyNoteManager = new DailyNoteManager();
		const dailyNoteModifier = new DailyNoteModifier(
			this.settings.dailyMemosHeader,
		);
		return memosPaginator.foreach(async ([today, dailyMemosForToday]) => {
			if (onResourceReferenced) {
				for (const item of Object.values(dailyMemosForToday)) {
					for (const r of item.resources) onResourceReferenced(r);
				}
			}

			const momentDay = window.moment(today);

			const targetFile = await dailyNoteManager.getOrCreateDailyNote(
				momentDay,
			);

			await this.app.vault.process(targetFile, (originFileContent) => {
				const modifiedFileContent = dailyNoteModifier.modifyDailyNote(
					originFileContent,
					today,
					dailyMemosForToday,
				);

				if (!modifiedFileContent) {
					return originFileContent;
				}

				return modifiedFileContent;
			});
		});
	};

	private writePerMemoFiles = async (
		memosPaginator: MemosPaginator,
		seen: Set<string> | null,
		onResourceReferenced?: (r: APIResource) => void,
	) => {
		const writer = new PerMemoFileWriter(this.app, this.settings);
		const lastTime = await memosPaginator.foreach(
			async ([, dailyMemosForToday]) => {
				for (const item of Object.values(dailyMemosForToday)) {
					if (onResourceReferenced) {
						for (const r of item.resources) onResourceReferenced(r);
					}
					await writer.writeMemo(item);
				}
			},
			seen ? (ts) => seen.add(ts) : undefined
		);

		if (seen) {
			const summary = await writer.handleOrphans(seen);
			const total = summary.marked + summary.deleted + summary.kept;
			if (total > 0) {
				const mode = this.settings.orphanHandling ?? "keep";
				const msg =
					mode === "mark"
						? `Orphan memos: ${summary.marked} marked, ${summary.kept} already marked`
						: `Orphan memos: ${summary.deleted} deleted, ${summary.kept} kept`;
				new Notice(msg);
				log.info(msg);
			}
		}

		return lastTime;
	};
}
