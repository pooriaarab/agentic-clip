import { VendorError } from "../core.js";
import { requestJson } from "./http.js";
export interface CreatomateOptions { apiKey?: string; fetchFn?: typeof fetch; timeoutMs?: number }
export class CreatomateAdapter {
  private options: Required<CreatomateOptions>;
  constructor({ apiKey = process.env.CREATOMATE_API_KEY ?? "", fetchFn = fetch, timeoutMs = 30000 }: CreatomateOptions = {}) {
    this.options = { apiKey, fetchFn, timeoutMs };
  }
  private request(path: string, body?: unknown) {
    const { apiKey, fetchFn, timeoutMs } = this.options;
    if (!apiKey) throw new VendorError("Missing CREATOMATE_API_KEY");
    return requestJson(fetchFn, `https://api.creatomate.com/v2/renders${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }, timeoutMs);
  }
  async submit(body: unknown): Promise<string> {
    const result = await this.request("", body);
    const render = Array.isArray(result) ? result[0] : result;
    if (["failed", "error"].includes(render?.status)) throw new VendorError(`Creatomate render ${render.status}`);
    if (typeof render?.id !== "string" || !render.id) throw new VendorError("Creatomate response missing render id");
    return render.id;
  }
  async status(id: string): Promise<{ status: string; url?: string }> {
    const body = await this.request(`/${encodeURIComponent(id)}`);
    const result = Array.isArray(body) ? body[0] : body;
    if (["failed", "error"].includes(result?.status)) throw new VendorError(`Creatomate render ${result.status}`);
    if (typeof result?.status !== "string") throw new VendorError("Creatomate response missing status");
    return { status: result.status, ...(result.status === "succeeded" && result.url ? { url: result.url } : {}) };
  }
}
