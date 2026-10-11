import { createHash, createHmac } from "node:crypto";
import { VendorError } from "./core.js";
import { requestJson } from "./vendors/http.js";

const hash = (value: string | Uint8Array): string =>
  createHash("sha256").update(value).digest("hex");

const hmac = (key: string | Uint8Array, value: string): Buffer =>
  createHmac("sha256", key).update(value).digest();

export interface S3PutOptions {
  accessKeyId: string;
  secretAccessKey: string;
  region?: string;
  host: string;
  path: string;
  contentType: string;
  date: Date;
}

export function signS3Put({
  accessKeyId,
  secretAccessKey,
  region = "auto",
  host,
  path,
  contentType,
  date,
}: S3PutOptions): Record<string, string> {
  const amzDate = date.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const day = amzDate.slice(0, 8);
  const payload = "UNSIGNED-PAYLOAD";
  const names = "content-type;host;x-amz-content-sha256;x-amz-date";
  const canonical =
    `PUT\n${path}\n\ncontent-type:${contentType.trim()}\nhost:${host}\n` +
    `x-amz-content-sha256:${payload}\nx-amz-date:${amzDate}\n\n${names}\n${payload}`;
  const scope = `${day}/${region}/s3/aws4_request`;
  const key = hmac(
    hmac(hmac(hmac(`AWS4${secretAccessKey}`, day), region), "s3"),
    "aws4_request",
  );
  const signature = createHmac("sha256", key)
    .update(`AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${hash(canonical)}`)
    .digest("hex");
  return {
    host,
    "x-amz-date": amzDate,
    "x-amz-content-sha256": payload,
    "content-type": contentType,
    authorization:
      `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, ` +
      `SignedHeaders=${names}, Signature=${signature}`,
  };
}

export interface R2UploadOptions {
  bytes: Uint8Array;
  bucket: string;
  key: string;
  accountId?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  contentType?: string;
  fetchFn?: typeof fetch;
}

export async function uploadToR2({
  bytes,
  bucket,
  key,
  accountId = process.env.R2_ACCOUNT_ID,
  accessKeyId = process.env.R2_ACCESS_KEY_ID,
  secretAccessKey = process.env.R2_SECRET_ACCESS_KEY,
  contentType = "video/mp4",
  fetchFn = fetch,
}: R2UploadOptions): Promise<{ bucket: string; key: string; url: string }> {
  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new VendorError(
      "Missing R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, or R2_SECRET_ACCESS_KEY",
    );
  }
  if (!bucket.trim() || !key.trim()) {
    throw new VendorError("R2 bucket and key must be nonempty");
  }
  const host = `${accountId}.r2.cloudflarestorage.com`;
  const encode = (part: string): string =>
    encodeURIComponent(part).replace(/[!'()*]/g, (c) =>
      `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
    );
  const path = `/${encode(bucket)}/${key.split("/").map(encode).join("/")}`;
  try {
    const response = await fetchFn(`https://${host}${path}`, {
      method: "PUT",
      headers: signS3Put({
        accessKeyId,
        secretAccessKey,
        host,
        path,
        contentType,
        date: new Date(),
      }),
      body: new Uint8Array(bytes),
    });
    if (!response.ok) {
      throw new VendorError(`R2 HTTP ${response.status}: ${await response.text()}`, {
        status: response.status,
      });
    }
    return { bucket, key, url: `r2://${bucket}/${key}` };
  } catch (cause) {
    if (cause instanceof VendorError) throw cause;
    throw new VendorError("R2 upload failed", { cause });
  }
}

export interface StreamUploadOptions {
  bytes: Uint8Array;
  filename?: string;
  accountId?: string;
  apiToken?: string;
  customerSubdomain?: string;
  fetchFn?: typeof fetch;
}

export async function uploadToStream({
  bytes,
  filename = "clip.mp4",
  accountId = process.env.STREAM_ACCOUNT_ID,
  apiToken = process.env.STREAM_API_TOKEN,
  customerSubdomain = process.env.STREAM_CUSTOMER_SUBDOMAIN,
  fetchFn = fetch,
}: StreamUploadOptions): Promise<{
  uid: string;
  playbackHls?: string;
  embedUrl?: string;
}> {
  if (!accountId || !apiToken) {
    throw new VendorError("Missing STREAM_ACCOUNT_ID or STREAM_API_TOKEN");
  }
  const created = await requestJson(
    fetchFn,
    `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/stream/direct_upload`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ maxDurationSeconds: 3600 }),
    },
  );
  if (created.success === false) {
    throw new VendorError(`Stream direct upload failed: ${JSON.stringify(created)}`);
  }
  const uploadURL: unknown = created.result?.uploadURL;
  const uid: unknown = created.result?.uid;
  if (typeof uploadURL !== "string" || !uploadURL || typeof uid !== "string" || !uid) {
    throw new VendorError("Stream response missing uploadURL or uid");
  }
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(bytes)], { type: "video/mp4" }), filename);
  try {
    const response = await fetchFn(uploadURL, { method: "POST", body: form });
    if (!response.ok) {
      throw new VendorError(
        `Stream upload HTTP ${response.status}: ${await response.text()}`,
        { status: response.status },
      );
    }
    const text = await response.text();
    if (text) {
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = null;
      }
      if (
        parsed !== null &&
        typeof parsed === "object" &&
        (parsed as { success?: unknown }).success === false
      ) {
        throw new VendorError(`Stream upload failed: ${text}`);
      }
    }
  } catch (cause) {
    if (cause instanceof VendorError) throw cause;
    throw new VendorError("Stream upload failed", { cause });
  }
  if (!customerSubdomain) return { uid };
  return {
    uid,
    playbackHls: `https://${customerSubdomain}.cloudflarestream.com/${uid}/manifest/video.m3u8`,
    embedUrl: `https://${customerSubdomain}.cloudflarestream.com/${uid}/iframe`,
  };
}
