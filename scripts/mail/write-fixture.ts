// Writes the reference mailbox (apps/app/src/features/email/testing/fixture.ts)
// for the other test layers (specs/mail-rebuild.md decision 18):
//   --format jsonl   → apps/desktop/src-tauri/target/mail-fixture/messages.jsonl (Rust perf)
//   --format maildir → .mail-it/maildir/<account>/ (Dovecot harness, one Maildir per account)
// Options: --messages N (default 100000), --seed N, --out <path>.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import {
  type FixtureMessage,
  generateFixture,
} from "../../apps/app/src/features/email/testing/fixture.ts";

const root = resolve(import.meta.dir, "../..");
const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const format = arg("format") ?? "jsonl";
const fixture = generateFixture({
  messages: arg("messages") ? Number(arg("messages")) : undefined,
  seed: arg("seed") ? Number(arg("seed")) : undefined,
});

const MAILDIR_FOLDER: Record<string, string> = {
  inbox: "",
  sent: ".Sent",
  drafts: ".Drafts",
  archive: ".Archive",
  trash: ".Trash",
  spam: ".Junk",
};

function rfc822(m: FixtureMessage): string {
  const headers = [
    `From: ${m.fromName} <${m.fromEmail}>`,
    `To: ${m.to.join(", ")}`,
    `Subject: ${m.subject}`,
    `Date: ${new Date(m.dateMs).toUTCString()}`,
    `Message-ID: ${m.messageId}`,
    m.inReplyTo ? `In-Reply-To: ${m.inReplyTo}\r\nReferences: ${m.inReplyTo}` : null,
    m.listUnsubscribe ? `List-Unsubscribe: ${m.listUnsubscribe}` : null,
    m.precedence ? `Precedence: ${m.precedence}` : null,
    m.autoSubmitted ? `Auto-Submitted: ${m.autoSubmitted}` : null,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
  ].filter(Boolean);
  return `${headers.join("\r\n")}\r\n\r\n${m.bodyText}\r\n`;
}

if (format === "jsonl") {
  const out = arg("out") ?? join(root, "apps/desktop/src-tauri/target/mail-fixture/messages.jsonl");
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, fixture.messages.map((m) => JSON.stringify(m)).join("\n") + "\n");
  console.log(`wrote ${fixture.messages.length} messages to ${out}`);
} else if (format === "maildir") {
  const out = arg("out") ?? join(root, ".mail-it/maildir");
  for (const m of fixture.messages) {
    const account = fixture.accounts.find((a) => a.id === m.accountId)!;
    const dir = join(out, account.address, "Maildir", MAILDIR_FOLDER[m.mailboxRole] ?? "");
    for (const sub of ["cur", "new", "tmp"]) mkdirSync(join(dir, sub), { recursive: true });
    const seen = (m.flags & 1) !== 0 ? "S" : "";
    const flagged = (m.flags & 2) !== 0 ? "F" : "";
    writeFileSync(
      join(dir, "cur", `${Math.floor(m.dateMs / 1000)}.${m.id}.fixture:2,${flagged}${seen}`),
      rfc822(m),
    );
  }
  console.log(`wrote ${fixture.messages.length} messages to ${out}`);
} else {
  console.error(`unknown --format ${format} (jsonl | maildir)`);
  process.exit(1);
}
