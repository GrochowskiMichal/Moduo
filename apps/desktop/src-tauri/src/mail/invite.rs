//! Calendar invite parsing (MR-4, AC18 parse; decision 20). Reads the
//! `text/calendar` parts [`crate::mail::mime::parse`] collects into the event
//! card's fields. RSVP builds an iTIP REPLY ([`itip_reply`], MR-6). A missing organizer or a
//! malformed ICS gives a card with "Add to calendar" only (`can_rsvp = false`).

use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Attendee {
    pub email: String,
    pub name: Option<String>,
    pub partstat: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Invite {
    pub method: Option<String>,
    pub uid: Option<String>,
    pub sequence: i64,
    pub summary: String,
    pub location: Option<String>,
    pub description: Option<String>,
    /// Raw DTSTART/DTEND values with their TZID (if any); the card formats them.
    pub dtstart: Option<String>,
    pub dtend: Option<String>,
    pub tzid: Option<String>,
    pub all_day: bool,
    pub organizer: Option<Attendee>,
    pub attendees: Vec<Attendee>,
    /// REQUEST with an organizer and a UID: Accept/Maybe/Decline can reply.
    pub can_rsvp: bool,
    pub cancelled: bool,
}

/// RFC 5545 §3.1: a line starting with space or tab continues the previous one.
fn unfold(ics: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for raw in ics.split('\n') {
        let line = raw.strip_suffix('\r').unwrap_or(raw);
        if (line.starts_with(' ') || line.starts_with('\t')) && !out.is_empty() {
            out.last_mut().unwrap().push_str(&line[1..]);
        } else if !line.is_empty() {
            out.push(line.to_string());
        }
    }
    out
}

/// Splits `NAME;P1=v;P2="v":value`, honoring quoted parameter values.
fn split_line(line: &str) -> Option<(String, Vec<(String, String)>, String)> {
    let mut in_q = false;
    let mut colon = None;
    for (i, c) in line.char_indices() {
        match c {
            '"' => in_q = !in_q,
            ':' if !in_q => {
                colon = Some(i);
                break;
            }
            _ => {}
        }
    }
    let colon = colon?;
    let (head, value) = (&line[..colon], &line[colon + 1..]);
    let mut parts = head.split(';');
    let name = parts.next()?.trim().to_ascii_uppercase();
    let params = parts
        .filter_map(|p| {
            let (k, v) = p.split_once('=')?;
            Some((
                k.trim().to_ascii_uppercase(),
                v.trim_matches('"').to_string(),
            ))
        })
        .collect();
    Some((name, params, value.to_string()))
}

fn unescape(v: &str) -> String {
    v.replace("\\n", "\n")
        .replace("\\N", "\n")
        .replace("\\,", ",")
        .replace("\\;", ";")
        .replace("\\\\", "\\")
}

/// Drops every control character (CR, LF, NUL, ...). The bool says one was found.
fn strip_controls(v: &str) -> (String, bool) {
    let clean: String = v.chars().filter(|c| !c.is_control()).collect();
    let hit = clean.len() != v.len();
    (clean, hit)
}

/// A plain RFC 5322 addr-spec (`local@domain`, dot-atom both sides): no
/// whitespace, quotes, brackets or separators that could break out of a
/// `mailto:` value in the REPLY.
fn is_addr_spec(s: &str) -> bool {
    let Some((local, domain)) = s.split_once('@') else {
        return false;
    };
    let atext = |c: char| c.is_ascii_alphanumeric() || "!#$%&'*+-/=?^_`{|}~".contains(c);
    let dot_atom = |p: &str, ok: &dyn Fn(char) -> bool| {
        !p.is_empty() && p.split('.').all(|seg| !seg.is_empty() && seg.chars().all(ok))
    };
    local.len() <= 64
        && domain.len() <= 253
        && dot_atom(local, &atext)
        && dot_atom(domain, &|c: char| c.is_ascii_alphanumeric() || c == '-')
}

/// DATE / DATE-TIME value characters only (`20261110T100000Z`).
fn is_date_value(s: &str) -> bool {
    !s.is_empty() && s.len() <= 16 && s.chars().all(|c| c.is_ascii_digit() || c == 'T' || c == 'Z')
}

fn person(params: &[(String, String)], value: &str) -> Option<Attendee> {
    let (value, hit) = strip_controls(value);
    if hit {
        return None;
    }
    let v = value.trim();
    let email = v
        .strip_prefix("mailto:")
        .or_else(|| v.strip_prefix("MAILTO:"))
        .unwrap_or(v)
        .trim()
        .to_string();
    if !is_addr_spec(&email) {
        return None;
    }
    let get = |k: &str| {
        params
            .iter()
            .find(|(n, _)| n == k)
            .map(|(_, v)| strip_controls(v).0)
    };
    Some(Attendee {
        email,
        name: get("CN"),
        partstat: get("PARTSTAT").map(|s| s.to_ascii_uppercase()),
    })
}

/// Parses the first VEVENT of an ICS body. `None` only when there is no VEVENT.
pub fn parse_invite(ics: &str) -> Option<Invite> {
    let lines = unfold(ics);
    let mut method = None;
    let mut in_event = false;
    let mut seen_event = false;
    let mut inv = Invite {
        method: None,
        uid: None,
        sequence: 0,
        summary: String::new(),
        location: None,
        description: None,
        dtstart: None,
        dtend: None,
        tzid: None,
        all_day: false,
        organizer: None,
        attendees: Vec::new(),
        can_rsvp: false,
        cancelled: false,
    };
    let mut nested = 0u32;
    // A control character or malformed value in a field the REPLY echoes.
    let mut hostile = false;
    for line in &lines {
        let Some((name, params, value)) = split_line(line) else {
            continue;
        };
        match (name.as_str(), value.trim().to_ascii_uppercase().as_str()) {
            ("BEGIN", "VEVENT") if !seen_event => {
                in_event = true;
                seen_event = true;
                continue;
            }
            ("END", "VEVENT") if in_event => {
                in_event = false;
                continue;
            }
            ("BEGIN", _) if in_event => {
                nested += 1;
                continue;
            }
            ("END", _) if in_event && nested > 0 => {
                nested -= 1;
                continue;
            }
            _ => {}
        }
        if !in_event {
            if name == "METHOD" {
                method = Some(value.trim().to_ascii_uppercase());
            }
            continue;
        }
        if nested > 0 {
            continue; // VALARM and friends
        }
        let param = |k: &str| params.iter().find(|(n, _)| n == k).map(|(_, v)| v.clone());
        match name.as_str() {
            "UID" => {
                let (v, hit) = strip_controls(value.trim());
                hostile |= hit || v.is_empty();
                inv.uid = Some(v);
            }
            "SEQUENCE" => inv.sequence = value.trim().parse().unwrap_or(0),
            "SUMMARY" => inv.summary = unescape(&value),
            "LOCATION" => inv.location = Some(unescape(&value)).filter(|s| !s.is_empty()),
            "DESCRIPTION" => inv.description = Some(unescape(&value)).filter(|s| !s.is_empty()),
            "DTSTART" => {
                inv.all_day = param("VALUE").is_some_and(|v| v.eq_ignore_ascii_case("DATE"))
                    || value.trim().len() == 8;
                inv.tzid = param("TZID").map(|t| {
                    let (t, hit) = strip_controls(&t);
                    hostile |= hit || t.contains(['"', ';', ':', ',']);
                    t
                });
                let (v, hit) = strip_controls(value.trim());
                hostile |= hit || !is_date_value(&v);
                inv.dtstart = Some(v);
            }
            "DTEND" => {
                let (v, hit) = strip_controls(value.trim());
                hostile |= hit || !is_date_value(&v);
                inv.dtend = Some(v);
            }
            "STATUS" if value.trim().eq_ignore_ascii_case("CANCELLED") => inv.cancelled = true,
            "ORGANIZER" => {
                inv.organizer = person(&params, &value);
                hostile |= inv.organizer.is_none();
            }
            "ATTENDEE" => {
                if let Some(a) = person(&params, &value) {
                    inv.attendees.push(a);
                }
            }
            _ => {}
        }
    }
    if !seen_event {
        return None;
    }
    if method.as_deref() == Some("CANCEL") {
        inv.cancelled = true;
    }
    inv.can_rsvp = method.as_deref() == Some("REQUEST")
        && inv.organizer.is_some()
        && inv.uid.is_some()
        && inv.dtstart.is_some()
        && !inv.cancelled
        && !hostile;
    inv.method = method;
    Some(inv)
}

/// The attendee's answer (RFC 5546 §3.2.3 PARTSTAT).
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Rsvp {
    Accept,
    Maybe,
    Decline,
}

impl Rsvp {
    pub fn partstat(self) -> &'static str {
        match self {
            Rsvp::Accept => "ACCEPTED",
            Rsvp::Maybe => "TENTATIVE",
            Rsvp::Decline => "DECLINED",
        }
    }
    /// The subject prefix Outlook, Gmail and Apple Calendar all use.
    pub fn subject_prefix(self) -> &'static str {
        match self {
            Rsvp::Accept => "Accepted",
            Rsvp::Maybe => "Tentative",
            Rsvp::Decline => "Declined",
        }
    }
}

/// RFC 5545 §3.3.11 TEXT escaping; other control characters are dropped.
fn escape(v: &str) -> String {
    let v: String = v
        .replace("\r\n", "\n")
        .replace('\r', "\n")
        .chars()
        .filter(|c| *c == '\n' || !c.is_control())
        .collect();
    v.replace('\\', "\\\\")
        .replace(';', "\\;")
        .replace(',', "\\,")
        .replace('\n', "\\n")
}

/// RFC 5545 §3.1: lines longer than 75 octets fold with CRLF + space, never
/// inside a UTF-8 sequence.
fn fold(line: &str, out: &mut String) {
    let mut n = 0;
    for c in line.chars() {
        let w = c.len_utf8();
        if n + w > 75 {
            out.push_str("\r\n ");
            n = 1;
        }
        out.push(c);
        n += w;
    }
    out.push_str("\r\n");
}

fn quote_param(v: &str) -> String {
    let clean: String = v.chars().filter(|c| *c != '"' && !c.is_control()).collect();
    if clean.contains([':', ';', ',']) {
        format!("\"{clean}\"")
    } else {
        clean
    }
}

/// Builds the iTIP `METHOD:REPLY` (RFC 5546 §3.2.3) for `me` answering `inv`.
/// It carries only the replying attendee, the event's UID, SEQUENCE and
/// DTSTART, and the organizer, which is what every major calendar matches on.
/// `dtstamp` is UTC `YYYYMMDDTHHMMSSZ`.
pub fn itip_reply(
    inv: &Invite,
    me_email: &str,
    me_name: Option<&str>,
    answer: Rsvp,
    dtstamp: &str,
) -> Result<String, String> {
    if !inv.can_rsvp {
        return Err("invite_not_rsvpable".into());
    }
    let (Some(org), Some(uid), Some(start)) = (&inv.organizer, &inv.uid, &inv.dtstart) else {
        return Err("invite_not_rsvpable".into());
    };
    // Defense in depth: an Invite built elsewhere still can't inject lines.
    let me_email = me_email.trim();
    let dates_ok = is_date_value(start) && inv.dtend.as_deref().is_none_or(is_date_value);
    let tz_ok = inv.tzid.as_deref().is_none_or(|t| !strip_controls(t).1);
    if !is_addr_spec(&org.email) || !is_addr_spec(me_email) || !dates_ok || !tz_ok || strip_controls(uid).1 {
        return Err("invite_not_rsvpable".into());
    }
    let date_prop = |name: &str, v: &str| {
        if inv.all_day {
            format!("{name};VALUE=DATE:{v}")
        } else if let Some(tz) = &inv.tzid {
            format!("{name};TZID={}:{v}", quote_param(tz))
        } else {
            format!("{name}:{v}")
        }
    };
    let mut lines = vec![
        "BEGIN:VCALENDAR".to_string(),
        "PRODID:-//Moduo//Mail//EN".into(),
        "VERSION:2.0".into(),
        "METHOD:REPLY".into(),
        "BEGIN:VEVENT".into(),
        format!("UID:{}", escape(uid)),
        format!("SEQUENCE:{}", inv.sequence),
        format!("DTSTAMP:{dtstamp}"),
        date_prop("DTSTART", start),
    ];
    if let Some(end) = &inv.dtend {
        lines.push(date_prop("DTEND", end));
    }
    if !inv.summary.is_empty() {
        lines.push(format!("SUMMARY:{}", escape(&inv.summary)));
    }
    let org_cn = org
        .name
        .as_deref()
        .map(|n| format!(";CN={}", quote_param(n)))
        .unwrap_or_default();
    lines.push(format!("ORGANIZER{org_cn}:mailto:{}", org.email));
    let me_cn = me_name
        .filter(|n| !n.trim().is_empty())
        .map(|n| format!(";CN={}", quote_param(n)))
        .unwrap_or_default();
    lines.push(format!(
        "ATTENDEE{me_cn};PARTSTAT={}:mailto:{}",
        answer.partstat(),
        me_email
    ));
    lines.push("END:VEVENT".into());
    lines.push("END:VCALENDAR".into());
    let mut out = String::new();
    for l in &lines {
        fold(l, &mut out);
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    const REQ: &str = "BEGIN:VCALENDAR\r\nMETHOD:REQUEST\r\nBEGIN:VTIMEZONE\r\nTZID:Europe/Warsaw\r\nBEGIN:STANDARD\r\nDTSTART:19701025T030000\r\nEND:STANDARD\r\nEND:VTIMEZONE\r\nBEGIN:VEVENT\r\nUID:abc@x\r\nSEQUENCE:2\r\nSUMMARY:Design review\\, round 2\r\nDTSTART;TZID=Europe/Warsaw:20261110T100000\r\nDTEND;TZID=Europe/Warsaw:20261110T110000\r\nLOCATION:Room 4\r\nORGANIZER;CN=\"Anna: PM\":mailto:anna@x.test\r\nATTENDEE;CN=Me;PARTSTAT=NEEDS-ACTION:mailto:me@x.test\r\nATTENDEE;PARTSTAT=accepted:mailto:bob@x.\r\n test\r\nBEGIN:VALARM\r\nSUMMARY:not the title\r\nEND:VALARM\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";

    #[test]
    fn parses_request() {
        let i = parse_invite(REQ).unwrap();
        assert_eq!(i.method.as_deref(), Some("REQUEST"));
        assert_eq!(i.uid.as_deref(), Some("abc@x"));
        assert_eq!(i.sequence, 2);
        assert_eq!(i.summary, "Design review, round 2");
        assert_eq!(i.tzid.as_deref(), Some("Europe/Warsaw"));
        assert_eq!(i.dtstart.as_deref(), Some("20261110T100000"));
        assert!(!i.all_day);
        let org = i.organizer.unwrap();
        assert_eq!(org.email, "anna@x.test");
        assert_eq!(org.name.as_deref(), Some("Anna: PM"));
        assert_eq!(i.attendees.len(), 2);
        assert_eq!(i.attendees[1].email, "bob@x.test");
        assert_eq!(i.attendees[1].partstat.as_deref(), Some("ACCEPTED"));
        assert!(i.can_rsvp);
    }

    #[test]
    fn no_organizer_or_malformed_means_no_rsvp() {
        let no_org = REQ.replace("ORGANIZER;CN=\"Anna: PM\":mailto:anna@x.test\r\n", "");
        let i = parse_invite(&no_org).unwrap();
        assert!(i.organizer.is_none());
        assert!(!i.can_rsvp);

        let publish = REQ.replace("METHOD:REQUEST", "METHOD:PUBLISH");
        assert!(!parse_invite(&publish).unwrap().can_rsvp);

        let cancel = REQ.replace("METHOD:REQUEST", "METHOD:CANCEL");
        assert!(parse_invite(&cancel).unwrap().cancelled);

        assert!(parse_invite("BEGIN:VCALENDAR\nEND:VCALENDAR").is_none());
        assert!(parse_invite("garbage\n:::\n;;;").is_none());
        let broken = parse_invite(
            "BEGIN:VEVENT\nSUMMARY:x\nDTSTART;VALUE=DATE:20261110\nATTENDEE:not-an-email",
        )
        .unwrap();
        assert!(broken.all_day && !broken.can_rsvp && broken.attendees.is_empty());
    }

    #[test]
    fn hostile_invites_get_no_rsvp() {
        let cases = [
            REQ.replace("UID:abc@x", "UID:abc@x\rATTENDEE:mailto:evil@x.test"),
            REQ.replace("UID:abc@x", "UID:abc\u{0}@x"),
            REQ.replace(":20261110T100000\r\n", ":20261110T100000\rMETHOD:CANCEL\r\n"),
            REQ.replace(":20261110T110000", ":2026;X=1"),
            REQ.replace("TZID=Europe/Warsaw:20261110T100000", "TZID=\"Eu\rX:Y\":20261110T100000"),
            REQ.replace("mailto:anna@x.test", "mailto:anna@x.test\rBCC:x"),
            REQ.replace("mailto:anna@x.test", "mailto:anna@x.test>,evil@y.test"),
            REQ.replace("mailto:anna@x.test", "mailto:an na@x.test"),
            REQ.replace("mailto:anna@x.test", "mailto:\"a\"@x.test"),
            REQ.replace("mailto:anna@x.test", "mailto:@x.test"),
        ];
        for c in &cases {
            let i = parse_invite(c).unwrap();
            assert!(!i.can_rsvp, "should not rsvp: {c:?}");
            assert!(itip_reply(&i, "me@x.test", None, Rsvp::Accept, "20261104T120000Z").is_err());
        }
        // A hand-built Invite with a CRLF in a field is refused at reply time too.
        let mut i = parse_invite(REQ).unwrap();
        i.uid = Some("a\r\nX:y".into());
        assert!(itip_reply(&i, "me@x.test", None, Rsvp::Accept, "20261104T120000Z").is_err());
        let i = parse_invite(REQ).unwrap();
        assert!(itip_reply(&i, "me@x.test\r\nX:y", None, Rsvp::Accept, "z").is_err());
    }

    #[test]
    fn reply_escapes_text_and_strips_controls() {
        let mut i = parse_invite(REQ).unwrap();
        i.summary = "a;b,c\\d\r\nEND:VEVENT\u{7}".into();
        let r = itip_reply(&i, "me@x.test", Some("Me\r\nX"), Rsvp::Accept, "20261104T120000Z").unwrap();
        assert!(r.contains("SUMMARY:a\\;b\\,c\\\\d\\nEND:VEVENT\r\n"));
        assert!(r.contains("ATTENDEE;CN=MeX;"));
        assert!(!r.split("\r\n").any(|l| l.contains('\r') || l.contains('\n')));
        assert_eq!(r.matches("END:VEVENT").count(), 2); // one escaped in SUMMARY text
        assert_eq!(r.lines().filter(|l| l.starts_with("END:VEVENT")).count(), 1);
    }

    #[test]
    fn itip_reply_partstat() {
        let i = parse_invite(REQ).unwrap();
        for (a, ps) in [
            (Rsvp::Accept, "ACCEPTED"),
            (Rsvp::Maybe, "TENTATIVE"),
            (Rsvp::Decline, "DECLINED"),
        ] {
            let r = itip_reply(&i, "me@x.test", Some("Me, Myself"), a, "20261104T120000Z").unwrap();
            assert!(r.contains("METHOD:REPLY\r\n"));
            assert!(r.contains("UID:abc@x\r\n"));
            assert!(r.contains("SEQUENCE:2\r\n"));
            assert!(r.contains("DTSTART;TZID=Europe/Warsaw:20261110T100000\r\n"));
            assert!(r.contains("ORGANIZER;CN=\"Anna: PM\":mailto:anna@x.test"));
            assert!(r.contains(&format!(
                "ATTENDEE;CN=\"Me, Myself\";PARTSTAT={ps}:mailto:me@x.test"
            )));
            assert!(r.contains("SUMMARY:Design review\\, round 2"));
            // Only the replying attendee, never the others.
            assert!(!r.contains("bob@x.test"));
            assert!(r.lines().all(|l| l.trim_end_matches('\r').len() <= 75));
            // The reply parses back as a REPLY with our PARTSTAT.
            let back = parse_invite(&r).unwrap();
            assert_eq!(back.method.as_deref(), Some("REPLY"));
            assert_eq!(back.attendees[0].partstat.as_deref(), Some(ps));
        }
        let mut no = i.clone();
        no.can_rsvp = false;
        assert!(itip_reply(&no, "me@x.test", None, Rsvp::Accept, "x").is_err());

        let long = REQ.replace("Design review\\, round 2", &"Very long title ".repeat(10));
        let r = itip_reply(&parse_invite(&long).unwrap(), "me@x.test", None, Rsvp::Accept, "20261104T120000Z").unwrap();
        assert!(r.lines().all(|l| l.trim_end_matches('\r').len() <= 75));
        assert!(parse_invite(&r).unwrap().summary.starts_with("Very long title Very"));
    }
}
