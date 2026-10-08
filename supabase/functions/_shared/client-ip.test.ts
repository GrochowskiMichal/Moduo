import { afterEach, describe, expect, it, rs } from "@rstest/core";

import { clientIp } from "./client-ip.ts";

function req(headers: Record<string, string>): Pick<Request, "headers"> {
  return { headers: new Headers(headers) };
}

describe("clientIp", () => {
  it("reads cf-connecting-ip", () => {
    expect(clientIp(req({ "cf-connecting-ip": "198.51.100.23" }))).toBe("198.51.100.23");
  });

  it("prefers cf-connecting-ip over x-forwarded-for and x-real-ip", () => {
    const forged = req({
      "x-forwarded-for": "203.0.113.7, 198.51.100.23",
      "x-real-ip": "203.0.113.7",
      "cf-connecting-ip": "198.51.100.23",
    });
    expect(clientIp(forged)).toBe("198.51.100.23");
  });

  describe("without cf-connecting-ip", () => {
    afterEach(() => {
      rs.restoreAllMocks();
    });

    it("falls back to the leftmost x-forwarded-for entry and warns", () => {
      const warn = rs.spyOn(console, "warn").mockImplementation(() => {});
      expect(clientIp(req({ "x-forwarded-for": "198.51.100.23,198.51.100.23, 10.0.0.1" }))).toBe(
        "198.51.100.23",
      );
      expect(clientIp(req({ "cf-connecting-ip": " ", "x-forwarded-for": "2001:db8:1:2::5" }))).toBe(
        "2001:db8:1:2::/64",
      );
      expect(warn).toHaveBeenCalledTimes(2);
    });

    it("never reads x-real-ip, and says unknown when nothing is there", () => {
      expect(clientIp(req({ "x-real-ip": "203.0.113.8" }))).toBe("unknown");
      expect(clientIp(req({ "x-forwarded-for": " , 10.0.0.1" }))).toBe("unknown");
      expect(clientIp(req({}))).toBe("unknown");
    });
  });

  it("keys IPv6 callers by their /64", () => {
    expect(clientIp(req({ "cf-connecting-ip": "2001:db8:85a3:12:8a2e:370:7334:1" }))).toBe(
      "2001:db8:85a3:12::/64",
    );
    // Every address inside one /64 is the same bucket, however it's written.
    const sameBlock = [
      "2001:DB8:85A3:0012:0000:0000:0000:0001",
      "2001:db8:85a3:12::ffff",
      "2001:db8:85a3:12:1:2:3:4",
      "2001:db8:85a3:12::1%eth0",
    ];
    for (const ip of sameBlock) {
      expect(clientIp(req({ "cf-connecting-ip": ip }))).toBe("2001:db8:85a3:12::/64");
    }
    expect(clientIp(req({ "cf-connecting-ip": "2001:db8::1" }))).toBe("2001:db8:0:0::/64");
    expect(clientIp(req({ "cf-connecting-ip": "::1" }))).toBe("0:0:0:0::/64");
  });

  it("keeps different /64s apart", () => {
    const a = clientIp(req({ "cf-connecting-ip": "2001:db8:1:1::1" }));
    const b = clientIp(req({ "cf-connecting-ip": "2001:db8:1:2::1" }));
    expect(a).not.toBe(b);
  });

  it("treats an IPv4-mapped IPv6 address as the IPv4 address", () => {
    expect(clientIp(req({ "cf-connecting-ip": "::ffff:198.51.100.23" }))).toBe("198.51.100.23");
    expect(clientIp(req({ "cf-connecting-ip": "::ffff:c633:6417" }))).toBe("198.51.100.23");
  });

  it("passes an unparseable value through rather than merging it with others", () => {
    expect(clientIp(req({ "cf-connecting-ip": "1:2:3:4:5:6:7:8:9" }))).toBe("1:2:3:4:5:6:7:8:9");
    expect(clientIp(req({ "cf-connecting-ip": "1::2::3" }))).toBe("1::2::3");
    expect(clientIp(req({ "cf-connecting-ip": "::ffff:300.1.1.1" }))).toBe("::ffff:300.1.1.1");
  });
});
