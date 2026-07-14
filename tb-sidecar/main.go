package main

import (
"bytes"
"encoding/json"
"fmt"
"io"
"log"
"net/http"
"os"
"time"
)

type TransferRequest struct {
ID             string `json:"id,omitempty"`
DebitAccountID string `json:"debitAccountId"`
CreditAccountID string `json:"creditAccountId"`
Amount         int64  `json:"amount"`
Ledger         int    `json:"ledger,omitempty"`
Code           int    `json:"code,omitempty"`
Ref            string `json:"ref,omitempty"`
TxType         string `json:"txType,omitempty"`
AgentID        string `json:"agentId,omitempty"`
}

type TransferResponse struct {
ID         string `json:"id"`
Status     string `json:"status"`
SyncStatus string `json:"syncStatus"`
Amount     int64  `json:"amount"`
}

func main() {
port := os.Getenv("PORT")
if port == "" {
= "8080"
}

http.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
te(`{"status":"ok"}`))
})

http.HandleFunc("/transfers", func(w http.ResponseWriter, r *http.Request) {
r.Method != http.MethodPost {
"Method not allowed", http.StatusMethodNotAllowed)

, err := io.ReadAll(r.Body)
err != nil {
"Error reading body", http.StatusBadRequest)

r.Body.Close()

req TransferRequest
err := json.Unmarshal(body, &req); err != nil {
"Invalid JSON", http.StatusBadRequest)

Mock implementation that just returns success
In a real implementation, this would connect to TigerBeetle via zig client
:= req.ID
id == "" {
= fmt.Sprintf("tb-%d", time.Now().UnixNano())
:= TransferResponse{
        id,
    "committed",
ncStatus: "synced",
t:     req.Amount,
tent-Type", "application/json")
.NewEncoder(w).Encode(resp)
})

log.Printf("TigerBeetle sidecar listening on port %s", port)
log.Fatal(http.ListenAndServe(":"+port, nil))
}
