"use strict";
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
exports.__esModule = true;
exports.DailyNoteModifier = void 0;
var log = require("@/utils/log");
/**
 * Generates a regular expression for matching a header in a daily note.
 * If the header is already formatted with one or more '#' symbols, it will be used as is.
 * Otherwise, a single '#' symbol will be added before the header.
 *
 * @param header - The header to generate the regular expression for.
 * @returns The regular expression for matching the header and its content.
 */
function generateHeaderRegExp(header) {
    var formattedHeader = /^#+/.test(header.trim())
        ? header.trim()
        : "# ".concat(header.trim());
    var reg = new RegExp("(".concat(formattedHeader, "[^\n]*)([\\s\\S]*?)(?=\\n#|$)"));
    return reg;
}
var DailyNoteModifier = /** @class */ (function () {
    function DailyNoteModifier(dailyMemosHeader) {
        var _this = this;
        this.dailyMemosHeader = dailyMemosHeader;
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
        this.modifyDailyNote = function (originFileContent, today, fetchedRecordList) {
            var _a, _b;
            var header = _this.dailyMemosHeader;
            var reg = generateHeaderRegExp(header);
            var regMatch = originFileContent.match(reg);
            if (!(regMatch === null || regMatch === void 0 ? void 0 : regMatch.length) || regMatch.index === undefined) {
                log.debug("".concat(regMatch));
                log.warn("Failed to find header for ".concat(today, ". Please make sure your daily note template is correct."));
                return;
            }
            var localRecordContent = (_a = regMatch[2]) === null || _a === void 0 ? void 0 : _a.trim(); // the memos list
            var from = regMatch.index + regMatch[1].length + 1; // start of the memos list
            var to = from + localRecordContent.length + 1; // end of the memos list
            var prefix = originFileContent.slice(0, from); // contents before the memos list
            var suffix = originFileContent.slice(to); // contents after the memos list
            var localRecordList = localRecordContent
                ? localRecordContent.split(/\n(?=- )/g)
                : [];
            // MoeMemos records with timestamp identifier (^timestamp)
            var moeMemosRecords = {}; // map<timestamp, record>
            // Thino and other platform memos (without MoeMemos timestamp format)
            var otherPlatformMemos = [];
            for (var _i = 0, localRecordList_1 = localRecordList; _i < localRecordList_1.length; _i++) {
                var record = localRecordList_1[_i];
                // Check for MoeMemos format (has ^timestamp at the end)
                var moeMemosMatch = record.match(/.*\^(\d{10})/);
                // Check for Thino format (starts with bullet point and time)
                var thinoOrOtherFormatMatch = record.match(/^- \d{1,2}:\d{2}/);
                if (moeMemosMatch === null || moeMemosMatch === void 0 ? void 0 : moeMemosMatch.length) {
                    var createdTs = (_b = moeMemosMatch[1]) === null || _b === void 0 ? void 0 : _b.trim();
                    moeMemosRecords[createdTs] = record;
                }
                else if (thinoOrOtherFormatMatch && !(moeMemosMatch === null || moeMemosMatch === void 0 ? void 0 : moeMemosMatch.length)) {
                    // This is a Thino memo or other platform memo that doesn't have MoeMemos timestamp format
                    otherPlatformMemos.push(record);
                }
            }
            log.debug("for ".concat(today, "\n\nfetchedRecordList: ").concat(JSON.stringify({
                from: from,
                to: to,
                prefix: prefix,
                suffix: suffix,
                localRecordList: localRecordList,
                moeMemosRecords: moeMemosRecords,
                otherPlatformMemos: otherPlatformMemos
            })));
            // Process MoeMemos records
            var sortedMoeMemosRecords = Object.entries(__assign(__assign({}, moeMemosRecords), fetchedRecordList))
                .sort(function (a, b) { return Number(a[0]) - Number(b[0]); })
                .map(function (item) { return item[1]; });
            // Combine MoeMemos records with Thino and other platform memos
            var allMemosCombined = __spreadArray(__spreadArray([], sortedMoeMemosRecords, true), otherPlatformMemos, true).join("\n");
            var modifiedFileContent = prefix.trim() +
                "\n\n".concat(allMemosCombined, "\n\n") +
                suffix.trim() +
                "\n";
            return modifiedFileContent;
        };
    }
    return DailyNoteModifier;
}());
exports.DailyNoteModifier = DailyNoteModifier;
