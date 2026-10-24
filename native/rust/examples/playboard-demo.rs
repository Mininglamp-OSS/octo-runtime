//! 直接使用 Rust SDK 的 playboard；Kernel 必须已启动。stdout 保持 NDJSON。
use futures_util::StreamExt;
use octo_runtime_client::{generated::rules::validate, models, CancelToken, Client, Error};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    env, fs,
    io::{self, Read, Write},
    path::Path,
    time::Duration,
};

const MAX_INPUT: u64 = 32 * 1024 * 1024;
fn failure(code: &str) -> Error {
    Error::new(code)
}
fn read_json(path: &str) -> Result<Value, Error> {
    if path.is_empty() {
        return Err(failure("JSON_FILE_REQUIRED"));
    }
    let mut data = Vec::new();
    if path == "-" {
        io::stdin().take(MAX_INPUT + 1).read_to_end(&mut data)?;
    } else {
        fs::File::open(path)?
            .take(MAX_INPUT + 1)
            .read_to_end(&mut data)?;
    }
    if data.len() as u64 > MAX_INPUT {
        return Err(failure("INVOKE_REQUEST_TOO_LARGE"));
    }
    Ok(serde_json::from_slice(&data)?)
}
fn emit(value: &Value) -> Result<(), Error> {
    let mut out = io::stdout().lock();
    serde_json::to_writer(&mut out, value)?;
    out.write_all(b"\n")?;
    out.flush()?;
    Ok(())
}
fn duration(text: &str) -> Result<Duration, Error> {
    let (number, factor) = [("ms", 0.001), ("s", 1.0), ("m", 60.0), ("h", 3600.0)]
        .into_iter()
        .find_map(|(unit, factor)| text.strip_suffix(unit).map(|n| (n, factor)))
        .unwrap_or((text, 1.0));
    let seconds: f64 = number.parse().map_err(|_| failure("INVALID_DURATION"))?;
    Duration::try_from_secs_f64(seconds * factor).map_err(|_| failure("INVALID_DURATION"))
}
fn help() {
    println!("Native Octo Runtime playground (Rust)\n\n  playboard-demo status|list --endpoint SOCKET\n  playboard-demo playboard --endpoint SOCKET < request.json\n  playboard-demo playboard --endpoint SOCKET --prompt 'Reply with OK' --adapter codex\n  playboard-demo playboard --endpoint SOCKET --request request.json --timeout 30s --receipt run.json\n  playboard-demo get|subscribe|cancel --endpoint SOCKET --ref run.json\n  playboard-demo respond|native-respond --endpoint SOCKET --ref run.json --response reply.json\n\nOptions: --mode native|canonical --approval ask --cancel-grace 10s --responses answers.json\n         --after 0 --reason demo_user_cancelled\nOCTO_KERNEL_ENDPOINT supplies the default endpoint. stdout is NDJSON. No auto-approval.");
}
struct Options {
    command: String,
    values: HashMap<String, String>,
}
impl Options {
    fn get(&self, key: &str) -> &str {
        self.values.get(key).map(String::as_str).unwrap_or("")
    }
    fn parse() -> Result<Option<Self>, Error> {
        let mut args = env::args().skip(1);
        let Some(command) = args.next() else {
            help();
            return Ok(None);
        };
        if ["help", "--help", "-h"].contains(&command.as_str()) {
            help();
            return Ok(None);
        }
        if ![
            "status",
            "list",
            "playboard",
            "get",
            "subscribe",
            "cancel",
            "respond",
            "native-respond",
        ]
        .contains(&command.as_str())
        {
            return Err(failure("UNKNOWN_COMMAND"));
        }
        let mut values: HashMap<String, String> = [
            ("endpoint", ""),
            ("request", "-"),
            ("prompt", ""),
            ("adapter", "codex"),
            ("mode", "canonical"),
            ("approval", "ask"),
            ("timeout", "0"),
            ("cancel-grace", "10s"),
            ("receipt", ""),
            ("ref", ""),
            ("after", "0"),
            ("reason", "demo_user_cancelled"),
            ("response", "-"),
            ("responses", ""),
        ]
        .into_iter()
        .map(|(k, v)| (k.into(), v.into()))
        .collect();
        if let Ok(endpoint) = env::var("OCTO_KERNEL_ENDPOINT") {
            values.insert("endpoint".into(), endpoint);
        }
        while let Some(arg) = args.next() {
            if ["--help", "-h"].contains(&arg.as_str()) {
                help();
                return Ok(None);
            }
            let key = arg
                .strip_prefix("--")
                .ok_or_else(|| failure("UNKNOWN_OPTION"))?;
            if !values.contains_key(key) {
                return Err(failure("UNKNOWN_OPTION"));
            }
            values.insert(
                key.into(),
                args.next()
                    .ok_or_else(|| failure("OPTION_VALUE_REQUIRED"))?,
            );
        }
        if values["endpoint"].is_empty() {
            return Err(failure("KERNEL_ENDPOINT_REQUIRED"));
        }
        Ok(Some(Self { command, values }))
    }
}
struct AbortOnDrop(Vec<tokio::task::JoinHandle<()>>);
impl Drop for AbortOnDrop {
    fn drop(&mut self) {
        for task in &self.0 {
            task.abort();
        }
    }
}
#[tokio::main]
async fn main() {
    let args = match Options::parse() {
        Ok(Some(v)) => v,
        Ok(None) => return,
        Err(e) => {
            eprintln!("{}", e.code);
            std::process::exit(2);
        }
    };
    let client = Client::attach(args.get("endpoint"));
    let result = run(&client, &args).await;
    client.close().await;
    let code = match result {
        Ok(code) => code,
        Err(e) => {
            eprintln!("{}", e.code);
            1
        }
    };
    std::process::exit(code);
}
async fn run(client: &Client, args: &Options) -> Result<i32, Error> {
    let timeout = duration(args.get("timeout"))?;
    let grace = duration(args.get("cancel-grace"))?;
    if grace.is_zero() {
        return Err(failure("INVALID_DURATION"));
    }
    let after: i64 = args
        .get("after")
        .parse()
        .map_err(|_| failure("INVALID_CURSOR"))?;
    if after < 0 {
        return Err(failure("INVALID_CURSOR"));
    }
    let token = CancelToken::new();
    let interrupted = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let signal_token = token.clone();
    let signal_state = interrupted.clone();
    let signal_task = tokio::spawn(async move {
        #[cfg(unix)]
        {
            if let Ok(mut terminate) =
                tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            {
                tokio::select! { _ = tokio::signal::ctrl_c() => {}, _ = terminate.recv() => {} }
            } else {
                let _ = tokio::signal::ctrl_c().await;
            }
        }
        #[cfg(not(unix))]
        {
            let _ = tokio::signal::ctrl_c().await;
        }
        signal_state.store(true, std::sync::atomic::Ordering::SeqCst);
        signal_token.cancel();
    });
    let mut tasks = AbortOnDrop(vec![signal_task]);
    if !timeout.is_zero() {
        let token = token.clone();
        tasks.0.push(tokio::spawn(async move {
            tokio::time::sleep(timeout).await;
            token.cancel();
        }));
    }
    match args.command.as_str() {
        "status" => {
            emit(&serde_json::to_value(client.status().await?)?)?;
            return Ok(0);
        }
        "list" => {
            emit(&serde_json::to_value(client.list().await?)?)?;
            return Ok(0);
        }
        "playboard" => {}
        _ => {
            let raw_ref = read_json(args.get("ref"))?;
            validate("KernelRunRef", &raw_ref)?;
            let reference: models::KernelRunRef =
                octo_runtime_client::codec::from_value(raw_ref.clone())?;
            match args.command.as_str() {
                "get" => {
                    let key = octo_runtime_client::codec::from_value(
                        json!({"run_id":reference.run_id,"invocation_id":reference.invocation_id,"agent_session_id":reference.agent_session_id,"session_generation":reference.session_generation,"protocol_mode":reference.protocol_mode}),
                    )?;
                    emit(&serde_json::to_value(
                        client.get(key, Some(reference.kernel_instance_id)).await?,
                    )?)?;
                }
                "cancel" => emit(&serde_json::to_value(
                    client.cancel(reference, args.get("reason")).await?,
                )?)?,
                "subscribe" => {
                    let stream = client.subscribe(reference, after);
                    futures_util::pin_mut!(stream);
                    loop {
                        tokio::select! { _=token.cancelled()=>return Ok(if interrupted.load(std::sync::atomic::Ordering::SeqCst) {130} else {124}), item=stream.next()=>match item {Some(value)=>emit(&value?)?,None=>break} }
                    }
                }
                "respond" => {
                    let reply = read_json(args.get("response"))?;
                    validate("InteractionResponseWire", &reply)?;
                    client
                        .respond(reference, octo_runtime_client::codec::from_value(reply)?)
                        .await?;
                    emit(&json!({}))?;
                }
                "native-respond" => {
                    let reply = read_json(args.get("response"))?;
                    validate("NativeInteractionResponse", &reply)?;
                    client
                        .respond_native(reference, octo_runtime_client::codec::from_value(reply)?)
                        .await?;
                    emit(&json!({}))?;
                }
                _ => return Err(failure("UNKNOWN_COMMAND")),
            }
            return Ok(0);
        }
    }
    let mut request = if args.get("prompt").is_empty() {
        read_json(args.get("request"))?
    } else {
        json!({"protocol_mode":args.get("mode"),"inputs":[{"type":"text","text":args.get("prompt")}],"contexts":{"schema":"octo.context-envelope/v3","items":[{"namespace":"octo.execution","name":"adapter","payload":{"type":args.get("adapter")}},{"namespace":"octo.security","name":"approval_policy","payload":{"mode":args.get("approval")}}]}})
    };
    validate("InvokeInputWire", &request)?;
    for key in ["runId", "invocationId", "sessionId"] {
        if request.get(key).is_none() {
            request[key] = json!(format!(
                "{}-{}-{}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos(),
                key
            ));
        }
    }
    let original_key = json!({"run_id":request["runId"],"invocation_id":request["invocationId"],"agent_session_id":request["sessionId"],"session_generation":request.get("sessionGeneration").cloned().unwrap_or(json!(0)),"protocol_mode":request.get("protocol_mode").cloned().unwrap_or(json!("native"))});
    let expected_instance = if args.get("receipt").is_empty() {
        None
    } else {
        Some(client.status().await?.kernel_instance_id)
    };
    let mut replies = if args.get("responses").is_empty() {
        json!([])
    } else {
        read_json(args.get("responses"))?
    };
    let replies = replies
        .as_array_mut()
        .ok_or_else(|| failure("REPLIES_ARRAY_REQUIRED"))?;
    for reply in replies.iter() {
        let definition = match reply["kind"].as_str() {
            Some("native") => "NativeInteractionResponse",
            Some("canonical") => "InteractionResponseWire",
            _ => return Err(failure("REPLY_KIND_INVALID")),
        };
        validate(definition, &reply["response"])?;
    }
    let closer = client.clone();
    let close_token = token.clone();
    tasks.0.push(tokio::spawn(async move {
        close_token.cancelled().await;
        tokio::time::sleep(grace).await;
        closer.close().await;
    }));
    let mut exit_code = 1;
    let mut saved = false;
    let mut failure_result = None;
    let mut answered = std::collections::HashSet::new();
    {
        let stream = client.invoke(
            octo_runtime_client::codec::from_value(request)?,
            None,
            Some(token.clone()),
        );
        futures_util::pin_mut!(stream);
        while let Some(event) = stream.next().await {
            let event = match event {
                Ok(v) => v,
                Err(e) => {
                    failure_result = Some(e);
                    break;
                }
            };
            let records = client.invocations();
            let record = records.as_array().and_then(|a| a.first());
            if !saved && !args.get("receipt").is_empty() {
                let reference = if let Some(reference) = record.and_then(|r| r.get("ref")) {
                    reference.clone()
                } else {
                    let snapshot = client
                        .get(
                            octo_runtime_client::codec::from_value(original_key.clone())?,
                            expected_instance.clone(),
                        )
                        .await?;
                    serde_json::to_value(snapshot.r#ref)?
                };
                {
                    let path = Path::new(args.get("receipt"));
                    let temporary = path.with_extension(format!("tmp-{}", std::process::id()));
                    let result = (|| {
                        let mut options = fs::OpenOptions::new();
                        options.write(true).create_new(true);
                        #[cfg(unix)]
                        {
                            use std::os::unix::fs::OpenOptionsExt;
                            options.mode(0o600);
                        }
                        let mut file = options.open(&temporary)?;
                        file.write_all(&serde_json::to_vec(&reference)?)?;
                        file.write_all(b"\n")?;
                        drop(file);
                        fs::rename(&temporary, path)?;
                        Ok::<(), Error>(())
                    })();
                    let _ = fs::remove_file(&temporary);
                    if let Err(e) = result {
                        failure_result = Some(e);
                        break;
                    };
                    saved = true;
                }
            }
            if let Err(e) = emit(&event) {
                failure_result = Some(e);
                break;
            }
            if event["kind"] == "control" && event["control"]["type"] == "state" {
                exit_code = match event["control"]["state"].as_str() {
                    Some("completed") => 0,
                    Some("cancelled") => 130,
                    _ => 1,
                };
            }
            match event["type"].as_str() {
                Some("run.completed") => exit_code = 0,
                Some("run.cancelled") => exit_code = 130,
                Some("run.failed") => exit_code = 1,
                _ => {}
            }
            let native = event.get("kind").is_some();
            let interaction = event["type"] == "interaction.requested"
                || (event["kind"] == "control"
                    && event["control"]["type"] == "interaction"
                    && event["control"]["status"] == "pending")
                || (event["kind"] == "native" && event["messageKind"] == "request");
            if interaction {
                let target = if native {
                    event["control"]
                        .get("requestId")
                        .unwrap_or(&event["payload"]["id"])
                } else {
                    &event["payload"]["interactionId"]
                };
                // request 与 control.pending 可指向同一原生请求，只回答一次。
                let answer_key = format!("{native}:{target}");
                if answered.contains(&answer_key) {
                    continue;
                }
                let selected = replies.iter_mut().find(|r| {
                    r["used"] != true
                        && (r["kind"] == "native") == native
                        && r["response"][if native { "requestId" } else { "interactionId" }]
                            == *target
                });
                let Some(reply) = selected else {
                    eprintln!("INTERACTION_PENDING: use respond/native-respond --ref <receipt> --response <reply.json> in another terminal; Ctrl-C cancels this run.");
                    continue;
                };
                let Some(invocation) = record.and_then(|r| r["key"]["invocation_id"].as_str())
                else {
                    failure_result = Some(failure("INVOCATION_NOT_TRACKED"));
                    break;
                };
                let result = if native {
                    client
                        .respond_native_interaction(
                            invocation,
                            octo_runtime_client::codec::from_value(reply["response"].clone())?,
                        )
                        .await
                } else {
                    client
                        .respond_interaction(
                            invocation,
                            octo_runtime_client::codec::from_value(reply["response"].clone())?,
                        )
                        .await
                };
                if let Err(e) = result {
                    failure_result = Some(e);
                    break;
                };
                reply["used"] = json!(true);
                answered.insert(answer_key);
            }
        }
    }
    client.stop_admission();
    if !client.invocations().as_array().unwrap().is_empty() {
        let result = client
            .drain(tokio::time::Instant::now() + grace, "playboard_exit")
            .await;
        if result["complete"] != true {
            eprintln!(
                "DRAIN_INCOMPLETE: {} invocation(s) remain unresolved",
                result["unresolved"].as_array().unwrap().len()
            );
            if failure_result.is_none() {
                failure_result = Some(failure("RUN_OUTCOME_UNKNOWN"));
            }
        }
    }
    if let Some(e) = failure_result {
        if e.code == "CALLER_ABORTED" {
            return Ok(if interrupted.load(std::sync::atomic::Ordering::SeqCst) {
                130
            } else {
                124
            });
        }
        return Err(e);
    }
    Ok(exit_code)
}
