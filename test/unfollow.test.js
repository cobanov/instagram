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

function loadInternals(fetchImpl) {
  let captured = null;
  const sandbox = {
    __IU_TEST__: (api) => { captured = api; },
    location: { hostname: "www.instagram.com" },
    localStorage: { getItem: () => null, setItem: () => {} },
    navigator: { language: "en-US" },
    console,
    fetch: fetchImpl,
    /* Fire timers immediately so the inter-attempt backoff does not slow the suite. */
    setTimeout: (fn) => { fn(); return 0; },
    clearTimeout: () => {},
    setInterval: () => 0,
    clearInterval: () => {}
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
    return {
      status: next.status,
      text: async () => next.body ?? ""
    };
  };
  return { impl, calls };
}

const { evaluateUnfollowResponse, normalizeUser } = loadInternals();

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
