//! Calendar invite parsing (MR-4, AC18 parse; decision 20). Reads the
//! `text/calendar` parts [`crate::mail::mime::parse`] collects into the event
//! card's fields. RSVP (the iTIP REPLY) is MR-6's. A missing organizer or a
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

fn person(params: &[(String, String)], value: &str) -> Option<Attendee> {
    let v = value.trim();
    let email = v
        .strip_prefix("mailto:")
        .or_else(|| v.strip_prefix("MAILTO:"))
        .unwrap_or(v)
        .trim()
        .to_string();
    if !email.contains('@') {
        return None;
    }
    let get = |k: &str| params.iter().find(|(n, _)| n == k).map(|(_, v)| v.clone());
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
            "UID" => inv.uid = Some(value.trim().to_string()),
            "SEQUENCE" => inv.sequence = value.trim().parse().unwrap_or(0),
            "SUMMARY" => inv.summary = unescape(&value),
            "LOCATION" => inv.location = Some(unescape(&value)).filter(|s| !s.is_empty()),
            "DESCRIPTION" => inv.description = Some(unescape(&value)).filter(|s| !s.is_empty()),
            "DTSTART" => {
                inv.all_day = param("VALUE").is_some_and(|v| v.eq_ignore_ascii_case("DATE"))
                    || value.trim().len() == 8;
                inv.tzid = param("TZID");
                inv.dtstart = Some(value.trim().to_string());
            }
            "DTEND" => inv.dtend = Some(value.trim().to_string()),
            "STATUS" if value.trim().eq_ignore_ascii_case("CANCELLED") => inv.cancelled = true,
            "ORGANIZER" => inv.organizer = person(&params, &value),
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
        && !inv.cancelled;
    inv.method = method;
    Some(inv)
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
}
