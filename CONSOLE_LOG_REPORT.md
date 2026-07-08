Console Log Analysis Report


╔═══════════════════════════════════════════════════════════╗
║          Console.log Replacement Analysis Report          ║
╚═══════════════════════════════════════════════════════════╝

📊 Summary:
  • Total files analyzed: 768
  • Files with console.* calls: 11
  • Total console.* calls found: 31
  • Files fixed: 11

🔴 Production Logging Issues:
  • console.log statements should use structured logger
  • Console output bypasses logging infrastructure
  • Missing correlation IDs and structured data

💡 Recommendations:
  1. Use logger.info() for informational messages
  2. Use logger.warn() for warnings
  3. Use logger.error() for errors
  4. Include context data in structured format

📝 Files with console.log (top 10):
  • server/kafka-event-consumer.ts: 10 calls
  • server/lib/emailDelivery.ts: 5 calls
  • server/security.scoring.test.ts: 4 calls
  • server/loadtest-bandwidth.test.ts: 3 calls
  • server/middleware/websocketResilience.ts: 3 calls
  • server/_core/index.ts: 1 calls
  • server/lib/dbHealthCheck.ts: 1 calls
  • server/lib/scheduledLoadTestWorker.ts: 1 calls
  • server/middleware/networkResilienceMiddleware.ts: 1 calls
  • server/middleware/securityHardeningMiddleware.ts: 1 calls