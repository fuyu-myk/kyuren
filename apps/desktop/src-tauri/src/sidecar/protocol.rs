use serde_json::Value;

pub enum Inbound {
    Response {
        id: String,
        result: Result<Value, Failure>,
    },
    Event {
        name: String,
        data: Value,
    },
    Malformed {
        reason: String,
    },
}

#[derive(Debug, Clone)]
pub struct Failure {
    pub code: String,
    pub message: String,
}

impl std::fmt::Display for Failure {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.code, self.message)
    }
}

pub fn parse(line: &str) -> Inbound {
    let Ok(Value::Object(fields)) = serde_json::from_str::<Value>(line) else {
        return Inbound::Malformed {
            reason: "line is not a JSON object".into(),
        };
    };

    if let Some(Value::String(name)) = fields.get("event") {
        return Inbound::Event {
            name: name.clone(),
            data: fields.get("data").cloned().unwrap_or(Value::Null),
        };
    }

    let (Some(Value::String(id)), Some(Value::Bool(ok))) = (fields.get("id"), fields.get("ok"))
    else {
        return Inbound::Malformed {
            reason: "message is neither an event nor a response".into(),
        };
    };

    if *ok {
        return Inbound::Response {
            id: id.clone(),
            result: Ok(fields.get("result").cloned().unwrap_or(Value::Null)),
        };
    }

    let body = fields.get("error").and_then(Value::as_object);
    let field = |key: &str| {
        body.and_then(|b| b.get(key))
            .and_then(Value::as_str)
            .unwrap_or("unknown")
            .to_string()
    };

    Inbound::Response {
        id: id.clone(),
        result: Err(Failure {
            code: field("code"),
            message: field("message"),
        }),
    }
}
