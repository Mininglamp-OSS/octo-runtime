use octo_runtime_client::{decode, encode, models, Presence};
use serde::{de::DeserializeOwned, Serialize};
use serde_json::{json, Value};

fn roundtrip<T: DeserializeOwned + Serialize>(name: &str, input: Value) -> T {
    let value: T = decode(name, &serde_json::to_vec(&input).unwrap()).unwrap();
    let output: Value = serde_json::from_slice(&encode(name, &value).unwrap()).unwrap();
    assert_eq!(input, output, "{name} must preserve the selected branch");
    value
}

#[test]
fn activity_subject_discriminators_select_and_preserve_every_branch() {
    for (index, kind) in ["run", "message", "tool", "interaction"].iter().enumerate() {
        let mut subject = json!({"type":kind});
        if index > 0 {
            subject["id"] = json!("subject-42");
        }
        let value = roundtrip::<models::ActivitySubject>("ActivitySubject", subject.clone());
        assert!(matches!(
            (index, value),
            (0, models::ActivitySubject::Variant0(_))
                | (1, models::ActivitySubject::Variant1(_))
                | (2, models::ActivitySubject::Variant2(_))
                | (3, models::ActivitySubject::Variant3(_))
        ));
        roundtrip::<models::ActivityStartedPayload>(
            "ActivityStartedPayload",
            json!({
                "activityId":"activity-1", "kind":"working", "subject":subject,
                "source":"provider", "info":{}, "startedAtMs":1
            }),
        );
    }
    for invalid in [
        json!({"type":"unknown"}),
        json!({"type":"tool"}),
        json!({"type":"run","id":"extra"}),
    ] {
        // Direct serde binding must also consult the schema, including closed fields.
        assert!(serde_json::from_value::<models::ActivitySubject>(invalid).is_err());
    }
}

#[test]
fn frame_unions_preserve_native_canonical_and_control_payloads() {
    for branch in [
        json!({"kind":"native","messageKind":"notification","payload":{"method":"delta","extension":{"n":1.5,"big":900719925474099312345_u128}}}),
        json!({"kind":"canonical","event":{"protocolVersion":2,"type":"message.delta","payload":{"channel":"final","text":"answer"}}}),
        json!({"kind":"control","control":{"type":"state","state":"completed"}}),
    ] {
        let canonical = branch["kind"] == "canonical";
        let mut frame = json!({"run_id":"run-1","invocation_id":"invoke-1","stream_id":"host:stream-1",
            "agent_session_id":"session-1","session_generation":3,
            "protocol_mode":if canonical {"canonical"} else {"native"},"protocol":"codex.app-server","seq":1});
        frame
            .as_object_mut()
            .unwrap()
            .extend(branch.as_object().unwrap().clone());
        roundtrip::<models::HostFrame>("HostFrame", frame);
    }
}

#[test]
fn mcp_union_preserves_stdio_and_http_configuration() {
    for server in [
        json!({"type":"stdio","command":"example","args":["--stdio"],"env":{"EXAMPLE":"value"}}),
        json!({"type":"streamable_http","url":"https://example.com/mcp","headers":{"X-Example":"value"}}),
    ] {
        roundtrip::<models::McpServer>("McpServer", server.clone());
        roundtrip::<models::InvokeInputWire>(
            "InvokeInputWire",
            json!({
                "contexts":{"schema":"octo.context-envelope/v3","items":[{
                    "namespace":"octo.execution","name":"mcp","payload":{"mcpServers":{"example":server}}
                }]}, "inputs":[{"type":"text","text":"test"}],
                "extension":{"big":900719925474099312345_u128}
            }),
        );
    }
}

#[test]
fn mathematical_integer_binding_preserves_opaque_numbers() {
    for token in ["1", "1.0", "1e0", "9007199254740991.0"] {
        let input = r#"{"contexts":{"schema":"octo.context-envelope/v3","items":[]},"inputs":[{"type":"text","text":"test"}],"sessionGeneration":TOKEN,"future":{"n":1.0,"big":900719925474099312345}}"#.replace("TOKEN",token);
        let value: models::InvokeInputWire = decode("InvokeInputWire", input.as_bytes()).unwrap();
        assert!(matches!(value.session_generation, Presence::Present(_)));
        let output = String::from_utf8(encode("InvokeInputWire", &value).unwrap()).unwrap();
        assert!(output.contains(r#""n":1.0"#), "{output}");
        assert!(output.contains("900719925474099312345"));
        let reply = r#"{"requestId":TOKEN,"payload":{"id":TOKEN}}"#.replace("TOKEN", token);
        let _: models::NativeInteractionResponse =
            decode("NativeInteractionResponse", reply.as_bytes()).unwrap();
    }
    for token in ["1.5", "true", "null", "9007199254740992"] {
        let input = r#"{"contexts":{"schema":"octo.context-envelope/v3","items":[]},"inputs":[{"type":"text","text":"test"}],"sessionGeneration":TOKEN}"#.replace("TOKEN",token);
        assert!(decode::<models::InvokeInputWire>("InvokeInputWire", input.as_bytes()).is_err());
    }
}
