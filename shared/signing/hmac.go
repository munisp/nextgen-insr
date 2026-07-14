package signing

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/http"
	"os"
	"strconv"
	"time"
)

var signingKey []byte

func init() {
	key := os.Getenv("SERVICE_SIGNING_KEY")
	if key == "" {
		key = "insureportal-default-signing-key"
	}
	signingKey = []byte(key)
}

// SignRequest adds HMAC signature headers to outgoing inter-service requests.
func SignRequest(req *http.Request, body []byte) {
	timestamp := strconv.FormatInt(time.Now().Unix(), 10)
	payload := fmt.Sprintf("%s:%s:%s", req.Method, req.URL.Path, timestamp)
	if len(body) > 0 {
		payload += ":" + string(body)
	}
	mac := hmac.New(sha256.New, signingKey)
	mac.Write([]byte(payload))
	signature := hex.EncodeToString(mac.Sum(nil))

	req.Header.Set("X-Service-Timestamp", timestamp)
	req.Header.Set("X-Service-Signature", signature)
}

// VerifyRequest validates HMAC signature on incoming inter-service requests.
func VerifyRequest(r *http.Request, body []byte) bool {
	timestamp := r.Header.Get("X-Service-Timestamp")
	signature := r.Header.Get("X-Service-Signature")
	if timestamp == "" || signature == "" {
		return false
	}

	// Reject requests older than 5 minutes
	ts, err := strconv.ParseInt(timestamp, 10, 64)
	if err != nil || time.Since(time.Unix(ts, 0)) > 5*time.Minute {
		return false
	}

	payload := fmt.Sprintf("%s:%s:%s", r.Method, r.URL.Path, timestamp)
	if len(body) > 0 {
		payload += ":" + string(body)
	}
	mac := hmac.New(sha256.New, signingKey)
	mac.Write([]byte(payload))
	expected := hex.EncodeToString(mac.Sum(nil))

	return hmac.Equal([]byte(signature), []byte(expected))
}
