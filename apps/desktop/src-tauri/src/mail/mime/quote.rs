//! Quote and signature split (AC16): the byte offset where quoted history or a
//! signature starts, so the reader can collapse it behind "…". `None` when
//! there's nothing to collapse or nothing would remain above the fold.

/// Plain text: the earliest attribution line, quoted block, forwarded header
/// or signature delimiter that has real content above it.
pub fn text_quote_offset(text: &str) -> Option<usize> {
    let mut offset = 0usize;
    let lines: Vec<&str> = text.split_inclusive('\n').collect();
    for (i, line) in lines.iter().enumerate() {
        let t = line.trim_end_matches(['\r', '\n']);
        let trimmed = t.trim();
        let hit = trimmed.starts_with('>') && rest_mostly_quoted(&lines[i..])
            || t == "-- "
            || t == "--"
            || trimmed.starts_with("-----Original Message-----")
            || trimmed.starts_with("---------- Forwarded message")
            || trimmed.starts_with("Sent from my ")
            || is_attribution(trimmed, lines.get(i + 1).map(|l| l.trim()))
            || is_outlook_header(&lines[i..]);
        if hit && has_own_content(&text[..offset]) {
            return Some(offset);
        }
        offset += line.len();
    }
    None
}

fn has_own_content(above: &str) -> bool {
    above
        .lines()
        .map(str::trim)
        .any(|l| !l.is_empty() && !l.starts_with('>'))
}

fn rest_mostly_quoted(rest: &[&str]) -> bool {
    let non_empty: Vec<&str> = rest
        .iter()
        .map(|l| l.trim())
        .filter(|l| !l.is_empty())
        .collect();
    let quoted = non_empty.iter().filter(|l| l.starts_with('>')).count();
    quoted * 10 >= non_empty.len() * 8
}

/// "On Mon, 3 Nov 2026, Anna <a@x> wrote:" (possibly wrapped onto two lines).
fn is_attribution(line: &str, next: Option<&str>) -> bool {
    let l = line.to_ascii_lowercase();
    let starts = l.starts_with("on ") || l.starts_with("am ") || l.starts_with("le ");
    if !starts {
        return false;
    }
    let ends = |s: &str| {
        let s = s.trim_end().to_ascii_lowercase();
        s.ends_with("wrote:") || s.ends_with("schrieb:") || s.ends_with("a écrit :")
    };
    ends(&l) || next.is_some_and(|n| ends(n) && n.len() < 80)
}

/// Outlook's "From: … / Sent: … / To: … / Subject: …" block.
fn is_outlook_header(rest: &[&str]) -> bool {
    let first = rest.first().map(|l| l.trim()).unwrap_or("");
    if !first.starts_with("From:") {
        return false;
    }
    rest.iter()
        .skip(1)
        .take(4)
        .any(|l| l.trim().starts_with("Sent:") || l.trim().starts_with("Date:"))
}

const HTML_MARKERS: &[&str] = &[
    "<div class=\"gmail_quote",
    "<div class=\"gmail_signature",
    "<blockquote type=\"cite\"",
    "<div id=\"divrplyfwdmsg\"",
    "<div id=\"appendonsend\"",
    "<div class=\"moz-cite-prefix\"",
    "<div class=\"moz-signature\"",
    "<div class=\"yahoo_quoted\"",
    "<hr id=\"stopspelling\"",
    "<blockquote",
];

/// HTML: the earliest known quote/signature container, at a tag boundary.
pub fn html_quote_offset(html: &str) -> Option<usize> {
    let lower = html.to_ascii_lowercase();
    let at = HTML_MARKERS.iter().filter_map(|m| lower.find(m)).min()?;
    // `to_ascii_lowercase` keeps byte offsets, so `at` indexes `html` too.
    (!visible_text(&html[..at]).trim().is_empty()).then_some(at)
}

fn visible_text(html: &str) -> String {
    let mut out = String::new();
    let mut in_tag = false;
    for c in html.chars() {
        match c {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => out.push(c),
            _ => {}
        }
    }
    out.replace("&nbsp;", " ")
}
