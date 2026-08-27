package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"

	"github.com/gin-gonic/gin"
)

// USSDSession represents an active USSD session
type USSDSession struct {
	SessionID   string            `json:"sessionId"`
	PhoneNumber string            `json:"phoneNumber"`
	ServiceCode string            `json:"serviceCode"`
	Text        string            `json:"text"`
	State       string            `json:"state"`
	Data        map[string]string `json:"data"`
	CreatedAt   time.Time         `json:"createdAt"`
}

// Menu represents a USSD menu structure
type Menu struct {
	Title   string
	Options []MenuOption
}

type MenuOption struct {
	Key     string
	Label   string
	Handler func(session *USSDSession, input string) string
}

// sessionRegistry tracks real USSD sessions in process memory so the admin
// session/stats endpoints report measured data (honestly labeled
// "since process start") instead of fabricated constants.
type sessionRegistry struct {
	mu        sync.Mutex
	sessions  map[string]*USSDSession
	total     int64
	completed int64
	flows     map[string]int64
	startedAt time.Time
}

var registry = &sessionRegistry{
	sessions:  make(map[string]*USSDSession),
	flows:     make(map[string]int64),
	startedAt: time.Now(),
}

// activeWindow is how long since the last interaction a session counts as active.
const activeWindow = 3 * time.Minute

func (r *sessionRegistry) record(sessionID, phoneNumber, serviceCode, text string, completed bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	s, ok := r.sessions[sessionID]
	if !ok {
		s = &USSDSession{SessionID: sessionID, PhoneNumber: phoneNumber, ServiceCode: serviceCode, CreatedAt: time.Now(), Data: map[string]string{}}
		r.sessions[sessionID] = s
		r.total++
	}
	s.Text = text
	s.Data["last_seen"] = time.Now().Format(time.RFC3339)
	if completed {
		r.completed++
	}
	// Flow attribution by first menu choice (only when the session starts).
	if len(text) >= 1 && !ok {
		switch text[:1] {
		case "1":
			r.flows["policy_status"]++
		case "2":
			r.flows["file_claim"]++
		case "3":
			r.flows["pay_premium"]++
		case "4":
			r.flows["get_quote"]++
		case "5":
			r.flows["wallet_balance"]++
		case "6":
			r.flows["contact_support"]++
		}
	}
	// opportunistic cleanup of stale sessions
	if len(r.sessions) > 10000 {
		cutoff := time.Now().Add(-activeWindow)
		for id, sess := range r.sessions {
			lastSeen, err := time.Parse(time.RFC3339, sess.Data["last_seen"])
			if err != nil || lastSeen.Before(cutoff) {
				delete(r.sessions, id)
			}
		}
	}
}

func (r *sessionRegistry) snapshot() (total, active, completed int64, topFlows []string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	cutoff := time.Now().Add(-activeWindow)
	for _, sess := range r.sessions {
		if lastSeen, err := time.Parse(time.RFC3339, sess.Data["last_seen"]); err == nil && lastSeen.After(cutoff) {
			active++
		}
	}
	for name, count := range r.flows {
		if count > 0 {
			topFlows = append(topFlows, name)
		}
	}
	return r.total, active, r.completed, topFlows
}

func main() {
	router := gin.New()
	router.Use(gin.Recovery())

	// USSD callback endpoint (AfricasTalking/Hubtel format)
	router.POST("/ussd/callback", handleUSSDCallback)
	router.POST("/ussd/africastalking", handleUSSDCallback)

	// Admin endpoints
	router.GET("/health", func(c *gin.Context) {
		c.JSON(200, gin.H{"status": "healthy", "service": "ussd-gateway"})
	})
	router.GET("/api/v1/ussd/sessions", listActiveSessions)
	router.GET("/api/v1/ussd/stats", getUSSDStats)

	port := os.Getenv("PORT")
	if port == "" {
		port = "8082"
	}

	srv := &http.Server{Addr: ":" + port, Handler: router, ReadTimeout: 10 * time.Second, WriteTimeout: 30 * time.Second}

	go func() {
		log.Printf("ussd-gateway service starting on :%s", port)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("listen error: %v", err)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = srv.Shutdown(ctx)
}

func handleUSSDCallback(c *gin.Context) {
	sessionID := c.PostForm("sessionId")
	phoneNumber := c.PostForm("phoneNumber")
	serviceCode := c.PostForm("serviceCode")
	text := c.PostForm("text")

	if sessionID == "" || phoneNumber == "" {
		c.String(http.StatusBadRequest, "END Invalid request")
		return
	}

	response := processUSSD(sessionID, phoneNumber, serviceCode, text)
	registry.record(sessionID, phoneNumber, serviceCode, text, len(response) >= 3 && response[:3] == "END")
	c.String(http.StatusOK, response)
}

func processUSSD(sessionID, phoneNumber, serviceCode, text string) string {
	switch {
	case text == "":
		return `CON Welcome to InsurePortal
1. Check Policy Status
2. File a Claim
3. Pay Premium
4. Get a Quote
5. Check Wallet Balance
6. Contact Support`

	case text == "1":
		return `CON Enter your policy number:
(e.g., POL-2024-001234)`

	case text == "2":
		return `CON Select claim type:
1. Motor Accident
2. Health/Medical
3. Property Damage
4. Travel
5. Life Insurance`

	case text == "3":
		return `CON Select payment method:
1. Debit Card
2. Bank Transfer
3. Mobile Money
4. Wallet Balance`

	case text == "4":
		return `CON Select insurance type:
1. Motor (from ₦15,000/yr)
2. Health (from ₦25,000/yr)
3. Life (from ₦10,000/yr)
4. Travel (from ₦5,000/trip)
5. Property (from ₦20,000/yr)`

	case text == "5":
		// FAIL-LOUD: this gateway has no connection to the wallet/ledger
		// backend. It must never answer with a fabricated balance.
		return "END Wallet balance lookup is temporarily unavailable via USSD.\nPlease check the InsurePortal app or call 0800-INSURE."

	case text == "6":
		return "END Contact InsurePortal Support:\nPhone: 0800-INSURE (0800-467873)\nWhatsApp: +234 800 123 4567\nEmail: support@insureportal.ng"

	// Policy status flow
	case len(text) > 2 && text[:2] == "1*":
		// FAIL-LOUD: no policy-store backend is wired to this service, so no
		// policy status is ever invented.
		return "END Policy lookup is temporarily unavailable via USSD.\nPlease use the InsurePortal app or call 0800-INSURE to verify policy " + text[2:] + "."

	// Claim filing flow
	case text == "2*1":
		return "CON Motor Accident Claim\nEnter brief description:"
	case text == "2*2":
		return "CON Health/Medical Claim\nEnter hospital name:"
	case len(text) > 4 && text[:4] == "2*1*":
		// FAIL-LOUD: no claims backend exists behind this gateway. A claim is
		// never claimed to be filed when nothing was persisted anywhere.
		return "END USSD claim filing is temporarily unavailable.\nNo claim has been recorded.\nPlease file via the InsurePortal app or call 0800-INSURE (24/7 claims line)."

	// Quote flow
	case text == "4*1":
		return `CON Motor Insurance Quote
Vehicle value (₦):
1. Under 2,000,000
2. 2,000,000 - 5,000,000
3. 5,000,000 - 10,000,000
4. Over 10,000,000`
	case text == "4*1*1":
		return "END Motor Insurance Quote:\nComprehensive: ₦15,000/year\nThird Party: ₦5,000/year\n\nDial *123*456*3# to pay now\nor visit insureportal.ng"

	default:
		return "END Invalid option. Please try again.\nDial " + serviceCode + " to start over."
	}
}

func listActiveSessions(c *gin.Context) {
	_, active, _, _ := registry.snapshot()
	c.JSON(200, gin.H{
		"activeSessions": active,
		"note":           "session identifiers withheld; counts measured in-memory since process start",
	})
}

func getUSSDStats(c *gin.Context) {
	total, active, completed, topFlows := registry.snapshot()
	if topFlows == nil {
		topFlows = []string{}
	}
	c.JSON(200, gin.H{
		"totalSessions":     total,
		"activeSessions":    active,
		"completedSessions": completed,
		"topFlows":          topFlows,
		"window":            "in-memory since process start",
		"processStartedAt":  registry.startedAt.Format(time.RFC3339),
	})
}
