use octo_runtime_client::{decode, encode, models, Presence};

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
