// Invariants for the Content-Security-Policy built in csp.mjs.
//
// The failure these guard against is silent: a policy that is too strict breaks a
// page with a console message nobody reads, and one that is too loose fails open.
// Both are invisible in review, so they are asserted here instead.
//
// Run: node scripts/test-csp.mjs

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

import {
  adminContentSecurityPolicy,
  adminInlineScriptSources,
  mainContentSecurityPolicy,
} from "../csp.mjs";

let tests = 0;
let failures = 0;

function test(name, run) {
  tests += 1;
  try {
    run();
    console.log(`PASS ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL ${name}\n  ${error.message}`);
  }
}

/**
 * Split a policy into "directive -> sources".
 *
 * CSP accepts both `name sources` and `name: sources`, so match on whichever
 * separator comes first rather than assuming the colon form.
 */
function parse(policy) {
  const out = new Map();
  for (const part of policy.split(";").map((s) => s.trim()).filter(Boolean)) {
    const space = part.indexOf(" ");
    const colon = part.indexOf(":");
    let index;
    if (colon !== -1 && (space === -1 || colon < space)) index = colon;
    else index = space;
    assert.ok(index > 0, `malformed CSP directive: ${part}`);
    out.set(part.slice(0, index).trim(), part.slice(index + 1).trim().split(/\s+/));
  }
  return out;
}

const main = parse(mainContentSecurityPolicy());
const admin = parse(adminContentSecurityPolicy());
const adminHtml = readFileSync("public/admin/index.html", "utf8");

test("main path blocks inline event handlers via script-src-attr", () => {
  assert.deepEqual(main.get("script-src-attr"), ["'none'"]);
});

test("main path keeps style attributes working for framer-motion SSR", () => {
  // style-src-attr 'none' would block every style="" the framework renders.
  assert.deepEqual(main.get("style-src-attr"), ["'unsafe-inline'"]);
  assert.deepEqual(main.get("style-src-elem"), ["'self'", "'unsafe-inline'"]);
});

test("main path still allows Next.js inline scripts and stays CDN-free", () => {
  assert.deepEqual(main.get("script-src"), ["'self'", "'unsafe-inline'"]);
  for (const [directive, sources] of main) {
    for (const source of sources) {
      assert.ok(
        !/https?:\/\//.test(source),
        `${directive} still allows a remote origin: ${source}`,
      );
    }
  }
});

test("main path keeps the clickjacking and base-uri guards", () => {
  assert.deepEqual(main.get("frame-ancestors"), ["'none'"]);
  assert.deepEqual(main.get("object-src"), ["'none'"]);
  assert.deepEqual(main.get("base-uri"), ["'self'"]);
  assert.deepEqual(main.get("form-action"), ["'self'"]);
});

test("admin script-src has no unsafe-inline", () => {
  assert.ok(
    !admin.get("script-src").includes("'unsafe-inline'"),
    `admin script-src still allows inline scripts: ${admin.get("script-src").join(" ")}`,
  );
});

test("admin script-src allows only self plus hashes", () => {
  const sources = admin.get("script-src");
  assert.equal(sources[0], "'self'");
  for (const source of sources.slice(1)) {
    assert.match(source, /^'sha256-[A-Za-z0-9+/]+={0,2}'$/, `unexpected script source: ${source}`);
  }
});

test("admin policy allows the origins the CMS is known to need", () => {
  // These are NOT inferred from reading the source. Each one was added or kept
  // because a real browser console said so:
  //   unpkg.com         -> "sveltia-cms.js: Refused to connect ... connect-src"
  //                         (locales/<locale>.json is fetched from unpkg at runtime)
  //   api.github.com    -> the GitHub backend reads and writes the repository
  //   raw.githubusercontent.com / avatars.githubusercontent.com -> media and avatar
  //
  // Do NOT turn this into an allowlist of "origins that look unused". That
  // reasoning is what produced the regression this test now guards: the locale
  // URL is assembled at runtime, so grepping the CMS source finds nothing and a
  // code search that returns nothing proves nothing either. Removing one of
  // these requires loading /admin in a browser and reading the console.
  const required = new Map([
    ["connect-src", ["https://api.github.com", "https://unpkg.com"]],
    ["img-src", ["https://avatars.githubusercontent.com"]],
    ["font-src", ["https://fonts.gstatic.com", "https://cdn.jsdelivr.net"]],
  ]);
  for (const [directive, origins] of required) {
    const have = admin.get(directive) ?? [];
    for (const origin of origins) {
      assert.ok(have.includes(origin), `${directive} is missing ${origin}; the CMS will fail to load it`);
    }
  }
});

test("admin script-src still permits the vendored same-origin bundle", () => {
  const scriptTags = [...adminHtml.matchAll(/<script[^>]*\bsrc="([^"]+)"/gi)].map((m) => m[1]);
  assert.equal(scriptTags.length, 1, `expected exactly one external script, got ${scriptTags.length}`);
  assert.ok(
    scriptTags[0].startsWith("./vendor/"),
    `admin bundle is no longer vendored locally: ${scriptTags[0]}`,
  );
});

test("every declared hash matches an inline script in the admin shell", () => {
  const bodies = [...adminHtml.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map(
    (m) => m[1],
  );
  const expected = bodies.map(
    (body) => `'sha256-${createHash("sha256").update(body, "utf8").digest("base64")}'`,
  );
  // Recomputed independently of csp.mjs: if the helper's regex ever stops
  // matching, these two lists diverge and the page silently loses its script.
  assert.deepEqual(adminInlineScriptSources(), expected);
  const declared = admin.get("script-src").slice(1);
  assert.deepEqual(declared, expected, "admin script-src hashes do not match the admin HTML");
});

test("adding a second inline script keeps the policy complete", () => {
  // Guards the multi-hash path: a second <script> must yield a second source,
  // not silently go unhashed (which would then be blocked at runtime).
  const sources = adminInlineScriptSources();
  assert.equal(sources.length, bodies_in(adminHtml));
});

function bodies_in(html) {
  return [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].length;
}

console.log(`${tests - failures}/${tests} CSP policy tests passed.`);
if (failures) process.exitCode = 1;
