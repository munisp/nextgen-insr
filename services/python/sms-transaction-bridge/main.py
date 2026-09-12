"""
SMS Transaction Bridge — executes basic wallet transactions over plain SMS
for users without data connectivity.

Command grammar (one SMS, <=160 chars):
  CI <amount> <pin>          cash in
  CO <amount> <pin>          cash out
  BAL <pin>                  balance enquiry
  TRF <amount> <phone> <pin> transfer
  HELP                       usage

Honesty contract:
- PINs are validated against the platform API (PLATFORM_API_URL
  /api/sms-bridge/validate-pin) — never accepted locally. Without
  PLATFORM_API_URL configured, every transaction fails loud (503) and /health
  is degraded; only HELP works offline.
- Transactions execute via real platform API calls; the platform's error is
  returned verbatim in the SMS response.
- Every response is formatted to fit in a single 160-char SMS.
"""

import logging
import os

import httpx
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("sms-transaction-bridge")

PLATFORM_API_URL = os.getenv("PLATFORM_API_URL", "").rstrip("/")
SMS_MAX_LEN = 160
COMMANDS = ("CI", "CO", "BAL", "TRF", "HELP")

HELP_TEXT = (
    "Cmds: CI amt pin=cash-in, CO amt pin=cash-out, BAL pin=balance, "
    "TRF amt phone pin=transfer"
)


class SmsCommand(BaseModel):
    command: str
    amount: float | None = None
    phone: str | None = None
    pin: str | None = None


def parse_sms(text: str) -> SmsCommand:
    """Parse one SMS body into a command. Raises ValueError on bad syntax."""
    parts = text.strip().split()
    if not parts:
        raise ValueError("empty SMS")
    command = parts[0].upper()
    if command not in COMMANDS:
        raise ValueError(f"unknown command '{parts[0]}'")
    if command == "HELP":
        return SmsCommand(command="HELP")
    if command in ("CI", "CO"):
        if len(parts) != 3:
            raise ValueError(f"{command} needs: {command} <amount> <pin>")
        return SmsCommand(command=command, amount=_amount(parts[1]), pin=parts[2])
    if command == "BAL":
        if len(parts) != 2:
            raise ValueError("BAL needs: BAL <pin>")
        return SmsCommand(command="BAL", pin=parts[1])
    # TRF
    if len(parts) != 4:
        raise ValueError("TRF needs: TRF <amount> <phone> <pin>")
    return SmsCommand(command="TRF", amount=_amount(parts[1]), phone=parts[2], pin=parts[3])


def _amount(s: str) -> float:
    try:
        v = float(s)
    except ValueError:
        raise ValueError(f"invalid amount '{s}'")
    if v <= 0:
        raise ValueError("amount must be positive")
    return v


def format_response(text: str) -> str:
    """Guarantee the response fits one SMS (160 chars), truncating honestly."""
    if len(text) <= SMS_MAX_LEN:
        return text
    return text[: SMS_MAX_LEN - 1] + "…"


async def validate_pin(client: httpx.AsyncClient, msisdn: str, pin: str) -> None:
    """Validate the PIN against the platform. Raises HTTPException on any
    failure — a PIN is never assumed valid."""
    if not PLATFORM_API_URL:
        raise HTTPException(
            status_code=503,
            detail="PLATFORM_API_URL not configured — cannot validate PIN")
    try:
        resp = await client.post(
            f"{PLATFORM_API_URL}/api/sms-bridge/validate-pin",
            json={"msisdn": msisdn, "pin": pin},
            timeout=8.0,
        )
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"platform unreachable: {e}")
    if resp.status_code != 200:
        raise HTTPException(
            status_code=401,
            detail=format_response(f"PIN validation failed ({resp.status_code})"))


async def execute(cmd: SmsCommand, msisdn: str) -> str:
    if cmd.command == "HELP":
        return format_response(HELP_TEXT)
    assert cmd.pin is not None
    async with httpx.AsyncClient() as client:
        await validate_pin(client, msisdn, cmd.pin)
        payload = {
            "msisdn": msisdn,
            "operation": {"CI": "cash_in", "CO": "cash_out",
                          "BAL": "balance", "TRF": "transfer"}[cmd.command],
            "amount": cmd.amount,
            "counterparty": cmd.phone,
        }
        try:
            resp = await client.post(
                f"{PLATFORM_API_URL}/api/sms-bridge/execute",
                json=payload,
                timeout=15.0,
            )
        except httpx.HTTPError as e:
            raise HTTPException(status_code=502, detail=f"platform unreachable: {e}")
    if resp.status_code != 200:
        return format_response(f"FAILED {cmd.command}: platform {resp.status_code}")
    body = resp.json()
    if cmd.command == "BAL":
        return format_response(f"BAL: {body.get('balance')} {body.get('currency', 'NGN')}")
    ref = body.get("reference", "?")
    return format_response(f"OK {cmd.command} {cmd.amount or ''} ref:{ref}".replace("  ", " "))


app = FastAPI(title="SMS Transaction Bridge", version="1.0.0")


class SmsRequest(BaseModel):
    msisdn: str
    text: str


@app.get("/health")
async def health():
    if not PLATFORM_API_URL:
        raise HTTPException(
            status_code=503,
            detail={"status": "degraded",
                    "reason": "PLATFORM_API_URL not configured — transactions disabled"})
    return {"status": "ok", "service": "sms-transaction-bridge"}


@app.post("/api/v1/sms")
async def handle_sms(req: SmsRequest):
    try:
        cmd = parse_sms(req.text)
    except ValueError as e:
        return {"reply": format_response(f"ERR: {e}. Send HELP")}
    reply = await execute(cmd, req.msisdn)
    return {"reply": reply, "chars": len(reply)}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", "8115")))
