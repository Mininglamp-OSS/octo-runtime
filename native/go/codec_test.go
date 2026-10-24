package octo

import (
	"bytes"
	"encoding/json"
	"errors"
	"testing"
)

func TestEncodeRejectsNativeInvalidUTF8BeforeJSONReplacement(t *testing.T) {
	value := KernelLookupKey{RunId: string([]byte{0xff}), InvocationId: "i", AgentSessionId: "s", ProtocolMode: "native"}
	_, err := Encode("KernelLookupKey", value)
	var typed *Error
	if !errors.As(err, &typed) || typed.Code != "INVALID_JSON_UNICODE" {
		t.Fatalf("expected strict Unicode rejection, got %v", err)
	}
}

func TestOpaqueNumbersAndPresenceSurviveRoundTrip(t *testing.T) {
	// 未知扩展中的大整数和显式 null 不得投影到 float64 或缺省。
	value, err := Decode[ProviderSession]("ProviderSession", []byte(`{"sessionId":"s","future":{"integer":900719925474099312345,"nullable":null}}`))
	if err != nil {
		t.Fatal(err)
	}
	encoded, err := Encode("ProviderSession", value)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(encoded, []byte(`900719925474099312345`)) || !bytes.Contains(encoded, []byte(`"nullable":null`)) {
		t.Fatalf("opaque JSON changed: %s", encoded)
	}
	if bytes.Contains(encoded, []byte(`"provider"`)) {
		t.Fatalf("absent field was emitted: %s", encoded)
	}
}

func TestRawMalformedUnicodeIsRejected(t *testing.T) {
	for _, payload := range []json.RawMessage{json.RawMessage(`{"x":"\ud800"}`), json.RawMessage{'"', 0xff, '"'}} {
		_, err := Encode("ProviderSession", map[string]any{"sessionId": "s", "future": payload})
		if err == nil {
			t.Fatalf("accepted malformed opaque JSON %q", payload)
		}
	}
}

func TestOpenModelExtensionsRejectMalformedUnicode(t *testing.T) {
	for _, extra := range []map[string]json.RawMessage{
		{string([]byte{0xff}): json.RawMessage(`{"x":1}`)},
		{"future": json.RawMessage(`{"x":"\ud800"}`)},
		{"future": json.RawMessage{'"', 0xff, '"'}},
	} {
		value := ProviderSession{SessionId: "s", Extra: extra}
		for _, encode := range []func() ([]byte, error){
			func() ([]byte, error) { return Encode("ProviderSession", value) },
			func() ([]byte, error) { return json.Marshal(value) },
		} {
			_, err := encode()
			var typed *Error
			if !errors.As(err, &typed) || typed.Code != "INVALID_JSON_UNICODE" {
				t.Fatalf("expected strict extension rejection, got %v", err)
			}
		}
	}
	value := ProviderSession{SessionId: "s", Extra: map[string]json.RawMessage{"\u754c": json.RawMessage(`{"big":900719925474099312345,"n":1.0}`)}}
	encoded, err := Encode("ProviderSession", value)
	if err != nil || !bytes.Contains(encoded, []byte("\u754c")) || !bytes.Contains(encoded, []byte(`{"big":900719925474099312345,"n":1.0}`)) {
		t.Fatalf("valid extension changed: %s, %v", encoded, err)
	}
}

func TestMathematicalIntegerBindingPreservesOpaqueNumbers(t *testing.T) {
	for _, n := range []string{"1", "1.0", "1e0", "9007199254740991.0"} {
		data := []byte(`{"contexts":{"schema":"octo.context-envelope/v3","items":[]},"inputs":[{"type":"text","text":"test"}],"sessionGeneration":` + n + `,"future":{"n":1.0,"big":900719925474099312345}}`)
		value, err := Decode[InvokeInputWire]("InvokeInputWire", data)
		if err != nil {
			t.Fatalf("%s: %v", n, err)
		}
		if !value.SessionGeneration.Set {
			t.Fatal("lost presence")
		}
		encoded, err := Encode("InvokeInputWire", value)
		if err != nil {
			t.Fatal(err)
		}
		if !bytes.Contains(encoded, []byte(`"n":1.0`)) || !bytes.Contains(encoded, []byte(`900719925474099312345`)) {
			t.Fatalf("opaque numbers changed: %s", encoded)
		}
	}
	for _, n := range []string{"1.5", "true", "null", "9007199254740992"} {
		_, err := Decode[InvokeInputWire]("InvokeInputWire", []byte(`{"contexts":{"schema":"octo.context-envelope/v3","items":[]},"inputs":[{"type":"text","text":"test"}],"sessionGeneration":`+n+`}`))
		if err == nil {
			t.Fatalf("accepted invalid integer %s", n)
		}
	}
}
