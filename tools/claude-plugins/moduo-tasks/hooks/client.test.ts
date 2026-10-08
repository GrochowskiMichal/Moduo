import { describe, expect, test } from "claude-code/testing";

import { ConnectorError, classify, parseAnswer } from "./client";
import { clean, localDate, resolveTimeZone } from "./model";

const ok = (payload: unknown) =>
  JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    result: { content: [{ type: "text", text: JSON.stringify(payload) }] },
  });

describe("connector client", () => {
  test("maps connector errors", () => {
    expect(classify(401, "")).toBe("rejected");
    expect(classify(403, "")).toBe("rejected");
    expect(classify(200, "Unknown tool: tasks_list")).toBe("noaccess");
    expect(classify(200, "no edit access to tasks")).toBe("noaccess");
    expect(classify(null, "")).toBe("offline");
    expect(classify(503, "upstream")).toBe("offline");
    expect(classify(400, "bad input")).toBe("error");

    expect(parseAnswer<number[]>(200, ok([1, 2]))).toEqual([1, 2]);
    expect(() => parseAnswer(401, "Unauthorized")).toThrow(ConnectorError);
    let problem = "";
    try {
      parseAnswer(
        200,
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          error: { code: -32601, message: "Unknown tool: tasks_list" },
        }),
      );
    } catch (err) {
      problem = (err as ConnectorError).problem;
    }
    expect(problem).toBe("noaccess");
    try {
      parseAnswer(
        200,
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          result: { isError: true, content: [{ text: "boom" }] },
        }),
      );
    } catch (err) {
      problem = (err as ConnectorError).problem;
    }
    expect(problem).toBe("error");
  });

  test("strips terminal escapes from Moduo text", () => {
    const esc = String.fromCharCode(27);
    const rlo = String.fromCharCode(0x202e);
    expect(clean(`${esc}[31mRed${esc}[0m title`)).toBe("[31mRed[0m title");
    expect(clean(`a${rlo}b\nc\td`)).toBe("abcd");
    expect(clean("Zażółć gęślą jaźń · MCP-1")).toBe("Zażółć gęślą jaźń · MCP-1");
    expect(clean(null)).toBe("");
  });

  test("uses the local date", () => {
    // 2026-10-07 22:30 UTC is already 8 October in Warsaw (UTC+2 in summer).
    const justAfterMidnight = Date.UTC(2026, 9, 7, 22, 30);
    expect(localDate(justAfterMidnight, "Europe/Warsaw")).toBe("2026-10-08");
    expect(localDate(justAfterMidnight, "UTC")).toBe("2026-10-07");
    // Winter time: 2026-12-31 23:30 UTC is 1 January in Warsaw (UTC+1).
    expect(localDate(Date.UTC(2026, 11, 31, 23, 30), "Europe/Warsaw")).toBe("2027-01-01");
    expect(resolveTimeZone("Europe/Warsaw")).toBe("Europe/Warsaw");
    expect(resolveTimeZone("Not/AZone")).not.toBe("Not/AZone");
  });
});
