import { DailyRecordType, MemosClient0191 } from "@/api/memos-v0.19.1";
import { requestUrl } from "obsidian";
import * as log from "@/utils/log";
import { AuthCli, Memo, MemoListPaginator } from "@/api/memos-v0.22.0-adapter";
import {
	APIResource,
	convert0220ResourceToAPIResource,
	generateResourceLink,
} from "./MemosResource";
import { extractTags, shouldIncludeByTags } from "./TagFilter";

type APIMemo = {
	/**
	 * created at or udpated at for the memo, for identifying the memo
	 * for identifying the memo, sorting, and decide which daily note to place in
	 */
	timestamp: number;
	/**
	 * content of the memo
	 */
	content: string;
	/**
	 * resources for the memo
	 * for generating file link
	 */
	resources?: APIResource[];
	/**
	 * Server-side memo identifier (e.g. "abc123" extracted from `memos/abc123`).
	 * Used to build memo_url. Absent on v0.19.1.
	 */
	uid?: string;
};

type MdItemMemo = {
	date: string; // date for which daily memo to place
	timestamp: string; // timestamp for identifying the memo
	rendered: string; // daily-note bullet form
	rawContent: string; // original memo body (no mutations)
	resourceLines: string[]; // markdown links for per-memo output
	resources: APIResource[]; // raw resources referenced by this memo — drives filtered attachment download
	uid?: string;
};

// Shape surfaced to downstream code (daily-note modifier & per-memo writer).
export type MemoItem = {
	timestamp: string;
	rendered: string;
	rawContent: string;
	resourceLines: string[];
	// Raw resources for this memo. Used by the sync driver to download only
	// attachments referenced by memos that survived the tag filter — the global
	// listAttachments endpoint returns everything on the server, so relying on
	// it would pull orphans from filtered-out memos.
	resources: APIResource[];
	tags: string[];
	uid?: string;
};

// "memos/abc123" -> "abc123". Accepts just "abc123" too. Returns undefined for empty input.
export function extractMemoUid(name?: string): string | undefined {
	if (!name) return undefined;
	const parts = name.split("/");
	const last = parts[parts.length - 1];
	return last || undefined;
}

/**
 * transformAPIToMdItemMemo
 * transform API returned memo to md item.
 * It will find all resources and generate file link.
 * @param param APIMemoParam
 */
function transformAPIToMdItemMemo(param: APIMemo): MdItemMemo {
	const { timestamp, content, resources, uid } = param;
	const [date, time] = window
		.moment(timestamp * 1000)
		.format("YYYY-MM-DD HH:mm")
		.split(" ");
	const [firstLine, ...otherLine] = content.trim().split("\n");
	const taskMatch = firstLine.match(/(- \[.?\])(.*)/); // 目前仅支持 task
	const isCode = /```/.test(firstLine);

	let targetFirstLine = "";

	if (taskMatch) {
		targetFirstLine = `${taskMatch[1]} ${time} ${taskMatch[2]}`;
	} else if (isCode) {
		targetFirstLine = `- ${time}`; // 首行不允许存在代码片段
		otherLine.unshift(firstLine);
	} else {
		targetFirstLine = `- ${time} ${firstLine.replace(/^- /, "")}`;
	}

	// Block anchor identity. Two memos created in the same second would otherwise
	// collide on `^<ts>` — same anchor in one daily note is illegal in Obsidian
	// (only the first is addressable) and the parser dedupes by ts. Suffix with
	// uid when available; legacy `^<ts>` records keep working via the parser's
	// optional-suffix regex and one-shot legacy cleanup on migration.
	const blockAnchor = uid ? `^${timestamp}-${uid}` : `^${timestamp}`;
	targetFirstLine += ` #daily-record ${blockAnchor}`;

	const targetOtherLine = otherLine?.length //剩余行
		? "\n" +
		  otherLine
				.filter((line: string) => line.trim())
				.map((line) => `\t${line}`)
				.join("\n")
				.trimEnd()
		: "";
	const resourceLines = resources?.length
		? resources.map(
				(resource: APIResource) => generateResourceLink(resource)
		  )
		: [];
	const targetResourceLine = resourceLines.length
		? "\n" + resourceLines.map((link) => `\t- ${link}`).join("\n")
		: "";
	const finalTargetContent =
		targetFirstLine + targetOtherLine + targetResourceLine;

	return {
		date,
		timestamp: String(timestamp),
		rendered: finalTargetContent,
		rawContent: content,
		resourceLines,
		resources: resources ?? [],
		uid,
	};
}

// Observer invoked for every memo found on the server, BEFORE include/exclude
// tag filtering. Receives memo identity strings — emitted as both the timestamp
// AND the server uid (when available) so orphan detection's "seen" set matches
// files written by older versions (memo_id = timestamp) and newer versions
// (memo_id = uid). Firing before the tag filter is critical: a memo that exists
// on the server but is filtered out of the current sync must not be mistaken
// for an orphan and trashed.
export type OnMemoSeen = (id: string) => void;

export type MemosPaginator = {
	foreach: (
		handle: ([today, dailyMemosForToday]: [
			string, // date, format "YYYY-MM-DD"
			Record<string, MemoItem> // daily memos for today, map<timestamp, item>
		]) => Promise<void>,
		onMemoSeen?: OnMemoSeen
	) => Promise<string>;
};

export class MemosPaginator0191 {
	private limit: number;
	private offset: number;
	private lastTime: string;

	constructor(
		private client: MemosClient0191,
		lastTime?: string,
		private filter?: (
			date: string,
			dailyMemosForDate: Record<string, MemoItem>
		) => boolean,
		private includeTags: string[] = [],
		private excludeTags: string[] = []
	) {
		this.limit = 50;
		this.offset = 0;
		this.lastTime = lastTime || "";
	}

	/**
	 * return lastTime
	 * @param handle
	 * @returns
	 */
	foreach = async (
		handle: ([today, dailyMemosForToday]: [
			string, // date, format "YYYY-MM-DD"
			Record<string, MemoItem> // daily memos for today, map<timestamp, item>
		]) => Promise<void>,
		onMemoSeen?: OnMemoSeen
	) => {
		this.offset = 0; // iterate from newest, reset offset
		while (true) {
			const memos = await this.client.listMemos(this.limit, this.offset);
			if (memos == null) {
				// API failure (not legit-empty — legit-empty returns []). Throw so the
				// caller surfaces the error and skips advancing lastTime; next sync
				// retries from the same checkpoint.
				throw new Error(
					"Memos API (v0.19.1) returned no response — check server URL / token / connectivity"
				);
			}

			const mostRecentRecordTimeStamp = memos[0]?.createdAt
				? window.moment(memos[0]?.createdAt).unix()
				: memos[0]?.createdTs;

			if (
				!memos.length ||
				mostRecentRecordTimeStamp * 1000 < Number(this.lastTime)
			) {
				// bug if one memo pinned to top
				// but it's not a big deal, use sync for current daily notes
				log.debug("No new daily memos found.");
				this.lastTime = Date.now().toString();
				return this.lastTime;
			}

			const dailyMemosByDay = this.generalizeDailyMemos(memos, onMemoSeen);

			await Promise.all(
				Object.entries(dailyMemosByDay).map(
					async ([today, dailyMemosForToday]) => {
						if (
							this.filter &&
							!this.filter(today, dailyMemosForToday)
						) {
							return;
						}
						await handle([today, dailyMemosForToday]);
					}
				)
			);

			this.lastTime = String(mostRecentRecordTimeStamp * 1000);
			this.offset += memos.length;
		}
	};

	// generalize daily memos by day and timestamp
	// map<date, map<timestamp, MemoItem>>
	private generalizeDailyMemos = (
		memos: DailyRecordType[],
		onMemoSeen?: OnMemoSeen
	) => {
		const dailyMemosByDay: Record<string, Record<string, MemoItem>> = {};
		for (const memo of memos) {
			if (!memo.content && !memo.resourceList?.length) {
				continue;
			}

			const { createdTs, createdAt } = memo;
			const timestampInput = createdAt
				? window.moment(createdAt).unix()
				: createdTs;

			const mdItemMemo = transformAPIToMdItemMemo({
				timestamp: timestampInput,
				content: memo.content,
				resources: memo.resourceList,
			});

			// Emit BEFORE tag filter — orphan detection must reflect server
			// truth, not the current filter's output. Emit both forms so old
			// files (memo_id = timestamp) and new files (memo_id = uid) match.
			onMemoSeen?.(mdItemMemo.timestamp);
			if (mdItemMemo.uid) onMemoSeen?.(mdItemMemo.uid);

			const memoTags = extractTags(memo.content ?? "");
			if (!shouldIncludeByTags(memoTags, this.includeTags, this.excludeTags)) {
				continue;
			}

			if (!dailyMemosByDay[mdItemMemo.date]) {
				dailyMemosByDay[mdItemMemo.date] = {};
			}

			const dictKey = mdItemMemo.uid || mdItemMemo.timestamp;
			dailyMemosByDay[mdItemMemo.date][dictKey] = {
				timestamp: mdItemMemo.timestamp,
				rendered: mdItemMemo.rendered,
				rawContent: mdItemMemo.rawContent,
				resourceLines: mdItemMemo.resourceLines,
				resources: mdItemMemo.resources,
				tags: memoTags,
				uid: mdItemMemo.uid,
			};
		}
		return dailyMemosByDay;
	};
}

export class MemosPaginator0220 {
	private pageSize: number;
	private pageToken: string;
	private lastTime: string;

	constructor(
		private memoListPaginator: MemoListPaginator,
		private authCli: AuthCli,
		lastTime?: string,
		private filter?: (
			date: string,
			dailyMemosForDate: Record<string, MemoItem>
		) => boolean,
		private includeTags: string[] = [],
		private excludeTags: string[] = []
	) {
		this.pageSize = 50;
		this.pageToken = "";
		this.lastTime = lastTime || "";
	}

	/**
	 * return lastTime
	 * @param handle
	 * @returns
	 */
	foreach = async (
		handle: ([today, dailyMemosForToday]: [
			string, // date, format "YYYY-MM-DD"
			Record<string, MemoItem> // daily memos for today, map<timestamp, item>
		]) => Promise<void>,
		onMemoSeen?: OnMemoSeen
	) => {
		// because memos pagination is from newest to oldest
		// so we always need to iterate from newest and reset pageToken
		// what ever we are doing a full sync or delta sync
		this.pageToken = "";
		// v0.25.1 uses getCurrentSession, v0.22.0/v0.24.0 uses getAuthStatus
		const currentUser = this.authCli.getCurrentSession
			? await this.authCli.getCurrentSession({})
			: await this.authCli.getAuthStatus!({});
		while (true) {
			const resp = await this.memoListPaginator.listMemos(
				this.pageSize,
				this.pageToken,
				currentUser
			);
			log.debug(
				`resp for pageToken ${this.pageToken}: ${JSON.stringify(resp)}`
			);
			if (!resp) {
				// API failure — throw so the caller surfaces the error and skips
				// advancing lastTime; next sync retries from the same checkpoint.
				throw new Error(
					"Memos API (v0.22+) returned no response — check server URL / token / connectivity"
				);
			}
			const { memos, nextPageToken } = resp;

			const mostRecentRecordTimeStamp = memos[0]?.updateTime
				? window.moment(memos[0]?.updateTime).unix()
				: window.moment(memos[0]?.createTime).unix();

			if (
				!memos.length ||
				mostRecentRecordTimeStamp * 1000 < Number(this.lastTime)
			) {
				// bug if one memo pinned to top
				// but it's not a big deal, use sync for current daily notes
				log.debug("No new daily memos found.");
				this.lastTime = Date.now().toString();
				return this.lastTime;
			}

			const dailyMemosByDay = this.generalizeDailyMemos(memos, onMemoSeen);

			await Promise.all(
				Object.entries(dailyMemosByDay).map(
					async ([today, dailyMemosForToday]) => {
						if (
							this.filter &&
							!this.filter(today, dailyMemosForToday)
						) {
							return;
						}
						await handle([today, dailyMemosForToday]);
					}
				)
			);

			this.lastTime = String(mostRecentRecordTimeStamp * 1000);
			if (!nextPageToken) {
				return this.lastTime;
			}
			this.pageToken = nextPageToken;
		}
	};

	// generalize daily memos by day and timestamp
	// map<date, map<timestamp, MemoItem>>
	private generalizeDailyMemos = (memos: Memo[], onMemoSeen?: OnMemoSeen) => {
		const dailyMemosByDay: Record<string, Record<string, MemoItem>> = {};
		for (const memo of memos) {
			if (!memo.content && !memo.resources?.length) {
				continue;
			}

			const resources = memo.resources?.map(
				convert0220ResourceToAPIResource
			);

			const mdItemMemo = transformAPIToMdItemMemo({
				timestamp: window.moment(memo.createTime).unix(),
				content: memo.content,
				resources: resources,
				uid: extractMemoUid(memo.name),
			});

			// Emit BEFORE tag filter — orphan detection must reflect server
			// truth, not the current filter's output. Emit both forms so old
			// files (memo_id = timestamp) and new files (memo_id = uid) match.
			onMemoSeen?.(mdItemMemo.timestamp);
			if (mdItemMemo.uid) onMemoSeen?.(mdItemMemo.uid);

			const memoTags = extractTags(memo.content ?? "");
			if (!shouldIncludeByTags(memoTags, this.includeTags, this.excludeTags)) {
				continue;
			}

			if (!dailyMemosByDay[mdItemMemo.date]) {
				dailyMemosByDay[mdItemMemo.date] = {};
			}

			const dictKey = mdItemMemo.uid || mdItemMemo.timestamp;
			dailyMemosByDay[mdItemMemo.date][dictKey] = {
				timestamp: mdItemMemo.timestamp,
				rendered: mdItemMemo.rendered,
				rawContent: mdItemMemo.rawContent,
				resourceLines: mdItemMemo.resourceLines,
				resources: mdItemMemo.resources,
				tags: memoTags,
				uid: mdItemMemo.uid,
			};
		}
		return dailyMemosByDay;
	};
}

/**
 * MemosPaginator for v0.26.1
 * Uses Obsidian requestUrl (bypasses CORS) + Connect protocol JSON format
 * Key v0.26.0 breaking changes handled:
 *   1. AuthService: GetCurrentSession -> GetCurrentUser (not needed, skipped)
 *   2. AttachmentService: GetAttachmentBinary removed (use HTTP /file/ endpoint)
 *   3. Server migrated to connect-rpc (CORS blocks gRPC-Web from Electron)
 */
export class MemosPaginator0261 {
	private pageSize: number;
	private pageToken: string;
	private lastTime: string;

	constructor(
		private apiUrl: string,
		private token: string,
		lastTime?: string,
		private filter?: (
			date: string,
			dailyMemosForDate: Record<string, MemoItem>
		) => boolean,
		private includeTags: string[] = [],
		private excludeTags: string[] = []
	) {
		this.pageSize = 50;
		this.pageToken = "";
		this.lastTime = lastTime || "";
	}

	foreach = async (
		handle: ([today, dailyMemosForToday]: [
			string,
			Record<string, MemoItem>
		]) => Promise<void>,
		onMemoSeen?: OnMemoSeen
	) => {
		this.pageToken = "";
		while (true) {
			const resp = await this.listMemosREST(this.pageSize, this.pageToken);
			if (!resp || !resp.memos || !resp.memos.length) {
				log.debug("No new daily memos found.");
				this.lastTime = Date.now().toString();
				return this.lastTime;
			}
			const { memos, nextPageToken } = resp;

			const mostRecentRecordTimeStamp = memos[0]?.updateTime
				? window.moment(memos[0]?.updateTime).unix()
				: window.moment(memos[0]?.createTime).unix();

			if (!memos.length || mostRecentRecordTimeStamp * 1000 < Number(this.lastTime)) {
				log.debug("No new daily memos found.");
				this.lastTime = Date.now().toString();
				return this.lastTime;
			}

			const dailyMemosByDay = this.generalizeDailyMemos(memos, onMemoSeen);

			await Promise.all(
				Object.entries(dailyMemosByDay).map(
					async ([today, dailyMemosForToday]) => {
						if (this.filter && !this.filter(today, dailyMemosForToday)) {
							return;
						}
						await handle([today, dailyMemosForToday]);
					}
				)
			);

			this.lastTime = String(mostRecentRecordTimeStamp * 1000);
			if (!nextPageToken) {
				return this.lastTime;
			}
			this.pageToken = nextPageToken;
		}
	};

	private listMemosREST = async (pageSize: number, pageToken: string) => {
		const params = new URLSearchParams({ pageSize: String(pageSize) });
		if (pageToken) params.set("pageToken", pageToken);
		const url = `${this.apiUrl}/api/v1/memos?${params.toString()}`;
		try {
			const res = await requestUrl({
				url,
				method: "GET",
				headers: {
					Accept: "application/json",
					Authorization: `Bearer ${this.token}`,
				},
				throw: false,
			});
			const contentType = res.headers?.["content-type"] ?? res.headers?.["Content-Type"] ?? "";
			if (res.status !== 200 || !contentType.includes("application/json")) {
				const bodySnippet = (res.text ?? "").slice(0, 200);
				log.error(
					`listMemosREST: unexpected response — status=${res.status} content-type=${contentType} url=${url} body=${bodySnippet}`
				);
				// Throw so the caller surfaces the error and skips advancing
				// lastTime; next sync retries from the same checkpoint.
				throw new Error(
					`Memos REST API returned status ${res.status} (content-type: ${contentType || "none"})`
				);
			}
			return res.json;
		} catch (error) {
			log.error(`Failed to list memos via REST: ${error} url=${url}`);
			throw error instanceof Error
				? error
				: new Error(`Failed to list memos via REST: ${String(error)}`);
		}
	};

	private generalizeDailyMemos = (memos: Memo[], onMemoSeen?: OnMemoSeen) => {
		const dailyMemosByDay: Record<string, Record<string, MemoItem>> = {};
		for (const memo of memos) {
			if (!memo.content && !memo.attachments?.length) {
				continue;
			}

			const resources = memo.attachments?.map(
				convert0220ResourceToAPIResource
			);

			const mdItemMemo = transformAPIToMdItemMemo({
				timestamp: window.moment(memo.createTime).unix(),
				content: memo.content,
				resources,
				uid: extractMemoUid(memo.name),
			});

			// Emit BEFORE tag filter — orphan detection must reflect server
			// truth, not the current filter's output. Emit both forms so old
			// files (memo_id = timestamp) and new files (memo_id = uid) match.
			onMemoSeen?.(mdItemMemo.timestamp);
			if (mdItemMemo.uid) onMemoSeen?.(mdItemMemo.uid);

			const memoTags = extractTags(memo.content ?? "");
			if (!shouldIncludeByTags(memoTags, this.includeTags, this.excludeTags)) {
				continue;
			}

			if (!dailyMemosByDay[mdItemMemo.date]) {
				dailyMemosByDay[mdItemMemo.date] = {};
			}
			const dictKey = mdItemMemo.uid || mdItemMemo.timestamp;
			dailyMemosByDay[mdItemMemo.date][dictKey] = {
				timestamp: mdItemMemo.timestamp,
				rendered: mdItemMemo.rendered,
				rawContent: mdItemMemo.rawContent,
				resourceLines: mdItemMemo.resourceLines,
				resources: mdItemMemo.resources,
				tags: memoTags,
				uid: mdItemMemo.uid,
			};
		}
		return dailyMemosByDay;
	};
}
