package octo

import "fmt"

// Error 保留未知业务错误码和原 data；Cause 可由 errors.Is/As 检查。
type Error struct {
	Code   string
	Data   map[string]any
	Cause  error
	Remote bool
}

func (e *Error) Error() string {
	if e.Cause != nil {
		return fmt.Sprintf("%s: %v", e.Code, e.Cause)
	}
	return e.Code
}
func (e *Error) Unwrap() error { return e.Cause }
func code(e error) string {
	if e, ok := e.(*Error); ok {
		return e.Code
	}
	return ""
}
func retryable(e error) bool {
	for _, s := range retryableErrors {
		if code(e) == s {
			return true
		}
	}
	return false
}
