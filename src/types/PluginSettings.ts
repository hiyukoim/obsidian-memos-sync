export interface MemosSyncPluginSettings {
	/**
	 * The header for the daily memos section.
	 */
	dailyMemosHeader: string;
	/**
	 * The folder for attachments.
	 */
	attachmentFolder: string;
	/**
	 * Memos Version, for using different version of memos API.
	 */
	memosAPIVersion: "v0.26.1" | "v0.25.1" | "v0.24.0" | "v0.22.0" | "v0.19.1";
	/**
	 * Usememos API URL. Should be like `https://api.usememos.com/api/v1`.
	 */
	memosAPIURL: string;
	/**
	 * Usememos token.
	 */
	memosAPIToken: string;
	/**
	 * Only sync memos that have at least one of these tags (case-insensitive, no leading #).
	 * Empty array = no include restriction.
	 */
	includeTags: string[];
	/**
	 * Skip memos that have any of these tags. Applied before includeTags.
	 */
	excludeTags: string[];
	/**
	 * Where synced memos land.
	 *  - "daily-note": append to the daily note under the configured header (legacy)
	 *  - "per-memo-file": one markdown file per memo, routed by tag rules
	 */
	outputMode: "daily-note" | "per-memo-file";
	/**
	 * Default folder for per-memo-file mode when no tag rule matches.
	 */
	perMemoFolder: string;
	/**
	 * Tag -> folder routing rules. Evaluated in order, first match wins.
	 * Only applies when outputMode === "per-memo-file".
	 */
	tagFolderRules: Array<{ tag: string; folder: string }>;
	/**
	 * Folders (and their descendants) to scan when locating existing memo files
	 * by frontmatter memo_id. Used to respect manual moves.
	 * Empty = auto-derive from perMemoFolder + tagFolderRules folders.
	 */
	scanFolders: string[];
}
