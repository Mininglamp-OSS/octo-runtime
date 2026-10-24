use futures_util::StreamExt;
use octo_runtime_client::{generated::rules, models, CancelToken, Client, Error};
use serde_json::{json, Value};
use std::io::{self, BufRead};
#[tokio::main]
async fn main() {
    for line in io::stdin().lock().lines() {
        let result = match serde_json::from_str::<Value>(&line.unwrap()) {
            Ok(m) => run(m).await,
            Err(_) => Err(Error::new("INVALID_JSON")),
        };
        println!("{}", result.unwrap_or_else(|e| json!({"error":e.code})))
    }
}
async fn run(m: Value) -> Result<Value, Error> {
    if m["op"] == "codec" {
        let ok = rules::validate(m["definition"].as_str().unwrap(), &m["value"]).is_ok();
        return Ok(if ok {
            json!({"valid":true,"value":m["value"]})
        } else {
            json!({"valid":false})
        });
    }
    let c = Client::attach(m["endpoint"].as_str().unwrap());
    let status = c.status().await?;
    let adapters = c.list().await?;
    let mut result = json!({"instance":status.kernel_instance_id,"adapters":adapters.len()});
    let input: models::InvokeInputWire =
        octo_runtime_client::codec::from_value(m["input"].clone())?;
    if m["op"] == "drain-queued-cancels" {
        let mut tasks = Vec::new();
        for n in 0..5 {
            let mut request = m["input"].clone();
            let id = format!("{}-{n}", request["invocationId"].as_str().unwrap());
            request["invocationId"] = json!(id);
            request["runId"] = json!(id);
            {
                let stream = c.invoke(octo_runtime_client::codec::from_value(request)?, None, None);
                futures_util::pin_mut!(stream);
                stream.next().await.unwrap()?;
            }
            let client = c.clone();
            tasks.push(tokio::spawn(async move {
                client.cancel_invocation(&id, "test_cancel").await
            }));
        }
        let gate = m["gate"].as_str().unwrap();
        tokio::time::timeout(std::time::Duration::from_secs(5), async {
            while !std::path::Path::new(&format!("{gate}.ready")).exists() {
                tokio::time::sleep(std::time::Duration::from_millis(1)).await;
            }
        })
        .await
        .map_err(|_| Error::new("TEST_BARRIER_TIMEOUT"))?;
        result["drain"] = c
            .drain(
                tokio::time::Instant::now() + std::time::Duration::from_millis(100),
                "test_drain",
            )
            .await;
        result["repeated"] = c
            .drain(
                tokio::time::Instant::now() + std::time::Duration::from_secs(5),
                "again",
            )
            .await;
        std::fs::write(format!("{gate}.drained"), "drained")?;
        for task in tasks {
            let _ = task.await;
        }
        c.close().await;
        return Ok(result);
    }
    if ["close-admitting", "cancel-close-admitting"].contains(&m["op"].as_str().unwrap()) {
        let token = CancelToken::new();
        let observing = c.clone();
        let observing_token = token.clone();
        let task = tokio::spawn(async move {
            let stream = observing.invoke(input, None, Some(observing_token));
            futures_util::pin_mut!(stream);
            stream.next().await
        });
        let gate = m["gate"].as_str().unwrap();
        let result = tokio::time::timeout(std::time::Duration::from_secs(5), async {
            while !std::path::Path::new(gate).exists() {
                tokio::time::sleep(std::time::Duration::from_millis(1)).await;
            }
            if m["op"] == "cancel-close-admitting" {
                token.cancel();
                if m["yieldWatcher"] == true {
                    tokio::task::yield_now().await;
                }
            }
            task.abort();
            let _ = task.await;
            std::fs::write(format!("{gate}.closed"), "closed")?;
            loop {
                let records = c.invocations();
                if records.as_array().unwrap().len() == 1
                    && records[0].get("ref").is_some()
                    && (m["op"] == "close-admitting"
                        || records[0]["cancellation"] == "acknowledged")
                {
                    return Ok::<_, Error>(json!({"registry":records}));
                }
                tokio::time::sleep(std::time::Duration::from_millis(1)).await;
            }
        })
        .await
        .map_err(|_| Error::new("TEST_BARRIER_TIMEOUT"))?;
        c.close().await;
        return result;
    }
    if [
        "invoke",
        "interaction",
        "cancel-invocation",
        "abandon",
        "drain",
    ]
    .contains(&m["op"].as_str().unwrap())
    {
        let stream = c.invoke(input, None, None);
        result["before"] = json!(c.invocations().as_array().unwrap().len());
        futures_util::pin_mut!(stream);
        let mut events = vec![];
        while let Some(event) = stream.next().await {
            let event = match event {
                Ok(v) => v,
                Err(e) => {
                    result["error"] = json!(e.code);
                    break;
                }
            };
            events.push(event.clone());
            if m["op"] == "interaction" {
                let invocation = m["input"]["invocationId"].as_str().unwrap();
                let reply = if event["kind"] == "native" && event["messageKind"] == "request" {
                    c.respond_native_interaction(
                        invocation,
                        octo_runtime_client::codec::from_value(
                            json!({"requestId":42,"payload":{"id":42,"result":"approved"}}),
                        )?,
                    )
                    .await
                } else if event["type"] == "interaction.requested" {
                    c.respond_interaction(
                        invocation,
                        octo_runtime_client::codec::from_value(
                            json!({"interactionId":"approval","outcome":"accepted"}),
                        )?,
                    )
                    .await
                } else {
                    Ok(())
                };
                if let Err(e) = reply {
                    result["error"] = json!(e.code);
                    break;
                }
            }
            if events.len() == 1 {
                match m["op"].as_str().unwrap() {
                    "cancel-invocation" => {
                        let invocation = m["input"]["invocationId"].as_str().unwrap();
                        match c.cancel_invocation(invocation, "test_cancel").await {
                            Ok(v) => result["cancel"] = v,
                            Err(e) => {
                                result["error"] = json!(e.code);
                                break;
                            }
                        };
                        let _ = c.cancel_invocation(invocation, "second").await;
                    }
                    "abandon" => break,
                    "drain" => {
                        result["drain"] = c
                            .drain(
                                tokio::time::Instant::now() + std::time::Duration::from_secs(2),
                                "test_drain",
                            )
                            .await
                    }
                    _ => {}
                }
            }
        }
        result["events"] = json!(events);
        result["registry"] = c.invocations();
        c.close().await;
        return Ok(result);
    }
    let reference = c.submit(input, None, None).await?;
    result["ref"] = serde_json::to_value(&reference)?;
    if m["op"] == "cancel" {
        result["cancel"] = serde_json::to_value(c.cancel(reference.clone(), "test_cancel").await?)?
    }
    let stream = c.subscribe(reference.clone(), 0);
    futures_util::pin_mut!(stream);
    let mut frames = vec![];
    while let Some(frame) = stream.next().await {
        frames.push(frame?)
    }
    result["frames"] = json!(frames);
    let key = octo_runtime_client::codec::from_value(
        json!({"run_id":reference.run_id,"invocation_id":reference.invocation_id,"agent_session_id":reference.agent_session_id,"session_generation":reference.session_generation,"protocol_mode":reference.protocol_mode}),
    )?;
    result["snapshot"] =
        serde_json::to_value(c.get(key, Some(reference.kernel_instance_id)).await?)?;
    c.close().await;
    Ok(result)
}
