import { describe, expect, it } from "vitest";
import {
  SsrfBlockedError,
  isPrivateIpAddress,
  resolvePinnedHostname,
} from "@/server/features/ai/tools/runtime/capabilities/web-ssrf";

describe("web SSRF guard", () => {
  it("detects private/local addresses", () => {
    expect(isPrivateIpAddress("127.0.0.1")).toBe(true);
    expect(isPrivateIpAddress("10.1.2.3")).toBe(true);
    expect(isPrivateIpAddress("::1")).toBe(true);
    expect(isPrivateIpAddress("93.184.216.34")).toBe(false);
  });

  it("blocks localhost hostnames before DNS lookup", async () => {
    await expect(resolvePinnedHostname("localhost")).rejects.toBeInstanceOf(SsrfBlockedError);
  });

  it("blocks hostnames that resolve to private IPs", async () => {
    await expect(
      resolvePinnedHostname("private.example", async () => [{ address: "10.0.0.5", family: 4 }]),
    ).rejects.toBeInstanceOf(SsrfBlockedError);
  });

  it("allows hostnames that resolve to public IPs", async () => {
    const pinned = await resolvePinnedHostname("example.com", async () => [
      { address: "93.184.216.34", family: 4 },
    ]);

    expect(pinned.hostname).toBe("example.com");
    expect(pinned.addresses).toEqual(["93.184.216.34"]);
  });
});
