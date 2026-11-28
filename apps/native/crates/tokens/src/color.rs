//! Colours: CSS Color 4's oklch, oklab, sRGB and hsl, and `color-mix()`.
//!
//! Colours are kept as extended sRGB (channels may leave 0–1) until they are read, so a mix of a
//! wide colour comes out as the browser's does; `Rgba::clipped` is what is drawn.

/// An sRGB colour, 0–1 per channel, alpha 0–1.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Rgba {
    pub r: f32,
    pub g: f32,
    pub b: f32,
    pub a: f32,
}

impl Rgba {
    pub const TRANSPARENT: Rgba = Rgba {
        r: 0.0,
        g: 0.0,
        b: 0.0,
        a: 0.0,
    };

    /// Each channel into 0–1 (Chromium clips the same way when it paints).
    pub fn clipped(self) -> Rgba {
        let c = |v: f32| v.clamp(0.0, 1.0);
        Rgba {
            r: c(self.r),
            g: c(self.g),
            b: c(self.b),
            a: c(self.a),
        }
    }

    /// The same colour at `pct`% of its alpha (Tailwind's `bg-primary/90`).
    pub fn alpha(self, pct: f32) -> Rgba {
        Rgba {
            a: self.a * pct / 100.0,
            ..self
        }
    }
}

fn to_linear(v: f64) -> f64 {
    let a = v.abs();
    let l = if a <= 0.04045 {
        a / 12.92
    } else {
        ((a + 0.055) / 1.055).powf(2.4)
    };
    l.copysign(v)
}

fn from_linear(v: f64) -> f64 {
    let a = v.abs();
    let s = if a <= 0.0031308 {
        12.92 * a
    } else {
        1.055 * a.powf(1.0 / 2.4) - 0.055
    };
    s.copysign(v)
}

/// oklab (L 0–1) → extended sRGB.
pub fn oklab_to_rgb(l: f64, a: f64, b: f64, alpha: f64) -> Rgba {
    let l_ = l + 0.396_337_777_4 * a + 0.215_803_757_3 * b;
    let m_ = l - 0.105_561_345_8 * a - 0.063_854_172_8 * b;
    let s_ = l - 0.089_484_177_5 * a - 1.291_485_548 * b;
    let (l3, m3, s3) = (l_.powi(3), m_.powi(3), s_.powi(3));
    let r = 4.076_741_662_1 * l3 - 3.307_711_591_3 * m3 + 0.230_969_929_2 * s3;
    let g = -1.268_438_004_6 * l3 + 2.609_757_401_1 * m3 - 0.341_319_396_5 * s3;
    let bl = -0.004_196_086_3 * l3 - 0.703_418_614_7 * m3 + 1.707_614_701 * s3;
    Rgba {
        r: from_linear(r) as f32,
        g: from_linear(g) as f32,
        b: from_linear(bl) as f32,
        a: alpha as f32,
    }
}

/// Extended sRGB → oklab [L, a, b].
pub fn rgb_to_oklab(c: Rgba) -> [f64; 3] {
    let (r, g, b) = (
        to_linear(c.r.into()),
        to_linear(c.g.into()),
        to_linear(c.b.into()),
    );
    let l = 0.412_221_470_8 * r + 0.536_332_536_3 * g + 0.051_445_992_9 * b;
    let m = 0.211_903_498_2 * r + 0.680_699_545_1 * g + 0.107_396_956_6 * b;
    let s = 0.088_302_461_9 * r + 0.281_718_837_6 * g + 0.629_978_700_5 * b;
    let (l_, m_, s_) = (l.cbrt(), m.cbrt(), s.cbrt());
    [
        0.210_454_255_3 * l_ + 0.793_617_785 * m_ - 0.004_072_046_8 * s_,
        1.977_998_495_1 * l_ - 2.428_592_205 * m_ + 0.450_593_709_9 * s_,
        0.025_904_037_1 * l_ + 0.782_771_766_2 * m_ - 0.808_675_766 * s_,
    ]
}

pub fn oklch(l: f32, c: f32, h: f32, alpha: f32) -> Rgba {
    let (l, c, h) = (f64::from(l), f64::from(c), f64::from(h).to_radians());
    oklab_to_rgb(l, c * h.cos(), c * h.sin(), alpha.into())
}

pub fn rgb(r: f32, g: f32, b: f32, alpha: f32) -> Rgba {
    Rgba {
        r: r / 255.0,
        g: g / 255.0,
        b: b / 255.0,
        a: alpha,
    }
}

/// hsl(h, s%, l%) as CSS Color 4 defines it.
pub fn hsl(h: f32, s: f32, l: f32, alpha: f32) -> Rgba {
    let (s, l) = (s / 100.0, l / 100.0);
    let f = |n: f32| {
        let k = (n + h / 30.0).rem_euclid(12.0);
        let a = s * l.min(1.0 - l);
        l - a * (k - 3.0).min(9.0 - k).clamp(-1.0, 1.0)
    };
    Rgba {
        r: f(0.0),
        g: f(8.0),
        b: f(4.0),
        a: alpha,
    }
}

/// Chroma below this has no meaningful hue (CSS Color 4 calls the hue "powerless").
const ACHROMATIC: f64 = 2e-4;

/// `color-mix(in <space>, a pa%, b pb%)` with premultiplied alpha, as CSS Color 4 defines it.
/// Returns None for a space it does not know.
pub fn mix(space: &str, a: Rgba, pa: Option<f32>, b: Rgba, pb: Option<f32>) -> Option<Rgba> {
    let (pa, pb) = match (pa, pb) {
        (None, None) => (50.0, 50.0),
        (Some(p), None) => (p, 100.0 - p),
        (None, Some(p)) => (100.0 - p, p),
        (Some(x), Some(y)) => (x, y),
    };
    let sum = pa + pb;
    if sum <= 0.0 {
        return None;
    }
    // Percentages that add up to less than 100 also scale the result's alpha.
    let scale = if sum < 100.0 { sum / 100.0 } else { 1.0 };
    let (wa, wb) = (f64::from(pa / sum), f64::from(pb / sum));
    let (aa, ab) = (f64::from(a.a), f64::from(b.a));
    let alpha = aa * wa + ab * wb;
    let lab_a = rgb_to_oklab(a);
    let lab_b = rgb_to_oklab(b);
    let premix = |x: f64, y: f64| {
        if alpha == 0.0 {
            0.0
        } else {
            (x * aa * wa + y * ab * wb) / alpha
        }
    };
    let out = match space {
        "oklab" => oklab_to_rgb(
            premix(lab_a[0], lab_b[0]),
            premix(lab_a[1], lab_b[1]),
            premix(lab_a[2], lab_b[2]),
            alpha,
        ),
        "oklch" => {
            let polar = |lab: [f64; 3]| {
                let c = lab[1].hypot(lab[2]);
                let h =
                    (c > ACHROMATIC).then(|| lab[2].atan2(lab[1]).to_degrees().rem_euclid(360.0));
                (lab[0], c, h)
            };
            let (la, ca, ha) = polar(lab_a);
            let (lb, cb, hb) = polar(lab_b);
            // A missing hue takes the other colour's.
            let (mut h1, mut h2) = match (ha, hb) {
                (Some(x), Some(y)) => (x, y),
                (Some(x), None) => (x, x),
                (None, Some(y)) => (y, y),
                (None, None) => (0.0, 0.0),
            };
            // The shorter way round.
            if h2 - h1 > 180.0 {
                h1 += 360.0;
            } else if h2 - h1 < -180.0 {
                h2 += 360.0;
            }
            let (l, c) = (premix(la, lb), premix(ca, cb));
            let h = (h1 * wa + h2 * wb).to_radians();
            oklab_to_rgb(l, c * h.cos(), c * h.sin(), alpha)
        }
        "srgb" => {
            let to = |x: f32, y: f32| premix(x.into(), y.into()) as f32;
            Rgba {
                r: to(a.r, b.r),
                g: to(a.g, b.g),
                b: to(a.b, b.b),
                a: alpha as f32,
            }
        }
        _ => return None,
    };
    Some(Rgba {
        a: out.a * scale,
        ..out
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hue(c: Rgba) -> f64 {
        let lab = rgb_to_oklab(c);
        lab[2].atan2(lab[1]).to_degrees().rem_euclid(360.0)
    }

    #[test]
    fn oklch_mixes_take_the_shorter_way_round_the_hue() {
        let a = oklch(0.7, 0.1, 350.0, 1.0);
        let b = oklch(0.7, 0.1, 10.0, 1.0);
        for (x, y) in [(a, b), (b, a)] {
            let h = hue(mix("oklch", x, None, y, None).unwrap());
            assert!(!(5.0..355.0).contains(&h), "hue {h} went the long way");
        }
    }

    #[test]
    fn a_grey_takes_the_other_colours_hue() {
        let grey = oklch(0.7, 0.0, 0.0, 1.0);
        let blue = oklch(0.7, 0.1, 250.0, 1.0);
        let h = hue(mix("oklch", grey, None, blue, None).unwrap());
        assert!((h - 250.0).abs() < 0.5, "hue {h}");
    }

    #[test]
    fn percentages_under_100_scale_alpha() {
        let white = rgb(255.0, 255.0, 255.0, 1.0);
        let out = mix("oklab", white, Some(30.0), white, Some(20.0)).unwrap();
        assert!((out.a - 0.5).abs() < 1e-6);
    }

    #[test]
    fn round_trips_through_oklab() {
        let c = Rgba {
            r: 0.2,
            g: 0.5,
            b: 0.8,
            a: 1.0,
        };
        let [l, a, b] = rgb_to_oklab(c);
        let back = oklab_to_rgb(l, a, b, 1.0);
        assert!((back.r - c.r).abs() < 1e-5 && (back.b - c.b).abs() < 1e-5);
    }
}
