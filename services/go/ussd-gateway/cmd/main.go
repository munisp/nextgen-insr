package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/gin-gonic/gin"
)

// USSDSession represents an active USSD session
type USSDSession struct {
	SessionID   string    `json:"sessionId"`
	PhoneNumber string    `json:"phoneNumber"`
	ServiceCode string    `json:"serviceCode"`
	Text        string    `json:"text"`
	State       string    `json:"state"`
	Data        map[string]string `json:"data"`
	CreatedAt   time.Time `json:"createdAt"`
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
	srv.Shutdown(ctx)
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
		return "END Your wallet balance is ₦45,000.00\nLast transaction: ₦5,000 premium payment (2 days ago)"

	case text == "6":
		return "END Contact InsurePortal Support:\nPhone: 0800-INSURE (0800-467873)\nWhatsApp: +234 800 123 4567\nEmail: support@insureportal.ng"

	// Policy status flow
	case len(text) > 2 && text[:2] == "1*":
		policyNum := text[2:]
		return "END Policy: " + policyNum + "\nStatus: Active\nExpiry: 2025-12-31\nPremium: ₦45,000/year\nCoverage: ₦5,000,000"

	// Claim filing flow
	case text == "2*1":
		return "CON Motor Accident Claim\nEnter brief description:"
	case text == "2*2":
		return "CON Health/Medical Claim\nEnter hospital name:"
	case len(text) > 4 && text[:4] == "2*1*":
		return "END Claim submitted successfully!\nClaim #: CLM-" + sessionID[:8] + "\nYou will receive an SMS with details.\nExpected processing: 3-5 business days"

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
	c.JSON(200, gin.H{"sessions": []interface{}{}, "count": 0})
}

func getUSSDStats(c *gin.Context) {
	c.JSON(200, gin.H{
		"totalSessions":  0,
		"activeSessions": 0,
		"completedToday": 0,
		"topFlows":       []string{"policy_status", "file_claim", "get_quote"},
	})
}
