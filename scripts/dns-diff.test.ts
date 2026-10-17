import { describe, expect, it } from "@rstest/core";

import {
  cloudflareBody,
  diff,
  fromCloudflare,
  fromVercel,
  liveDiff,
  normalizeValue,
  parseDig,
  unquoteTxt,
  WILDCARD_PROBE,
} from "./dns-diff";

// The records that must survive the move exactly: Hostinger mail, Resend (send.* + DKIM), DMARC,
// the verification TXT, CAA.
const VERCEL = [
  { name: "", type: "MX", value: "mx1.hostinger.com", mxPriority: 5 },
  { name: "", type: "MX", value: "mx2.hostinger.com", mxPriority: 10 },
  { name: "", type: "TXT", value: "v=spf1 include:_spf.mail.hostinger.com ~all" },
  { name: "", type: "TXT", value: "anthropic-domain-verification-tbpb07=abc" },
  { name: "_dmarc", type: "TXT", value: "v=DMARC1; p=none;" },
  { name: "resend._domainkey", type: "TXT", value: "p=MIGf" },
  { name: "send", type: "MX", value: "feedback-smtp.eu-west-1.amazonses.com", mxPriority: 10 },
  { name: "send", type: "TXT", value: "v=spf1 include:amazonses.com ~all" },
  {
    name: "hostingermail-a._domainkey",
    type: "CNAME",
    value: "hostingermail-a.dkim.mail.hostinger.com.",
  },
  { name: "", type: "CAA", value: '0 issue "letsencrypt.org"' },
  { name: "", type: "ALIAS", value: "cname.vercel-dns.com." },
];

const CLOUDFLARE = [
  { name: "moduo.app", type: "MX", content: "mx1.hostinger.com", priority: 5 },
  { name: "moduo.app", type: "MX", content: "mx2.hostinger.com", priority: 10 },
  { name: "moduo.app", type: "TXT", content: '"v=spf1 include:_spf.mail.hostinger.com ~all"' },
  { name: "moduo.app", type: "TXT", content: '"anthropic-domain-verification-tbpb07=abc"' },
  { name: "_dmarc.moduo.app", type: "TXT", content: '"v=DMARC1; p=none;"' },
  { name: "resend._domainkey.moduo.app", type: "TXT", content: '"p=" "MIGf"' },
  {
    name: "send.moduo.app",
    type: "MX",
    content: "feedback-smtp.eu-west-1.amazonses.com",
    priority: 10,
  },
  { name: "send.moduo.app", type: "TXT", content: '"v=spf1 include:amazonses.com ~all"' },
  {
    name: "hostingermail-a._domainkey.moduo.app",
    type: "CNAME",
    content: "Hostingermail-a.dkim.mail.hostinger.com",
  },
  {
    name: "moduo.app",
    type: "CAA",
    content: '0 issue "letsencrypt.org"',
    data: { flags: 0, tag: "issue", value: "letsencrypt.org" },
  },
  { name: "moduo.app", type: "CNAME", content: "cname.vercel-dns.com" },
];

describe("dns-diff · records match", () => {
  it("finds no difference between equal zones spelled the two providers' ways", () => {
    expect(diff(fromVercel(VERCEL), fromCloudflare(CLOUDFLARE))).toEqual({
      onlyVercel: [],
      onlyCloudflare: [],
    });
  });

  it("reports a missing DKIM key and a changed MX priority on the right side", () => {
    const cf = CLOUDFLARE.filter((r) => r.name !== "resend._domainkey.moduo.app").map((r) =>
      r.content === "mx2.hostinger.com" ? { ...r, priority: 20 } : r,
    );
    const d = diff(fromVercel(VERCEL), fromCloudflare(cf));
    expect(d.onlyVercel.map((r) => `${r.name} ${r.type} ${r.value}`)).toEqual([
      "moduo.app MX 10 mx2.hostinger.com",
      "resend._domainkey.moduo.app TXT p=MIGf",
    ]);
    expect(d.onlyCloudflare.map((r) => `${r.name} ${r.type} ${r.value}`)).toEqual([
      "moduo.app MX 20 mx2.hostinger.com",
    ]);
  });

  it("catches one changed character in SPF", () => {
    const cf = CLOUDFLARE.map((r) =>
      r.content.includes("_spf.mail")
        ? { ...r, content: '"v=spf1 include:_spf.mail.hostinger.com -all"' }
        : r,
    );
    expect(diff(fromVercel(VERCEL), fromCloudflare(cf)).onlyVercel).toHaveLength(1);
  });
});

describe("dns-diff · normalizing", () => {
  it("joins TXT chunks and unescapes quotes", () => {
    expect(unquoteTxt('"v=DKIM1;k=rsa;p=AB" "CD"')).toBe("v=DKIM1;k=rsa;p=ABCD");
    expect(unquoteTxt('"a \\"b\\""')).toBe('a "b"');
    expect(unquoteTxt("bare value")).toBe("bare value");
  });

  it("collapses Vercel's rotating anycast addresses and leaves others alone", () => {
    expect(normalizeValue("A", "216.198.79.65")).toBe("vercel-anycast");
    expect(normalizeValue("A", "64.29.17.1")).toBe("vercel-anycast");
    expect(normalizeValue("A", "104.21.3.4")).toBe("104.21.3.4");
  });

  it("builds Cloudflare bodies that read back as the same record", () => {
    for (const r of fromVercel(VERCEL)) {
      const b = cloudflareBody(r) as { content?: string; priority?: number; data?: never };
      expect(b.proxied).toBe(false);
      const back = fromCloudflare([
        {
          name: r.name,
          type: r.type,
          content: b.content ?? "",
          priority: b.priority,
          data: b.data,
        },
      ]);
      expect(back[0]).toEqual(r);
    }
  });

  it("refuses to copy a bare Vercel anycast A record", () => {
    expect(() => cloudflareBody({ name: "moduo.app", type: "A", value: "vercel-anycast" })).toThrow(
      /cname\.vercel-dns\.com/,
    );
  });
});

describe("dns-diff · live answers", () => {
  const DIG = [
    'moduo.app.\t\t600\tIN\tTXT\t"v=spf1 include:_spf.mail.hostinger.com ~all"',
    'moduo.app.\t\t600\tIN\tTXT\t"anthropic-domain-verification-tbpb07=abc"',
    "hostingermail-a._domainkey.moduo.app. 60 IN CNAME hostingermail-a.dkim.mail.hostinger.com.",
    'hostingermail-a.dkim.mail.hostinger.com. 300 IN TXT "v=DKIM1;"',
  ].join("\n");

  it("keeps only answers owned by the queried name and type", () => {
    expect(parseDig(DIG, "moduo.app", "TXT")).toEqual([
      "anthropic-domain-verification-tbpb07=abc",
      "v=spf1 include:_spf.mail.hostinger.com ~all",
    ]);
    expect(parseDig(DIG, "hostingermail-a._domainkey.moduo.app.", "CNAME")).toEqual([
      "hostingermail-a.dkim.mail.hostinger.com",
    ]);
    expect(parseDig(DIG, "hostingermail-a._domainkey.moduo.app", "TXT")).toEqual([]);
  });

  it("reports a name whose answers differ, probes the wildcard, and skips the apex NS", async () => {
    const asked: string[] = [];
    const fake = async (server: string, name: string, type: string) => {
      asked.push(`${server} ${name} ${type}`);
      if (name === "_dmarc.moduo.app" && type === "TXT")
        return server === "v" ? ["v=DMARC1; p=none;"] : [];
      return type === "A" ? ["vercel-anycast"] : [];
    };
    const out = await liveDiff(["moduo.app", "_dmarc.moduo.app", "*.moduo.app"], "v", "c", fake);
    expect(out).toEqual([
      { name: "_dmarc.moduo.app", type: "TXT", vercel: ["v=DMARC1; p=none;"], cloudflare: [] },
    ]);
    expect(asked).toContain(`v ${WILDCARD_PROBE}.moduo.app A`);
    expect(asked).not.toContain("v moduo.app NS");
  });
});
