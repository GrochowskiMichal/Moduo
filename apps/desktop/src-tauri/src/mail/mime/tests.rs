use super::quote::{html_quote_offset, text_quote_offset};
use super::*;

const MULTIPART: &str = "From: Anna <anna@x.test>\r\nTo: me@x.test\r\nSubject: Plan\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary=\"B\"\r\n\r\n--B\r\nContent-Type: multipart/alternative; boundary=\"A\"\r\n\r\n--A\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nHello there\r\n\r\nOn Mon, 3 Nov 2026, Bob <b@x> wrote:\r\n> old text\r\n--A\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<p>Hello there</p><img src=\"https://t.example/p.gif\" width=\"1\" height=\"1\"><div class=\"gmail_quote\">old</div>\r\n--A--\r\n--B\r\nContent-Type: application/pdf; name=\"plan.pdf\"\r\nContent-Disposition: attachment; filename=\"plan.pdf\"\r\nContent-Transfer-Encoding: base64\r\n\r\nJVBERi0xLjQ=\r\n--B\r\nContent-Type: text/calendar; method=REQUEST; charset=utf-8\r\n\r\nBEGIN:VCALENDAR\r\nMETHOD:REQUEST\r\nBEGIN:VEVENT\r\nUID:u1\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n--B--\r\n";

#[test]
fn parses_parts_attachments_and_invites() {
    let p = parse(MULTIPART.as_bytes());
    assert!(!p.fallback);
    assert!(p.html.as_deref().unwrap().contains("<p>Hello there</p>"));
    assert!(p.text.as_deref().unwrap().starts_with("Hello there"));
    assert_eq!(p.tracker_count, 1);
    let pdf = p
        .attachments
        .iter()
        .find(|a| a.filename == "plan.pdf")
        .unwrap();
    assert_eq!(pdf.mime, "application/pdf");
    assert_eq!(pdf.bytes, b"%PDF-1.4");
    assert_eq!(p.invites.len(), 1);
    let off = p.quote_offset.unwrap() as usize;
    assert!(p.html.unwrap()[off..].starts_with("<div class=\"gmail_quote"));
}

#[test]
fn quote_split() {
    let t =
        "Sounds good.\n\nOn Mon, 3 Nov 2026 at 10:00, Anna <a@x.test> wrote:\n> Shall we?\n> Yes\n";
    let o = text_quote_offset(t).unwrap();
    assert!(t[o..].starts_with("On Mon"));

    let wrapped = "Ok\nOn Mon, 3 Nov 2026 at 10:00, Anna Longname\n<a@x.test> wrote:\n> hi\n";
    assert!(wrapped[text_quote_offset(wrapped).unwrap()..].starts_with("On Mon"));

    let sig = "Thanks!\n-- \nAnna\nCEO, Example\n";
    assert!(sig[text_quote_offset(sig).unwrap()..].starts_with("-- "));

    let outlook = "See below\r\n\r\nFrom: Bob\r\nSent: Monday\r\nTo: me\r\n\r\nold";
    assert!(outlook[text_quote_offset(outlook).unwrap()..].starts_with("From: Bob"));

    // Nothing above the quote: nothing to collapse.
    assert_eq!(text_quote_offset("> all quoted\n> still\n"), None);
    assert_eq!(text_quote_offset("Just a note.\nNo quotes.\n"), None);
    // An inline '>' in prose that isn't followed by a quoted tail stays.
    assert_eq!(
        text_quote_offset("a\n> one inline\nreply text\nmore\nmore\n"),
        None
    );

    let h = "<div>Yes</div><blockquote type=\"cite\">old</blockquote>";
    assert_eq!(&h[html_quote_offset(h).unwrap()..][..11], "<blockquote");
    assert_eq!(html_quote_offset("<blockquote>only</blockquote>"), None);
}

#[test]
fn malformed_corpus_never_panics() {
    let corpus: Vec<Vec<u8>> = vec![
        b"".to_vec(),
        b"\r\n\r\n".to_vec(),
        b"garbage without headers".to_vec(),
        b"Content-Type: multipart/mixed; boundary=\"X\"\r\n\r\n--X\r\nContent-Type: text/plain\r\n\r\nunterminated".to_vec(),
        b"Content-Type: multipart/mixed\r\n\r\nno boundary param".to_vec(),
        b"Content-Type: text/plain; charset=x-unknown-9\r\n\r\n\xff\xfe\xfdtext".to_vec(),
        b"Content-Transfer-Encoding: base64\r\n\r\n!!!not base64%%%".to_vec(),
        b"Content-Transfer-Encoding: quoted-printable\r\n\r\n=ZZ=\r\n=".to_vec(),
        b"Content-Type: text/html\r\n\r\n<div><p><<<</img></table>".to_vec(),
        b"Subject: =?utf-8?B?broken?=\r\nFrom: \"unterminated\r\n\r\nbody".to_vec(),
        "Content-Type: multipart/mixed; boundary=a\r\n\r\n".to_string().into_bytes().into_iter().chain(b"--a\r\nContent-Type: multipart/mixed; boundary=a\r\n\r\n".repeat(200)).collect(),
        vec![0u8; 4096],
        (0..=255u8).cycle().take(10_000).collect(),
        MULTIPART.as_bytes()[..MULTIPART.len() / 2].to_vec(),
    ];
    for raw in &corpus {
        let p = parse(raw);
        // Best effort: never a crash, offsets always inside the string.
        if let Some(o) = p.quote_offset {
            let s = p.html.as_deref().or(p.text.as_deref()).unwrap();
            assert!((o as usize) <= s.len());
            assert!(s.is_char_boundary(o as usize));
        }
        let _ = original_text(raw);
    }
    let p = parse(b"Content-Type: text/plain; charset=x-unknown-9\r\n\r\nhello");
    assert!(p.text.unwrap().contains("hello"));
}

#[test]
fn original_is_capped() {
    let big = vec![b'a'; ORIGINAL_MAX_BYTES + 10];
    let s = original_text(&big);
    assert!(s.ends_with("[… truncated]"));
    assert_eq!(
        original_text(b"Subject: x\r\n\r\nhi"),
        "Subject: x\r\n\r\nhi"
    );
}
