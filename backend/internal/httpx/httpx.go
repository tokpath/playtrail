// Package httpx holds the HTTP plumbing shared by all handlers: the unified
// error body (ARCHITECTURE §6.1), JSON helpers, and middleware.
package httpx

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"time"

	"github.com/google/uuid"
)

// Error codes from PRD appendix A / ARCHITECTURE §6.1.
const (
	CodeInvalidParam         = "INVALID_PARAM"
	CodeValidationFailed     = "VALIDATION_FAILED"
	CodeUnauthenticated      = "UNAUTHENTICATED"
	CodeForbidden            = "FORBIDDEN"
	CodeNotFound             = "NOT_FOUND"
	CodeGone                 = "GONE"
	CodeRevisionConflict     = "REVISION_CONFLICT"
	CodePayloadTooLarge      = "PAYLOAD_TOO_LARGE"
	CodeUnsupportedMediaType = "UNSUPPORTED_MEDIA_TYPE"
	CodePublishGateFailed    = "PUBLISH_GATE_FAILED"
	CodeRateLimited          = "RATE_LIMITED"
	CodeInternalError        = "INTERNAL_ERROR"
)

// Error is the unified API error. Handlers and domain packages return it;
// WriteError renders it without ever leaking stacks or SQL.
type Error struct {
	Status      int
	Code        string
	Message     string
	FieldErrors map[string]string
}

func (e *Error) Error() string { return fmt.Sprintf("%s: %s", e.Code, e.Message) }

func New(status int, code, message string) *Error {
	return &Error{Status: status, Code: code, Message: message}
}

func InvalidParam(msg string) *Error { return New(http.StatusBadRequest, CodeInvalidParam, msg) }
func Unauthenticated() *Error {
	return New(http.StatusUnauthorized, CodeUnauthenticated, "authentication required")
}
func Forbidden(msg string) *Error { return New(http.StatusForbidden, CodeForbidden, msg) }
func NotFound(msg string) *Error  { return New(http.StatusNotFound, CodeNotFound, msg) }
func Gone() *Error                { return New(http.StatusGone, CodeGone, "this game has been unlisted") }
func RevisionConflict() *Error {
	return New(http.StatusConflict, CodeRevisionConflict, "revision version conflict; reload and try again")
}
func PayloadTooLarge(msg string) *Error {
	return New(http.StatusRequestEntityTooLarge, CodePayloadTooLarge, msg)
}
func UnsupportedMediaType(msg string) *Error {
	return New(http.StatusUnsupportedMediaType, CodeUnsupportedMediaType, msg)
}
func RateLimited() *Error {
	return New(http.StatusTooManyRequests, CodeRateLimited, "rate limit exceeded")
}
func Internal(msg string) *Error { return New(http.StatusInternalServerError, CodeInternalError, msg) }

// Validation builds a 422 VALIDATION_FAILED error with field errors.
func Validation(fieldErrors map[string]string) *Error {
	return &Error{Status: http.StatusUnprocessableEntity, Code: CodeValidationFailed,
		Message: "validation failed", FieldErrors: fieldErrors}
}

type requestIDKey struct{}
type loggerKey struct{}

// RequestID returns the request id stored by the RequestID middleware.
func RequestID(ctx context.Context) string {
	if id, ok := ctx.Value(requestIDKey{}).(string); ok {
		return id
	}
	return ""
}

// Logger returns the slog logger stored by the Logger middleware.
func Logger(ctx context.Context) *slog.Logger {
	if l, ok := ctx.Value(loggerKey{}).(*slog.Logger); ok {
		return l
	}
	return slog.Default()
}

// NewError creates an *Error from any error, mapping unknown errors to 500.
func AsError(err error) *Error {
	var apiErr *Error
	if errors.As(err, &apiErr) {
		return apiErr
	}
	return Internal("internal error")
}

// WriteError renders err as the unified error body. Unexpected errors
// (anything not already an *Error) are logged for diagnosis without leaking
// details into the response.
func WriteError(w http.ResponseWriter, r *http.Request, err error) {
	var apiErr *Error
	if !errors.As(err, &apiErr) {
		Logger(r.Context()).Error("unexpected handler error", "error", err)
		apiErr = Internal("internal error")
	}
	body := struct {
		Code        string            `json:"code"`
		Message     string            `json:"message"`
		FieldErrors map[string]string `json:"fieldErrors,omitempty"`
		RequestID   string            `json:"requestId"`
	}{
		Code:        apiErr.Code,
		Message:     apiErr.Message,
		FieldErrors: apiErr.FieldErrors,
		RequestID:   RequestID(r.Context()),
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(apiErr.Status)
	_ = json.NewEncoder(w).Encode(body)
}

// JSON writes a JSON response body.
func JSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if v != nil {
		_ = json.NewEncoder(w).Encode(v)
	}
}

// DecodeJSON reads a JSON request body into v, rejecting unknown fields for
// strict endpoints and limiting body size to maxBytes.
func DecodeJSON(w http.ResponseWriter, r *http.Request, v any, maxBytes int64, disallowUnknown bool) error {
	r.Body = http.MaxBytesReader(w, r.Body, maxBytes)
	dec := json.NewDecoder(r.Body)
	if disallowUnknown {
		dec.DisallowUnknownFields()
	}
	if err := dec.Decode(v); err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			return PayloadTooLarge(fmt.Sprintf("request body exceeds %d bytes", tooLarge.Limit))
		}
		return InvalidParam("malformed JSON body")
	}
	if err := dec.Decode(&struct{}{}); err != io.EOF {
		return InvalidParam("unexpected trailing data in JSON body")
	}
	return nil
}

// RequestID middleware assigns (or reuses) an X-Request-Id and stores it in context.
func RequestIDMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := r.Header.Get("X-Request-Id")
		if _, err := uuid.Parse(id); err != nil {
			id = uuid.NewString()
		}
		w.Header().Set("X-Request-Id", id)
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), requestIDKey{}, id)))
	})
}

// Logger middleware injects the logger and writes one structured access log line.
func LoggerMiddleware(log *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			start := time.Now()
			rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
			next.ServeHTTP(rec, r)
			log.Info("request",
				"requestId", RequestID(r.Context()),
				"method", r.Method,
				"path", r.URL.Path,
				"status", rec.status,
				"duration", time.Since(start).String(),
			)
		})
	}
}

type statusRecorder struct {
	http.ResponseWriter
	status      int
	wroteHeader bool
}

func (rec *statusRecorder) WriteHeader(code int) {
	if !rec.wroteHeader {
		rec.status = code
		rec.wroteHeader = true
	}
	rec.ResponseWriter.WriteHeader(code)
}

// Recover converts panics into 500 responses without leaking the stack.
func Recover(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if rec := recover(); rec != nil {
				Logger(r.Context()).Error("panic recovered", "panic", fmt.Sprint(rec))
				WriteError(w, r, Internal("internal error"))
			}
		}()
		next.ServeHTTP(w, r)
	})
}

// CacheControl sets the response cache header appropriate for the group.
func CacheControl(public bool) func(http.Handler) http.Handler {
	value := "no-store"
	if public {
		value = "public, max-age=0, s-maxage=30"
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Cache-Control", value)
			next.ServeHTTP(w, r)
		})
	}
}
