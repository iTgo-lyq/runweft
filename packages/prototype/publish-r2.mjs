import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile, rename, rm } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import {
  artifactDigest,
  validateRequest,
  validateResult,
} from "../../.agents/skills/spec-trail/prototype/scripts/publishing.mjs";
import { hostedUrl } from "../../.agents/skills/spec-trail/prototype/scripts/contract.mjs";
import { digestPrefix } from "../../.agents/skills/spec-trail/prototype/scripts/upload-protocol.mjs";

const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".woff2": "font/woff2",
};
function fail(code, message, retryable = false) {
  throw Object.assign(new Error(message), { publishCode: code, retryable });
}
function configuration(env) {
  for (const key of [
    "R2_ACCOUNT_ID",
    "R2_BUCKET",
    "R2_PUBLIC_BASE_URL",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
  ]) {
    if (!env[key]?.trim()) fail("CONFIGURATION", `Missing ${key}`);
  }
  if (
    !/^[a-f0-9]{32}$/.test(env.R2_ACCOUNT_ID) ||
    !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(env.R2_BUCKET)
  ) {
    fail("CONFIGURATION", "Invalid R2 account ID or bucket name");
  }
  const base = env.R2_PUBLIC_BASE_URL;
  if (!hostedUrl(base) || !base.startsWith("https://") || new URL(base).hash) {
    fail(
      "CONFIGURATION",
      "R2_PUBLIC_BASE_URL must be a credential-free HTTPS URL without query or hash",
    );
  }
  return {
    bucket: env.R2_BUCKET,
    base: base.replace(/\/?$/, "/"),
    client: {
      region: "auto",
      endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: env.R2_ACCESS_KEY_ID,
        secretAccessKey: env.R2_SECRET_ACCESS_KEY,
      },
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
      requestHandler: { connectionTimeout: 10_000, requestTimeout: 60_000 },
    },
  };
}

// Credentials stay on the publishing machine; only public, immutable URLs leave it.
export async function publishToR2(
  request,
  { env = process.env, client, fetchImpl = fetch } = {},
) {
  validateRequest(request);
  const config = configuration(env);
  const { files } = artifactDigest(request.artifactDirectory);
  const snapshot = new Map(),
    hash = createHash("sha256");
  for (const file of files) {
    if (!mime[extname(file)])
      fail("ARTIFACT", "Unsupported artifact file type");
    const bytes = await readFile(join(request.artifactDirectory, file));
    snapshot.set(file, bytes);
    hash.update(digestPrefix(file, bytes.length)).update(bytes);
  }
  if (`sha256:${hash.digest("hex")}` !== request.digest)
    fail("ARTIFACT", "Artifact changed after preparation");
  if (request.entries.some((e) => !snapshot.has(e.entryPath)))
    fail("ARTIFACT", "Missing entry output");

  const version = request.requestId,
    prefix = `runweft/${version}/`;
  const urlFor = (file) =>
    new URL(
      prefix + file.split("/").map(encodeURIComponent).join("/"),
      config.base,
    ).href;
  const s3 = client ?? new S3Client(config.client);
  try {
    for (const [file, bytes] of snapshot) {
      const object = { Bucket: config.bucket, Key: prefix + file };
      try {
        await s3.send(
          new PutObjectCommand({
            ...object,
            Body: bytes,
            IfNoneMatch: "*",
            StorageClass: "STANDARD",
            ContentType: mime[extname(file)],
            CacheControl: "public, max-age=31536000, immutable",
          }),
        );
      } catch (error) {
        if (error.$metadata?.httpStatusCode !== 412) throw error;
        const existing = await s3.send(new GetObjectCommand(object));
        if (
          !Buffer.from(await existing.Body.transformToByteArray()).equals(
            bytes,
          ) ||
          existing.ContentType !== mime[extname(file)]
        ) {
          fail(
            "VERSION_CONFLICT",
            "Existing version differs; refusing overwrite",
          );
        }
      }
    }
    // References are published only after every object is anonymously readable.
    for (const [file, bytes] of snapshot) {
      const response = await fetchImpl(urlFor(file), {
        redirect: "error",
        signal: AbortSignal.timeout(30_000),
      });
      if (
        !response.ok ||
        response.headers.get("content-type")?.split(";")[0] !==
          mime[extname(file)].split(";")[0] ||
        !Buffer.from(await response.arrayBuffer()).equals(bytes)
      ) {
        fail(
          "PUBLIC_READ",
          "Public artifact bytes or Content-Type differ; check bucket public access",
          true,
        );
      }
    }
    const result = {
      schemaVersion: 1,
      status: "published",
      requestId: request.requestId,
      sourceCommit: request.sourceCommit,
      digest: request.digest,
      version,
      entries: request.entries.map((e) => {
        const thumbnails = ["pc-web", "ipad", "mobile"]
          .filter((device) => snapshot.has(`${e.id}/${device}.png`))
          .map((device) => ({ device, url: urlFor(`${e.id}/${device}.png`) }));
        return {
          id: e.id,
          url: urlFor(e.entryPath) + (e.hash ?? ""),
          ...(thumbnails.length ? { thumbnails } : {}),
        };
      }),
    };
    validateResult(request, result);
    return result;
  } catch (error) {
    if (error.publishCode) throw error;
    const status = error.$metadata?.httpStatusCode;
    fail(
      "R2_REQUEST",
      status
        ? `R2 request failed (HTTP ${status})`
        : "R2 upload or public verification failed",
      !status || status === 429 || status === 409 || status >= 500,
    );
  } finally {
    if (!client) s3.destroy();
  }
}

async function writeResult(path, result) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(result, null, 2) + "\n", {
      mode: 0o600,
      flag: "wx",
    });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  let request, output;
  try {
    const { values } = parseArgs({
      options: { request: { type: "string" }, result: { type: "string" } },
    });
    if (!values.request || !values.result)
      fail(
        "ARGUMENTS",
        "Usage: node publish-r2.mjs --request request.json --result result.json",
      );
    if (resolve(values.request) === resolve(values.result))
      fail("ARGUMENTS", "Request and result paths must differ");
    request = JSON.parse(await readFile(values.request, "utf8"));
    validateRequest(request);
    output = values.result;
    await writeResult(output, await publishToR2(request));
    console.log(
      "R2 publication verified. Register the saved result to update references.",
    );
  } catch (error) {
    const message = error.publishCode
      ? error.message
      : "Publication failed; check request, artifact directory and result path";
    if (output)
      await writeResult(output, {
        schemaVersion: 1,
        status: "failed",
        requestId: request.requestId,
        code: error.publishCode ?? "PUBLICATION",
        message,
        retryable: error.retryable ?? false,
      });
    console.error(message);
    process.exitCode = 1;
  }
}
