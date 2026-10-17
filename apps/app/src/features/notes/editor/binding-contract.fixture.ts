/**
 * A FROZEN note doc (NR-3 binding contract): the bytes `buildDocStateFromMarkdown`
 * wrote for `GOLDEN_MD` under Lexical 0.52.0, the CollaborationPluginV2 binding
 * and the `root-v2` root. Stored docs in production look exactly like this.
 *
 * Never regenerate it to make a failing test pass: a failure means a Lexical
 * bump reads EXISTING notes differently, which is the regression the contract
 * test exists to catch.
 */

/** The markdown the golden doc was built from (a frozen copy of the fixture). */
export const GOLDEN_MD = [
  "# Plan",
  "",
  "Intro with **bold**, *italic*, ***both***, ~~struck~~, `code` and a [link](https://example.com/a).",
  "A second line inside the same block.",
  "",
  "## Steps",
  "",
  "- first",
  "- second",
  "",
  "1. one",
  "2. two",
  "",
  "- [x] done thing",
  "- [ ] open thing",
  "",
  "- [ ] Ship the report <!-- moduo:task:task-123 -->",
  "",
  "Talked to [Jane Doe](moduo://contact/abc-123) today.",
  "",
  "| Name | Status |",
  "| --- | --- |",
  "| Acme | **Active** |",
  "| Globex | [site](https://globex.test) |",
  "",
  "[Kickoff notes](moduo://note/n-1)",
].join("\n");

export const GOLDEN_DOC_B64 = [
  "AY0B+4Dyyg0ABwEHcm9vdC12MgMHaGVhZGluZwcA+4Dyyg0ABgQA+4Dyyg0BBFBsYW6H+4Dyyg0AAwlwYXJhZ3JhcGgHAPuA",
  "8soNBgYEAPuA8soNBwtJbnRybyB3aXRoIIT7gPLKDRIEYm9sZIT7gPLKDRYCLCCE+4Dyyg0YBml0YWxpY4T7gPLKDR4CLCCE",
  "+4Dyyg0gBGJvdGiE+4Dyyg0kAiwghPuA8soNJgZzdHJ1Y2uE+4Dyyg0sAiwghPuA8soNLgRjb2RlhPuA8soNMgcgYW5kIGEg",
  "xvuA8soNEvuA8soNEwFwDnsiX19mb3JtYXQiOjF9xvuA8soNOvuA8soNEwFpATHG+4Dyyg0W+4Dyyg0XAXAEbnVsbMb7gPLK",
  "DTz7gPLKDRcBaQRudWxsxvuA8soNPfuA8soNFwFpATLG+4Dyyg0Y+4Dyyg0ZAWkEbnVsbMb7gPLKDT/7gPLKDRkBcA57Il9f",
  "Zm9ybWF0Ijoyfcb7gPLKDUD7gPLKDRkBaQEzxvuA8soNHvuA8soNHwFwBG51bGzG+4Dyyg1C+4Dyyg0fAWkEbnVsbMb7gPLK",
  "DUP7gPLKDR8BaQE0xvuA8soNIPuA8soNIQFpBG51bGzG+4Dyyg1F+4Dyyg0hAXAOeyJfX2Zvcm1hdCI6M33G+4Dyyg1G+4Dy",
  "yg0hAWkBNcb7gPLKDST7gPLKDSUBcARudWxsxvuA8soNSPuA8soNJQFpBG51bGzG+4Dyyg1J+4Dyyg0lAWkBNsb7gPLKDSb7",
  "gPLKDScBaQRudWxsxvuA8soNS/uA8soNJwFwDnsiX19mb3JtYXQiOjR9xvuA8soNTPuA8soNJwFpATfG+4Dyyg0s+4Dyyg0t",
  "AXAEbnVsbMb7gPLKDU77gPLKDS0BaQRudWxsxvuA8soNT/uA8soNLQFpATjG+4Dyyg0u+4Dyyg0vAWkEbnVsbMb7gPLKDVH7",
  "gPLKDS8BcA97Il9fZm9ybWF0IjoxNn3G+4Dyyg1S+4Dyyg0vAWkBOcb7gPLKDTL7gPLKDTMBcARudWxsxvuA8soNVPuA8soN",
  "MwFpBG51bGzG+4Dyyg1V+4Dyyg0zAWkCMTCG+4Dyyg05AWkEbnVsbIf7gPLKDQcDBGxpbmsHAPuA8soNWAYEAPuA8soNWQRs",
  "aW5rKAD7gPLKDVgFX191cmwBdxVodHRwczovL2V4YW1wbGUuY29tL2GH+4Dyyg1YBgQA+4Dyyg1fAS6H+4Dyyg1fAwlsaW5l",
  "YnJlYWuH+4Dyyg1hBgQA+4Dyyg1iJEEgc2Vjb25kIGxpbmUgaW5zaWRlIHRoZSBzYW1lIGJsb2NrLof7gPLKDQYDB2hlYWRp",
  "bmcHAPuA8soNhwEGBAD7gPLKDYgBBVN0ZXBzKAD7gPLKDYcBBV9fdGFnAXcCaDKH+4Dyyg2HAQMEbGlzdAcA+4Dyyg2PAQMI",
  "bGlzdGl0ZW0HAPuA8soNkAEGBAD7gPLKDZEBBWZpcnN0h/uA8soNkAEDCGxpc3RpdGVtBwD7gPLKDZcBBgQA+4Dyyg2YAQZz",
  "ZWNvbmQoAPuA8soNlwEHX192YWx1ZQF9AigA+4Dyyg2PAQVfX3RhZwF3AnVsKAD7gPLKDY8BCl9fbGlzdFR5cGUBdwZidWxs",
  "ZXQoAPuA8soNjwEOc19tZExpc3RNYXJrZXIBdwEth/uA8soNjwEDBGxpc3QHAPuA8soNowEDCGxpc3RpdGVtBwD7gPLKDaQB",
  "BgQA+4Dyyg2lAQNvbmWH+4Dyyg2kAQMIbGlzdGl0ZW0HAPuA8soNqQEGBAD7gPLKDaoBA3R3bygA+4Dyyg2pAQdfX3ZhbHVl",
  "AX0Ch/uA8soNowEDBGxpc3QHAPuA8soNrwEDCGxpc3RpdGVtBwD7gPLKDbABBgQA+4Dyyg2xAQpkb25lIHRoaW5nKAD7gPLK",
  "DbABCV9fY2hlY2tlZAF4h/uA8soNsAEDCGxpc3RpdGVtBwD7gPLKDb0BBgQA+4Dyyg2+AQpvcGVuIHRoaW5nKAD7gPLKDb0B",
  "B19fdmFsdWUBfQIoAPuA8soNvQEJX19jaGVja2VkAXkoAPuA8soNrwEFX190YWcBdwJ1bCgA+4Dyyg2vAQpfX2xpc3RUeXBl",
  "AXcFY2hlY2soAPuA8soNrwEOc19tZExpc3RNYXJrZXIBdwEth/uA8soNrwEDCXRhc2stbGluZQcA+4Dyyg3OAQYEAPuA8soN",
  "zwEPU2hpcCB0aGUgcmVwb3J0KAD7gPLKDc4BCF9fdGFza0lkAXcIdGFzay0xMjOH+4Dyyg3OAQMJcGFyYWdyYXBoBwD7gPLK",
  "DeABBgQA+4Dyyg3hAQpUYWxrZWQgdG8gh/uA8soN4QEDCmVudGl0eS1yZWYoAPuA8soN7AEMX19lbnRpdHlUeXBlAXcHY29u",
  "dGFjdCgA+4Dyyg3sAQpfX2VudGl0eUlkAXcHYWJjLTEyMygA+4Dyyg3sAQdfX2xhYmVsAXcISmFuZSBEb2WH+4Dyyg3sAQYE",
  "APuA8soN8AEHIHRvZGF5Lof7gPLKDeABAwV0YWJsZQcA+4Dyyg34AQMIdGFibGVyb3cHAPuA8soN+QEDCXRhYmxlY2VsbAcA",
  "+4Dyyg36AQMJcGFyYWdyYXBoBwD7gPLKDfsBBgQA+4Dyyg38AQROYW1lKAD7gPLKDfoBDV9faGVhZGVyU3RhdGUBfQGH+4Dy",
  "yg36AQMJdGFibGVjZWxsBwD7gPLKDYICAwlwYXJhZ3JhcGgHAPuA8soNgwIGBAD7gPLKDYQCBlN0YXR1cygA+4Dyyg2CAg1f",
  "X2hlYWRlclN0YXRlAX0Bh/uA8soN+QEDCHRhYmxlcm93BwD7gPLKDYwCAwl0YWJsZWNlbGwHAPuA8soNjQIDCXBhcmFncmFw",
  "aAcA+4Dyyg2OAgYEAPuA8soNjwIEQWNtZYf7gPLKDY0CAwl0YWJsZWNlbGwHAPuA8soNlAIDCXBhcmFncmFwaAcA+4Dyyg2V",
  "AgYEAPuA8soNlgIGQWN0aXZlRvuA8soNlwIBcA57Il9fZm9ybWF0IjoxfYb7gPLKDZwCAXAEbnVsbIf7gPLKDYwCAwh0YWJs",
  "ZXJvdwcA+4Dyyg2fAgMJdGFibGVjZWxsBwD7gPLKDaACAwlwYXJhZ3JhcGgHAPuA8soNoQIGBAD7gPLKDaICBkdsb2JleIf7",
  "gPLKDaACAwl0YWJsZWNlbGwHAPuA8soNqQIDCXBhcmFncmFwaAcA+4Dyyg2qAgMEbGluawcA+4Dyyg2rAgYEAPuA8soNrAIE",
  "c2l0ZSgA+4Dyyg2rAgVfX3VybAF3E2h0dHBzOi8vZ2xvYmV4LnRlc3SH+4Dyyg34AQMIcGFnZS1yb3coAPuA8soNsgIIX19u",
  "b3RlSWQBdwNuLTEoAPuA8soNsgIHX19sYWJlbAF3DUtpY2tvZmYgbm90ZXMA",
].join("");
