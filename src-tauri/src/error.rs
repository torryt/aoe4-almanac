use serde::Serialize;

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("sqlite: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("http: {0}")]
    Http(#[from] reqwest::Error),
    #[error("json: {0}")]
    Json(#[from] serde_json::Error),
    #[error("{0}")]
    Msg(String),
}

impl AppError {
    pub fn msg(s: impl Into<String>) -> Self {
        AppError::Msg(s.into())
    }
}

#[derive(Serialize)]
struct AppErrorPayload {
    code: &'static str,
    message: String,
}

impl Serialize for AppError {
    fn serialize<S: serde::Serializer>(&self, ser: S) -> Result<S::Ok, S::Error> {
        let code = match self {
            AppError::Sqlite(_) => "sqlite",
            AppError::Io(_) => "io",
            AppError::Http(_) => "http",
            AppError::Json(_) => "json",
            AppError::Msg(_) => "app",
        };
        AppErrorPayload { code, message: self.to_string() }.serialize(ser)
    }
}

pub type AppResult<T> = Result<T, AppError>;
