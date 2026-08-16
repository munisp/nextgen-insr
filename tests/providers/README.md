# tests/providers — PROTOCOL-FAITHFUL LOCAL SIMULATORS (TEST CODE ONLY)

**Framework rule:** official provider sandboxes are preferred. A
protocol-faithful local service is used ONLY because the official sandboxes
are unreachable from this test environment. This is a documented gap
(THREAT_MODEL.md §F-02) and these simulators are **NOT evidence of
provider-specific behavior** — they prove only that OUR code implements the
documented wire protocols correctly (signature verification, idempotency,
unknown-outcome resolution, fail-closed parsing).

| Simulator | Provider | Wire protocol reproduced |
|---|---|---|
| `stripeSimulator.ts` | Stripe webhooks | Event JSON + `Stripe-Signature` header with the REAL `t,v1=HMAC-SHA256(secret, t.payload)` algorithm, verified by the same stripe-node `constructEvent` the production handler runs |
| `termiiSimulator.ts` | Termii SMS | `POST /api/sms/send` request/response JSON shapes per the Termii Send Message API as encoded in `server/lib/smsService.ts` |
| `frankfurterSimulator.ts` | Frankfurter (ECB) FX | `/latest` and time-series JSON shapes per `server/routers/fxRates.ts` |
| `vendingSimulator.ts` | Airtime / bill-payment / mobile-money | `POST /vend|/pay|/cashin|/cashout` + `GET /status/{reference}` per `server/lib/providerDispatch.ts` |

**Open external item:** re-run the equivalent scenarios against the official
Stripe test mode, Termii sandbox, live Frankfurter endpoint, and the chosen
vending provider's sandbox; attach that evidence separately.
