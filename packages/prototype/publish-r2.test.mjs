import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { artifactDigest } from "../../.agents/skills/spec-trail/prototype/scripts/publishing.mjs";
import {
  requestIdentity,
  validateResult,
} from "../../.agents/skills/spec-trail/prototype/scripts/publication-contract.mjs";
import { publishToR2 } from "./publish-r2.mjs";

const env = {
  R2_ACCOUNT_ID: "a".repeat(32),
  R2_BUCKET: "test-prototypes",
  R2_PUBLIC_BASE_URL: "https://pub-test.r2.dev",
  R2_ACCESS_KEY_ID: "test-access-key",
  R2_SECRET_ACCESS_KEY: "test-secret-key",
};
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), "runweft-r2-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, "shell"));
  await writeFile(
    join(dir, "shell/index.html"),
    "<!doctype html><title>Shell</title><p>Shell</p>",
  );
  const request = {
    schemaVersion: 1,
    repository: "https://github.com/iTgo-lyq/runweft",
    sourceCommit: "b".repeat(40),
    artifactDirectory: dir,
    digest: artifactDigest(dir).digest,
    entries: [{ id: "shell", entryPath: "shell/index.html", hash: "#preview" }],
  };
  request.requestId = requestIdentity(request);
  return { dir, request };
}
function storage() {
  const objects = new Map(),
    calls = [];
  return {
    objects,
    calls,
    client: {
      async send(command) {
        const value = command.input;
        calls.push(command);
        if (command.constructor.name === "PutObjectCommand") {
          assert.equal(value.IfNoneMatch, "*");
          assert.equal(value.StorageClass, "STANDARD");
          if (objects.has(value.Key))
            throw { $metadata: { httpStatusCode: 412 } };
          objects.set(value.Key, {
            bytes: Buffer.from(value.Body),
            contentType: value.ContentType,
          });
          return {};
        }
        const object = objects.get(value.Key);
        return {
          ContentType: object.contentType,
          Body: {
            async transformToByteArray() {
              return object.bytes;
            },
          },
        };
      },
    },
    async fetchImpl(url, options) {
      assert.equal(options.redirect, "error");
      assert.equal(options.headers, undefined);
      const object = objects.get(
        decodeURIComponent(new URL(url).pathname.slice(1)),
      );
      return new Response(object?.bytes, {
        status: object ? 200 : 404,
        headers: { "content-type": object?.contentType ?? "text/plain" },
      });
    },
  };
}

test("publishes verified immutable URLs; retry returns the identical result", async (t) => {
  const { request } = await fixture(t),
    host = storage();
  const first = await publishToR2(request, { env, ...host });
  validateResult(request, first);
  assert.equal(
    first.entries[0].url,
    `${env.R2_PUBLIC_BASE_URL}/runweft/${request.requestId}/shell/index.html#preview`,
  );
  assert.deepEqual(await publishToR2(request, { env, ...host }), first);
  assert.equal(host.objects.size, 1);
  assert.equal(
    host.calls.filter((c) => c.constructor.name === "GetObjectCommand").length,
    1,
  );
});

test("does not overwrite a conflicting existing version", async (t) => {
  const { request } = await fixture(t),
    host = storage();
  const key = `runweft/${request.requestId}/shell/index.html`;
  host.objects.set(key, {
    bytes: Buffer.from("old content"),
    contentType: "text/html; charset=utf-8",
  });
  await assert.rejects(publishToR2(request, { env, ...host }), {
    publishCode: "VERSION_CONFLICT",
  });
  assert.equal(host.objects.get(key).bytes.toString(), "old content");
});

test("rejects changed output before making a network request", async (t) => {
  const { dir, request } = await fixture(t),
    host = storage();
  await writeFile(join(dir, "shell/index.html"), "changed");
  await assert.rejects(publishToR2(request, { env, ...host }), {
    publishCode: "ARTIFACT",
  });
  assert.equal(host.calls.length, 0);
});

test("rejects a missing entry before uploading", async (t) => {
  const { request } = await fixture(t),
    host = storage();
  request.entries[0].entryPath = "missing.html";
  request.requestId = requestIdentity(request);
  await assert.rejects(publishToR2(request, { env, ...host }), {
    publishCode: "ARTIFACT",
  });
  assert.equal(host.calls.length, 0);
});

test("partial upload failure can be retried without replacing earlier objects", async (t) => {
  const { dir, request } = await fixture(t),
    host = storage();
  await writeFile(join(dir, "shell/style.css"), "body { color: navy }");
  request.digest = artifactDigest(dir).digest;
  request.requestId = requestIdentity(request);
  const client = {
    send: (command) =>
      command.input.Key.endsWith("style.css")
        ? Promise.reject({ $metadata: { httpStatusCode: 503 } })
        : host.client.send(command),
  };
  await assert.rejects(publishToR2(request, { env, ...host, client }), {
    publishCode: "R2_REQUEST",
    retryable: true,
  });
  assert.equal(host.objects.size, 1);
  validateResult(request, await publishToR2(request, { env, ...host }));
  assert.equal(host.objects.size, 2);
});

test("permission errors are sanitized and never expose credentials", async (t) => {
  const { request } = await fixture(t);
  const client = {
    async send() {
      throw Object.assign(new Error(env.R2_SECRET_ACCESS_KEY), {
        $metadata: { httpStatusCode: 403 },
      });
    },
  };
  await assert.rejects(publishToR2(request, { env, client }), (error) => {
    assert.equal(error.message, "R2 request failed (HTTP 403)");
    assert.equal(error.retryable, false);
    return true;
  });
});

test("rejects public errors, wrong bytes and download MIME types", async (t) => {
  const { request } = await fixture(t);
  for (const response of [
    () => new Response("Forbidden", { status: 403 }),
    () => new Response("wrong", { headers: { "content-type": "text/html" } }),
    () =>
      new Response("download", {
        headers: { "content-type": "application/octet-stream" },
      }),
  ]) {
    await assert.rejects(
      publishToR2(request, {
        env,
        ...storage(),
        fetchImpl: async () => response(),
      }),
      { publishCode: "PUBLIC_READ" },
    );
  }
});

test("registers only screenshots included in the verified artifact", async (t) => {
  const { dir, request } = await fixture(t),
    host = storage();
  await writeFile(
    join(dir, "shell/pc-web.png"),
    Buffer.from([137, 80, 78, 71]),
  );
  request.digest = artifactDigest(dir).digest;
  request.requestId = requestIdentity(request);
  const result = await publishToR2(request, { env, ...host });
  assert.deepEqual(result.entries[0].thumbnails, [
    {
      device: "pc-web",
      url: `${env.R2_PUBLIC_BASE_URL}/runweft/${request.requestId}/shell/pc-web.png`,
    },
  ]);
});

test("rejects missing credentials and non-public or credential-bearing URLs", async (t) => {
  const { request } = await fixture(t),
    host = storage();
  await assert.rejects(publishToR2(request, { env: {}, ...host }), {
    publishCode: "CONFIGURATION",
  });
  for (const url of [
    "http://pub-test.r2.dev",
    "https://user:secret@pub-test.r2.dev",
    "https://pub-test.r2.dev?token=secret",
  ]) {
    await assert.rejects(
      publishToR2(request, {
        env: { ...env, R2_PUBLIC_BASE_URL: url },
        ...host,
      }),
      { publishCode: "CONFIGURATION" },
    );
  }
  assert.equal(host.calls.length, 0);
});

test("CLI replaces stale success with a failed result and exits unsuccessfully", async (t) => {
  const { dir, request } = await fixture(t);
  const input = join(dir, "request.json"),
    output = join(dir, "result.json");
  await writeFile(input, JSON.stringify(request));
  await writeFile(output, JSON.stringify({ status: "published" }));
  const script = fileURLToPath(new URL("./publish-r2.mjs", import.meta.url));
  const run = spawnSync(
    process.execPath,
    [script, "--request", input, "--result", output],
    { env: {}, encoding: "utf8" },
  );
  assert.equal(run.status, 1);
  const result = JSON.parse(await readFile(output, "utf8"));
  assert.equal(result.status, "failed");
  assert.throws(
    () => validateResult(request, result),
    /Host publication failed/,
  );
});
