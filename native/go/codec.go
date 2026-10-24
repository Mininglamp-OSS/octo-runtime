package octo

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"math/big"
	"net/url"
	"reflect"
	"regexp"
	"strconv"
	"strings"
	"unicode/utf8"
)

// Optional 区分未出现与显式零值；可空类型使用 Optional[*T]。
type Optional[T any] struct {
	Value T
	Set   bool
}

func Some[T any](v T) Optional[T]                   { return Optional[T]{Value: v, Set: true} }
func (v Optional[T]) IsZero() bool                  { return !v.Set }
func (v Optional[T]) bindingType() reflect.Type     { return reflect.TypeFor[T]() }
func (v Optional[T]) MarshalJSON() ([]byte, error)  { return marshalJSON(v.Value) }
func (v *Optional[T]) UnmarshalJSON(b []byte) error { v.Set = true; return json.Unmarshal(b, &v.Value) }

func marshalOpen(v any, extra map[string]json.RawMessage) ([]byte, error) {
	// Extra 虽标记为 json:"-"，仍由此 marshaler 输出，必须在标准库替换坏字符前检查。
	if e := checkStrings(reflect.ValueOf(extra), 0); e != nil {
		return nil, e
	}
	b, e := marshalJSON(v)
	if e != nil {
		return nil, e
	}
	var m map[string]json.RawMessage
	if e = json.Unmarshal(b, &m); e != nil {
		return nil, e
	}
	for k, x := range extra {
		if _, exists := m[k]; exists {
			return nil, fmt.Errorf("extra property conflicts with declared field: %s", k)
		}
		m[k] = x
	}
	return marshalJSON(m)
}
func unmarshalOpen(b []byte, v any, extra *map[string]json.RawMessage) error {
	if e := json.Unmarshal(b, v); e != nil {
		return e
	}
	var m map[string]json.RawMessage
	if e := json.Unmarshal(b, &m); e != nil {
		return e
	}
	t := reflect.TypeOf(v).Elem()
	for i := 0; i < t.NumField(); i++ {
		delete(m, strings.Split(t.Field(i).Tag.Get("json"), ",")[0])
	}
	*extra = m
	return nil
}

// decodeJSON 不把 opaque 数字投影到 float64，也不允许 Go 默认替换坏 UTF-8/surrogate。
func decodeJSON(data []byte) (any, error) {
	if !utf8.Valid(data) || !validEscapes(data) {
		return nil, &Error{Code: "INVALID_JSON_UNICODE"}
	}
	d := json.NewDecoder(bytes.NewReader(data))
	d.UseNumber()
	var v any
	if e := d.Decode(&v); e != nil {
		return nil, &Error{Code: "INVALID_JSON", Cause: e}
	}
	var trailing any
	if e := d.Decode(&trailing); e != io.EOF {
		return nil, &Error{Code: "INVALID_JSON"}
	}
	return v, nil
}
func validEscapes(b []byte) bool {
	// 转义扫描只在 JSON 字符串中识别 \u；双反斜线不能被误判为 surrogate。
	in := false
	hex := func(p []byte) int {
		v := 0
		for _, c := range p {
			v *= 16
			switch {
			case c >= '0' && c <= '9':
				v += int(c - '0')
			case c >= 'a' && c <= 'f':
				v += int(c-'a') + 10
			case c >= 'A' && c <= 'F':
				v += int(c-'A') + 10
			default:
				return -1
			}
		}
		return v
	}
	for i := 0; i < len(b); i++ {
		if b[i] == '"' {
			in = !in
			continue
		}
		if !in || b[i] != '\\' {
			continue
		}
		i++
		if i >= len(b) {
			return false
		}
		if b[i] != 'u' {
			continue
		}
		if i+4 >= len(b) {
			return false
		}
		v := hex(b[i+1 : i+5])
		i += 4
		if v >= 0xdc00 && v <= 0xdfff {
			return false
		}
		if v >= 0xd800 && v <= 0xdbff {
			if i+6 >= len(b) || b[i+1] != '\\' || b[i+2] != 'u' {
				return false
			}
			w := hex(b[i+3 : i+7])
			if w < 0xdc00 || w > 0xdfff {
				return false
			}
			i += 6
		}
	}
	return true
}

// Validate 与 Decode 是公开 wire 边界；直接 json.Unmarshal 只用于标准库数据绑定。
func Validate(definition string, data []byte) error {
	v, e := decodeJSON(data)
	if e != nil {
		return e
	}
	id, ok := definitionRules[definition]
	if !ok {
		return fmt.Errorf("unknown definition %s", definition)
	}
	return validate(id, v, "$")
}
func Decode[T any](definition string, data []byte) (T, error) {
	var v T
	if e := Validate(definition, data); e != nil {
		return v, e
	}
	e := unmarshalWire(data, &v)
	return v, e
}

// 只在目标类型的整数槽位规范化数学整数；RawMessage、未知扩展和 json.Number
// 保留原数值 token，不能为修复已知字段而把 Provider 数据转成浮点数。
func unmarshalWire(data []byte, target any) error {
	b, err := integerBindings(data, reflect.TypeOf(target))
	if err != nil {
		return err
	}
	return json.Unmarshal(b, target)
}
func integerBindings(data []byte, t reflect.Type) ([]byte, error) {
	for t.Kind() == reflect.Pointer {
		t = t.Elem()
	}
	if bytes.Equal(bytes.TrimSpace(data), []byte("null")) || t == reflect.TypeFor[json.RawMessage]() {
		return data, nil
	}
	if optional, ok := reflect.Zero(t).Interface().(interface{ bindingType() reflect.Type }); ok {
		return integerBindings(data, optional.bindingType())
	}
	switch t.Kind() {
	case reflect.Int, reflect.Int64, reflect.Int32, reflect.Int16, reflect.Int8:
		var n json.Number
		if err := json.Unmarshal(data, &n); err != nil {
			return nil, err
		}
		i, err := integerNumber(n)
		if err != nil {
			return nil, err
		}
		return []byte(fmt.Sprint(i)), nil
	case reflect.Struct:
		var m map[string]json.RawMessage
		if err := json.Unmarshal(data, &m); err != nil {
			return nil, err
		}
		for i := 0; i < t.NumField(); i++ {
			field := t.Field(i)
			name := strings.Split(field.Tag.Get("json"), ",")[0]
			if !field.IsExported() || name == "-" {
				continue
			}
			if name == "" {
				name = field.Name
			}
			if value, ok := m[name]; ok {
				b, err := integerBindings(value, field.Type)
				if err != nil {
					return nil, err
				}
				m[name] = b
			}
		}
		return marshalJSON(m)
	case reflect.Slice, reflect.Array:
		var a []json.RawMessage
		if err := json.Unmarshal(data, &a); err != nil {
			return nil, err
		}
		for i, value := range a {
			b, err := integerBindings(value, t.Elem())
			if err != nil {
				return nil, err
			}
			a[i] = b
		}
		return marshalJSON(a)
	case reflect.Map:
		var m map[string]json.RawMessage
		if err := json.Unmarshal(data, &m); err != nil {
			return nil, err
		}
		for k, value := range m {
			b, err := integerBindings(value, t.Elem())
			if err != nil {
				return nil, err
			}
			m[k] = b
		}
		return marshalJSON(m)
	}
	return data, nil
}
func integerNumber(n json.Number) (int64, error) {
	r, ok := new(big.Rat).SetString(string(n))
	if !ok || !r.IsInt() || !r.Num().IsInt64() {
		return 0, invalid("integer")
	}
	return r.Num().Int64(), nil
}
func Encode(definition string, value any) ([]byte, error) {
	if e := checkStrings(reflect.ValueOf(value), 0); e != nil {
		return nil, e
	}
	b, e := marshalJSON(value)
	if e != nil {
		return nil, e
	}
	if e = Validate(definition, b); e != nil {
		return nil, e
	}
	return b, nil
}

// 标准库会把坏 UTF-8 替换为 U+FFFD；必须在 marshaler 运行之前拒绝它。
func checkStrings(v reflect.Value, depth int) error {
	if !v.IsValid() {
		return nil
	}
	if depth > 256 {
		return &Error{Code: "INVALID_JSON"}
	}
	if v.Type() == reflect.TypeOf(json.RawMessage{}) {
		if v.IsNil() {
			return nil
		}
		_, e := decodeJSON(v.Bytes())
		return e
	}
	switch v.Kind() {
	case reflect.String:
		if !utf8.ValidString(v.String()) {
			return &Error{Code: "INVALID_JSON_UNICODE"}
		}
	case reflect.Pointer, reflect.Interface:
		if !v.IsNil() {
			return checkStrings(v.Elem(), depth+1)
		}
	case reflect.Struct:
		for i := 0; i < v.NumField(); i++ {
			if v.Type().Field(i).IsExported() && v.Type().Field(i).Tag.Get("json") != "-" {
				if e := checkStrings(v.Field(i), depth+1); e != nil {
					return e
				}
			}
		}
	case reflect.Map:
		for it := v.MapRange(); it.Next(); {
			if e := checkStrings(it.Key(), depth+1); e != nil {
				return e
			}
			if e := checkStrings(it.Value(), depth+1); e != nil {
				return e
			}
		}
	case reflect.Array, reflect.Slice:
		if v.Type().Elem().Kind() != reflect.Uint8 {
			for i := 0; i < v.Len(); i++ {
				if e := checkStrings(v.Index(i), depth+1); e != nil {
					return e
				}
			}
		}
	}
	return nil
}
func marshalJSON(value any) ([]byte, error) {
	var output bytes.Buffer
	encoder := json.NewEncoder(&output)
	encoder.SetEscapeHTML(false)
	if e := encoder.Encode(value); e != nil {
		return nil, e
	}
	return bytes.TrimSuffix(output.Bytes(), []byte{'\n'}), nil
}

type rule struct {
	Ref, Items, If, Then, Else, Not, Contains, PropertyNames, AdditionalProperties           int
	Types, Values, Required                                                                  []string
	Properties                                                                               map[string]int
	Strict, UniqueItems                                                                      bool
	OneOf, AnyOf, AllOf                                                                      []int
	Minimum, Maximum, MinLength, MaxLength, MinItems, MaxItems, MinProperties, MaxProperties *float64
	Pattern, Format                                                                          string
	Extensions                                                                               map[string]int
}
type methodRule struct {
	Params, Result     int
	SideEffect, Stream bool
}

func bound(v float64) *float64 { return &v }
func invalid(path string) error {
	return &Error{Code: "VALIDATION_ERROR", Cause: fmt.Errorf("invalid value at %s", path)}
}
func fits(v float64, min, max *float64) bool {
	return (min == nil || v >= *min) && (max == nil || v <= *max)
}
func jsonEqual(a, b any) bool {
	if x, ok := a.(json.Number); ok {
		y, ok := b.(json.Number)
		if !ok {
			return false
		}
		left, lok := new(big.Rat).SetString(string(x))
		right, rok := new(big.Rat).SetString(string(y))
		return lok && rok && left.Cmp(right) == 0
	}
	if x, ok := a.(map[string]any); ok {
		y, ok := b.(map[string]any)
		if !ok || len(x) != len(y) {
			return false
		}
		for k, v := range x {
			w, exists := y[k]
			if !exists || !jsonEqual(v, w) {
				return false
			}
		}
		return true
	}
	if x, ok := a.([]any); ok {
		y, ok := b.([]any)
		if !ok || len(x) != len(y) {
			return false
		}
		for i, v := range x {
			if !jsonEqual(v, y[i]) {
				return false
			}
		}
		return true
	}
	return reflect.DeepEqual(a, b)
}
func validate(id int, v any, path string) error {
	r := rules[id]
	bad := func() error { return invalid(path) }
	if r.Ref > 0 {
		return validate(r.Ref-1, v, path)
	}
	if len(r.Types) > 0 {
		ok := false
		for _, t := range r.Types {
			switch t {
			case "null":
				ok = ok || v == nil
			case "boolean":
				_, yes := v.(bool)
				ok = ok || yes
			case "string":
				_, yes := v.(string)
				ok = ok || yes
			case "object":
				_, yes := v.(map[string]any)
				ok = ok || yes
			case "array":
				_, yes := v.([]any)
				ok = ok || yes
			case "number", "integer":
				if n, yes := v.(json.Number); yes {
					f, yes := new(big.Rat).SetString(string(n))
					ok = ok || (yes && (t == "number" || f.IsInt()))
				}
			}
		}
		if !ok {
			return bad()
		}
	}
	if len(r.Values) > 0 {
		ok := false
		for _, s := range r.Values {
			w, _ := decodeJSON([]byte(s))
			ok = ok || jsonEqual(v, w)
		}
		if !ok {
			return bad()
		}
	}
	if n, ok := v.(json.Number); ok && (r.Minimum != nil || r.Maximum != nil) {
		f, yes := new(big.Rat).SetString(string(n))
		if !yes {
			return bad()
		}
		if r.Minimum != nil && f.Cmp(new(big.Rat).SetFloat64(*r.Minimum)) < 0 {
			return bad()
		}
		if r.Maximum != nil && f.Cmp(new(big.Rat).SetFloat64(*r.Maximum)) > 0 {
			return bad()
		}
	}
	if s, ok := v.(string); ok {
		if !fits(float64(utf8.RuneCountInString(s)), r.MinLength, r.MaxLength) {
			return bad()
		}
		if r.Pattern != "" {
			pattern := strings.ReplaceAll(r.Pattern, `\u0000`, "\x00")
			matched, e := regexp.MatchString(pattern, s)
			if e != nil || !matched {
				return bad()
			}
		}
		if r.Format == "date-time" { /* Format is an annotation in the source Draft-07 checker. */
		}
	}
	if m, ok := v.(map[string]any); ok {
		if !fits(float64(len(m)), r.MinProperties, r.MaxProperties) {
			return bad()
		}
		for _, k := range r.Required {
			if _, ok := m[k]; !ok {
				return invalid(path + "." + k)
			}
		}
		for k, x := range m {
			if r.PropertyNames > 0 {
				if e := validate(r.PropertyNames-1, k, path); e != nil {
					return e
				}
			}
			if child, yes := r.Properties[k]; yes {
				if e := validate(child, x, path+"."+k); e != nil {
					return e
				}
			} else if r.Strict {
				return invalid(path + "." + k)
			} else if r.AdditionalProperties > 0 {
				if e := validate(r.AdditionalProperties-1, x, path+"."+k); e != nil {
					return e
				}
			}
		}
	}
	if a, ok := v.([]any); ok {
		if !fits(float64(len(a)), r.MinItems, r.MaxItems) {
			return bad()
		}
		contains := r.Contains == 0
		seen := map[string]bool{}
		for i, x := range a {
			if r.Items > 0 {
				if e := validate(r.Items-1, x, fmt.Sprintf("%s[%d]", path, i)); e != nil {
					return e
				}
			}
			if r.Contains > 0 && validate(r.Contains-1, x, path) == nil {
				contains = true
			}
			if r.UniqueItems {
				b, _ := json.Marshal(x)
				if seen[string(b)] {
					return bad()
				}
				seen[string(b)] = true
			}
		}
		if !contains {
			return bad()
		}
	}
	for _, child := range r.AllOf {
		if e := validate(child, v, path); e != nil {
			return e
		}
	}
	for _, union := range []struct {
		ids   []int
		exact bool
	}{{r.OneOf, true}, {r.AnyOf, false}} {
		if len(union.ids) > 0 {
			n := 0
			for _, child := range union.ids {
				if validate(child, v, path) == nil {
					n++
				}
			}
			if n == 0 || (union.exact && n != 1) {
				return bad()
			}
		}
	}
	if r.Not > 0 && validate(r.Not-1, v, path) == nil {
		return bad()
	}
	if r.If > 0 {
		child := r.Else
		if validate(r.If-1, v, path) == nil {
			child = r.Then
		}
		if child > 0 {
			if e := validate(child-1, v, path); e != nil {
				return e
			}
		}
	}
	for ext, limit := range r.Extensions {
		if e := refinement(ext, limit, v, path); e != nil {
			return e
		}
	}
	return nil
}
func refinement(ext string, limit int, v any, path string) error {
	bad := func() error { return invalid(path + " (" + ext + ")") }
	switch ext {
	case "x-octo-unicode-scalar-strings": // decodeJSON has already validated the entire tree.
	case "x-octo-max-json-bytes":
		b, _ := marshalJSON(v)
		if len(b)-separatorEscapeBytes(v) > limit {
			return bad()
		}
	case "x-octo-max-json-depth":
		if depth(v) > limit {
			return bad()
		}
	case "x-octo-max-utf8-bytes":
		if s, ok := v.(string); ok && len(s) > limit {
			return bad()
		}
	case "x-octo-max-utf16-length":
		if s, ok := v.(string); ok {
			n := 0
			for _, c := range s {
				n++
				if c > 0xffff {
					n++
				}
			}
			if n > limit {
				return bad()
			}
		}
	case "x-octo-http-url":
		if s, ok := v.(string); ok {
			u, e := url.Parse(s)
			if e != nil || (u.Scheme != "https" && u.Scheme != "http") || u.Hostname() == "" || u.User != nil {
				return bad()
			}
			if port := u.Port(); port != "" {
				if _, e := strconv.ParseUint(port, 10, 16); e != nil {
					return bad()
				}
			}
		}
	case "x-octo-unique-type-keys", "x-octo-unique-env-keys", "x-octo-unique-header-names", "x-octo-unique-resource-refs":
		m, _ := v.(map[string]any)
		if ext == "x-octo-unique-header-names" {
			seen := map[string]bool{}
			for k := range m {
				key := strings.ToLower(k)
				if seen[key] {
					return bad()
				}
				seen[key] = true
			}
			return nil
		}
		field, keys := "items", []string{"namespace", "name"}
		switch ext {
		case "x-octo-unique-env-keys":
			field = "env_variables"
			keys = []string{"key"}
		case "x-octo-unique-header-names":
			field = "headers"
			keys = []string{"name"}
		case "x-octo-unique-resource-refs":
			field = "entries"
			keys = []string{"resource_ref"}
		}
		a, _ := m[field].([]any)
		if direct, ok := v.([]any); ok {
			a = direct
		}
		seen := map[string]bool{}
		for _, x := range a {
			item, _ := x.(map[string]any)
			parts := []any{}
			for _, k := range keys {
				val := item[k]
				if ext == "x-octo-unique-header-names" {
					if s, ok := val.(string); ok {
						val = strings.ToLower(s)
					}
				}
				parts = append(parts, val)
			}
			b, _ := json.Marshal(parts)
			if seen[string(b)] {
				return bad()
			}
			seen[string(b)] = true
		}
	case "x-octo-matching-trigger-fields":
		m, _ := v.(map[string]any)
		fact, _ := m["trigger_fact"].(map[string]any)
		a, ap := m["trigger_seq"]
		b, bp := fact["message_seq"]
		if !jsonEqual(m["trigger_message_id"], fact["message_id"]) || ap != bp || (ap && !jsonEqual(a, b)) {
			return bad()
		}
	case "x-octo-runtime-selection-invariants":
		m, _ := v.(map[string]any)
		a, _ := m["authorized_candidates"].([]any)
		ids, priorities := map[string]bool{}, map[string]bool{}
		for _, item := range a {
			x, _ := item.(map[string]any)
			id, _ := x["runtime_id"].(string)
			p, _ := json.Marshal(x["priority"])
			if ids[id] || priorities[string(p)] {
				return bad()
			}
			ids[id] = true
			priorities[string(p)] = true
		}
		explicit, has := m["explicit_runtime_id"].(string)
		if m["selection_mode"] == "explicit" {
			if !has || len(a) != 1 || !ids[explicit] || m["failover"] != "none" {
				return bad()
			}
		} else if _, exists := m["explicit_runtime_id"]; exists {
			return bad()
		}

	default:
		return fmt.Errorf("unsupported compiled refinement %s", ext)
	}
	return nil
}

// Context 预算按紧凑 UTF-8 JSON 计数；Go 即使关闭 HTML 转义也会额外转义这两个标量。
func separatorEscapeBytes(v any) int {
	switch v := v.(type) {
	case string:
		return 3 * (strings.Count(v, "\u2028") + strings.Count(v, "\u2029"))
	case []any:
		n := 0
		for _, item := range v {
			n += separatorEscapeBytes(item)
		}
		return n
	case map[string]any:
		n := 0
		for key, item := range v {
			n += separatorEscapeBytes(key) + separatorEscapeBytes(item)
		}
		return n
	}
	return 0
}
func depth(v any) int {
	n := 0
	switch x := v.(type) {
	case map[string]any:
		if len(x) == 0 {
			return 0
		}
		for _, c := range x {
			if d := depth(c); d > n {
				n = d
			}
		}
		return n + 1
	case []any:
		if len(x) == 0 {
			return 0
		}
		for _, c := range x {
			if d := depth(c); d > n {
				n = d
			}
		}
		return n + 1
	}
	return 0
}
