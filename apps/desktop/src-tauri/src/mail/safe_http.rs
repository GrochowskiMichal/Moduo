//! The one HTTP client mail uses for URLs that come from a sender (RFC 8058
//! unsubscribe POSTs and sender logos). A hostile message must not be able to
//! make the app talk to this Mac, the LAN or a cloud metadata service:
//!
//! - https only, no redirects (a 3xx is an answer, never followed), no proxy;
//! - a DNS resolver that drops loopback, private, link-local, ULA, CGNAT,
//!   metadata and other non-public addresses. The filter runs on the addresses
//!   the connection actually uses, so a DNS rebind between a check and the
//!   connect can't slip through;
//! - IP-literal hosts never reach the resolver, so `check_url` refuses them.

use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr, ToSocketAddrs};
use std::sync::{Arc, OnceLock};
use std::time::Duration;

use reqwest::dns::{Addrs, Name, Resolve, Resolving};

/// True for any address a sender-supplied URL must never reach.
pub fn is_blocked_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => is_blocked_v4(v4),
        IpAddr::V6(v6) => {
            if let Some(v4) = v6.to_ipv4_mapped() {
                return is_blocked_v4(v4);
            }
            let s = v6.segments();
            v6.is_loopback()
                || v6.is_unspecified()
                || v6.is_multicast()
                || (s[0] & 0xfe00) == 0xfc00 // ULA fc00::/7
                || (s[0] & 0xffc0) == 0xfe80 // link-local fe80::/10
                || (s[0] & 0xffc0) == 0xfec0 // site-local fec0::/10
                || (s[0] == 0x64 && s[1] == 0xff9b) // NAT64 64:ff9b::/96 (embeds v4)
                || (s[0] == 0x2001 && s[1] == 0x0db8) // documentation
                || (s[0] == 0x2002) // 6to4 (embeds v4)
                || (s[0] == 0 && s[1] == 0 && s[2] == 0 && s[3] == 0 && s[4] == 0 && s[5] == 0) // v4-compatible
                || v6 == Ipv6Addr::new(0xfd00, 0x0ec2, 0, 0, 0, 0, 0, 0x0254) // AWS IMDS v6
        }
    }
}

fn is_blocked_v4(ip: Ipv4Addr) -> bool {
    let o = ip.octets();
    ip.is_loopback()
        || ip.is_private()
        || ip.is_link_local() // 169.254/16, incl. 169.254.169.254 metadata
        || ip.is_unspecified()
        || ip.is_broadcast()
        || ip.is_multicast()
        || ip.is_documentation()
        || o[0] == 0 // 0/8
        || (o[0] == 100 && (o[1] & 0xc0) == 64) // CGNAT 100.64/10
        || (o[0] == 192 && o[1] == 0 && o[2] == 0) // IETF 192.0.0/24
        || (o[0] == 198 && (o[1] & 0xfe) == 18) // benchmarking 198.18/15
        || o[0] >= 240 // reserved 240/4
}

/// The URL is https with a DNS name (an IP-literal host would bypass the resolver).
pub fn check_url(url: &str) -> Result<url::Url, String> {
    let u = url::Url::parse(url).map_err(|_| "invalid_url".to_string())?;
    if u.scheme() != "https" {
        return Err("https_only".into());
    }
    match u.host() {
        Some(url::Host::Domain(d)) if !d.is_empty() => {
            let d = d.trim_end_matches('.').to_ascii_lowercase();
            if d == "localhost" || d.ends_with(".localhost") {
                return Err("blocked_host".into());
            }
            Ok(u)
        }
        Some(_) => Err("blocked_host".into()),
        None => Err("invalid_url".into()),
    }
}

/// Keeps only public addresses; none left is an error so the connect fails.
pub fn filter_addrs(
    addrs: impl IntoIterator<Item = SocketAddr>,
) -> Result<Vec<SocketAddr>, String> {
    let ok: Vec<SocketAddr> = addrs
        .into_iter()
        .filter(|a| !is_blocked_ip(a.ip()))
        .collect();
    if ok.is_empty() {
        Err("blocked_address".into())
    } else {
        Ok(ok)
    }
}

/// The resolver behind `client()`: system lookup, then `filter_addrs`.
#[derive(Debug, Default)]
pub struct PublicOnlyResolver;

impl Resolve for PublicOnlyResolver {
    fn resolve(&self, name: Name) -> Resolving {
        let host = name.as_str().to_string();
        Box::pin(async move {
            let found = tokio::task::spawn_blocking(move || {
                (host.as_str(), 0u16)
                    .to_socket_addrs()
                    .map(|i| i.collect::<Vec<_>>())
            })
            .await
            .map_err(|e| -> Box<dyn std::error::Error + Send + Sync> { e.to_string().into() })?
            .map_err(|e| -> Box<dyn std::error::Error + Send + Sync> { Box::new(e) })?;
            let ok = filter_addrs(found)
                .map_err(|e| -> Box<dyn std::error::Error + Send + Sync> { e.into() })?;
            let addrs: Addrs = Box::new(ok.into_iter());
            Ok(addrs)
        })
    }
}

/// No redirects, no proxy, a short timeout. `client()` adds the rest.
pub(crate) fn base_builder() -> reqwest::ClientBuilder {
    reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .no_proxy()
        .connect_timeout(Duration::from_secs(5))
        .timeout(Duration::from_secs(15))
}

/// The shared SSRF-safe client: https only, public addresses only, no redirects.
pub fn client() -> Result<reqwest::Client, String> {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    if let Some(c) = CLIENT.get() {
        return Ok(c.clone());
    }
    let c = base_builder()
        .https_only(true)
        .dns_resolver(Arc::new(PublicOnlyResolver))
        .build()
        .map_err(|e| e.to_string())?;
    Ok(CLIENT.get_or_init(|| c).clone())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ip(s: &str) -> IpAddr {
        s.parse().unwrap()
    }

    #[test]
    fn blocks_non_public_addresses() {
        for s in [
            "127.0.0.1",
            "10.1.2.3",
            "172.16.0.1",
            "192.168.1.1",
            "169.254.169.254",
            "100.64.0.1",
            "100.127.255.255",
            "0.0.0.0",
            "255.255.255.255",
            "224.0.0.1",
            "::1",
            "::",
            "fc00::1",
            "fd00:ec2::254",
            "fe80::1",
            "::ffff:127.0.0.1",
            "::ffff:169.254.169.254",
            "64:ff9b::a00:1",
        ] {
            assert!(is_blocked_ip(ip(s)), "{s} must be blocked");
        }
        for s in ["93.184.216.34", "1.1.1.1", "100.128.0.1", "2606:4700::1111"] {
            assert!(!is_blocked_ip(ip(s)), "{s} is public");
        }
    }

    #[test]
    fn url_check_wants_https_and_a_name() {
        assert!(check_url("https://list.example.com/u?x=1").is_ok());
        assert_eq!(check_url("http://example.com/").unwrap_err(), "https_only");
        assert_eq!(check_url("https://127.0.0.1/").unwrap_err(), "blocked_host");
        assert_eq!(check_url("https://[::1]/").unwrap_err(), "blocked_host");
        assert_eq!(check_url("https://8.8.8.8/").unwrap_err(), "blocked_host");
        assert_eq!(check_url("https://localhost/").unwrap_err(), "blocked_host");
        assert_eq!(
            check_url("https://a.localhost./").unwrap_err(),
            "blocked_host"
        );
        assert!(check_url("file:///etc/passwd").is_err());
    }

    #[test]
    fn filter_drops_private_and_fails_when_empty() {
        let a: SocketAddr = "10.0.0.1:0".parse().unwrap();
        let b: SocketAddr = "93.184.216.34:0".parse().unwrap();
        assert_eq!(filter_addrs([a, b]).unwrap(), vec![b]);
        assert!(filter_addrs([a]).is_err());
    }

    #[tokio::test]
    async fn resolver_refuses_a_name_that_points_at_loopback() {
        // `localhost` resolves to 127.0.0.1/::1, the same as a rebinding name would.
        let r = PublicOnlyResolver
            .resolve("localhost".parse().unwrap())
            .await;
        assert!(r.is_err());
    }

    #[tokio::test]
    async fn client_refuses_http_and_loopback() {
        let c = client().unwrap();
        assert!(c.get("http://example.com/").send().await.is_err());
        assert!(c.get("https://localhost/").send().await.is_err());
    }
}
