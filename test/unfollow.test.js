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
    localStorage: {
      getItem: (key) => (key === "iu_state_v3" ? JSON.stringify({ language: "en" }) : null),
      setItem: () => {},
      removeItem: () => {}
    },
    navigator: { language: "en-US" },
    document: fakeDocument(),
    window: {},
    AbortController,
    URLSearchParams,
    console: { ...console, error: () => {}, warn: () => {} },
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
    "/api/v1/friendships/123/following/?count=50"
  );
  assert.equal(
    friendshipListUrl("123", "followers", "cursor + /"),
    "/api/v1/friendships/123/followers/?count=50&max_id=cursor%20%2B%20%2F"
  );
  assert.equal(
    friendshipListUrl("123", "following", "", 200),
    "/api/v1/friendships/123/following/?count=200"
  );
  assert.equal(
    friendshipListUrl("123", "following", "", 999),
    "/api/v1/friendships/123/following/?count=200"
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
  assert.equal(calls[0].url, "/api/v1/friendships/123/following/?count=50");
  assert.equal(
    calls[1].url,
    "/api/v1/friendships/123/following/?count=50&max_id=next%20cursor"
  );
  assert.equal(calls[0].init.credentials, "include");
  assert.equal(calls[0].init.headers["x-ig-app-id"], "936619743392459");
});

test("friendship scans use the saved users-per-request setting", async () => {
  const { impl, calls } = mockFetch([
    { status: 200, json: { users: [{ pk: "1", username: "first" }], has_more: false } }
  ]);
  const api = loadInternals(impl);
  api.state.timings.usersPerRequest = 200;

  await api.fetchFriendshipList("123", "following", () => {});

  assert.equal(calls[0].url, "/api/v1/friendships/123/following/?count=200");
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
  assert.equal(calls[0].url, "/api/v1/friendships/123/followers/?count=50&max_id=page-two");
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

test("HTTP 429 stops after one request without retrying the rate limit", async () => {
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
  assert.equal(calls.length, 1);
});

test("soft HTTP 200 failures stop and never become valid list responses", async () => {
  for (const [json, kind] of [
    [{ status: "fail", message: "login_required" }, "session"],
    [{ status: "fail", message: "feedback_required" }, "blocked"],
    [{ status: "fail", spam: true }, "blocked"],
    [{ status: "fail", checkpoint_url: "/challenge/" }, "blocked"],
    [{ status: "fail", message: "Please wait a few minutes before you try again." }, "rate"],
    [{ status: "fail", users: [] }, "http"]
  ]) {
    const { impl, calls } = mockFetch([{ status: 200, json }]);
    await assert.rejects(loadInternals(impl).igFetch("/api/v1/x"), error => error.kind === kind);
    assert.equal(calls.length, 1);
  }
});

test("a scan starts directly on the followers list without a profile preflight", async () => {
  const { impl, calls } = mockFetch([{ status: 403, json: { message: "checkpoint_required" } }]);
  const api = loadInternals(impl, { document: { ...fakeDocument(), cookie: "ds_user_id=123" } });
  await api.startScan();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/api/v1/friendships/123/followers/?count=50");
  assert.equal(api.state.mode, "idle");
  assert.match(api.state.error, /temporarily refused/);
});

test("a block on a resumed cursor never restarts that list", async () => {
  const { impl, calls } = mockFetch([{ status: 400, json: { message: "feedback_required" } }]);
  const api = loadInternals(impl, { document: { ...fakeDocument(), cookie: "ds_user_id=123" } });
  api.state.checkpoint = {
    ...api.createCheckpoint("123"), followersDone: true, followerIds: ["9"],
    following: [{ id: "1", username: "a" }], followingCursor: "next-page"
  };
  await api.startScan({ resume: true });
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /following\/\?count=50&max_id=next-page$/);
  assert.equal(api.state.mode, "results");
  assert.equal(api.state.partial, true);
  assert.match(api.state.checkpoint.stopReason, /temporarily refused/);
});

test("empty REST lists complete without the removed profile-count request", async () => {
  const { impl, calls } = mockFetch([
    { status: 200, json: { users: [], has_more: false } },
    { status: 200, json: { users: [], has_more: false } }
  ]);
  const api = loadInternals(impl, { document: { ...fakeDocument(), cookie: "ds_user_id=123" } });
  await api.startScan();
  assert.equal(api.state.mode, "results");
  assert.equal(api.state.users.length, 0);
  assert.equal(calls.length, 2);
});

test("server-limited lists cannot produce non-follower results", async () => {
  const { impl } = mockFetch([{ status: 200, json: {
    users: [{ pk: "1", username: "a" }], has_more: false, should_limit_list_of_followers: true
  } }]);
  await assert.rejects(loadInternals(impl).fetchFriendshipList("123", "followers", () => {}),
    error => error.kind === "incomplete");
});

test("a scan that stops while checking following still lists confirmed non-followers", async () => {
  const { impl, calls } = mockFetch([]);
  const api = loadInternals(impl);
  const checkpoint = {
    ...api.createCheckpoint("123"), followersDone: true,
    following: [{ id: "1", username: "mutual" }, { id: "2", username: "gone" }],
    followerIds: ["1"], followerUsernames: ["mutual"]
  };
  api.state.checkpoint = checkpoint;
  api.showResults(checkpoint, false);
  assert.equal(api.state.partial, true);
  assert.equal(api.getDisplayUsers().map((user) => user.id).join(","), "2");
  const html = api.renderResultsView();
  assert.match(html, /Scan stopped partway/);
  assert.match(html, /2 of the accounts you follow were checked/);
  assert.match(html, /data-action="resume-scan"/);
  assert.match(html, /data-action="unfollow"/);
  assert.equal(calls.length, 0);
});

test("closing a panel aborts its request and prevents its old scan from continuing", async () => {
  let calls = 0;
  let signal;
  const api = loadInternals((url, init) => {
    calls += 1;
    signal = init.signal;
    return new Promise((resolve, reject) => {
      signal.addEventListener("abort", () => reject(new Error("aborted")));
    });
  }, { document: { ...fakeDocument(), cookie: "ds_user_id=123" } });
  const running = api.startScan();
  api.unmount();
  await running;
  assert.equal(signal.aborted, true);
  assert.equal(calls, 1);
  await api.startScan();
  assert.equal(calls, 1);
});

test("double-clicking Scan does not start a second scan", async () => {
  let calls = 0;
  const api = loadInternals((url, init) => {
    calls += 1;
    return new Promise((resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(new Error("aborted")));
    });
  }, { document: { ...fakeDocument(), cookie: "ds_user_id=123" } });
  const running = api.startScan();
  await api.startScan();
  assert.equal(calls, 1);
  api.unmount();
  await running;
});

test("saved presets upgrade while custom timing values and request counts survive", () => {
  const { loadTimings } = loadInternals();
  const legacy = loadTimings({ scanDelayMin: 700, scanDelayMax: 1500, scanPauseEveryPages: 5, scanPauseMs: 8000 });
  assert.equal(legacy.scanDelayMin, 1000);
  assert.equal(legacy.scanDelayMax, 1300);
  assert.equal(legacy.scanPauseEveryPages, 7);
  assert.equal(legacy.scanPauseMs, 10000);
  const previous = loadTimings({ scanDelayMin: 1500, scanDelayMax: 3000, scanPauseEveryPages: 5, scanPauseMs: 20000 });
  assert.equal(previous.scanDelayMin, 1000);
  assert.equal(previous.scanDelayMax, 1300);
  assert.equal(previous.scanPauseEveryPages, 7);
  assert.equal(previous.scanPauseMs, 10000);
  const latest = loadTimings({ scanDelayMin: 1500, scanDelayMax: 3300, scanPauseEveryPages: 7, scanPauseMs: 10000 });
  assert.equal(latest.scanDelayMin, 1000);
  assert.equal(latest.scanDelayMax, 1300);
  const custom = loadTimings({ scanDelayMin: 1500, scanDelayMax: 3000, scanPauseEveryPages: 9, scanPauseMs: 20000, usersPerRequest: 200 });
  assert.equal(custom.scanDelayMin, 1500);
  assert.equal(custom.scanDelayMax, 3000);
  assert.equal(custom.scanPauseEveryPages, 9);
  assert.equal(custom.scanPauseMs, 20000);
  assert.equal(custom.usersPerRequest, 200);
  assert.equal(loadTimings({ usersPerRequest: 999 }).usersPerRequest, 200);
  assert.equal(loadTimings({ usersPerRequest: 0 }).usersPerRequest, 1);
  const slower = loadTimings({ scanDelayMin: 5000, scanDelayMax: 8000, scanPauseMs: 60000 });
  assert.equal(slower.scanDelayMin, 5000);
  assert.equal(slower.scanPauseMs, 60000);
  const oldUnfollow = loadTimings({ unfollowDelayMin: 5000, unfollowDelayMax: 9000, unfollowPauseEvery: 5, unfollowPauseMs: 300000 });
  assert.equal(oldUnfollow.unfollowDelayMin, 4000);
  assert.equal(oldUnfollow.unfollowDelayMax, 4800);
});

test("a scan follows the upstream followers-then-following request flow", async () => {
  const { impl, calls } = mockFetch([
    { status: 200, json: { users: [{ pk: "1", username: "mutual" }], has_more: false } },
    { status: 200, json: { users: [{ pk: "1", username: "mutual" }, { pk: "2", username: "not-mutual" }], has_more: false } }
  ]);
  const api = loadInternals(impl, { document: { ...fakeDocument(), cookie: "ds_user_id=123" } });
  await api.startScan();
  assert.equal(api.state.partial, false);
  assert.equal(api.getDisplayUsers().map(user => user.id).join(","), "2");
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, "/api/v1/friendships/123/followers/?count=50");
  assert.equal(calls[1].url, "/api/v1/friendships/123/following/?count=50");
  assert.equal(calls.some(call => call.url.includes("/users/") || call.url.includes("/friendships/show/")), false);
});

test("an interrupted followers request shows no results", async () => {
  const { impl, calls } = mockFetch([
    { status: 200, json: { users: [{ pk: "1", username: "a" }], has_more: true, next_max_id: "f2" } },
    { status: 429, body: "" }
  ]);
  const api = loadInternals(impl, { document: { ...fakeDocument(), cookie: "ds_user_id=123" } });
  await api.startScan();
  assert.equal(calls.length, 2);
  assert.equal(api.state.mode, "idle");
  assert.equal(api.getDisplayUsers().length, 0);
  assert.equal(api.state.checkpoint.followersDone, false);
});

test("non-followers stream in while following loads and survive an interruption", async () => {
  const { impl, calls } = mockFetch([
    { status: 200, json: { users: [{ pk: "1", username: "mutual" }], has_more: false } },
    { status: 200, json: { users: [{ pk: "1", username: "mutual" }, { pk: "2", username: "gone" }], has_more: true, next_max_id: "p2" } },
    { status: 429, body: "" }
  ]);
  const api = loadInternals(impl, { document: { ...fakeDocument(), cookie: "ds_user_id=123" } });
  api.state.timings.scanPauseEveryPages = 0;
  await api.startScan();
  assert.equal(calls.length, 3);
  assert.equal(api.state.mode, "results");
  assert.equal(api.state.partial, true);
  assert.equal(api.getDisplayUsers().map((user) => user.id).join(","), "2");
  assert.equal(api.state.checkpoint.followingCursor, "p2");
});

test("the scan view lists non-followers found so far once followers are loaded", () => {
  const api = loadInternals();
  api.state.checkpoint = { ...api.createCheckpoint("123"), followersDone: true };
  api.state.users = [
    { id: "1", username: "mutual", follows_viewer: true },
    { id: "2", username: "gone", follows_viewer: false }
  ];
  const html = api.renderScanView();
  assert.match(html, /Found so far: 1/);
  assert.match(html, /data-row="2"/);
  assert.doesNotMatch(html, /data-row="1"/);
  api.state.checkpoint.followersDone = false;
  assert.match(api.renderScanView(), /as soon as your followers are loaded/);
});

test("a follower matched only by username is never listed as a non-follower", () => {
  const following = [normalizeUser({ pk: "5", username: "Renamed" })];
  const marked = addFollowBackStatus(following, [{ id: "different-id", username: "renamed" }]);
  assert.equal(marked[0].follows_viewer, true);
});

test("the panel defaults to Turkish unless English was chosen", () => {
  const api = loadInternals(undefined, {
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} }
  });
  assert.equal(api.state.language, "tr");
});

function memoryStorage(initial = {}) {
  const data = { iu_state_v3: JSON.stringify({ language: "en" }), ...initial };
  return {
    data,
    getItem: (key) => (key in data ? data[key] : null),
    setItem: (key, value) => { data[key] = String(value); },
    removeItem: (key) => { delete data[key]; }
  };
}

test("a finished scan is saved and can be reopened without any request", async () => {
  const storage = memoryStorage();
  const { impl } = mockFetch([
    { status: 200, json: { users: [{ pk: "1", username: "mutual" }], has_more: false } },
    { status: 200, json: { users: [{ pk: "1", username: "mutual" }, { pk: "2", username: "gone" }], has_more: false } }
  ]);
  const doc = { ...fakeDocument(), cookie: "ds_user_id=123" };
  await loadInternals(impl, { document: doc, localStorage: storage }).startScan();

  const { impl: noFetch, calls } = mockFetch([]);
  const later = loadInternals(noFetch, { document: doc, localStorage: storage });
  assert.match(later.renderIdleView(), /Show last result \(1, /);
  later.showLastScan();
  assert.equal(later.state.mode, "results");
  assert.equal(later.getDisplayUsers().map((user) => user.id).join(","), "2");
  assert.match(later.renderResultsView(), /This list is from a scan/);
  assert.equal(calls.length, 0);
});

test("a saved result is ignored for another account or after a day", () => {
  const saved = (viewerId, age) => memoryStorage({
    iu_last_scan_v1: JSON.stringify({ viewerId, savedAt: Date.now() - age, users: [{ id: "2", username: "gone" }] })
  });
  const doc = { ...fakeDocument(), cookie: "ds_user_id=123" };
  assert.ok(loadInternals(undefined, { document: doc, localStorage: saved("123", 1000) }).loadLastScan());
  assert.equal(loadInternals(undefined, { document: doc, localStorage: saved("999", 1000) }).loadLastScan(), null);
  assert.equal(loadInternals(undefined, { document: doc, localStorage: saved("123", 2 * 24 * 3600 * 1000) }).loadLastScan(), null);
});

test("scan pacing uses upstream micro, regular, and long pauses", async () => {
  const timers = [];
  const fixedMath = Object.create(Math);
  fixedMath.random = () => 0.5;
  const api = loadInternals(undefined, {
    Math: fixedMath,
    setTimeout: (fn, ms) => { timers.push(ms); fn(); return 0; }
  });
  await api.waitBeforeNextScanPage(7);
  assert.deepEqual(timers, [1250, 1150, 10000]);
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

/* Unfollow runs instagram.com's own GraphQL mutation (upstream #363). The old
   REST routes answer the web client with 404 or a 200 HTML page, so a reply
   only counts when Instagram's data confirms the follow is gone. */
const GRAPHQL_OK = JSON.stringify({
  data: { xdt_destroy_friendship: { friendship_status: { following: false, outgoing_request: false } } }
});

test("a GraphQL reply whose friendship_status shows the follow gone is a confirmed unfollow", () => {
  const result = evaluateUnfollowResponse(200, GRAPHQL_OK);
  assert.equal(result.ok, true);
  assert.equal(result.blocked, false);
  assert.equal(result.confirmed, true);
});

test("a GraphQL reply behind the for(;;); guard is still read", () => {
  const result = evaluateUnfollowResponse(200, "for (;;);" + GRAPHQL_OK);
  assert.equal(result.ok, true);
});

test("a GraphQL reply without friendship_status is accepted but not confirmed", () => {
  const result = evaluateUnfollowResponse(200, '{"data":{"xdt_destroy_friendship":{}}}');
  assert.equal(result.ok, true);
  assert.notEqual(result.confirmed, true);
});

test("friendship_status still showing a follow is NOT a successful unfollow", () => {
  const result = evaluateUnfollowResponse(
    200,
    '{"data":{"x":{"friendship_status":{"following":true}}}}'
  );
  assert.equal(result.ok, false);
  assert.equal(result.blocked, false);
});

test("a GraphQL errors array is a failure", () => {
  const result = evaluateUnfollowResponse(200, '{"errors":[{"message":"Invalid doc_id"}]}');
  assert.equal(result.ok, false);
  assert.equal(result.blocked, false);
  assert.match(result.reason, /Invalid doc_id/);
});

test("the old REST success shape no longer counts as unfollowed", () => {
  const result = evaluateUnfollowResponse(200, '{"status":"ok"}');
  assert.equal(result.ok, false);
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

test("a GraphQL error saying try again later is a block", () => {
  const result = evaluateUnfollowResponse(200, '{"errors":[{"message":"Please try again later"}]}');
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

test("an HTML page served with 200 is not a success", () => {
  const result = evaluateUnfollowResponse(200, "<!DOCTYPE html><html><body>Log in</body></html>");
  assert.equal(result.ok, false);
});

test("HTTP 500 is a plain failure, not a block", () => {
  const result = evaluateUnfollowResponse(500, "");
  assert.equal(result.ok, false);
  assert.equal(result.blocked, false);
});

function pageWith({ moduleTokens = true, html = "" } = {}) {
  const modules = {
    DTSGInitialData: { token: "dtsg-token" },
    LSD: { token: "lsd-token" },
    SiteData: { client_revision: 1029384 }
  };
  return {
    window: moduleTokens ? { require: (name) => modules[name] } : {},
    document: {
      ...fakeDocument(),
      cookie: "ds_user_id=777; csrftoken=csrf-token",
      documentElement: { innerHTML: html }
    }
  };
}

const TARGET = { id: "42", username: "Someone" };

test("unfollow posts Instagram's own GraphQL mutation with the session tokens", async () => {
  const { impl, calls } = mockFetch([{ status: 200, body: GRAPHQL_OK }]);
  const { unfollowUser } = loadInternals(impl, pageWith());

  const outcome = await unfollowUser(TARGET, "csrf-token");

  assert.equal(outcome.ok, true);
  assert.equal(calls.length, 1, "a confirmed reply needs no follow-up search");
  assert.equal(calls[0].url, "/api/graphql");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers["x-csrftoken"], "csrf-token");
  assert.equal(calls[0].init.headers["x-fb-lsd"], "lsd-token");
  assert.equal(calls[0].init.headers["x-fb-friendly-name"], "usePolarisUnfollowMutation");
  const body = new URLSearchParams(calls[0].init.body);
  assert.equal(body.get("fb_dtsg"), "dtsg-token");
  assert.equal(body.get("lsd"), "lsd-token");
  assert.equal(body.get("av"), "777");
  assert.equal(body.get("__rev"), "1029384");
  assert.match(body.get("jazoest"), /^2\d+$/);
  assert.equal(body.get("doc_id"), "27789106940691111");
  assert.equal(JSON.parse(body.get("variables")).target_user_id, "42");
});

test("session tokens fall back to the inline page data", async () => {
  const html = '..."DTSGInitialData",[],{"token":"html-dtsg"}..."LSD",[],{"token":"html-lsd"}...';
  const { impl, calls } = mockFetch([{ status: 200, body: GRAPHQL_OK }]);
  const { unfollowUser } = loadInternals(impl, pageWith({ moduleTokens: false, html }));

  const outcome = await unfollowUser(TARGET, "csrf-token");

  assert.equal(outcome.ok, true);
  const body = new URLSearchParams(calls[0].init.body);
  assert.equal(body.get("fb_dtsg"), "html-dtsg");
  assert.equal(body.get("lsd"), "html-lsd");
});

test("without session tokens nothing is sent and the unfollow fails", async () => {
  const { impl, calls } = mockFetch([{ status: 200, body: "<html>no tokens</html>" }]);
  const { unfollowUser } = loadInternals(impl, pageWith({ moduleTokens: false }));

  const outcome = await unfollowUser(TARGET, "csrf-token");

  assert.equal(outcome.ok, false);
  assert.equal(calls.length, 1, "only the page refetch, never the mutation");
  assert.equal(calls[0].url, "/");
});

test("an unconfirmed reply is checked against the following list and passes when the account is gone", async () => {
  const { impl, calls } = mockFetch([
    { status: 200, body: '{"data":{"xdt_destroy_friendship":{}}}' },
    { status: 200, json: { users: [{ pk: "99", username: "someone_else" }] } }
  ]);
  const { unfollowUser } = loadInternals(impl, pageWith());

  const outcome = await unfollowUser(TARGET, "csrf-token");

  assert.equal(outcome.ok, true);
  assert.equal(calls.length, 2);
  assert.match(calls[1].url, /^\/api\/v1\/friendships\/777\/following\/\?count=12&query=Someone&/);
});

test("an unconfirmed reply fails when the account is still in the following list", async () => {
  const { impl } = mockFetch([
    { status: 200, body: '{"data":{"xdt_destroy_friendship":{}}}' },
    { status: 200, json: { users: [{ pk: "42", username: "someone" }] } }
  ]);
  const { unfollowUser } = loadInternals(impl, pageWith());

  const outcome = await unfollowUser(TARGET, "csrf-token");

  assert.equal(outcome.ok, false);
  assert.equal(outcome.blocked, false);
});

test("an unconfirmed reply fails when the following search itself fails", async () => {
  const { impl } = mockFetch([
    { status: 200, body: '{"data":{"xdt_destroy_friendship":{}}}' },
    { status: 500, body: "" }
  ]);
  const { unfollowUser } = loadInternals(impl, pageWith());

  const outcome = await unfollowUser(TARGET, "csrf-token");

  assert.equal(outcome.ok, false);
});

test("the HTML page Instagram serves to dead routes is never reported as unfollowed", async () => {
  const { impl, calls } = mockFetch([{ status: 200, body: "<!DOCTYPE html><html></html>" }]);
  const { unfollowUser } = loadInternals(impl, pageWith());

  const outcome = await unfollowUser(TARGET, "csrf-token");

  assert.equal(outcome.ok, false);
  assert.equal(calls.length, 1);
});

test("a block stops immediately without a follow-up request", async () => {
  const { impl, calls } = mockFetch([
    { status: 200, body: '{"status":"fail","feedback_required":true}' }
  ]);
  const { unfollowUser } = loadInternals(impl, pageWith());

  const outcome = await unfollowUser(TARGET, "csrf-token");

  assert.equal(outcome.blocked, true);
  assert.equal(outcome.ok, false);
  assert.equal(calls.length, 1, "must not hit Instagram again while blocked");
});

test("a network error on the mutation is a plain failure", async () => {
  const { impl } = mockFetch([{ throws: "network down" }]);
  const { unfollowUser } = loadInternals(impl, pageWith());

  const outcome = await unfollowUser(TARGET, "csrf-token");

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
