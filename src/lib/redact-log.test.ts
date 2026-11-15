import { describe, expect, it } from "vitest";
import { redactLogLine } from "./redact-log";

describe("redactLogLine", () => {
  it("hides the parameter values a failed query prints", () => {
    expect(redactLogLine("params: YHHC3r5z1IC57pbg06w57Za6ylqmwAC4")).toBe(
      "params: [hidden]",
    );
    expect(redactLogLine("  params: abc,def,3")).toBe("  params: [hidden]");
    expect(
      redactLogLine("[WebServer] params: M1D3O6v6wuKMLRC3pI0Nwt6gm23YTxra"),
    ).toBe("[WebServer] params: [hidden]");
  });

  it("keeps the query text and the rest of an error", () => {
    const line =
      '  query: \'select "id", "token" from "session" where "session"."token" = $1\',';
    expect(redactLogLine(line)).toBe(line);
    expect(redactLogLine("Error: Failed query: select 1")).toBe(
      "Error: Failed query: select 1",
    );
  });

  it("hides a token in a URL's query string", () => {
    expect(
      redactLogLine("GET /api/verify?token=abc123XYZ&next=%2Fapp 200"),
    ).toBe("GET /api/verify?token=[hidden]&next=%2Fapp 200");
    expect(redactLogLine("/reset?code=zzz999")).toBe("/reset?code=[hidden]");
  });

  it("hides bearer tokens and cookie headers", () => {
    expect(redactLogLine("Authorization: Bearer abc.def-ghi_jkl")).toBe(
      "Authorization: Bearer [hidden]",
    );
    expect(redactLogLine("Cookie: better-auth.session_token=abc; a=b")).toBe(
      "Cookie: [hidden]",
    );
    expect(redactLogLine("set-cookie: sid=1; Path=/")).toBe(
      "set-cookie: [hidden]",
    );
  });

  it("leaves an ordinary line alone", () => {
    expect(redactLogLine("GET /seasons/spring 200 in 12ms")).toBe(
      "GET /seasons/spring 200 in 12ms",
    );
  });
});
