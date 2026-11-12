import { describe, expect, it, vi } from "vitest";

vi.mock("@/env", () => ({
  env: { BETTER_AUTH_URL: "https://league.example.test" },
}));
vi.mock("@/db/client", () => ({ txDb: {} }));

const { consoleSender, outboxSender } = await import("./outbox");

const email = {
  to: "pat@example.test",
  subject: "Hi",
  html: "<p>Hi</p>",
  text: "Hi there",
  idempotencyKey: "message/1",
};

describe("outboxSender", () => {
  it("prints email in development when no provider is set up", async () => {
    const log = vi.fn();
    const send = outboxSender({ nodeEnv: "development" }, log);
    expect(await send?.(email)).toEqual({
      ok: true,
      value: { id: "console/message/1" },
    });
    expect(log).toHaveBeenCalledWith(expect.stringContaining("Hi there"));
  });

  it("sends nothing in production without a provider, so messages wait", () => {
    expect(outboxSender({ nodeEnv: "production" })).toBeNull();
  });

  it("uses the provider when it is configured", () => {
    const send = outboxSender({
      nodeEnv: "production",
      resendApiKey: "re_test_value",
      emailFrom: "League <hi@example.test>",
    });
    expect(send).toBeTypeOf("function");
  });
});

describe("consoleSender", () => {
  it("names the recipient and subject", async () => {
    const log = vi.fn();
    await consoleSender(log)(email);
    expect(log.mock.calls[0]?.[0]).toContain("To pat@example.test: Hi");
  });
});
