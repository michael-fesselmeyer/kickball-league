// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import axe from "axe-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DeviceState, Subscribed } from "@/lib/pwa/push-client";

const browser = vi.hoisted(
  (): {
    state: DeviceState;
    subscribed: Subscribed;
    unsubscribed: string | null;
  } => ({
    state: { state: "off" },
    subscribed: { ok: true, json: "{}", endpoint: "" },
    unsubscribed: null,
  }),
);
const actions = vi.hoisted(() => ({
  save: vi.fn(),
  forget: vi.fn(),
}));

vi.mock("@/lib/pwa/push-client", () => ({
  browserPushGlobals: () => ({ hasPushManager: true }),
  deviceState: vi.fn(async () => browser.state),
  subscribeDevice: vi.fn(async () => browser.subscribed),
  unsubscribeDevice: vi.fn(async () => browser.unsubscribed),
}));
vi.mock("./actions", () => ({
  savePushSettingsAction: actions.save,
  forgetPushDeviceAction: actions.forget,
}));

const { PushSettings } = await import("./push-settings");

const ENDPOINT = "https://push.example.test/send/device-1";
const topics = [
  { topic: "rainout", label: "Rain-outs", hint: "Rained out.", enabled: false },
  {
    topic: "sub_request",
    label: "Sub requests",
    hint: "Subs.",
    enabled: false,
  },
  {
    topic: "score",
    label: "Score confirmations",
    hint: "Scores.",
    enabled: true,
  },
];

const show = (devices = 0) =>
  render(<PushSettings publicKey="Bkey" topics={topics} devices={devices} />);

beforeEach(() => {
  browser.state = { state: "off" };
  browser.subscribed = {
    ok: true,
    json: JSON.stringify({ endpoint: ENDPOINT }),
    endpoint: ENDPOINT,
  };
  browser.unsubscribed = null;
  actions.save.mockReset();
  actions.forget.mockReset();
  actions.save.mockResolvedValue({
    status: "saved",
    message: "Push settings saved.",
    devices: 1,
  });
  actions.forget.mockResolvedValue({
    status: "saved",
    message: "Push is off on this device.",
    devices: 1,
  });
});

afterEach(cleanup);

describe("PushSettings", () => {
  it("offers each push topic, with the saved choices ticked", async () => {
    const { container } = show();
    expect(
      await screen.findByText(/Push is off\. Tick a topic and save/),
    ).toBeTruthy();
    expect(
      screen.getByLabelText(/Score confirmations/).matches(":checked"),
    ).toBe(true);
    expect(screen.getByLabelText(/Rain-outs/).matches(":checked")).toBe(false);
    const results = await axe.run(container);
    expect(results.violations).toEqual([]);
  });

  it("subscribes this device before saving, and sends its subscription", async () => {
    show();
    await screen.findByText(/Push is off/);
    fireEvent.click(screen.getByLabelText(/Rain-outs/));
    fireEvent.click(screen.getByRole("button", { name: "Save push settings" }));
    expect(await screen.findByText("Push settings saved.")).toBeTruthy();
    expect(screen.getByText("Push is on for this device.")).toBeTruthy();
    // What was saved stays ticked after the form's action has run.
    expect(screen.getByLabelText(/Rain-outs/).matches(":checked")).toBe(true);
    const form = actions.save.mock.calls[0]?.[1] as FormData;
    expect(form.getAll("topic")).toEqual(["rainout", "score"]);
    expect(form.get("subscription")).toBe(
      JSON.stringify({ endpoint: ENDPOINT }),
    );
    expect(
      screen.getByRole("button", { name: "Turn off push on this device" }),
    ).toBeTruthy();
  });

  it("saves without subscribing when every topic is off", async () => {
    show();
    await screen.findByText(/Push is off/);
    fireEvent.click(screen.getByLabelText(/Score confirmations/));
    fireEvent.click(screen.getByRole("button", { name: "Save push settings" }));
    await screen.findByText("Push settings saved.");
    const form = actions.save.mock.calls[0]?.[1] as FormData;
    expect(form.getAll("topic")).toEqual([]);
    expect(form.get("subscription")).toBeNull();
  });

  it("says why when the browser will not subscribe, and saves nothing", async () => {
    show();
    await screen.findByText(/Push is off/);
    browser.subscribed = { ok: false, reason: "blocked" };
    browser.state = { state: "blocked" };
    fireEvent.click(screen.getByRole("button", { name: "Save push settings" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/Notifications are blocked/);
    expect(actions.save).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(
        screen
          .getByRole("button", { name: "Save push settings" })
          .matches(":disabled"),
      ).toBe(true),
    );
  });

  it("explains when this browser cannot get push at all", async () => {
    browser.state = { state: "unsupported" };
    show();
    expect(
      await screen.findByText(/add the app to your Home Screen/),
    ).toBeTruthy();
    // Inside a disabled fieldset, so the browser disables it.
    expect(screen.getByLabelText(/Rain-outs/).matches(":disabled")).toBe(true);
  });

  it("turns push off on this device and shows the devices left", async () => {
    browser.state = { state: "on", endpoint: ENDPOINT };
    browser.unsubscribed = ENDPOINT;
    show(2);
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Turn off push on this device",
      }),
    );
    expect(await screen.findByText("Push is off on this device.")).toBeTruthy();
    expect(
      (actions.forget.mock.calls[0]?.[1] as FormData).get("endpoint"),
    ).toBe(ENDPOINT);
    expect(
      screen.getByText(/Push is on for 1 other device, not this one/),
    ).toBeTruthy();
  });
});
