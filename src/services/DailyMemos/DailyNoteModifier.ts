import * as log from "@/utils/log";

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
	constructor(private dailyMemosHeader: string) { }

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
		fetchedRecordList: Record<string, string>,
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

		// MoeMemos records with timestamp identifier (^timestamp)
		const moeMemosRecords: Record<string, string> = {}; // map<timestamp, record>
		// Thino and other platform memos (without MoeMemos timestamp format)
		const otherPlatformMemos: string[] = [];

		for (const record of localRecordList) {
			// Check for MoeMemos format (has ^timestamp at the end)
			const moeMemosMatch = record.match(/.*\^(\d{10})/);
			// Check for Thino format (starts with bullet point and time)
			const thinoOrOtherFormatMatch = record.match(/^- \d{1,2}:\d{2}/);

			if (moeMemosMatch?.length) {
				const createdTs = moeMemosMatch[1]?.trim();
				moeMemosRecords[createdTs] = record;
			} else if (thinoOrOtherFormatMatch && !moeMemosMatch?.length) {
				// This is a Thino memo or other platform memo that doesn't have MoeMemos timestamp format
				otherPlatformMemos.push(record);
			}
		}

		log.debug(
			`for ${today}\n\nfetchedRecordList: ${JSON.stringify({
				from,
				to,
				prefix,
				suffix,
				localRecordList,
				moeMemosRecords,
				otherPlatformMemos,
			})}`,
		);

		// Process MoeMemos records
		const sortedMoeMemosRecords = Object.entries({
			...moeMemosRecords,
			...fetchedRecordList,
		})
			.sort((a, b) => Number(a[0]) - Number(b[0]))
			.map((item) => item[1]);

		// Combine MoeMemos records with Thino and other platform memos
		const allMemosCombined = [...sortedMoeMemosRecords, ...otherPlatformMemos].join("\n");

		const modifiedFileContent =
			prefix.trim() +
			`\n\n${allMemosCombined}\n\n` +
			suffix.trim() +
			`\n`;

		return modifiedFileContent;
	};
}
