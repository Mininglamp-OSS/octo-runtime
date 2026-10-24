use crate::generated::rules::*;
use crate::{
    models,
    transport::{Channel, Transport},
    Error,
};
use futures_util::{Stream, StreamExt};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tokio::sync::{Notify, Semaphore};
use tokio_util::sync::CancellationToken;

pub type CancelToken = CancellationToken;
fn error(code: &str) -> Error {
    Error::new(code)
}
fn id() -> String {
    static NEXT: AtomicU64 = AtomicU64::new(0);
    format!(
        "{:x}-{:x}-{:x}",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    )
}
fn millis(n: u64) -> Duration {
    Duration::from_millis(n)
}
fn identify(mut v: Value) -> Result<Value, Error> {
    validate("InvokeInputWire", &v)?;
    for k in ["runId", "invocationId", "sessionId"] {
        if v.get(k).is_none() {
            v[k] = json!(id())
        }
    }
    if v.get("protocol_mode").is_none() {
        v["protocol_mode"] = json!("native")
    };
    if v.get("sessionGeneration").is_none() {
        v["sessionGeneration"] = json!(0)
    };
    Ok(v)
}
fn lookup(v: &Value) -> Value {
    json!({"run_id":v["runId"],"invocation_id":v["invocationId"],"agent_session_id":v["sessionId"],"session_generation":v["sessionGeneration"],"protocol_mode":v["protocol_mode"]})
}
fn same(a: &Value, b: &Value, fields: &[&str]) -> bool {
    fields
        .iter()
        .all(|k| crate::codec::json_equal(&a[*k], &b[*k]))
}
fn identity(a: &Value, b: &Value, full: bool) -> Result<(), Error> {
    if let Some(instance) = b.get("kernel_instance_id") {
        if &a["kernel_instance_id"] != instance {
            return Err(error("KERNEL_INSTANCE_CHANGED"));
        }
    };
    if !same(a, b, if full { RECEIPT_FIELDS } else { LOOKUP_FIELDS }) {
        return Err(error("RUN_IDENTITY_MISMATCH"));
    };
    Ok(())
}
fn frame_identity(a: &Value, b: &Value) -> Result<(), Error> {
    if !same(a, b, RECEIPT_FIELDS) {
        return Err(error("RUN_IDENTITY_MISMATCH"));
    };
    Ok(())
}
fn terminal(frame: &Value) -> Option<&str> {
    if frame["kind"] == "control" && frame["control"]["type"] == "state" {
        if let Some(state) = frame["control"]["state"].as_str() {
            if TERMINAL_STATES.contains(&state) {
                return Some(state);
            }
        }
    };
    None
}
fn response(v: Value, id: &str) -> Result<Value, Error> {
    if v["jsonrpc"] != "2.0"
        || v["id"] != id
        || v.get("result").is_some() == v.get("error").is_some()
    {
        return Err(error("INVALID_RESPONSE"));
    };
    validate(
        if v.get("error").is_some() {
            "IpcErrorResponse"
        } else {
            "IpcSuccessResponse"
        },
        &v,
    )
    .map_err(|_| error("INVALID_RESPONSE"))?;
    if v.get("error").is_some() {
        return Err(Error {
            code: v["error"]["data"]["code"].as_str().unwrap().into(),
            data: Some(v["error"]["data"].clone()),
            remote: true,
        });
    };
    Ok(v["result"].clone())
}
#[derive(Clone)]
pub struct Client {
    inner: Arc<Inner>,
}
struct Inner {
    transport: Transport,
    stopped: AtomicBool,
    records: Mutex<HashMap<String, Arc<Record>>>,
    controls: Arc<Semaphore>,
    drain: Mutex<Option<tokio::sync::watch::Receiver<Option<Value>>>>,
}
struct Record {
    state: Mutex<State>,
    admitted: Notify,
    cancelled: Notify,
}
struct State {
    key: Value,
    reference: Option<Value>,
    instance: Option<String>,
    submitted: bool,
    observing: bool,
    settled: bool,
    admission_error: Option<Error>,
    phase: &'static str,
    cancellation: &'static str,
    last_seq: i64,
    observation_error: Option<String>,
    cancel_started: bool,
    cancel_result: Option<Result<Value, Error>>,
}
impl Client {
    pub fn attach(endpoint: impl Into<String>) -> Self {
        Self {
            inner: Arc::new(Inner {
                transport: Transport::new(endpoint.into()),
                stopped: AtomicBool::new(false),
                records: Mutex::new(HashMap::new()),
                controls: Arc::new(Semaphore::new(LIMIT_CONTROL_CONCURRENCY)),
                drain: Mutex::new(None),
            }),
        }
    }
    pub async fn close(&self) {
        self.stop_admission();
        self.inner.transport.close().await;
    }
    pub fn stop_admission(&self) {
        self.inner.stopped.store(true, Ordering::SeqCst)
    }
    pub(crate) async fn rpc(
        &self,
        method_name: &str,
        params: Value,
        before: Option<Box<dyn FnOnce() -> Result<(), Error> + Send>>,
    ) -> Result<Value, Error> {
        let (check_params, check_result, side_effect) = method(method_name)?;
        check_params(&params)?;
        let request_id = id();
        let mut line = serde_json::to_vec(
            &json!({"jsonrpc":"2.0","id":request_id,"method":method_name,"params":params}),
        )?;
        line.push(b'\n');
        if line.len() > LIMIT_REQUEST_BYTES {
            return Err(error("INVOKE_REQUEST_TOO_LARGE"));
        };
        let mut sent = false;
        let result = tokio::time::timeout(
            millis(if method_name == "agent_run.invoke" {
                TIMEOUT_INVOKE_ACK
            } else {
                TIMEOUT_UNARY
            }),
            async {
                let mut conn = self.inner.transport.open().await?;
                if let Some(before) = before {
                    before()?
                };
                sent = true;
                conn.write(&line).await?;
                let bytes = conn.line().await?;
                let v = response(serde_json::from_slice(&bytes)?, &request_id)?;
                check_result(&v).map_err(|_| error("INVALID_RESPONSE"))?;
                conn.close().await;
                Ok(v)
            },
        )
        .await
        .unwrap_or_else(|_| Err(error("KERNEL_TIMEOUT")));
        match result {
            Err(e) if sent && side_effect && method_name != "agent_run.invoke" && !e.remote => {
                Err(error("OPERATION_OUTCOME_UNKNOWN"))
            }
            other => other,
        }
    }
    pub async fn status(&self) -> Result<models::KernelStatus, Error> {
        Ok(crate::codec::from_value(
            self.rpc("status", json!({}), None).await?,
        )?)
    }
    pub async fn list(&self) -> Result<Vec<models::HostedAdapterMetadataWire>, Error> {
        Ok(crate::codec::from_value(
            self.rpc("adapter.list", json!({}), None).await?,
        )?)
    }
    pub async fn submit(
        &self,
        input: models::InvokeInputWire,
        environment: Option<models::KernelInvokeEnvironmentWire>,
        cancel: Option<CancelToken>,
    ) -> Result<models::KernelRunRef, Error> {
        let client = self.clone();
        let input = serde_json::to_value(input)?;
        let env = environment
            .map(serde_json::to_value)
            .transpose()?
            .unwrap_or(json!({}));
        let task = tokio::spawn(async move { client.submit_value(input, env, cancel, None).await });
        Ok(crate::codec::from_value(
            task.await.map_err(|_| error("ACCEPTANCE_UNKNOWN"))??,
        )?)
    }
    async fn submit_value(
        &self,
        input: Value,
        environment: Value,
        token: Option<CancelToken>,
        record: Option<Arc<Record>>,
    ) -> Result<Value, Error> {
        if token.as_ref().is_some_and(|t| t.is_cancelled()) {
            return Err(error("CALLER_ABORTED"));
        };
        if environment.get("streamLimits").is_some() {
            return Err(error("KERNEL_STREAM_LIMITS_UNSUPPORTED"));
        };
        validate("KernelInvokeEnvironmentWire", &environment)?;
        let request = identify(input)?;
        let key = lookup(&request);
        let instance = self.status().await?.kernel_instance_id;
        if token.as_ref().is_some_and(|t| t.is_cancelled()) {
            return Err(error("CALLER_ABORTED"));
        };
        if let Some(r) = &record {
            r.state.lock().unwrap().instance = Some(instance.clone())
        };
        let sent = Arc::new(AtomicBool::new(false));
        let sent_write = sent.clone();
        let t = token.clone();
        let r = record.clone();
        let c = self.clone();
        let mut params = environment;
        params["input"] = request;
        params["kernel_instance_id"] = json!(instance);
        let ack = self
            .rpc(
                "agent_run.invoke",
                params,
                Some(Box::new(move || {
                    if t.as_ref().is_some_and(|t| t.is_cancelled()) {
                        return Err(error("CALLER_ABORTED"));
                    };
                    if let Some(r) = r {
                        if c.inner.stopped.load(Ordering::SeqCst) {
                            return Err(error("CLIENT_INVOCATION_ADMISSION_CLOSED"));
                        };
                        r.state.lock().unwrap().submitted = true
                    };
                    sent_write.store(true, Ordering::SeqCst);
                    Ok(())
                })),
            )
            .await;
        let reference = match ack {
            Ok(value) => {
                let mut reference = value["receipt"].clone();
                reference["kernel_instance_id"] = value["kernel_instance_id"].clone();
                let mut expected = key.clone();
                expected["kernel_instance_id"] = json!(instance);
                identity(&reference, &expected, false)?;
                reference
            }
            Err(e) => {
                if !sent.load(Ordering::SeqCst) || e.remote {
                    return Err(e);
                }
                let recovered = tokio::time::timeout(millis(TIMEOUT_RECOVERY), async {
                    for delay in REPAIR_DELAYS_MS {
                        tokio::time::sleep(millis(*delay)).await;
                        match self.get_value(key.clone(), Some(instance.clone())).await {
                            Ok(v) => return Ok(v["ref"].clone()),
                            Err(e)
                                if ["KERNEL_INSTANCE_CHANGED", "RUN_IDENTITY_MISMATCH"]
                                    .contains(&e.code.as_str()) =>
                            {
                                return Err(e)
                            }
                            _ => {}
                        }
                    }
                    Err(error("ACCEPTANCE_UNKNOWN"))
                })
                .await
                .unwrap_or_else(|_| Err(error("ACCEPTANCE_UNKNOWN")));
                recovered?
            }
        };
        if record.is_none() && token.as_ref().is_some_and(|t| t.is_cancelled()) {
            self.cancel_value(reference.clone(), "caller_aborted")
                .await?;
        };
        Ok(reference)
    }
    pub async fn get(
        &self,
        key: models::KernelLookupKey,
        instance: Option<String>,
    ) -> Result<models::KernelRunSnapshot, Error> {
        Ok(crate::codec::from_value(
            self.get_value(serde_json::to_value(key)?, instance).await?,
        )?)
    }
    async fn get_value(&self, key: Value, instance: Option<String>) -> Result<Value, Error> {
        let mut params = json!({"key":key});
        if let Some(i) = &instance {
            params["kernel_instance_id"] = json!(i)
        };
        let result = self.rpc("agent_run.get", params, None).await?;
        let mut expected = key;
        if let Some(i) = instance {
            expected["kernel_instance_id"] = json!(i)
        };
        identity(&result["ref"], &expected, false)?;
        if let Some(t) = result.get("terminal") {
            frame_identity(t, &result["ref"])?;
            if terminal(t).is_none() {
                return Err(error("HOST_FRAME_INVALID"));
            }
        };
        self.reconcile(&result)?;
        Ok(result)
    }
    async fn cancel_value(&self, reference: Value, reason: &str) -> Result<Value, Error> {
        self.rpc(
            "agent_run.cancel",
            json!({"ref":reference,"reason":reason}),
            None,
        )
        .await
    }
    pub async fn cancel(
        &self,
        reference: models::KernelRunRef,
        reason: &str,
    ) -> Result<models::IpcCancelResult, Error> {
        Ok(crate::codec::from_value(
            self.cancel_value(serde_json::to_value(reference)?, reason)
                .await?,
        )?)
    }
    pub async fn respond(
        &self,
        reference: models::KernelRunRef,
        response: models::InteractionResponseWire,
    ) -> Result<(), Error> {
        self.rpc(
            "agent_run.respond",
            json!({"ref":reference,"response":response}),
            None,
        )
        .await?;
        Ok(())
    }
    pub async fn respond_native(
        &self,
        reference: models::KernelRunRef,
        response: models::NativeInteractionResponse,
    ) -> Result<(), Error> {
        self.rpc(
            "agent_run.native.respond",
            json!({"ref":reference,"response":response}),
            None,
        )
        .await?;
        Ok(())
    }
    pub fn subscribe(
        &self,
        reference: models::KernelRunRef,
        after: i64,
    ) -> impl Stream<Item = Result<Value, Error>> + Send + 'static {
        self.subscribe_value(serde_json::to_value(reference).unwrap(), after)
    }
    fn subscribe_value(
        &self,
        reference: Value,
        mut after: i64,
    ) -> impl Stream<Item = Result<Value, Error>> + Send + 'static {
        let client = self.clone();
        async_stream::try_stream! {validate("KernelRunRef",&reference)?;let mut repair=0;let mut until=None;
         loop{
          let mut timeout=millis(TIMEOUT_UNARY);if let Some(end)=until{let remaining=tokio::time::Instant::now().checked_duration_since(end);if remaining.is_some(){Err(error("KERNEL_UNAVAILABLE"))?};timeout=timeout.min(end-tokio::time::Instant::now())}
          let connected:Result<(Channel,Value),Error>=tokio::time::timeout(timeout,async{let params=json!({"ref":reference,"after_seq":after});(method("agent_run.subscribe")?.0)(&params)?;let mut conn=client.inner.transport.open().await?;let request_id=id();let mut line=serde_json::to_vec(&json!({"jsonrpc":"2.0","id":request_id,"method":"agent_run.subscribe","params":params}))?;line.push(b'\n');conn.write(&line).await?;let snapshot=response(serde_json::from_slice(&conn.line().await?)?,&request_id)?;validate("KernelRunSnapshot",&snapshot)?;identity(&snapshot["ref"],&reference,true)?;if let Some(t)=snapshot.get("terminal"){frame_identity(t,&reference)?;if terminal(t).is_none(){return Err(error("HOST_FRAME_INVALID"))};client.reconcile(&snapshot)?;};Ok((conn,snapshot))}).await.unwrap_or_else(|_|Err(error("KERNEL_TIMEOUT")));
          let failure=match connected{Err(e)=>e,Ok((mut conn,snapshot))=>{
           if snapshot.get("terminal").is_some()&&after>=crate::codec::integer(&snapshot["latest_seq"])?{return}
           loop{let bytes=match conn.line().await{Ok(b)=>b,Err(e)=>break e};let notice:Value=serde_json::from_slice(&bytes)?;
            if notice["method"]=="agent_run.stream_error"{validate("IpcStreamErrorNotification",&notice)?;if notice["params"]["kernel_instance_id"]!=reference["kernel_instance_id"]{Err(error("KERNEL_INSTANCE_CHANGED"))?};Err(error(notice["params"]["code"].as_str().unwrap()))?}
            validate("IpcEventNotification",&notice)?;let p=&notice["params"];if p["kernel_instance_id"]!=reference["kernel_instance_id"]{Err(error("KERNEL_INSTANCE_CHANGED"))?};if p["run_id"]!=reference["run_id"]||p["stream_id"]!=reference["stream_id"]{Err(error("RUN_IDENTITY_MISMATCH"))?};let frame=&p["event"];frame_identity(frame,&reference)?;let seq=crate::codec::integer(&frame["seq"]).map_err(|_|error("HOST_FRAME_INVALID"))?;if seq!=after+1||!crate::codec::json_equal(&p["seq"],&frame["seq"]){Err(error("STREAM_GAP"))?};after=seq;client.observe(&reference,frame);let ended=terminal(frame).is_some();yield frame.clone();if ended{return}
           }
          }};
          if !RETRYABLE_ERRORS.contains(&failure.code.as_str()){Err(failure)?};if repair>=REPAIR_DELAYS_MS.len(){Err(error("KERNEL_UNAVAILABLE"))?};let end=*until.get_or_insert_with(||tokio::time::Instant::now()+millis(TIMEOUT_RECOVERY));let delay=millis(REPAIR_DELAYS_MS[repair]);repair+=1;if tokio::time::Instant::now()+delay>=end{Err(error("KERNEL_UNAVAILABLE"))?};tokio::time::sleep(delay).await;
         }
        }
    }
    pub fn invoke(
        &self,
        input: models::InvokeInputWire,
        environment: Option<models::KernelInvokeEnvironmentWire>,
        cancel: Option<CancelToken>,
    ) -> impl Stream<Item = Result<Value, Error>> + Send + 'static {
        let client = self.clone();
        async_stream::try_stream! {
         if cancel.as_ref().is_some_and(|t|t.is_cancelled()){Err(error("CALLER_ABORTED"))?};let request=identify(serde_json::to_value(input)?)?;let record=client.begin(lookup(&request))?;let _observation=Observation{record:record.clone()};let env=environment.map(serde_json::to_value).transpose()?.unwrap_or(json!({}));let admitting=client.clone();let r=record.clone();let token=cancel.clone();let native=request["protocol_mode"]=="native";
         let task=tokio::spawn(async move{let result=admitting.submit_value(request,env,token,Some(r.clone())).await;{let mut s=r.state.lock().unwrap();s.settled=true;match &result{Ok(reference)=>{s.reference=Some(reference.clone());s.phase=if s.observing{"accepted"}else{"unobserved"}},Err(e)=>{s.phase="acceptance_unknown";s.admission_error=Some(e.clone());s.observation_error=Some(e.code.clone());if !s.submitted||(e.remote&&!["RUN_IDENTITY_MISMATCH","KERNEL_INSTANCE_CHANGED"].contains(&e.code.as_str())){admitting.inner.records.lock().unwrap().remove(s.key["invocation_id"].as_str().unwrap());}}}};r.admitted.notify_waiters();result});
         // 观察关闭只结束尚未触发的 watcher；已触发的取消独立等接纳并完成控制。
         let observation_closed=CancelToken::new();let _watch=StopWatching(observation_closed.clone());
         if let Some(token)=cancel.clone(){let c=client.clone();let r=record.clone();tokio::spawn(async move{tokio::select!{biased; _=token.cancelled()=>{let _=c.cancel_record(r,"caller_aborted",None).await;},_=observation_closed.cancelled()=>{}}});}
         let reference=task.await.map_err(|_|error("ACCEPTANCE_UNKNOWN"))??;let source=client.subscribe_value(reference.clone(),0);futures_util::pin_mut!(source);
         while let Some(item)=source.next().await{let frame=item?;if native{yield frame.clone()}else if frame["kind"]=="canonical"{yield frame["event"].clone()}else if frame["kind"]=="control"{let control=&frame["control"];if control["type"]=="gap"{Err(error("STREAM_GAP"))?};if control["type"]=="error"{let key=record.state.lock().unwrap().key.clone();if let Ok(snapshot)=client.get_value(key,reference["kernel_instance_id"].as_str().map(str::to_owned)).await{if terminal(&snapshot["terminal"])==Some("lost"){Err(error("RUN_OUTCOME_UNKNOWN"))?}};Err(Error{code:control["code"].as_str().unwrap().into(),data:Some(control.clone()),remote:false})?}}
          if terminal(&frame)==Some("lost"){Err(error("RUN_OUTCOME_UNKNOWN"))?}
         }
         let started=record.state.lock().unwrap().cancel_started;if started{client.wait_cancel(&record).await?;};if cancel.as_ref().is_some_and(|t|t.is_cancelled()){Err(error("CALLER_ABORTED"))?}
        }
    }
    fn begin(&self, key: Value) -> Result<Arc<Record>, Error> {
        if self.inner.stopped.load(Ordering::SeqCst) {
            return Err(error("CLIENT_INVOCATION_ADMISSION_CLOSED"));
        };
        let mut records = self.inner.records.lock().unwrap();
        let id = key["invocation_id"].as_str().unwrap().to_owned();
        if records.contains_key(&id) {
            return Err(error("EXECUTION_IDENTITY_CONFLICT"));
        };
        if records.len() >= LIMIT_INVOCATIONS {
            return Err(error("CLIENT_INVOCATION_CAPACITY_EXHAUSTED"));
        };
        let r = Arc::new(Record {
            state: Mutex::new(State {
                key,
                reference: None,
                instance: None,
                submitted: false,
                observing: true,
                settled: false,
                admission_error: None,
                phase: "admitting",
                cancellation: "none",
                last_seq: 0,
                observation_error: None,
                cancel_started: false,
                cancel_result: None,
            }),
            admitted: Notify::new(),
            cancelled: Notify::new(),
        });
        records.insert(id, r.clone());
        Ok(r)
    }
    pub fn invocations(&self) -> Value {
        let records: Vec<_> = self
            .inner
            .records
            .lock()
            .unwrap()
            .values()
            .cloned()
            .collect();
        Value::Array(records.into_iter().map(|r|{let s=r.state.lock().unwrap();let mut v=json!({"key":s.key,"phase":s.phase,"cancellation":s.cancellation,"lastSeq":s.last_seq});if let Some(reference)=&s.reference{v["ref"]=reference.clone()};if let Some(e)=&s.observation_error{v["observationError"]=json!(e)};v}).collect())
    }
    fn observe(&self, reference: &Value, frame: &Value) {
        let id = reference["invocation_id"].as_str().unwrap();
        let r = self.inner.records.lock().unwrap().get(id).cloned();
        if let Some(r) = r {
            let mut s = r.state.lock().unwrap();
            if s.reference.as_ref() != Some(reference) {
                return;
            };
            s.last_seq = s
                .last_seq
                .max(crate::codec::integer(&frame["seq"]).expect("validated frame sequence"));
            match terminal(frame) {
                Some("lost") => {
                    s.phase = "unobserved";
                    s.observation_error = Some("RUN_OUTCOME_UNKNOWN".into())
                }
                Some(_) => {
                    self.inner.records.lock().unwrap().remove(id);
                }
                None => {}
            }
        }
    }
    fn reconcile(&self, snapshot: &Value) -> Result<(), Error> {
        let reference = &snapshot["ref"];
        let r = self
            .inner
            .records
            .lock()
            .unwrap()
            .get(reference["invocation_id"].as_str().unwrap())
            .cloned();
        if let Some(r) = r {
            {
                let mut s = r.state.lock().unwrap();
                if s.instance
                    .as_ref()
                    .is_some_and(|i| reference["kernel_instance_id"] != i.as_str())
                {
                    return Ok(());
                };
                identity(reference, &s.key, false)?;
                if let Some(expected) = &s.reference {
                    identity(reference, expected, true)?
                };
                s.reference = Some(reference.clone());
                s.settled = true;
            };
            r.admitted.notify_waiters();
            if let Some(t) = snapshot.get("terminal") {
                self.observe(reference, t)
            }
        };
        Ok(())
    }
    fn record(&self, id: &str) -> Result<Arc<Record>, Error> {
        self.inner
            .records
            .lock()
            .unwrap()
            .get(id)
            .cloned()
            .ok_or_else(|| error("INVOCATION_NOT_TRACKED"))
    }
    pub async fn cancel_invocation(&self, id: &str, reason: &str) -> Result<Value, Error> {
        self.cancel_record(self.record(id)?, reason, None).await
    }
    pub async fn respond_interaction(
        &self,
        id: &str,
        response: models::InteractionResponseWire,
    ) -> Result<(), Error> {
        let reference = self
            .record(id)?
            .state
            .lock()
            .unwrap()
            .reference
            .clone()
            .ok_or_else(|| error("INVOCATION_NOT_ACCEPTED"))?;
        self.rpc(
            "agent_run.respond",
            json!({"ref":reference,"response":response}),
            None,
        )
        .await?;
        Ok(())
    }
    pub async fn respond_native_interaction(
        &self,
        id: &str,
        response: models::NativeInteractionResponse,
    ) -> Result<(), Error> {
        let reference = self
            .record(id)?
            .state
            .lock()
            .unwrap()
            .reference
            .clone()
            .ok_or_else(|| error("INVOCATION_NOT_ACCEPTED"))?;
        self.rpc(
            "agent_run.native.respond",
            json!({"ref":reference,"response":response}),
            None,
        )
        .await?;
        Ok(())
    }
    async fn wait_cancel(&self, r: &Record) -> Result<Value, Error> {
        loop {
            let changed = r.cancelled.notified();
            if let Some(result) = r.state.lock().unwrap().cancel_result.clone() {
                return result;
            };
            changed.await
        }
    }
    async fn cancel_record(
        &self,
        r: Arc<Record>,
        reason: &str,
        deadline: Option<tokio::time::Instant>,
    ) -> Result<Value, Error> {
        loop {
            let changed = r.admitted.notified();
            let settled = {
                let mut s = r.state.lock().unwrap();
                if s.cancellation == "none" {
                    s.cancellation = "requested"
                };
                s.settled
            };
            if settled {
                break;
            };
            changed.await
        }
        let reference;
        let start;
        {
            let mut s = r.state.lock().unwrap();
            reference = s.reference.clone().ok_or_else(|| {
                s.admission_error
                    .clone()
                    .unwrap_or_else(|| error("ACCEPTANCE_UNKNOWN"))
            })?;
            if s.observation_error.as_deref() == Some("RUN_OUTCOME_UNKNOWN") {
                return Err(error("RUN_OUTCOME_UNKNOWN"));
            };
            if !self
                .inner
                .records
                .lock()
                .unwrap()
                .contains_key(reference["invocation_id"].as_str().unwrap())
            {
                return Ok(json!({"accepted":false}));
            };
            start = !s.cancel_started;
            s.cancel_started = true;
        }
        if start {
            let client = self.clone();
            let r = r.clone();
            let reason = reason.to_owned();
            tokio::spawn(async move {
                let work = async {
                    let _permit = client
                        .inner
                        .controls
                        .acquire()
                        .await
                        .map_err(|_| error("CLIENT_CLOSED"))?;
                    client.cancel_value(reference, &reason).await
                };
                let result = if let Some(deadline) = deadline {
                    tokio::time::timeout_at(deadline, work)
                        .await
                        .unwrap_or_else(|_| Err(error("DRAIN_DEADLINE_EXCEEDED")))
                } else {
                    work.await
                };
                {
                    let mut s = r.state.lock().unwrap();
                    s.cancellation = if result.is_ok() {
                        "acknowledged"
                    } else {
                        "unknown"
                    };
                    s.cancel_result = Some(result)
                };
                r.cancelled.notify_waiters();
            });
        };
        self.wait_cancel(&r).await
    }
    // 第一次 drain 固定绝对截止时间；调用方丢弃 Future 不会重启或延长清理。
    pub async fn drain(&self, deadline: tokio::time::Instant, reason: &str) -> Value {
        self.stop_admission();
        let mut receiver = {
            let mut cached = self.inner.drain.lock().unwrap();
            if let Some(receiver) = cached.as_ref() {
                receiver.clone()
            } else {
                let (sender, receiver) = tokio::sync::watch::channel(None);
                *cached = Some(receiver.clone());
                let client = self.clone();
                let reason = reason.to_owned();
                tokio::spawn(async move {
                    let result = client.drain_work(deadline, &reason).await;
                    let _ = sender.send(Some(result));
                });
                receiver
            }
        };
        loop {
            if let Some(result) = receiver.borrow().clone() {
                return result;
            };
            if receiver.changed().await.is_err() {
                return json!({"complete":false,"unresolved":self.invocations()});
            }
        }
    }
    async fn drain_work(&self, deadline: tokio::time::Instant, reason: &str) -> Value {
        let work = async {
            loop {
                let records: Vec<_> = self
                    .inner
                    .records
                    .lock()
                    .unwrap()
                    .values()
                    .cloned()
                    .collect();
                if records.is_empty() {
                    break;
                };
                let c = self.clone();
                let reason = reason.to_owned();
                futures_util::stream::iter(records)
                    .for_each_concurrent(LIMIT_LOOKUP_CONCURRENCY, move |r| {
                        let c = c.clone();
                        let reason = reason.clone();
                        async move {
                            let (key, instance) = {
                                let s = r.state.lock().unwrap();
                                (s.key.clone(), s.instance.clone())
                            };
                            if let Some(instance) = instance {
                                if let Ok(snapshot) = c.get_value(key, Some(instance)).await {
                                    if terminal(&snapshot["terminal"]).is_none() {
                                        let _ = c.cancel_record(r, &reason, Some(deadline)).await;
                                    }
                                }
                            }
                        }
                    })
                    .await;
                tokio::time::sleep(millis(100)).await;
            }
        };
        let _ = tokio::time::timeout_at(deadline, work).await;
        let records = self.invocations();
        json!({"complete":records.as_array().unwrap().is_empty(),"unresolved":records})
    }
}
struct Observation {
    record: Arc<Record>,
}
impl Drop for Observation {
    fn drop(&mut self) {
        let mut s = self.record.state.lock().unwrap();
        s.observing = false;
        if s.reference.is_some() {
            s.phase = "unobserved"
        }
    }
}
struct StopWatching(CancelToken);
impl Drop for StopWatching {
    fn drop(&mut self) {
        self.0.cancel();
    }
}
