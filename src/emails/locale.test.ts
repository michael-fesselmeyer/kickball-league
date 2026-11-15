import { describe, expect, it } from "vitest";
import type { Rendered } from "@/db/queries/outbox";
import { ENGLISH_ONLY_TEMPLATES, rendererFor } from "./templates";

/**
 * Each email is written in its recipient's language (ADR 0065): the
 * outbox reads it from their profile as the message is sent, and passes it
 * to the renderer. English is the fallback, and admin-only emails stay in
 * English.
 */
const render = rendererFor({
  siteUrl: "https://league.example.test",
  unsubscribeSecret: "test-secret-for-unsubscribe-links-0000",
});
const userId = "00000000-0000-4000-8000-000000000001" as never;

function sent(
  template: string,
  payload: Record<string, unknown>,
  locale?: "en" | "es",
  topic: "rainout" | "payment" | "sub_request" | "operations" = "rainout",
): Rendered {
  const result = render(template, payload, {
    userId,
    topic,
    ...(locale ? { locale } : {}),
  });
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

const gameDay = {
  seasonName: "Fall 2026",
  gameId: "5ea50000-0000-4000-8000-000000000001",
  teams: "Aces vs Bees",
  day: "Tue, Sep 15",
  was: "6:00 PM",
  kind: "off",
  newStart: null,
  reason: null,
};

describe("an email in the recipient's language", () => {
  it("is written in Spanish for a Spanish speaker, frame and push included", () => {
    const email = sent("game_day_change", gameDay, "es");
    expect(email.subject).toBe("Suspendido: Aces vs Bees, Tue, Sep 15");
    expect(email.html).toContain('<html lang="es">');
    expect(email.text).toContain("Tu partido se suspende");
    expect(email.text).toContain(
      "Te llegó este correo porque juegas en Fall 2026.",
    );
    expect(email.text).toContain("Elige qué correos recibes y cuándo");
    expect(email.text).toContain(
      "Dejar de recibir correos sobre suspensiones por lluvia",
    );
    expect(email.push?.title).toBe("Tu partido se suspende");
    expect(email.push?.reason).toBe("Porque juegas en Fall 2026.");
  });

  it("links a public page in the recipient's language when it is translated", () => {
    const email = sent("game_day_change", gameDay, "es");
    expect(email.push?.path).toBe(`/es/games/${gameDay.gameId}`);
    expect(sent("game_day_change", gameDay, "en").push?.path).toBe(
      `/games/${gameDay.gameId}`,
    );
  });

  it("falls back to English with no language, or in English", () => {
    for (const email of [
      sent("game_day_change", gameDay),
      sent("game_day_change", gameDay, "en"),
    ]) {
      expect(email.subject).toBe("Off: Aces vs Bees, Tue, Sep 15");
      expect(email.html).toContain('<html lang="en">');
      expect(email.text).toContain("You got this email because you play in");
      expect(email.text).toContain("Stop emails about rain-outs");
      expect(email.push?.reason).toBe("Because you play in Fall 2026.");
    }
  });

  it("counts in the language's plural rules", () => {
    const payment = {
      seasonName: "Fall 2026",
      seasonSlug: "fall-2026",
      deadline: "Friday, September 11 at 11:59 PM",
      daysLeft: 3,
      needsWaiver: false,
    };
    expect(sent("payment_reminder", payment, "es", "payment").subject).toBe(
      "Tu cuota de Fall 2026 vence en 3 días",
    );
    expect(
      sent("payment_reminder", { ...payment, daysLeft: 1 }, "es", "payment")
        .subject,
    ).toBe("Tu cuota de Fall 2026 vence mañana");
    expect(
      sent("payment_reminder", payment, undefined, "payment").subject,
    ).toBe("Your Fall 2026 fee is due in 3 days");
  });

  it("keeps an admin-only email in English, frame and all", () => {
    expect(ENGLISH_ONLY_TEMPLATES.has("rain_alert")).toBe(true);
    const email = sent(
      "rain_alert",
      {
        seasonName: "Fall 2026",
        seasonSlug: "fall-2026",
        date: "2026-09-13",
        day: "Sun, Sep 13",
        firstPitch: "1:00 PM",
        games: 4,
        level: "likely",
        peakChance: 80,
        thunder: false,
      },
      "es",
    );
    expect(email.subject).toBe("Rain likely Sun, Sep 13: Fall 2026");
    expect(email.html).toContain('<html lang="en">');
    expect(email.text).toContain("You got this email because");
    expect(email.text).toContain("Stop emails about rain-outs");
  });

  it("keeps what the league wrote as written", () => {
    const email = sent(
      "sub_request",
      {
        seasonName: "Fall 2026",
        seasonSlug: "fall-2026",
        team: "Kick Assets",
        teams: "Kick Assets vs Bees",
        when: "Sun, Sep 13, 7:00 PM, Field 2",
        spots: "2 subs",
        note: "Bring a red shirt",
        freeAgent: true,
      },
      "es",
      "sub_request",
    );
    expect(email.text).toContain("Kick Assets necesita un suplente");
    expect(email.text).toContain("De parte del capitán: Bring a red shirt");
    expect(email.text).toContain(
      "eres agente libre en Fall 2026 y estás libre a esa hora",
    );
  });
});
