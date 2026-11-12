import { describe, expect, it, vi } from "vitest";
import { err, ok } from "@/domain/result";
import type { Email, EmailSender } from "@/services/email";
import { deliverMagicLink } from "./magic-link";

const link = {
  email: "player@example.test",
  url: "http://localhost:3000/api/auth/magic-link/verify?token=t",
};

describe("deliverMagicLink", () => {
  it("prints the link in development when email is not set up", async () => {
    const log = vi.fn();
    await deliverMagicLink(link, { nodeEnv: "development", log });
    expect(log).toHaveBeenCalledOnce();
    expect(log.mock.calls[0]?.[0]).toContain(link.url);
  });

  it("refuses in production instead of logging a usable link", async () => {
    const log = vi.fn();
    await expect(
      deliverMagicLink(link, { nodeEnv: "production", log }),
    ).rejects.toThrow(/not configured/);
    expect(log).not.toHaveBeenCalled();
  });

  it("emails the link when email is set up, keyed so a retry cannot resend", async () => {
    const log = vi.fn();
    const send = vi.fn<EmailSender>(async () => ok({ id: "email-1" }));
    await deliverMagicLink(link, { nodeEnv: "production", log, send });
    expect(log).not.toHaveBeenCalled();
    const sent = send.mock.calls[0]?.[0] as Email;
    expect(sent.to).toBe(link.email);
    expect(sent.text).toContain(link.url);
    expect(sent.idempotencyKey).toMatch(/^magic-link\/[0-9a-f]{64}$/);
    // The key is derived from the link but does not contain it.
    expect(sent.idempotencyKey).not.toContain("token");
  });

  it("fails the request when the email cannot be sent", async () => {
    const send = vi.fn<EmailSender>(async () =>
      err("Resend refused the email (422): bad"),
    );
    await expect(
      deliverMagicLink(link, { nodeEnv: "production", log: vi.fn(), send }),
    ).rejects.toThrow(
      "Could not send the sign-in email. Resend refused the email (422): bad",
    );
  });
});
