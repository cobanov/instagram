const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const assert = require("node:assert/strict");

/* The scanner ships as a single pasteable IIFE, so there is nothing to require().
   It exposes its pure helpers through a __IU_TEST__ hook that only fires when the
   global is present, which never happens in a browser. */
const SOURCE = fs.readFileSync(
  path.join(__dirname, "..", "src", "instagram-unfollower.js"),
  "utf8"
);

/* The DOM the countdown and progress updaters touch; every lookup misses, which
   is exactly what happens in the browser before the panel is mounted. */
function fakeDocument() {
  return {
    hidden: false,
    querySelector: () => null,
    querySelectorAll: () => [],
    getElementById: () => null,
    addEventListener: () => {},
    removeEventListener: () => {}
  };
}

function loadInternals(fetchImpl, overrides = {}) {
  let captured = null;
  const sandbox = {
    __IU_TEST__: (api) => { captured = api; },
    location: { hostname: "www.instagram.com" },
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    navigator: { language: "en-US" },
    document: fakeDocument(),
    console,
    fetch: fetchImpl,
    /* Fire timers immediately so the inter-attempt backoff does not slow the suite. */
    setTimeout: (fn) => { fn(); return 0; },
    clearTimeout: () => {},
    setInterval: () => 0,
    clearInterval: () => {},
    ...overrides
  };
  vm.createContext(sandbox);
  vm.runInContext(SOURCE, sandbox, { filename: "instagram-unfollower.js" });
  if (!captured) {
    throw new Error("__IU_TEST__ hook did not fire");
  }
  return captured;
}

/* Records every request so tests can assert which endpoints were reached. */
function mockFetch(responses) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    const next = responses[calls.length - 1];
    if (!next) throw new Error(`unexpected request #${calls.length} to ${url}`);
    if (next.throws) throw new Error(next.throws);
    const body = next.body ?? (next.json !== undefined ? JSON.stringify(next.json) : "");
    return {
      ok: next.status >= 200 && next.status < 300,
      status: next.status,
      headers: { get: (name) => (next.headers || {})[String(name).toLowerCase()] ?? null },
      text: async () => body,
      json: async () => next.json ?? JSON.parse(body || "{}")
    };
  };
  return { impl, calls };
}

const {
  addFollowBackStatus,
  evaluateUnfollowResponse,
  friendshipListUrl,
  normalizeUser
} = loadInternals();

test("friendship list URLs use Instagram's current REST endpoints", () => {
  assert.equal(
    friendshipListUrl("123", "following"),
    "/api/v1/friendships/123/following/?count=200"
  );
  assert.equal(
    friendshipListUrl("123", "followers", "cursor + /"),
    "/api/v1/friendships/123/followers/?count=200&max_id=cursor%20%2B%20%2F"
  );
});

test("following and followers are diffed by normalized user id", () => {
  const following = [
    normalizeUser({ pk: 1, username: "mutual" }),
    normalizeUser({ pk: "2", username: "not-mutual" })
  ];
  const followers = [normalizeUser({ pk: "1", username: "mutual" })];

  const results = addFollowBackStatus(following, followers);

  assert.equal(results[0].follows_viewer, true);
  assert.equal(results[1].follows_viewer, false);
});

test("friendship scans paginate the REST endpoint with the web app header", async () => {
  const { impl, calls } = mockFetch([
    {
      status: 200,
      json: {
        users: [{ pk: "1", username: "first" }],
        has_more: true,
        next_max_id: "next cursor"
      }
    },
    {
      status: 200,
      json: {
        users: [{ pk: "2", username: "second" }],
        has_more: false
      }
    }
  ]);
  const { fetchFriendshipList } = loadInternals(impl);

  const results = await fetchFriendshipList("123", "following", () => {});

  assert.equal(results.map((user) => user.id).join(","), "1,2");
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, "/api/v1/friendships/123/following/?count=200");
  assert.equal(
    calls[1].url,
    "/api/v1/friendships/123/following/?count=200&max_id=next%20cursor"
  );
  assert.equal(calls[0].init.credentials, "include");
  assert.equal(calls[0].init.headers["x-ig-app-id"], "936619743392459");
});

test("friendship scans reject an incomplete empty page", async () => {
  const { impl } = mockFetch([
    {
      status: 200,
      json: { users: [], has_more: true, next_max_id: "next" }
    }
  ]);
  const { fetchFriendshipList } = loadInternals(impl);

  await assert.rejects(
    fetchFriendshipList("123", "followers", () => {}),
    /Scan failed/
  );
});

test("friendship scans reject a repeated cursor instead of looping forever", async () => {
  const { impl } = mockFetch([
    {
      status: 200,
      json: {
        users: [{ pk: "1", username: "first" }],
        has_more: true,
        next_max_id: "same-cursor"
      }
    },
    {
      status: 200,
      json: {
        users: [{ pk: "2", username: "second" }],
        has_more: true,
        next_max_id: "same-cursor"
      }
    }
  ]);
  const { fetchFriendshipList } = loadInternals(impl);

  await assert.rejects(
    fetchFriendshipList("123", "followers", () => {}),
    /Scan failed/
  );
});

test("a scan resumes from a stored cursor and keeps what was already fetched", async () => {
  const { impl, calls } = mockFetch([
    {
      status: 200,
      json: { users: [{ pk: "3", username: "third" }], has_more: false }
    }
  ]);
  const { fetchFriendshipList } = loadInternals(impl);
  const pages = [];

  const results = await fetchFriendshipList(
    "123",
    "followers",
    (users, cursor) => pages.push({ count: users.length, cursor }),
    { cursor: "page-two", seed: [{ id: "1" }, { id: "2" }] }
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/api/v1/friendships/123/followers/?count=200&max_id=page-two");
  assert.equal(results.map((user) => user.id).join(","), "1,2,3");
  assert.deepEqual(pages, [{ count: 3, cursor: "" }]);
});

test("every page hands the next cursor to the caller so it can be checkpointed", async () => {
  const { impl } = mockFetch([
    { status: 200, json: { users: [{ pk: "1", username: "a" }], has_more: true, next_max_id: "c1" } },
    { status: 200, json: { users: [{ pk: "2", username: "b" }], has_more: true, next_max_id: "c2" } },
    { status: 200, json: { users: [{ pk: "3", username: "c" }], has_more: false } }
  ]);
  const { fetchFriendshipList } = loadInternals(impl);
  const cursors = [];

  await fetchFriendshipList("123", "following", (_, cursor) => cursors.push(cursor));

  assert.deepEqual(cursors, ["c1", "c2", ""]);
});

test("HTTP 401 on a list request is reported as a dead session", async () => {
  const { impl } = mockFetch([{ status: 401, body: "" }]);
  const { igFetch } = loadInternals(impl);

  await assert.rejects(igFetch("/api/v1/x"), (error) => {
    assert.equal(error.kind, "session");
    assert.equal(error.status, 401);
    assert.match(error.message, /signed you out/);
    return true;
  });
});

test("an HTML login page served with 200 is a dead session, not a crash", async () => {
  const { impl } = mockFetch([{ status: 200, body: "<!DOCTYPE html><html>login</html>" }]);
  const { igFetch } = loadInternals(impl);

  await assert.rejects(igFetch("/api/v1/x"), (error) => {
    assert.equal(error.kind, "session");
    return true;
  });
});

test("feedback_required on a list request is a block with a wait-and-resume message", async () => {
  const { impl } = mockFetch([
    { status: 400, body: JSON.stringify({ message: "feedback_required", status: "fail" }) }
  ]);
  const { igFetch } = loadInternals(impl);

  await assert.rejects(igFetch("/api/v1/x"), (error) => {
    assert.equal(error.kind, "blocked");
    assert.equal(error.status, 400);
    return true;
  });
});

test("a plain 400 keeps its status so a stale cursor can be told apart from a block", async () => {
  const { impl } = mockFetch([{ status: 400, body: JSON.stringify({ message: "invalid max_id" }) }]);
  const { igFetch } = loadInternals(impl);

  await assert.rejects(igFetch("/api/v1/x"), (error) => {
    assert.equal(error.kind, "http");
    assert.equal(error.status, 400);
    return true;
  });
});

test("HTTP 429 is retried with a cooldown and then gives up with the rate-limit message", async () => {
  const { impl, calls } = mockFetch([
    { status: 429, body: "" },
    { status: 429, body: "" },
    { status: 429, body: "" },
    { status: 429, body: "" }
  ]);
  const { igFetch } = loadInternals(impl);

  await assert.rejects(igFetch("/api/v1/x"), (error) => {
    assert.equal(error.kind, "rate");
    return true;
  });
  assert.equal(calls.length, 4);
});

test("a network error is retried and then reported as a dropped connection", async () => {
  const { impl, calls } = mockFetch([
    { throws: "Failed to fetch" },
    { throws: "Failed to fetch" },
    { throws: "Failed to fetch" },
    { throws: "Failed to fetch" }
  ]);
  const { igFetch } = loadInternals(impl);

  await assert.rejects(igFetch("/api/v1/x"), (error) => {
    assert.equal(error.kind, "network");
    return true;
  });
  assert.equal(calls.length, 4);
});

test("a countdown wait is a single timer, not a chain of slices", async () => {
  const timers = [];
  const { sleepWithCountdown } = loadInternals(undefined, {
    setTimeout: (fn, ms) => { timers.push(ms); fn(); return 0; }
  });

  await sleepWithCountdown(8000, "scanPause");

  assert.deepEqual(timers, [8000]);
});

test("a stored checkpoint is ignored once it is older than a day or already complete", () => {
  const make = (fields) => JSON.stringify({
    viewerId: "123",
    savedAt: Date.now(),
    following: [{ id: "1", username: "a" }],
    followingDone: true,
    followerIds: ["1"],
    followersDone: false,
    ...fields
  });
  const load = (raw) => loadInternals(undefined, {
    localStorage: { getItem: () => raw, setItem: () => {}, removeItem: () => {} }
  }).loadCheckpoint();

  assert.equal(load(make({})).viewerId, "123");
  assert.equal(load(make({ savedAt: Date.now() - 2 * 24 * 60 * 60 * 1000 })), null);
  assert.equal(load(make({ followersDone: true })), null);
  assert.equal(load("not json"), null);
  assert.equal(load(null), null);
});

test("following is diffed against follower ids as well as follower users", () => {
  const following = [
    normalizeUser({ pk: 1, username: "mutual" }),
    normalizeUser({ pk: "2", username: "not-mutual" })
  ];
  const marked = addFollowBackStatus(following, ["1"]);
  assert.equal(marked[0].follows_viewer, true);
  assert.equal(marked[1].follows_viewer, false);
});

test("HTTP 200 with status ok counts as unfollowed", () => {
  const result = evaluateUnfollowResponse(200, '{"status":"ok"}');
  assert.equal(result.ok, true);
  assert.equal(result.blocked, false);
});

test("HTTP 200 carrying friendship_status counts as unfollowed", () => {
  const result = evaluateUnfollowResponse(
    200,
    '{"status":"ok","friendship_status":{"following":false,"outgoing_request":false}}'
  );
  assert.equal(result.ok, true);
});

test("HTTP 200 with status fail is NOT a successful unfollow", () => {
  const result = evaluateUnfollowResponse(200, '{"status":"fail"}');
  assert.equal(result.ok, false);
  assert.equal(result.blocked, false);
  assert.notEqual(result.reason, "");
});

test("feedback_required is reported as a block, not a plain failure", () => {
  const result = evaluateUnfollowResponse(
    200,
    '{"status":"fail","feedback_required":true,"message":"feedback_required"}'
  );
  assert.equal(result.ok, false);
  assert.equal(result.blocked, true);
});

test("spam flag is reported as a block", () => {
  const result = evaluateUnfollowResponse(200, '{"status":"fail","spam":true}');
  assert.equal(result.blocked, true);
});

test("checkpoint_required is reported as a block", () => {
  const result = evaluateUnfollowResponse(
    400,
    '{"message":"checkpoint_required","checkpoint_url":"/challenge/"}'
  );
  assert.equal(result.ok, false);
  assert.equal(result.blocked, true);
});

test("HTTP 429 is a block so the run stops instead of hammering", () => {
  const result = evaluateUnfollowResponse(429, "");
  assert.equal(result.ok, false);
  assert.equal(result.blocked, true);
});

test("HTTP 401 means the session died and must stop the run", () => {
  const result = evaluateUnfollowResponse(401, '{"require_login":true}');
  assert.equal(result.ok, false);
  assert.equal(result.blocked, true);
});

test("an HTML login page served with 200 is not a success", () => {
  const result = evaluateUnfollowResponse(200, "<!DOCTYPE html><html><body>Log in</body></html>");
  assert.equal(result.ok, false);
});

test("HTTP 500 is transient, so the fallback endpoint may still be tried", () => {
  const result = evaluateUnfollowResponse(500, "");
  assert.equal(result.ok, false);
  assert.equal(result.blocked, false);
});

test("a successful first endpoint does not touch the fallback", async () => {
  const { impl, calls } = mockFetch([{ status: 200, body: '{"status":"ok"}' }]);
  const { unfollowUser } = loadInternals(impl);

  const outcome = await unfollowUser("42", "csrf-token");

  assert.equal(outcome.ok, true);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /^\/api\/v1\/friendships\/destroy\/42\/$/);
});

test("a soft failure falls through to the legacy web endpoint", async () => {
  const { impl, calls } = mockFetch([
    { status: 200, body: '{"status":"fail"}' },
    { status: 200, body: '{"status":"ok"}' }
  ]);
  const { unfollowUser } = loadInternals(impl);

  const outcome = await unfollowUser("42", "csrf-token");

  assert.equal(outcome.ok, true);
  assert.equal(calls.length, 2);
  assert.match(calls[1].url, /^\/web\/friendships\/42\/unfollow\/$/);
});

test("the legacy web endpoint is called without the private-API app id", async () => {
  const { impl, calls } = mockFetch([
    { status: 200, body: '{"status":"fail"}' },
    { status: 200, body: '{"status":"ok"}' }
  ]);
  const { unfollowUser } = loadInternals(impl);

  await unfollowUser("42", "csrf-token");

  assert.ok(calls[0].init.headers["x-ig-app-id"], "private API needs the app id");
  assert.equal(calls[1].init.headers["x-ig-app-id"], undefined);
  assert.equal(calls[1].init.headers["x-csrftoken"], "csrf-token");
});

test("a block stops immediately instead of retrying the fallback", async () => {
  const { impl, calls } = mockFetch([
    { status: 200, body: '{"status":"fail","feedback_required":true}' }
  ]);
  const { unfollowUser } = loadInternals(impl);

  const outcome = await unfollowUser("42", "csrf-token");

  assert.equal(outcome.blocked, true);
  assert.equal(outcome.ok, false);
  assert.equal(calls.length, 1, "must not hammer a second endpoint while blocked");
});

test("a network error on the first endpoint still tries the fallback", async () => {
  const { impl, calls } = mockFetch([
    { throws: "network down" },
    { status: 200, body: '{"status":"ok"}' }
  ]);
  const { unfollowUser } = loadInternals(impl);

  const outcome = await unfollowUser("42", "csrf-token");

  assert.equal(outcome.ok, true);
  assert.equal(calls.length, 2);
});

test("when both endpoints reject, the outcome is a plain failure", async () => {
  const { impl } = mockFetch([
    { status: 200, body: '{"status":"fail"}' },
    { status: 400, body: '{"message":"Bad Request"}' }
  ]);
  const { unfollowUser } = loadInternals(impl);

  const outcome = await unfollowUser("42", "csrf-token");

  assert.equal(outcome.ok, false);
  assert.equal(outcome.blocked, false);
  assert.notEqual(outcome.reason, "");
});

test("normalizeUser reads follows_viewer straight from edge_follow nodes", () => {
  assert.equal(normalizeUser({ id: "1", username: "a", follows_viewer: true }).follows_viewer, true);
  assert.equal(normalizeUser({ id: "1", username: "a", follows_viewer: false }).follows_viewer, false);
});

test("normalizeUser falls back to friendship_status.followed_by", () => {
  const user = normalizeUser({ id: "1", username: "a", friendship_status: { followed_by: true } });
  assert.equal(user.follows_viewer, true);
});

/* The panel showed the raw key "scanPause" to users because t() falls back to
   the key when a string is missing. These tests read the keys out of the source
   and check every one of them resolves, so the next missing string fails here
   instead of on screen. */
const { I18N } = loadInternals();
const LOCALES = Object.keys(I18N);

/* Most keys are plain t("key") calls. The rest are passed around as data —
   countdown reasons, progress labels, and the settings field table — so each of
   those shapes needs its own pattern. */
function usedKeys() {
  const keys = new Set();
  const patterns = [
    /\bt\(\s*"(\w+)"/g,
    /\bt\(\s*[\w.]+\s*\?\s*"(\w+)"\s*:\s*"(\w+)"/g,
    /sleepWithCountdown\([^,]+,\s*"(\w+)"\)/g,
    /\blabel:\s*"(\w+)"/g,
    /\[\s*"\w+",\s*"(\w+)",\s*\d+\s*\]/g
  ];
  for (const pattern of patterns) {
    for (const match of SOURCE.matchAll(pattern)) {
      match.slice(1).filter(Boolean).forEach((key) => keys.add(key));
    }
  }
  return [...keys];
}

test("every string key the code asks for exists in every language", () => {
  const missing = [];
  for (const locale of LOCALES) {
    for (const key of usedKeys()) {
      if (!(key in I18N[locale])) missing.push(`${locale}.${key}`);
    }
  }
  assert.deepEqual(missing, [], `missing strings: ${missing.join(", ")}`);
});

test("the countdown reasons resolve to text, not to their own key", () => {
  for (const key of ["scanPause", "cooldownIn", "nextActionIn"]) {
    for (const locale of LOCALES) {
      const template = I18N[locale][key];
      assert.notEqual(template, undefined, `${locale}.${key} is missing`);
      assert.match(template, /\{seconds\}/, `${locale}.${key} must show the seconds left`);
    }
  }
});

test("the languages carry the same set of keys", () => {
  const [first, ...rest] = LOCALES;
  for (const locale of rest) {
    assert.deepEqual(
      Object.keys(I18N[locale]).sort(),
      Object.keys(I18N[first]).sort(),
      `${locale} and ${first} must define the same keys`
    );
  }
});

test("no language leaves a string empty", () => {
  for (const locale of LOCALES) {
    for (const [key, value] of Object.entries(I18N[locale])) {
      assert.equal(typeof value, "string", `${locale}.${key} must be a string`);
      assert.notEqual(value.trim(), "", `${locale}.${key} is empty`);
    }
  }
});
