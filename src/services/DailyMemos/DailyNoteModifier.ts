import * as log from "@/utils/log";
import { MemoItem } from "./MemosPaginator";

/**
 * Generates a regular expression for matching a header in a daily note.
 * If the header is already formatted with one or more '#' symbols, it will be used as is.
 * Otherwise, a single '#' symbol will be added before the header.
 *
 * @param header - The header to generate the regular expression for.
 * @returns The regular expression for matching the header and its content.
 */
function generateHeaderRegExp(header: string) {
	const formattedHeader = /^#+/.test(header.trim())
		? header.trim()
		: `# ${header.trim()}`;
	const reg = new RegExp(`(${formattedHeader}[^\n]*)([\\s\\S]*?)(?=\\n#|$)`);

	return reg;
}

export class DailyNoteModifier {
	constructor(private dailyMemosHeader: string) {}

	/**
	 * Daily Notes will be:
	 * ```markdown
	 * contents before
	 * ...
	 *
	 * # The Header
	 * - memos
	 * - memos
	 *
	 * contents after
	 * ```
	 *
	 * @returns modifiedFileContent
	 */
	modifyDailyNote = (
		originFileContent: string,
		today: string,
		fetchedRecordList: Record<string, MemoItem>,
	) => {
		const header = this.dailyMemosHeader;
		const reg = generateHeaderRegExp(header);
		const regMatch = originFileContent.match(reg);

		if (!regMatch?.length || regMatch.index === undefined) {
			log.debug(`${regMatch}`);
			log.warn(
				`Failed to find header for ${today}. Please make sure your daily note template is correct.`,
			);
			return;
		}

		const localRecordContent = regMatch[2]?.trim(); // the memos list
		const from = regMatch.index + regMatch[1].length + 1; // start of the memos list
		const to = from + localRecordContent.length + 1; // end of the memos list
		const prefix = originFileContent.slice(0, from); // contents before the memos list
		const suffix = originFileContent.slice(to); // contents after the memos list
		const localRecordList = localRecordContent
			? localRecordContent.split(/\n(?=- )/g)
			: [];

		// record on memos, keyed by `<ts>-<uid>` (post-migration) or just `<ts>`
		// (legacy). Combined key prevents same-second memos from collapsing.
		const existedRecordList: Record<string, string> = {};

		for (const record of localRecordList) {
			const regMatch = record.match(/\^(\d{10})(?:-([A-Za-z0-9]+))?/);
			const createdTs = regMatch?.[1]?.trim() ?? "";
			const recordUid = regMatch?.[2]?.trim() ?? "";
			const key = recordUid ? `${createdTs}-${recordUid}` : createdTs;

			if (createdTs) {
				existedRecordList[key] = record;
			}
		}

		log.debug(
			`for ${today}\n\nfetchedRecordList: ${JSON.stringify({
				from,
				to,
				prefix,
				suffix,
				localRecordList,
				existedRecordList,
			})}`,
		);

		// Key fetched records by `<ts>-<uid>` (or just `<ts>` for legacy v0.19.1
		// memos that lack a server uid). Same key shape as the parser above so
		// dedupe via spread merges by memo identity, not by timestamp alone —
		// two memos created in the same second now coexist.
		//
		// Migration: a memo previously rendered with bare `^<ts>` may already
		// exist in the daily note. When that memo's fetched render carries a
		// uid (i.e. a new `^<ts>-<uid>` anchor), drop the legacy entry so the
		// note doesn't end up with both lines for the same memo.
		const fetchedRendered: Record<string, string> = {};
		for (const item of Object.values(fetchedRecordList)) {
			const key = item.uid
				? `${item.timestamp}-${item.uid}`
				: item.timestamp;
			fetchedRendered[key] = item.rendered;
			if (item.uid && existedRecordList[item.timestamp]) {
				delete existedRecordList[item.timestamp];
			}
		}

		// Sort by the leading timestamp portion of the key. Combined keys
		// (`<ts>-<uid>`) would yield NaN under plain Number(), so split first.
		const sortedRecordList = Object.entries({
			...existedRecordList,
			...fetchedRendered,
		})
			.sort((a, b) => Number(a[0].split("-")[0]) - Number(b[0].split("-")[0]))
			.map((item) => item[1])
			.join("\n");

		const modifiedFileContent =
			prefix.trim() +
			`\n\n${sortedRecordList}\n\n` +
			suffix.trim() +
			`\n`;

		return modifiedFileContent;
	};
}
