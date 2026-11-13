import { describe, expect, it, vi } from "vitest";
import { resendSender } from "./email";

const KEY = "re_test_secret_value";
const message = {
  to: "player@example.test",
  subject: "Hi",
  html: "<p>Hi</p>",
  text: "Hi",
  idempotencyKey: "magic-link/abc",
};

const respond = (status: number, body: unknown) =>
  vi.fn<typeof globalThis.fetch>(
    async () =>
      new Response(typeof body === "string" ? body : JSON.stringify(body), {
        status,
        statusText: status === 200 ? "OK" : "Unprocessable",
      }),
  );

describe("resendSender", () => {
  it("posts the message with the key and the idempotency key", async () => {
    const fetch = respond(200, { id: "email-1" });
    const send = resendSender({
      apiKey: KEY,
      from: "League <hi@example.test>",
      fetch,
    });
    expect(await send(message)).toEqual({ ok: true, value: { id: "email-1" } });
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init?.headers).toEqual({
      Authorization: `Bearer ${KEY}`,
      "Content-Type": "application/json",
      "Idempotency-Key": "magic-link/abc",
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      from: "League <hi@example.test>",
      to: ["player@example.test"],
      subject: "Hi",
      html: "<p>Hi</p>",
      text: "Hi",
    });
  });

  it("leaves the idempotency header off when there is no key", async () => {
    const fetch = respond(200, { id: "email-2" });
    const plain = {
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
    };
    await resendSender({ apiKey: KEY, from: "hi@example.test", fetch })(plain);
    const [, init] = fetch.mock.calls[0] ?? [];
    expect(init?.headers).not.toHaveProperty("Idempotency-Key");
  });

  it("reports Resend's reason, without the API key", async () => {
    const send = resendSender({
      apiKey: KEY,
      from: "hi@example.test",
      fetch: respond(422, { message: "The from address is not verified." }),
    });
    const result = await send(message);
    expect(result).toEqual({
      ok: false,
      error:
        "Resend refused the email (422): The from address is not verified.",
    });
    expect(JSON.stringify(result)).not.toContain(KEY);
  });

  it("names a quota refusal, so the outbox can wait for tomorrow", async () => {
    const send = resendSender({
      apiKey: KEY,
      from: "hi@example.test",
      fetch: respond(429, {
        name: "daily_quota_exceeded",
        message: "You have reached your daily email sending quota.",
      }),
    });
    expect(await send(message)).toEqual({
      ok: false,
      error:
        "Resend refused the email (429 daily_quota_exceeded): You have reached your daily email sending quota.",
    });
  });

  it("falls back to the status text when the body is not JSON", async () => {
    const send = resendSender({
      apiKey: KEY,
      from: "hi@example.test",
      fetch: respond(422, "oops"),
    });
    expect(await send(message)).toEqual({
      ok: false,
      error: "Resend refused the email (422): Unprocessable",
    });
  });

  it("reports a network failure", async () => {
    const send = resendSender({
      apiKey: KEY,
      from: "hi@example.test",
      fetch: vi.fn(async () => {
        throw new TypeError(`fetch failed for ${KEY}`);
      }),
    });
    expect(await send(message)).toEqual({
      ok: false,
      error: "Resend could not be reached.",
    });
  });
});
