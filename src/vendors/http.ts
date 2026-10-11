import { VendorError } from "../core.js";

export async function requestJson(fetchFn: typeof fetch, url: string, init: RequestInit, timeoutMs = 30000): Promise<any> {
  try {
    const response = await fetchFn(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) throw new VendorError(`Vendor HTTP ${response.status}: ${await response.text()}`, { status: response.status });
    return await response.json();
  } catch (cause) {
    if (cause instanceof VendorError) throw cause;
    throw new VendorError("Vendor request failed", { cause });
  }
}
