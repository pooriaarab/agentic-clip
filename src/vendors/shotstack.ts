import { VendorError } from "../core.js";
import { requestJson } from "./http.js";

export interface ShotstackOptions { apiKey?: string; env?: "stage" | "v1"; fetchFn?: typeof fetch; timeoutMs?: number }
export class ShotstackAdapter {
  private options: Required<ShotstackOptions>;
  constructor({ apiKey = process.env.SHOTSTACK_API_KEY ?? "", env = "v1", fetchFn = fetch, timeoutMs = 30000 }: ShotstackOptions = {}) {
    this.options = { apiKey, env, fetchFn, timeoutMs };
  }
  private request(path: string, body?: unknown) {
    const { apiKey, env, fetchFn, timeoutMs } = this.options;
    if (!apiKey) throw new VendorError("Missing SHOTSTACK_API_KEY");
    return requestJson(fetchFn, `https://api.shotstack.io/edit/${env}/render${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { "x-api-key": apiKey, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }, timeoutMs);
  }
  async submit(edit: unknown): Promise<string> {
    const body = await this.request("", edit);
    if (body.success === false) throw new VendorError(`Shotstack rejected render: ${JSON.stringify(body)}`);
    const id = body.response?.id ?? body.id;
    if (typeof id !== "string" || !id) throw new VendorError("Shotstack response missing render id");
    return id;
  }
  async status(id: string): Promise<{ status: string; url?: string }> {
    const body = await this.request(`/${encodeURIComponent(id)}`);
    if (body.success === false) throw new VendorError(`Shotstack status failed: ${JSON.stringify(body)}`);
    const result = body.response ?? body;
    if (typeof result.status !== "string") throw new VendorError("Shotstack response missing status");
    if (["failed", "error"].includes(result.status)) throw new VendorError(`Shotstack render ${result.status}`);
    return { status: result.status, ...(result.url ? { url: result.url } : {}) };
  }
}
