use crate::error::{AppError, AppResult};
use crate::seed::user_agent;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, VecDeque};
use std::sync::{Mutex, RwLock};
use std::thread::sleep;
use std::time::{Duration, Instant};

const BASE: &str = "https://aoe4world.com/api/v0";

// --- Raw types (matching the TS shapes) ---

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RawPlayerRef {
    #[serde(default)]
    pub result: Option<String>,
    #[serde(default)]
    pub civilization: Option<String>,
    #[serde(default)]
    pub civilization_randomized: Option<bool>,
    #[serde(default)]
    pub rating: Option<i64>,
    #[serde(default)]
    pub rating_diff: Option<i64>,
    #[serde(default)]
    pub mmr: Option<i64>,
    #[serde(default)]
    pub mmr_diff: Option<i64>,
    #[serde(default)]
    pub input_type: Option<String>,
    pub profile_id: i64,
    pub name: String,
    #[serde(default)]
    pub steam_id: Option<String>,
    #[serde(default)]
    pub country: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RawTeamMember {
    pub player: RawPlayerRef,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RawAoe4WorldGame {
    pub game_id: i64,
    pub started_at: String,
    #[serde(default)]
    pub updated_at: Option<String>,
    #[serde(default)]
    pub duration: Option<i64>,
    #[serde(default)]
    pub map: Option<String>,
    #[serde(default)]
    pub kind: Option<String>,
    #[serde(default)]
    pub leaderboard: Option<String>,
    #[serde(default)]
    pub mmr_leaderboard: Option<String>,
    #[serde(default)]
    pub season: Option<i64>,
    #[serde(default)]
    pub server: Option<String>,
    #[serde(default)]
    pub patch: Option<i64>,
    #[serde(default)]
    pub average_rating: Option<i64>,
    #[serde(default)]
    pub average_mmr: Option<i64>,
    #[serde(default)]
    pub ongoing: Option<bool>,
    #[serde(default)]
    pub just_finished: Option<bool>,
    pub teams: Vec<Vec<RawTeamMember>>,
    // Capture remaining fields for raw_payload storage
    #[serde(flatten)]
    pub extra: HashMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RawAvatars {
    #[serde(default)]
    pub small: Option<String>,
    #[serde(default)]
    pub medium: Option<String>,
    #[serde(default)]
    pub full: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RawAoe4WorldMode {
    #[serde(default)]
    pub rating: Option<i64>,
    #[serde(default)]
    pub max_rating: Option<i64>,
    #[serde(default)]
    pub max_rating_7d: Option<i64>,
    #[serde(default)]
    pub max_rating_1m: Option<i64>,
    #[serde(default)]
    pub rank: Option<i64>,
    #[serde(default)]
    pub rank_level: Option<String>,
    #[serde(default)]
    pub streak: Option<i64>,
    #[serde(default)]
    pub games_count: Option<i64>,
    #[serde(default)]
    pub wins_count: Option<i64>,
    #[serde(default)]
    pub losses_count: Option<i64>,
    #[serde(default)]
    pub win_rate: Option<f64>,
    #[serde(default)]
    pub last_game_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RawAoe4WorldPlayer {
    pub name: String,
    pub profile_id: i64,
    #[serde(default)]
    pub steam_id: Option<String>,
    #[serde(default)]
    pub country: Option<String>,
    #[serde(default)]
    pub avatars: Option<RawAvatars>,
    #[serde(default)]
    pub last_game_at: Option<String>,
    #[serde(default)]
    pub modes: Option<HashMap<String, RawAoe4WorldMode>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RawLeaderboardEntry {
    pub name: String,
    pub profile_id: i64,
    #[serde(default)]
    pub country: Option<String>,
    #[serde(default)]
    pub rank: Option<i64>,
    #[serde(default)]
    pub rating: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RawLeaderboardResponse {
    pub total_count: i64,
    pub page: i64,
    pub per_page: i64,
    pub count: i64,
    pub offset: i64,
    pub players: Vec<RawLeaderboardEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RawSearchResponse {
    pub total_count: i64,
    pub page: i64,
    pub per_page: i64,
    pub count: i64,
    pub offset: i64,
    pub players: Vec<RawAoe4WorldPlayer>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RawGamesResponse {
    pub total_count: i64,
    pub page: i64,
    pub per_page: i64,
    pub count: i64,
    pub offset: i64,
    #[serde(default)]
    pub filters: serde_json::Value,
    pub games: Vec<RawAoe4WorldGame>,
}

// --- Rate limiter ---

const MIN_GAP_MS: u64 = 250;
const WINDOW_MS: u64 = 60_000;
const MAX_PER_WINDOW: usize = 30;

struct RateState {
    last_call: Option<Instant>,
    call_times: VecDeque<Instant>,
}

static RATE: Mutex<RateState> = Mutex::new(RateState {
    last_call: None,
    call_times: VecDeque::new(),
});

// Serializes upstream calls so the rate limiter sees one request at a time.
static IN_FLIGHT: Mutex<()> = Mutex::new(());

fn pace() {
    loop {
        let sleep_for = {
            let mut st = RATE.lock().expect("rate poisoned");
            let now = Instant::now();
            while let Some(front) = st.call_times.front().copied() {
                if now.duration_since(front).as_millis() as u64 > WINDOW_MS {
                    st.call_times.pop_front();
                } else {
                    break;
                }
            }
            if let Some(last) = st.last_call {
                let since = now.duration_since(last).as_millis() as u64;
                if since < MIN_GAP_MS {
                    Some(Duration::from_millis(MIN_GAP_MS - since))
                } else if st.call_times.len() >= MAX_PER_WINDOW {
                    let earliest = *st.call_times.front().unwrap_or(&now);
                    let elapsed = now.duration_since(earliest).as_millis() as u64;
                    Some(Duration::from_millis(WINDOW_MS.saturating_sub(elapsed) + 50))
                } else {
                    st.last_call = Some(now);
                    st.call_times.push_back(now);
                    None
                }
            } else if st.call_times.len() >= MAX_PER_WINDOW {
                let earliest = *st.call_times.front().unwrap_or(&now);
                let elapsed = now.duration_since(earliest).as_millis() as u64;
                Some(Duration::from_millis(WINDOW_MS.saturating_sub(elapsed) + 50))
            } else {
                st.last_call = Some(now);
                st.call_times.push_back(now);
                None
            }
        };
        match sleep_for {
            Some(d) => sleep(d),
            None => return,
        }
    }
}

fn client() -> &'static reqwest::blocking::Client {
    use std::sync::OnceLock;
    static CLIENT: OnceLock<reqwest::blocking::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(60))
            .build()
            .expect("reqwest client")
    })
}

#[derive(Debug)]
struct HttpStatusError {
    status: u16,
    body: String,
}

fn rate_limited_get(url: &str) -> Result<serde_json::Value, HttpStatusError> {
    pace();
    let res = client()
        .get(url)
        .header("user-agent", user_agent())
        .header("accept", "application/json")
        .send();
    let res = match res {
        Ok(r) => r,
        Err(e) => {
            return Err(HttpStatusError {
                status: 0,
                body: e.to_string(),
            });
        }
    };
    let status = res.status().as_u16();
    if status == 429 || status >= 500 {
        let retry_after = res
            .headers()
            .get("retry-after")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.parse::<u64>().ok())
            .unwrap_or(0)
            * 1000;
        return Err(HttpStatusError {
            status,
            body: format!("retry_after_ms={retry_after}"),
        });
    }
    if !res.status().is_success() {
        return Err(HttpStatusError {
            status,
            body: res.text().unwrap_or_default(),
        });
    }
    res.json::<serde_json::Value>().map_err(|e| HttpStatusError {
        status: 0,
        body: format!("decode: {e}"),
    })
}

fn fetch_json_with_backoff(url: &str) -> AppResult<serde_json::Value> {
    let mut delay_ms: u64 = 5_000;
    let max_ms: u64 = 5 * 60_000;
    let mut last_err: Option<String> = None;
    for _ in 0..5 {
        match rate_limited_get(url) {
            Ok(v) => return Ok(v),
            Err(e) => {
                if e.status == 429 || (e.status >= 500 && e.status < 600) {
                    // Body may carry "retry_after_ms=N"
                    let retry_after_ms: u64 = e
                        .body
                        .strip_prefix("retry_after_ms=")
                        .and_then(|s| s.parse().ok())
                        .unwrap_or(0);
                    let sleep_for = if retry_after_ms > 0 { retry_after_ms } else { delay_ms };
                    sleep(Duration::from_millis(sleep_for));
                    delay_ms = (delay_ms * 2).min(max_ms);
                    last_err = Some(format!("{} {}", e.status, e.body));
                    continue;
                }
                return Err(AppError::msg(format!("aoe4world {}: {}", e.status, e.body)));
            }
        }
    }
    Err(AppError::msg(format!(
        "aoe4world: retry budget exhausted for {url} ({})",
        last_err.unwrap_or_default()
    )))
}

fn with_mutex<T>(f: impl FnOnce() -> AppResult<T>) -> AppResult<T> {
    let _guard = IN_FLIGHT.lock().expect("in-flight poisoned");
    f()
}

// --- Endpoints ---

pub fn search_players(query: &str) -> AppResult<RawSearchResponse> {
    let url = format!(
        "{BASE}/players/search?query={}",
        urlencode(query)
    );
    let v = with_mutex(|| fetch_json_with_backoff(&url))?;
    serde_json::from_value(v).map_err(|e| AppError::msg(format!("decode search: {e}")))
}

pub fn get_player(profile_id: i64) -> AppResult<RawAoe4WorldPlayer> {
    let url = format!("{BASE}/players/{profile_id}");
    let v = with_mutex(|| fetch_json_with_backoff(&url))?;
    serde_json::from_value(v).map_err(|e| AppError::msg(format!("decode player: {e}")))
}

const LEADERBOARD_PAGE_TTL_MS: u64 = 10 * 60_000;

struct CacheEntry {
    at: Instant,
    data: RawLeaderboardResponse,
}

static LEADERBOARD_CACHE: RwLock<Option<HashMap<String, CacheEntry>>> = RwLock::new(None);

pub fn get_leaderboard_page(
    leaderboard: &str,
    country: Option<&str>,
    page: Option<i64>,
) -> AppResult<RawLeaderboardResponse> {
    let mut params: Vec<(String, String)> = Vec::new();
    if let Some(c) = country {
        params.push(("country".into(), c.to_string()));
    }
    if let Some(p) = page {
        params.push(("page".into(), p.to_string()));
    }
    let qs = if params.is_empty() {
        String::new()
    } else {
        let parts: Vec<String> = params
            .iter()
            .map(|(k, v)| format!("{}={}", urlencode(k), urlencode(v)))
            .collect();
        format!("?{}", parts.join("&"))
    };
    let url = format!("{BASE}/leaderboards/{leaderboard}{qs}");
    let key = format!(
        "{}|{}|{}",
        leaderboard,
        country.unwrap_or(""),
        page.unwrap_or(1)
    );

    {
        let cache = LEADERBOARD_CACHE.read().unwrap();
        if let Some(map) = cache.as_ref() {
            if let Some(hit) = map.get(&key) {
                if hit.at.elapsed().as_millis() as u64 <= LEADERBOARD_PAGE_TTL_MS {
                    return Ok(hit.data.clone());
                }
            }
        }
    }

    let v = with_mutex(|| fetch_json_with_backoff(&url))?;
    let data: RawLeaderboardResponse =
        serde_json::from_value(v).map_err(|e| AppError::msg(format!("decode lb: {e}")))?;

    {
        let mut cache = LEADERBOARD_CACHE.write().unwrap();
        let map = cache.get_or_insert_with(HashMap::new);
        map.insert(
            key,
            CacheEntry {
                at: Instant::now(),
                data: data.clone(),
            },
        );
    }

    Ok(data)
}

#[derive(Default, Clone)]
pub struct GamesQueryArgs {
    pub leaderboard: Option<String>,
    pub since: Option<String>,
    pub updated_since: Option<String>,
    pub order: Option<String>,
    pub page: Option<i64>,
    pub limit: Option<i64>,
}

pub fn get_games_page(profile_id: i64, args: &GamesQueryArgs) -> AppResult<RawGamesResponse> {
    let mut params: Vec<(String, String)> = Vec::new();
    if let Some(v) = &args.leaderboard {
        params.push(("leaderboard".into(), v.clone()));
    }
    if let Some(v) = &args.since {
        params.push(("since".into(), v.clone()));
    }
    if let Some(v) = &args.updated_since {
        params.push(("updated_since".into(), v.clone()));
    }
    if let Some(v) = &args.order {
        params.push(("order".into(), v.clone()));
    }
    if let Some(v) = args.page {
        params.push(("page".into(), v.to_string()));
    }
    if let Some(v) = args.limit {
        params.push(("limit".into(), v.to_string()));
    }
    let qs = if params.is_empty() {
        String::new()
    } else {
        let parts: Vec<String> = params
            .iter()
            .map(|(k, v)| format!("{}={}", urlencode(k), urlencode(v)))
            .collect();
        format!("?{}", parts.join("&"))
    };
    let url = format!("{BASE}/players/{profile_id}/games{qs}");
    let v = with_mutex(|| fetch_json_with_backoff(&url))?;
    serde_json::from_value(v).map_err(|e| AppError::msg(format!("decode games: {e}")))
}

fn urlencode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char);
            }
            _ => {
                out.push('%');
                out.push_str(&format!("{:02X}", b));
            }
        }
    }
    out
}
