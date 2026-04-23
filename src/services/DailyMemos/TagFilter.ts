// Extracts `#hashtag` tokens from memo markdown content.
// Unicode-aware so Japanese/other-script tags like `#子育て` work.
const TAG_REGEX = /(?:^|\s)#([\p{L}\p{N}_\-/]+)/gu;

export function extractTags(content: string): string[] {
	if (!content) return [];
	const found = new Set<string>();
	for (const match of content.matchAll(TAG_REGEX)) {
		found.add(match[1].toLowerCase());
	}
	return Array.from(found);
}

// Exclude wins: if any excludeTag matches, drop the memo.
// Otherwise, if includeTags is non-empty, the memo must match at least one.
// Empty filters => everything passes.
export function shouldIncludeByTags(
	tags: string[],
	includeTags: string[],
	excludeTags: string[]
): boolean {
	const hasInclude = includeTags.length > 0;
	const hasExclude = excludeTags.length > 0;
	if (!hasInclude && !hasExclude) return true;

	if (hasExclude && tags.some((t) => excludeTags.includes(t))) {
		return false;
	}
	if (hasInclude) {
		return tags.some((t) => includeTags.includes(t));
	}
	return true;
}

export function shouldIncludeMemo(
	content: string,
	includeTags: string[],
	excludeTags: string[]
): boolean {
	return shouldIncludeByTags(
		extractTags(content),
		includeTags,
		excludeTags
	);
}
