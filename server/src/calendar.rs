//! Calendar math — mirror of client/src/sim/calendar.ts. Shared vectors: docs/calendar-vectors.json.
use chrono::{Duration, LocalResult, NaiveDate, NaiveDateTime, NaiveTime, Offset, TimeZone};
use chrono_tz::Tz;

#[derive(Debug, Clone)]
pub struct CalConfig {
    pub start_date: NaiveDate,
    pub days: u32,
    pub tz: Tz,
    pub dawn: NaiveTime,
    pub inactive: Vec<NaiveDate>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct DayWindow {
    pub day: u32,
    pub date: NaiveDate,
    /// ms since epoch
    pub open: i64,
    pub dawn: i64,
}

/// UTC ms of a wall-clock time. Ambiguous → earlier instant; gap → shifted forward.
pub fn zoned_to_utc(date: NaiveDate, time: NaiveTime, tz: Tz) -> i64 {
    let naive = NaiveDateTime::new(date, time);
    match tz.from_local_datetime(&naive) {
        LocalResult::Single(t) => t.timestamp_millis(),
        LocalResult::Ambiguous(a, b) => a.timestamp_millis().min(b.timestamp_millis()),
        LocalResult::None => {
            // offset in effect before the transition
            let before = naive - Duration::hours(12);
            let off = tz.offset_from_utc_datetime(&before).fix().local_minus_utc() as i64;
            naive.and_utc().timestamp_millis() - off * 1000
        }
    }
}

pub fn active_dates(c: &CalConfig) -> Vec<NaiveDate> {
    let mut out = Vec::new();
    let mut d = c.start_date;
    let mut guard = 0;
    while (out.len() as u32) < c.days && guard < 2000 {
        if !c.inactive.contains(&d) {
            out.push(d);
        }
        d += Duration::days(1);
        guard += 1;
    }
    out
}

pub fn day_windows(c: &CalConfig) -> Vec<DayWindow> {
    let midnight = NaiveTime::from_hms_opt(0, 0, 0).unwrap();
    active_dates(c)
        .into_iter()
        .enumerate()
        .map(|(i, date)| DayWindow {
            day: i as u32 + 1,
            date,
            open: zoned_to_utc(date, midnight, c.tz),
            dawn: zoned_to_utc(date + Duration::days(1), c.dawn, c.tz),
        })
        .collect()
}

pub fn local_date(ts_ms: i64, tz: Tz) -> NaiveDate {
    tz.timestamp_millis_opt(ts_ms).unwrap().date_naive()
}

pub fn parse_config(v: &serde_json::Value) -> Result<CalConfig, String> {
    let s = |k: &str| v.get(k).and_then(|x| x.as_str()).ok_or_else(|| format!("missing {k}"));
    let start_date = NaiveDate::parse_from_str(s("startDate")?, "%Y-%m-%d").map_err(|_| "bad startDate")?;
    let days = v.get("days").and_then(|x| x.as_u64()).ok_or("missing days")? as u32;
    let tz: Tz = s("timeZone")?.parse().map_err(|_| "bad timeZone")?;
    let dawn = NaiveTime::parse_from_str(s("dawnTime")?, "%H:%M").map_err(|_| "bad dawnTime")?;
    let inactive = v
        .get("inactiveDates")
        .and_then(|x| x.as_array())
        .map(|a| a.iter().filter_map(|d| d.as_str().and_then(|d| NaiveDate::parse_from_str(d, "%Y-%m-%d").ok())).collect())
        .unwrap_or_default();
    Ok(CalConfig { start_date, days, tz, dawn, inactive })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shared_vectors() {
        let raw = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/../docs/calendar-vectors.json")).unwrap();
        let vectors: serde_json::Value = serde_json::from_str(&raw).unwrap();
        for v in vectors.as_array().unwrap() {
            let c = parse_config(&v["config"]).unwrap();
            let w = day_windows(&c);
            let exp = v["windows"].as_array().unwrap();
            assert_eq!(w.len(), exp.len());
            for (a, e) in w.iter().zip(exp) {
                assert_eq!(a.day as u64, e["day"].as_u64().unwrap());
                assert_eq!(a.date.format("%Y-%m-%d").to_string(), e["date"].as_str().unwrap());
                assert_eq!(a.open, e["open"].as_i64().unwrap(), "open {:?}", a);
                assert_eq!(a.dawn, e["dawn"].as_i64().unwrap(), "dawn {:?}", a);
            }
        }
    }
}
