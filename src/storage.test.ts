import { afterEach, describe, expect, test, vi } from "vitest";
import { signS3Put, uploadToR2, uploadToStream } from "./storage.js";
import { VendorError } from "./core.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("signS3Put", () => {
  const base = {
    accessKeyId: "AKID",
    secretAccessKey: "secret",
    host: "acct.r2.cloudflarestorage.com",
    path: "/bucket/clip.mp4",
    contentType: "video/mp4",
    date: new Date("2026-01-02T03:04:05.000Z"),
  };

  test("is deterministic for a fixed date", () => {
    expect(signS3Put(base)).toEqual(signS3Put(base));
  });

  test("carries the credential scope and signed headers", () => {
    const headers = signS3Put(base);
    expect(headers["x-amz-date"]).toBe("20260102T030405Z");
    expect(headers.authorization).toContain("AWS4-HMAC-SHA256 Credential=AKID/20260102/auto/s3/aws4_request");
    expect(headers.authorization).toContain(
      "SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date",
    );
    expect(headers.authorization).toMatch(/Signature=[0-9a-f]{64}$/);
  });

  test("a different key changes the signature", () => {
    const first = signS3Put(base).authorization;
    const second = signS3Put({ ...base, secretAccessKey: "other" }).authorization;
    expect(first).not.toBe(second);
  });
});

describe("uploadToR2", () => {
  test("puts bytes to the bucket path with auth headers", async () => {
    let seenUrl = "";
    let seenInit: RequestInit = {};
    const fetchFn = vi.fn<typeof fetch>(async (url, init) => {
      seenUrl = String(url);
      seenInit = init ?? {};
      return new Response("", { status: 200 });
    });
    const receipt = await uploadToR2({
      bytes: new Uint8Array([1, 2, 3]),
      bucket: "clips",
      key: "promo/launch.mp4",
      accountId: "acct",
      accessKeyId: "AKID",
      secretAccessKey: "secret",
      fetchFn,
    });
    expect(receipt).toEqual({
      bucket: "clips",
      key: "promo/launch.mp4",
      url: "r2://clips/promo/launch.mp4",
    });
    expect(seenUrl).toBe(
      "https://acct.r2.cloudflarestorage.com/clips/promo/launch.mp4",
    );
    expect(seenInit.method).toBe("PUT");
    const headers = seenInit.headers as Record<string, string>;
    expect(headers.authorization).toContain("AWS4-HMAC-SHA256");
    expect(seenInit.body).toBeInstanceOf(Uint8Array);
  });

  test("missing creds throw before fetch", async () => {
    const fetchFn = vi.fn<typeof fetch>();
    await expect(
      uploadToR2({ bytes: new Uint8Array(), bucket: "b", key: "k", fetchFn }),
    ).rejects.toThrow("Missing R2_ACCOUNT_ID");
    expect(fetchFn).not.toHaveBeenCalled();
  });

  test("non-2xx throws VendorError with status", async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => new Response("denied", { status: 403 }));
    const error = await uploadToR2({
      bytes: new Uint8Array([1]),
      bucket: "b",
      key: "k",
      accountId: "a",
      accessKeyId: "k",
      secretAccessKey: "s",
      fetchFn,
    }).catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(VendorError);
    expect((error as VendorError).status).toBe(403);
  });
});

describe("uploadToStream", () => {
  test("creates the upload then posts the file", async () => {
    const seen: string[] = [];
    const fetchFn = vi.fn<typeof fetch>(async (url, init) => {
      seen.push(String(url));
      if (seen.length === 1) {
        expect((init?.headers as Record<string, string>).authorization).toBe("Bearer tok");
        return jsonResponse({
          success: true,
          result: { uploadURL: "https://upload.example/u", uid: "uid-1" },
        });
      }
      expect(init?.body).toBeInstanceOf(FormData);
      return new Response("", { status: 200 });
    });
    const receipt = await uploadToStream({
      bytes: new Uint8Array([9]),
      filename: "launch.mp4",
      accountId: "acct",
      apiToken: "tok",
      customerSubdomain: "customer-abc",
      fetchFn,
    });
    expect(receipt).toEqual({
      uid: "uid-1",
      playbackHls: "https://customer-abc.cloudflarestream.com/uid-1/manifest/video.m3u8",
      embedUrl: "https://customer-abc.cloudflarestream.com/uid-1/iframe",
    });
    expect(seen).toEqual([
      "https://api.cloudflare.com/client/v4/accounts/acct/stream/direct_upload",
      "https://upload.example/u",
    ]);
  });

  test("works without a customer subdomain", async () => {
    const fetchFn = vi.fn<typeof fetch>(async (url) =>
      String(url).includes("direct_upload")
        ? jsonResponse({ success: true, result: { uploadURL: "https://upload.example/u", uid: "uid-2" } })
        : new Response("", { status: 200 }),
    );
    await expect(
      uploadToStream({ bytes: new Uint8Array([1]), accountId: "a", apiToken: "t", fetchFn }),
    ).resolves.toEqual({ uid: "uid-2" });
  });

  test("missing token throws before fetch", async () => {
    const fetchFn = vi.fn<typeof fetch>();
    await expect(
      uploadToStream({ bytes: new Uint8Array(), accountId: "a", fetchFn }),
    ).rejects.toThrow("Missing STREAM_ACCOUNT_ID");
    expect(fetchFn).not.toHaveBeenCalled();
  });

  test("failed create call throws", async () => {
    const fetchFn = vi.fn<typeof fetch>(async () =>
      jsonResponse({ success: false, errors: [{ message: "bad" }] }),
    );
    await expect(
      uploadToStream({ bytes: new Uint8Array([1]), accountId: "a", apiToken: "t", fetchFn }),
    ).rejects.toThrow("Stream direct upload failed");
  });
});
