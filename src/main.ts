import { App, Plugin, PluginSettingTab, Setting } from "obsidian";
import { DailyMemos } from "@/services/DailyMemos/DailyMemos";
import { MemosSyncPluginSettings } from "@/types/PluginSettings";
import { appHasDailyNotesPluginLoaded } from "obsidian-daily-notes-interface";

// Remember to rename these classes and interfaces!

function parseTagList(raw: string): string[] {
	const seen = new Set<string>();
	for (const part of raw.split(",")) {
		const tag = part.trim().replace(/^#/, "").toLowerCase();
		if (tag) seen.add(tag);
	}
	return Array.from(seen);
}

// One rule per line in "tag: folder" form. Blank lines and lines without `:` are ignored.
function parseTagFolderRules(
	raw: string
): Array<{ tag: string; folder: string }> {
	const rules: Array<{ tag: string; folder: string }> = [];
	for (const line of raw.split("\n")) {
		const idx = line.indexOf(":");
		if (idx === -1) continue;
		const tag = line.slice(0, idx).trim().replace(/^#/, "").toLowerCase();
		const folder = line.slice(idx + 1).trim().replace(/^\/+|\/+$/g, "");
		if (tag && folder) rules.push({ tag, folder });
	}
	return rules;
}

function stringifyTagFolderRules(
	rules: Array<{ tag: string; folder: string }>
): string {
	return rules.map((r) => `${r.tag}: ${r.folder}`).join("\n");
}

const MEMOS_SYNC_DEFAULT_SETTINGS: MemosSyncPluginSettings = {
	dailyMemosHeader: "Memos",
	memosAPIVersion: "v0.19.1",
	memosAPIURL: "https://usememos.com",
	memosAPIToken: "",
	attachmentFolder: "Attachments",
	includeTags: [],
	excludeTags: [],
	outputMode: "daily-note",
	perMemoFolder: "Memos",
	tagFolderRules: [],
};

export default class MemosSyncPlugin extends Plugin {
	settings: MemosSyncPluginSettings;
	dailyMemos: DailyMemos;

	async onload() {
		await this.loadSettings();
		await this.loadDailyMemos();

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new MemosSyncSettingTab(this.app, this));
	}

	onunload() {}

	loadSettings = async () => {
		this.settings = Object.assign(
			{},
			MEMOS_SYNC_DEFAULT_SETTINGS,
			await this.loadData(),
		);
	};

	saveSettings = async () => {
		await this.saveData(this.settings);
		this.loadDailyMemos();
	};

	loadDailyMemos = async () => {
		this.dailyMemos = new DailyMemos(this.app, this.settings);
		this.addCommand({
			id: "memos-sync-daily-memos",
			name: "Sync daily memos",
			callback: this.dailyMemos.sync,
		});
		this.addCommand({
			id: "memos-force-sync-daily-memos",
			name: "Force sync daily memos",
			callback: this.dailyMemos.forceSync,
		});
		this.addCommand({
			id: "memos-sync-force-current-daily-memos",
			name: "Force sync current daily memos",
			callback: this.dailyMemos.syncForCurrentFile,
		});
		// timeout
		// interval
		// for sync
		// notice to clear on unload
	};
}

class MemosSyncSettingTab extends PluginSettingTab {
	app: App;
	plugin: MemosSyncPlugin;

	constructor(app: App, plugin: MemosSyncPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	private saveSettings = (newSettings: Partial<MemosSyncPluginSettings>) => {
		this.plugin.settings = {
			...this.plugin.settings,
			...newSettings,
		};
		this.plugin.saveSettings();
	};

	display(): void {
		this.containerEl.empty();
		const dailyNotesEnabled = appHasDailyNotesPluginLoaded();
		if (!dailyNotesEnabled) {
			this.containerEl.createEl("h3", {
				text: "Attention: Daily Notes is not enabled.",
				attr: {
					style: "color: red",
				},
			});
			this.containerEl.createEl("p", {
				text: "Daily Notes feature is not enabled.",
				attr: {
					style: "color: red",
				},
			});
			this.containerEl.createEl("p", {
				text: "Please enable the official Daily Notes plugin or daily notes feature in Periodic Notes plugin. Otherwise, this plugin will not work properly.",
				attr: {
					style: "color: red",
				},
			});
		}

		new Setting(this.containerEl).setName("Output mode").setHeading();

		new Setting(this.containerEl)
			.setName("Output mode")
			.setDesc(
				"Daily note: append memos to each day's daily note under the header. Per-memo file: one markdown file per memo in a folder you choose.",
			)
			.addDropdown((dropDown) => {
				dropDown.addOptions({
					"daily-note": "Daily note (legacy)",
					"per-memo-file": "One file per memo",
				});
				dropDown.setValue(this.plugin.settings.outputMode);
				dropDown.onChange((value) => {
					this.saveSettings({
						outputMode: value as MemosSyncPluginSettings["outputMode"],
					});
					this.display();
				});
			});

		if (this.plugin.settings.outputMode === "daily-note") {
			new Setting(this.containerEl)
				.setName("Daily memos header")
				.setDesc(
					"The markdown header in each daily note under which memos are inserted.",
				)
				.addText((textfield) => {
					textfield.setPlaceholder(
						MEMOS_SYNC_DEFAULT_SETTINGS.dailyMemosHeader,
					);
					textfield.setValue(this.plugin.settings.dailyMemosHeader);
					textfield.onChange((value) => {
						this.saveSettings({
							dailyMemosHeader: value,
						});
					});
				});
		} else {
			new Setting(this.containerEl)
				.setName("Default folder")
				.setDesc(
					"Folder for memos that don't match any tag routing rule below.",
				)
				.addText((textfield) => {
					textfield.setPlaceholder(
						MEMOS_SYNC_DEFAULT_SETTINGS.perMemoFolder,
					);
					textfield.setValue(this.plugin.settings.perMemoFolder);
					textfield.onChange((value) => {
						this.saveSettings({
							perMemoFolder: value,
						});
					});
				});

			new Setting(this.containerEl)
				.setName("Tag folder routing")
				.setDesc(
					"One rule per line in `tag: folder` form. Evaluated top-down, first match wins. Leading # is optional.",
				)
				.addTextArea((textarea) => {
					textarea.setPlaceholder(
						"work: Memos/Work\n子育て: Memos/家族\nprojet: Memos/Projets\nидея: Memos/Ideas\n日記: Memos/Journal",
					);
					textarea.setValue(
						stringifyTagFolderRules(
							this.plugin.settings.tagFolderRules,
						),
					);
					textarea.inputEl.rows = 5;
					textarea.inputEl.style.width = "100%";
					textarea.onChange((value) => {
						this.saveSettings({
							tagFolderRules: parseTagFolderRules(value),
						});
					});
				});
		}

		new Setting(this.containerEl)
			.setName("Attachment folder")
			.setDesc("The folder for attachments.")
			.addText((textfield) => {
				textfield.setPlaceholder(
					MEMOS_SYNC_DEFAULT_SETTINGS.attachmentFolder,
				);
				textfield.setValue(this.plugin.settings.attachmentFolder);
				textfield.onChange((value) => {
					this.saveSettings({
						attachmentFolder: value,
					});
				});
			});

		new Setting(this.containerEl).setName("Tag filter").setHeading();

		new Setting(this.containerEl)
			.setName("Include tags")
			.setDesc(
				"Comma-separated list. Only sync memos that have at least one of these tags. Leading # is optional, matching is case-insensitive. Leave empty to sync all.",
			)
			.addText((textfield) => {
				textfield.setPlaceholder("e.g. obsidian, work, 子育て");
				textfield.setValue(this.plugin.settings.includeTags.join(", "));
				textfield.onChange((value) => {
					this.saveSettings({
						includeTags: parseTagList(value),
					});
				});
			});

		new Setting(this.containerEl)
			.setName("Exclude tags")
			.setDesc(
				"Comma-separated list. Skip memos that have any of these tags. Applied before Include tags.",
			)
			.addText((textfield) => {
				textfield.setPlaceholder("e.g. private, draft");
				textfield.setValue(this.plugin.settings.excludeTags.join(", "));
				textfield.onChange((value) => {
					this.saveSettings({
						excludeTags: parseTagList(value),
					});
				});
			});

		new Setting(this.containerEl).setName("Memos API").setHeading();

		new Setting(this.containerEl)
			.setName("Memos API version")
			.setDesc("Which version your Memos server.")
			.addDropdown((dropDown) => {
				dropDown.addOptions({
					"v0.19.1": "before v0.21.x",
					"v0.22.0": "v0.22.x ~ v0.23.x",
					"v0.24.0": "v0.24.x",
					"v0.25.1": "v0.25.x",
					"v0.26.1": "v0.26.x and later",
				});
				dropDown.setValue(this.plugin.settings.memosAPIVersion);
				dropDown.onChange((value) => {
					this.saveSettings({
						memosAPIVersion: value as MemosSyncPluginSettings["memosAPIVersion"],
					});
				});
			});

		new Setting(this.containerEl)
			.setName("Memos API URL")
			.setDesc("Memos API URL, e.g. http://localhost:5230")
			.addText((textfield) => {
				textfield.setPlaceholder(
					MEMOS_SYNC_DEFAULT_SETTINGS.memosAPIURL,
				);
				textfield.setValue(this.plugin.settings.memosAPIURL);
				textfield.onChange((value) => {
					this.saveSettings({
						memosAPIURL: value,
					});
				});
			});

		new Setting(this.containerEl)
			.setName("Memos API token")
			.setDesc("Memos API token.")
			.addText((textfield) => {
				textfield.setPlaceholder(
					MEMOS_SYNC_DEFAULT_SETTINGS.memosAPIToken,
				);
				textfield.setValue(this.plugin.settings.memosAPIToken);
				textfield.onChange((value) => {
					this.saveSettings({
						memosAPIToken: value,
					});
				});
			});
	}
}
