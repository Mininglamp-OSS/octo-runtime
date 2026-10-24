use bigdecimal::{BigDecimal, ToPrimitive};
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use serde_json::Value;
use std::str::FromStr;

#[derive(Debug, Clone)]
pub struct Error {
    pub code: String,
    pub data: Option<Value>,
    pub remote: bool,
}
impl Error {
    pub fn new(code: &str) -> Self {
        Self {
            code: code.into(),
            data: None,
            remote: false,
        }
    }
}
impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.code)
    }
}
impl std::error::Error for Error {}
impl From<serde_json::Error> for Error {
    fn from(_: serde_json::Error) -> Self {
        Self::new("INVALID_JSON")
    }
}
impl From<std::io::Error> for Error {
    fn from(_: std::io::Error) -> Self {
        Self::new("CONNECTION_CLOSED")
    }
}

/// Presence 保留缺省、显式 null 与零值；可空 T 由生成类型使用 Option<T>。
#[derive(Debug, Clone, Default)]
pub enum Presence<T> {
    #[default]
    Missing,
    Present(T),
}
impl<T> Presence<T> {
    pub fn is_missing(&self) -> bool {
        matches!(self, Self::Missing)
    }
}
impl<T: Serialize> Serialize for Presence<T> {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        match self {
            Self::Missing => s.serialize_unit(),
            Self::Present(v) => v.serialize(s),
        }
    }
}
impl<'de, T: Deserialize<'de>> Deserialize<'de> for Presence<T> {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        T::deserialize(d).map(Self::Present)
    }
}
pub fn decode<T: serde::de::DeserializeOwned>(name: &str, data: &[u8]) -> Result<T, Error> {
    let mut v: Value = serde_json::from_slice(data)?;
    crate::generated::rules::validate(name, &v)?;
    crate::generated::rules::normalize_integer_root(name, &mut v)?;
    Ok(from_value(v)?)
}

/// serde 的 flatten 中间值不能接收 Value deserializer 发出的 u128。
/// 经无损 JSON token 绑定开放模型，保留未知扩展中的大整数与小数。
pub fn from_value<T: serde::de::DeserializeOwned>(v: Value) -> Result<T, serde_json::Error> {
    serde_json::from_slice(&serde_json::to_vec(&v)?)
}

/// 仅用于 Schema 已知的整数槽位；不遍历 opaque Provider JSON。
pub fn integer(v: &Value) -> Result<i64, Error> {
    if !v.is_number() {
        return Err(bad());
    }
    let n = number(v)?;
    if !n.is_integer() {
        return Err(bad());
    }
    n.to_i64().ok_or_else(bad)
}
pub fn normalize_integers(v: &mut Value) -> Result<(), Error> {
    match v {
        Value::Number(_) => *v = Value::from(integer(v)?),
        Value::Array(a) => {
            for item in a {
                normalize_integers(item)?;
            }
        }
        _ => {}
    }
    Ok(())
}
pub fn deserialize_integers<'de, D: Deserializer<'de>, T: serde::de::DeserializeOwned>(
    d: D,
) -> Result<T, D::Error> {
    let mut v = Value::deserialize(d)?;
    normalize_integers(&mut v).map_err(serde::de::Error::custom)?;
    serde_json::from_value(v).map_err(serde::de::Error::custom)
}
pub fn json_equal(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::Number(_), Value::Number(_)) => {
            matches!((number(a),number(b)),(Ok(x),Ok(y)) if x == y)
        }
        (Value::Array(a), Value::Array(b)) => {
            a.len() == b.len() && a.iter().zip(b).all(|(x, y)| json_equal(x, y))
        }
        (Value::Object(a), Value::Object(b)) => {
            a.len() == b.len()
                && a.iter()
                    .all(|(k, x)| b.get(k).is_some_and(|y| json_equal(x, y)))
        }
        _ => a == b,
    }
}
pub fn encode<T: Serialize>(name: &str, v: &T) -> Result<Vec<u8>, Error> {
    let v = serde_json::to_value(v)?;
    crate::generated::rules::validate(name, &v)?;
    Ok(serde_json::to_vec(&v)?)
}
fn bad() -> Error {
    Error::new("VALIDATION_ERROR")
}
fn number(v: &Value) -> Result<BigDecimal, Error> {
    BigDecimal::from_str(&v.to_string()).map_err(|_| bad())
}
pub fn types(v: &Value, types: &[&str]) -> Result<(), Error> {
    if types.iter().any(|t| match *t {
        "object" => v.is_object(),
        "array" => v.is_array(),
        "string" => v.is_string(),
        "boolean" => v.is_boolean(),
        "null" => v.is_null(),
        "number" => v.is_number(),
        "integer" => v.is_number() && number(v).is_ok_and(|n| n.is_integer()),
        _ => false,
    }) {
        Ok(())
    } else {
        Err(bad())
    }
}
pub fn values(v: &Value, choices: &[&str]) -> Result<(), Error> {
    for s in choices {
        let other: Value = serde_json::from_str(s)?;
        if v == &other || (v.is_number() && other.is_number() && number(v)? == number(&other)?) {
            return Ok(());
        }
    }
    Err(bad())
}
pub fn constraint(v: &Value, key: &str, bound: i64) -> Result<(), Error> {
    let n = match key {
        "minimum" | "maximum" => {
            if !v.is_number() {
                return Ok(());
            }
            number(v)?
        }
        "minLength" | "maxLength" => {
            let Some(s) = v.as_str() else { return Ok(()) };
            BigDecimal::from(s.chars().count() as u64)
        }
        "minItems" | "maxItems" => {
            let Some(a) = v.as_array() else { return Ok(()) };
            BigDecimal::from(a.len() as u64)
        }
        _ => {
            let Some(m) = v.as_object() else {
                return Ok(());
            };
            BigDecimal::from(m.len() as u64)
        }
    };
    if (key.starts_with("min") && n < BigDecimal::from(bound))
        || (key.starts_with("max") && n > BigDecimal::from(bound))
    {
        Err(bad())
    } else {
        Ok(())
    }
}
pub fn pattern(v: &Value, pattern: &str) -> Result<(), Error> {
    if let Some(s) = v.as_str() {
        let re = regex::Regex::new(pattern).map_err(|_| Error::new("INVALID_COMPILED_PATTERN"))?;
        if !re.is_match(s) {
            return Err(bad());
        }
    };
    Ok(())
}
pub fn required(v: &Value, keys: &[&str]) -> Result<(), Error> {
    if let Some(m) = v.as_object() {
        if keys.iter().any(|k| !m.contains_key(*k)) {
            return Err(bad());
        }
    };
    Ok(())
}
pub fn unique(v: &Value) -> Result<(), Error> {
    if let Some(a) = v.as_array() {
        for (i, x) in a.iter().enumerate() {
            if a[..i].contains(x) {
                return Err(bad());
            }
        }
    };
    Ok(())
}
fn depth(v: &Value) -> usize {
    match v {
        Value::Array(a) => a.iter().map(depth).max().map_or(0, |n| n + 1),
        Value::Object(m) => m.values().map(depth).max().map_or(0, |n| n + 1),
        _ => 0,
    }
}
pub fn refinement(v: &Value, key: &str, limit: usize) -> Result<(), Error> {
    match key {
        "x-octo-unicode-scalar-strings" => {}
        "x-octo-max-json-bytes" => {
            if serde_json::to_vec(v)?.len() > limit {
                return Err(bad());
            }
        }
        "x-octo-max-json-depth" => {
            if depth(v) > limit {
                return Err(bad());
            }
        }
        "x-octo-max-utf8-bytes" => {
            if v.as_str().is_some_and(|s| s.len() > limit) {
                return Err(bad());
            }
        }
        "x-octo-max-utf16-length" => {
            if v.as_str().is_some_and(|s| s.encode_utf16().count() > limit) {
                return Err(bad());
            }
        }
        "x-octo-http-url" => {
            if let Some(s) = v.as_str() {
                let u = url::Url::parse(s).map_err(|_| bad())?;
                if !["http", "https"].contains(&u.scheme())
                    || u.host_str().is_none()
                    || !u.username().is_empty()
                    || u.password().is_some()
                {
                    return Err(bad());
                }
            }
        }
        "x-octo-unique-header-names" => {
            if let Some(m) = v.as_object() {
                let mut set = std::collections::HashSet::new();
                for k in m.keys() {
                    if !set.insert(k.to_lowercase()) {
                        return Err(bad());
                    }
                }
            }
        }
        "x-octo-unique-type-keys" | "x-octo-unique-env-keys" | "x-octo-unique-resource-refs" => {
            let (field, keys): (&str, &[&str]) = match key {
                "x-octo-unique-type-keys" => ("items", &["namespace", "name"]),
                "x-octo-unique-env-keys" => ("env_variables", &["key"]),
                _ => ("entries", &["resource_ref"]),
            };
            if let Some(a) = v[field].as_array() {
                let mut set = std::collections::HashSet::new();
                for x in a {
                    let values: Vec<_> = keys.iter().map(|k| &x[*k]).collect();
                    if !set.insert(serde_json::to_string(&values)?) {
                        return Err(bad());
                    }
                }
            }
        }
        "x-octo-matching-trigger-fields" => {
            if v["trigger_fact"]["message_id"] != v["trigger_message_id"]
                || v.get("trigger_seq").is_some() != v["trigger_fact"].get("message_seq").is_some()
                || v["trigger_seq"] != v["trigger_fact"]["message_seq"]
            {
                return Err(bad());
            }
        }
        "x-octo-runtime-selection-invariants" => {
            let a = v["authorized_candidates"].as_array().ok_or_else(bad)?;
            let mut ids = std::collections::HashSet::new();
            let mut priorities = std::collections::HashSet::new();
            for x in a {
                if !ids.insert(x["runtime_id"].as_str().ok_or_else(bad)?)
                    || !priorities.insert(x["priority"].to_string())
                {
                    return Err(bad());
                }
            }
            if v["selection_mode"] == "explicit" {
                if a.len() != 1
                    || v["failover"] != "none"
                    || !ids.contains(v["explicit_runtime_id"].as_str().ok_or_else(bad)?)
                {
                    return Err(bad());
                }
            } else if v.get("explicit_runtime_id").is_some() {
                return Err(bad());
            }
        }
        _ => return Err(Error::new("UNSUPPORTED_COMPILED_REFINEMENT")),
    };
    Ok(())
}
