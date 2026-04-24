// Minimal Node-level checks for the behavioural fixes added in the bugfix pass.
// Not hooked into any test framework — run with `node scripts/logic-tests.mjs`.
// Focus: the logic that doesn't need Obsidian runtime (tag filter ordering,
// uid-first dict key, throw-on-failure in the REST paginator).

import { strict as assert } from "node:assert";
import { pathToFileURL, fileURLToPath } from "node:url";
import { build } from "esbuild";
import path from "node:path";
import fs from "node:fs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(repoRoot, "scripts", ".tmp");
fs.mkdirSync(outDir, { recursive: true });

// Bundle the source files we need into a single ESM file that stubs out
// the obsidian import so we can import MemosPaginator + TagFilter from Node.
const entryFile = path.join(outDir, "entry.ts");
fs.writeFileSync(
	entryFile,
	`
export { shouldIncludeByTags, extractTags } from "../../src/services/DailyMemos/TagFilter";
export { MemosPaginator0191, MemosPaginator0220, MemosPaginator0261, extractMemoUid } from "../../src/services/DailyMemos/MemosPaginator";
export { DailyNoteModifier } from "../../src/services/DailyMemos/DailyNoteModifier";
`
);

const obsidianShim = path.join(outDir, "obsidian-shim.js");
fs.writeFileSync(
	obsidianShim,
	`
// Stand-ins for the Obsidian APIs the paginator touches.
// requestUrl delegates to globalThis.__requestUrl so the test harness can swap
// implementations after the bundle has been built. (esbuild inlines this module
// into the bundle, so module-local state would be invisible to the test.)
export async function requestUrl(opts) {
	const impl = globalThis.__requestUrl;
	if (!impl) throw new Error("requestUrl not wired — set globalThis.__requestUrl in the test");
	return impl(opts);
}
export class Notice {}
export class Modal { constructor() {} open() {} close() {} }
export class Setting { constructor() {} addButton() { return this; } }
export class TFile {}
export function normalizePath(p) { return p; }
`
);

// moment used by transformAPIToMdItemMemo; make a tiny window.moment shim.
const globalsShim = path.join(outDir, "globals-shim.js");
fs.writeFileSync(
	globalsShim,
	`
// Rough moment shim that covers unix()/format() on Number-of-seconds input.
function moment(input) {
	const ms = typeof input === "number" ? input * 1000 : Date.parse(input);
	const d = new Date(ms);
	return {
		unix: () => Math.floor(ms / 1000),
		format: (fmt) => {
			if (fmt === "YYYY-MM-DD HH:mm") {
				const pad = (n) => String(n).padStart(2, "0");
				return \`\${d.getUTCFullYear()}-\${pad(d.getUTCMonth()+1)}-\${pad(d.getUTCDate())} \${pad(d.getUTCHours())}:\${pad(d.getUTCMinutes())}\`;
			}
			return d.toISOString();
		},
	};
}
globalThis.window = globalThis.window || {};
globalThis.window.moment = moment;
`
);

const bundlePath = path.join(outDir, "bundle.mjs");
await build({
	entryPoints: [entryFile],
	bundle: true,
	format: "esm",
	platform: "node",
	target: "node18",
	outfile: bundlePath,
	tsconfig: path.join(repoRoot, "tsconfig.json"),
	alias: {
		"@": path.join(repoRoot, "src"),
		obsidian: obsidianShim,
	},
	banner: { js: `import "${pathToFileURL(globalsShim).href}";` },
	logLevel: "error",
});

const mod = await import(pathToFileURL(bundlePath).href);
const { shouldIncludeByTags, MemosPaginator0191, MemosPaginator0220, MemosPaginator0261, DailyNoteModifier } = mod;

let passed = 0;
let failed = 0;
const run = (name, fn) => {
	try {
		fn();
		console.log(`  \u2713 ${name}`);
		passed++;
	} catch (e) {
		console.error(`  \u2717 ${name}`);
		console.error(`    ${e.message}`);
		failed++;
	}
};
const runAsync = async (name, fn) => {
	try {
		await fn();
		console.log(`  \u2713 ${name}`);
		passed++;
	} catch (e) {
		console.error(`  \u2717 ${name}`);
		console.error(`    ${e.message}`);
		failed++;
	}
};

// ---------- TagFilter (pure, covers #1's dependency) ----------
console.log("TagFilter:");
run("empty filters accept everything", () => {
	assert.equal(shouldIncludeByTags(["work"], [], []), true);
	assert.equal(shouldIncludeByTags([], [], []), true);
});
run("exclude wins over include", () => {
	assert.equal(shouldIncludeByTags(["work", "private"], ["work"], ["private"]), false);
});
run("include requires at least one match", () => {
	assert.equal(shouldIncludeByTags(["bar"], ["foo"], []), false);
	assert.equal(shouldIncludeByTags(["foo"], ["foo"], []), true);
});

// ---------- #1: onMemoSeen fires before tag filter (v0.22+ paginator) ----------
console.log("#1 onMemoSeen fires before tag filter:");
await runAsync("v0.22+: filtered-out memo still emits seen callback", async () => {
	// Fake MemoListPaginator returning two memos, one tagged #keep, one tagged #skip.
	let callCount = 0;
	const fakePaginator = {
		listMemos: async () => {
			callCount++;
			if (callCount > 1) return { memos: [], nextPageToken: "" };
			return {
				memos: [
					{
						name: "memos/uidKeep",
						createTime: "2026-04-24T10:00:00Z",
						updateTime: "2026-04-24T10:00:00Z",
						content: "hello #keep",
						resources: [],
					},
					{
						name: "memos/uidSkip",
						createTime: "2026-04-24T10:00:01Z",
						updateTime: "2026-04-24T10:00:01Z",
						content: "hello #skip",
						resources: [],
					},
				],
				nextPageToken: "",
			};
		},
	};
	const fakeAuth = { getAuthStatus: async () => ({}) };
	const pag = new MemosPaginator0220(fakePaginator, fakeAuth, "", undefined, ["keep"], []);
	const seen = [];
	let handled = 0;
	await pag.foreach(
		async ([, dict]) => {
			handled += Object.keys(dict).length;
		},
		(id) => seen.push(id)
	);
	// Both memos must be seen (uid + timestamp each), even though only #keep survives the filter.
	assert.ok(seen.includes("uidKeep"), `seen missing uidKeep; got ${JSON.stringify(seen)}`);
	assert.ok(seen.includes("uidSkip"), `seen missing uidSkip; got ${JSON.stringify(seen)}`);
	assert.equal(handled, 1, "only #keep should have been handled");
});

// ---------- #2: uid-based dict key prevents same-timestamp overwrite ----------
console.log("#2 same-second memos keyed by uid:");
await runAsync("v0.22+: two memos in the same second coexist", async () => {
	const sameSecond = "2026-04-24T10:00:00Z";
	let callCount = 0;
	const fakePaginator = {
		listMemos: async () => {
			callCount++;
			if (callCount > 1) return { memos: [], nextPageToken: "" };
			return {
				memos: [
					{ name: "memos/uidA", createTime: sameSecond, updateTime: sameSecond, content: "alpha", resources: [] },
					{ name: "memos/uidB", createTime: sameSecond, updateTime: sameSecond, content: "bravo", resources: [] },
				],
				nextPageToken: "",
			};
		},
	};
	const fakeAuth = { getAuthStatus: async () => ({}) };
	const pag = new MemosPaginator0220(fakePaginator, fakeAuth, "", undefined, [], []);
	let observed = null;
	await pag.foreach(async ([, dict]) => {
		observed = dict;
	});
	assert.ok(observed, "no day was handled");
	const keys = Object.keys(observed);
	assert.equal(keys.length, 2, `expected 2 entries, got ${keys.length} (${keys.join(",")})`);
	assert.ok(keys.includes("uidA") && keys.includes("uidB"), `keys should be the uids; got ${keys.join(",")}`);
});

// ---------- #3: REST paginator throws on HTTP error ----------
console.log("#3 REST paginator throws on API failure:");
await runAsync("v0.26+: HTTP 500 throws instead of returning null", async () => {
	globalThis.__requestUrl = (async () => ({
		status: 500,
		headers: { "content-type": "text/html" },
		text: "<html>boom</html>",
		json: null,
	}));
	const pag = new MemosPaginator0261("https://example.com", "token", "", undefined, [], []);
	let threw = false;
	try {
		await pag.foreach(async () => {});
	} catch (e) {
		threw = true;
		assert.match(e.message, /status 500/i, `unexpected error: ${e.message}`);
	}
	assert.ok(threw, "foreach should have thrown");
});
await runAsync("v0.26+: network exception propagates", async () => {
	globalThis.__requestUrl = (async () => {
		throw new Error("ECONNREFUSED");
	});
	const pag = new MemosPaginator0261("https://example.com", "token", "", undefined, [], []);
	let threw = false;
	try {
		await pag.foreach(async () => {});
	} catch (e) {
		threw = true;
		assert.match(e.message, /ECONNREFUSED/);
	}
	assert.ok(threw, "network error should propagate");
});

// ---------- #3 (cont): v0.22+ paginator throws on null resp ----------
await runAsync("v0.22+: null listMemos response throws", async () => {
	const fakePaginator = { listMemos: async () => null };
	const fakeAuth = { getAuthStatus: async () => ({}) };
	const pag = new MemosPaginator0220(fakePaginator, fakeAuth, "", undefined, [], []);
	let threw = false;
	try {
		await pag.foreach(async () => {});
	} catch (e) {
		threw = true;
		assert.match(e.message, /no response/i);
	}
	assert.ok(threw, "null response should throw");
});

// ---------- #3 (cont): v0.19.1 paginator throws on null ----------
await runAsync("v0.19.1: null listMemos response throws", async () => {
	const fakeClient = { listMemos: async () => null };
	const pag = new MemosPaginator0191(fakeClient, "", undefined, [], []);
	let threw = false;
	try {
		await pag.foreach(async () => {});
	} catch (e) {
		threw = true;
		assert.match(e.message, /no response/i);
	}
	assert.ok(threw, "null response should throw on v0.19.1");
});

// ---------- Daily-note dedupe (regression guard for #2) ----------
console.log("DailyNoteModifier dedupe across uid-keyed dict:");
run("legacy ^<ts> line is replaced by ^<ts>-<uid> on uid-bearing re-render", () => {
	// Migration path: an already-synced daily note has a bare `^<ts>` line. The
	// fetched memo now carries a uid → its rendered bullet uses `^<ts>-<uid>`.
	// Output must contain exactly one entry for that memo with the new anchor;
	// the legacy bare-ts line must be removed (no duplicate, no overwrite-back).
	const modifier = new DailyNoteModifier("# Memos");
	const ts = "1745491200";
	const existing =
		`# Memos\n` +
		`- 10:00 hello world #daily-record ^${ts}\n\n`;
	const fetched = {
		uidA: {
			timestamp: ts,
			rendered: `- 10:00 hello world #daily-record ^${ts}-uidA`,
			rawContent: "hello world",
			resourceLines: [],
			tags: [],
			uid: "uidA",
		},
	};
	const out = modifier.modifyDailyNote(existing, "2026-04-24", fetched);
	const bareTs = (out.match(new RegExp(`\\^${ts}(?![-A-Za-z0-9])`, "g")) || []).length;
	const suffixed = (out.match(new RegExp(`\\^${ts}-uidA`, "g")) || []).length;
	assert.equal(bareTs, 0, `legacy ^${ts} should be gone, found ${bareTs}\n---\n${out}`);
	assert.equal(suffixed, 1, `expected 1 ^${ts}-uidA, got ${suffixed}\n---\n${out}`);
});
run("two same-second fetched memos with distinct uids both survive", () => {
	// Post-fix: each memo's anchor is `^<ts>-<uid>`, so Obsidian's one-anchor-
	// per-file constraint is no longer hit. Both lines must appear.
	const modifier = new DailyNoteModifier("# Memos");
	const ts = "1745491200";
	const fetched = {
		uidA: { timestamp: ts, rendered: `- 10:00 alpha #daily-record ^${ts}-uidA`, rawContent: "alpha", resourceLines: [], tags: [], uid: "uidA" },
		uidB: { timestamp: ts, rendered: `- 10:00 bravo #daily-record ^${ts}-uidB`, rawContent: "bravo", resourceLines: [], tags: [], uid: "uidB" },
	};
	const out = modifier.modifyDailyNote(`# Memos\n\n`, "2026-04-24", fetched);
	assert.match(out, new RegExp(`\\^${ts}-uidA`), `missing ^${ts}-uidA in:\n${out}`);
	assert.match(out, new RegExp(`\\^${ts}-uidB`), `missing ^${ts}-uidB in:\n${out}`);
	const total = (out.match(new RegExp(`\\^${ts}-uid`, "g")) || []).length;
	assert.equal(total, 2, `expected 2 distinct anchors, got ${total}`);
});
run("legacy ^<ts> line is preserved when no uid-bearing fetch arrives", () => {
	// A v0.19.1 sync (no uids) or a memo not in the current fetch window must
	// not have its legacy anchor stripped. The parser regex must still match
	// bare `^<ts>` records and carry them through as-is.
	const modifier = new DailyNoteModifier("# Memos");
	const ts = "1745491200";
	const existing =
		`# Memos\n` +
		`- 10:00 legacy line #daily-record ^${ts}\n\n`;
	const out = modifier.modifyDailyNote(existing, "2026-04-24", {});
	assert.match(out, new RegExp(`\\^${ts}\\b`), `legacy anchor lost:\n${out}`);
	assert.match(out, /legacy line/);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
