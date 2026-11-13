import { describe, expect, it } from "vitest";
import {
  authorizeUrl,
  downloadImage,
  exchangeCode,
  type InstagramFetch,
  profile,
  recentPosts,
  RECENT_LIMIT,
  refreshToken,
} from "./instagram";
import {
  EXPIRED_FIXTURE_TOKEN,
  FIXTURE_CODE,
  fixtureFetch,
  fixturePhoto,
  usesInstagramFixture,
} from "./instagram-fixture";

const now = new Date("2026-11-01T12:00:00Z");
const app = {
  appId: "1234567890",
  appSecret: "fixture",
  fetch: fixtureFetch(),
};

describe("authorizeUrl", () => {
  it("asks only for the basic scope, with the state, on Instagram's own sign-in", () => {
    const url = new URL(
      authorizeUrl({
        appId: "1234567890",
        redirectUri: "https://league.example.test/app/admin/instagram/callback",
        state: "abc",
      }),
    );
    expect(url.origin + url.pathname).toBe(
      "https://www.instagram.com/oauth/authorize",
    );
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: "1234567890",
      redirect_uri: "https://league.example.test/app/admin/instagram/callback",
      response_type: "code",
      scope: "instagram_business_basic",
      state: "abc",
      enable_fb_login: "false",
    });
  });
});

describe("exchangeCode", () => {
  it("turns the code into a 60-day token", async () => {
    const result = await exchangeCode(
      app,
      { code: `${FIXTURE_CODE}#_`, redirectUri: "https://x.example.test/cb" },
      now,
    );
    expect(result).toEqual({
      ok: true,
      value: {
        accessToken: "fixture-long-lived-token",
        expiresAt: new Date("2026-12-31T12:00:00Z"),
      },
    });
  });

  it("sends the secret in the body and the short token in a header, never in the address", async () => {
    const seen: { url: string; headers: Record<string, string> | undefined }[] =
      [];
    const spy: InstagramFetch = (url, init) => {
      seen.push({ url, headers: init.headers });
      return fixtureFetch()(url, init);
    };
    await exchangeCode(
      { ...app, fetch: spy },
      { code: FIXTURE_CODE, redirectUri: "https://x.example.test/cb" },
      now,
    );
    expect(seen.map((s) => s.url).join(" ")).not.toContain("fixture-short");
    expect(seen[1]?.headers?.Authorization).toBe(
      "Bearer fixture-short-lived-token",
    );
  });

  it("reports a refused code as a sign-in problem", async () => {
    const result = await exchangeCode(
      app,
      { code: "wrong", redirectUri: "https://x.example.test/cb" },
      now,
    );
    expect(result).toEqual({
      ok: false,
      error: { kind: "auth", message: "Instagram refused the sign-in" },
    });
  });
});

describe("refreshToken", () => {
  it("extends the token", async () => {
    const result = await refreshToken(app, "fixture-long-lived-token", now);
    expect(result.ok && result.value.accessToken).toBe(
      "fixture-refreshed-token",
    );
  });

  it("calls an expired token an auth failure, so admins reconnect", async () => {
    const result = await refreshToken(app, EXPIRED_FIXTURE_TOKEN, now);
    expect(result).toEqual({
      ok: false,
      error: {
        kind: "auth",
        message: "Instagram no longer accepts the connection",
      },
    });
  });

  it("calls an unreachable Instagram a passing problem", async () => {
    const result = await refreshToken(
      { fetch: fixtureFetch({ unreachable: true }) },
      "fixture-long-lived-token",
      now,
    );
    expect(result).toEqual({
      ok: false,
      error: { kind: "other", message: "Instagram could not be reached" },
    });
  });
});

describe("profile", () => {
  it("reads the account's ID and username", async () => {
    expect(await profile(app, "fixture-long-lived-token")).toEqual({
      ok: true,
      value: {
        externalId: "17841400000000001",
        username: "mccarrenkickball.example",
      },
    });
  });
});

describe("recentPosts", () => {
  it("reads posts newest first with the photo to copy for each kind", async () => {
    const result = await recentPosts(app, "fixture-long-lived-token");
    if (!result.ok) throw new Error(result.error.message);
    const { posts, complete } = result.value;
    expect(complete).toBe(true);
    // The video without a thumbnail is left out.
    expect(posts.map((p) => p.externalId)).toEqual([
      "18000000000000001",
      "18000000000000003",
      "18000000000000004",
      "18000000000000005",
      "18000000000000006",
    ]);
    const video = posts.find((p) => p.mediaType === "video");
    expect(video?.imageUrl).toContain("double-play-thumb.jpg");
    expect(posts.find((p) => p.mediaType === "carousel")?.imageUrl).toContain(
      "after-party-1.jpg",
    );
    expect(
      posts.find((p) => p.externalId === "18000000000000003")?.caption,
    ).toBeNull();
    expect(posts[0]?.takenAt).toEqual(new Date("2026-10-25T21:10:05Z"));
  });

  it("is incomplete when the page is full, and drops links that are not Instagram's", async () => {
    const item = (i: number) => ({
      id: String(i),
      media_type: "IMAGE",
      media_url: `https://scontent.cdninstagram.com/${i}.jpg`,
      permalink:
        i === 0
          ? "https://evil.example.test/p/x/"
          : `https://www.instagram.com/p/${i}/`,
      timestamp: "2026-10-01T10:00:00+0000",
    });
    const result = await recentPosts(
      {
        fetch: fixtureFetch({
          media: {
            data: Array.from({ length: RECENT_LIMIT }, (_, i) => item(i)),
          },
        }),
      },
      "fixture-long-lived-token",
    );
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.complete).toBe(false);
    expect(result.value.posts).toHaveLength(RECENT_LIMIT - 1);
  });
});

describe("downloadImage", () => {
  it("copies a photo from Instagram's CDN", async () => {
    const url = "https://scontent-lga3-1.cdninstagram.com/v/t51.fixture/a.jpg";
    const result = await downloadImage(app, url);
    expect(result.ok && result.value.contentType).toBe("image/png");
    expect(result.ok && result.value.bytes.equals(fixturePhoto(url))).toBe(
      true,
    );
  });

  it.each([
    "http://scontent.cdninstagram.com/a.jpg",
    "https://169.254.169.254/latest/meta-data",
    "https://cdninstagram.com.evil.example.test/a.jpg",
    "not a url",
  ])("refuses to fetch %s", async (url) => {
    let called = false;
    const result = await downloadImage(
      {
        fetch: (u, i) => {
          called = true;
          return fixtureFetch()(u, i);
        },
      },
      url,
    );
    expect(result.ok).toBe(false);
    expect(called).toBe(false);
  });

  it("refuses something that is not an image, or too large", async () => {
    const respond =
      (type: string, length: number): InstagramFetch =>
      async () => ({
        ok: true,
        status: 200,
        headers: new Headers({
          "content-type": type,
          "content-length": String(length),
        }),
        json: async () => ({}),
        arrayBuffer: async () => new ArrayBuffer(10),
      });
    const url = "https://scontent.cdninstagram.com/a.jpg";
    expect(
      (await downloadImage({ fetch: respond("text/html", 10) }, url)).ok,
    ).toBe(false);
    expect(
      (await downloadImage({ fetch: respond("image/jpeg", 9e6) }, url)).ok,
    ).toBe(false);
    expect(
      (await downloadImage({ fetch: respond("image/jpeg; q=1", 10) }, url)).ok,
    ).toBe(true);
  });
});

describe("fixturePhoto", () => {
  it("draws a valid PNG, different per address", () => {
    const a = fixturePhoto("a");
    expect(a.subarray(1, 4).toString()).toBe("PNG");
    expect(a.equals(fixturePhoto("b"))).toBe(false);
    expect(a.length).toBeLessThan(50_000);
  });
});

describe("usesInstagramFixture", () => {
  it("is on in development when asked for and no real app is set", () => {
    expect(
      usesInstagramFixture(
        { INSTAGRAM_FIXTURE: "true", NODE_ENV: "development" },
        false,
      ),
    ).toBe(true);
  });

  it("is off in a production build unless it is the demo", () => {
    const vars = { INSTAGRAM_FIXTURE: "true", NODE_ENV: "production" };
    expect(usesInstagramFixture(vars, false)).toBe(false);
    expect(usesInstagramFixture(vars, true)).toBe(true);
  });

  it("is off when a real app is configured, or when not asked for", () => {
    expect(
      usesInstagramFixture(
        { INSTAGRAM_FIXTURE: "true", INSTAGRAM_APP_ID: "123" },
        true,
      ),
    ).toBe(false);
    expect(usesInstagramFixture({ NODE_ENV: "development" }, true)).toBe(false);
  });
});
