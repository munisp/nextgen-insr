/**
 * InsurePortal Hardware SDK Simulation Layer
 *
 * Provides a unified interface for:
 *  - ESC/POS receipt printer (WebUSB with print dialog fallback)
 *  - Biometric fingerprint reader (WebAuthn bridge)
 *  - NFC card reader (Web NFC API with fallback)
 *  - EMV card reader simulation
 *
 * In production, replace each section with the actual PAX/Ingenico SDK calls.
 */

// ─── Types ────────────────────────────────────────────────────────────────────
export interface ReceiptData {
  ref: string;
  type: string;
  amount: number;
  fee?: number;
  customerName?: string;
  customerPhone?: string;
  agentCode: string;
  agentName: string;
  terminalSerial?: string;
  timestamp?: Date;
}

export interface BiometricResult {
  success: boolean;
  credentialId?: string;
  error?: string;
}

export interface NFCResult {
  success: boolean;
  cardNumber?: string;
  cardType?: string;
  error?: string;
}

export interface CardResult {
  success: boolean;
  maskedPan?: string;
  cardType?: string;
  expiryMonth?: string;
  expiryYear?: string;
  error?: string;
}

// ─── ESC/POS Receipt Printer ──────────────────────────────────────────────────
export const printer = {
  /**
   * Print receipt via browser print dialog (fallback for WebUSB).
   * In production: use WebUSB to send ESC/POS commands to the thermal printer.
   */
  async printReceipt(
    data: ReceiptData
  ): Promise<{ success: boolean; method: string }> {
    const timestamp = (data.timestamp ?? new Date()).toLocaleString("en-NG", {
      timeZone: "Africa/Lagos",
      dateStyle: "medium",
      timeStyle: "short",
    });

    const receiptHtml = `
      <html>
      <head>
        <title>InsurePortal Receipt</title>
        <style>
          body { font-family: 'Courier New', monospace; font-size: 12px; width: 80mm; margin: 0 auto; padding: 8px; }
          .center { text-align: center; }
          .bold { font-weight: bold; }
          .divider { border-top: 1px dashed #000; margin: 6px 0; }
          .row { display: flex; justify-content: space-between; }
          .logo { font-size: 18px; font-weight: bold; }
        </style>
      </head>
      <body>
        <div class="center">
          <div class="logo">54LINK</div>
          <div>Agency Banking Terminal</div>
          <div class="divider"></div>
        </div>
        <div class="row"><span>Ref:</span><span>${data.ref}</span></div>
        <div class="row"><span>Type:</span><span>${data.type}</span></div>
        <div class="row bold"><span>Amount:</span><span>₦${data.amount.toLocaleString("en-NG", { minimumFractionDigits: 2 })}</span></div>
        ${data.fee ? `<div class="row"><span>Fee:</span><span>₦${data.fee.toFixed(2)}</span></div>` : ""}
        <div class="divider"></div>
        ${data.customerName ? `<div class="row"><span>Customer:</span><span>${data.customerName}</span></div>` : ""}
        ${data.customerPhone ? `<div class="row"><span>Phone:</span><span>${data.customerPhone}</span></div>` : ""}
        <div class="divider"></div>
        <div class="row"><span>Agent:</span><span>${data.agentCode}</span></div>
        <div class="row"><span>Terminal:</span><span>${data.terminalSerial ?? "N/A"}</span></div>
        <div class="row"><span>Date:</span><span>${timestamp}</span></div>
        <div class="divider"></div>
        <div class="center bold">TRANSACTION SUCCESSFUL</div>
        <div class="center" style="font-size:10px;margin-top:4px;">Powered by InsurePortal · CBN Licensed</div>
      </body>
      </html>
    `;

    // Try WebUSB first (production path)
    if ("usb" in navigator) {
      try {
        // In production: enumerate USB devices, find ESC/POS printer, send commands
        // For now, fall through to print dialog
      } catch {
        // Fall through
      }
    }

    // Browser print dialog fallback
    const printWindow = window.open("", "_blank", "width=400,height=600");
    if (printWindow) {
      printWindow.document.write(receiptHtml);
      printWindow.document.close();
      printWindow.focus();
      setTimeout(() => {
        printWindow.print();
        printWindow.close();
      }, 250);
      return { success: true, method: "browser-print" };
    }

    return { success: false, method: "none" };
  },

  /**
   * Check if a USB thermal printer is connected.
   * In production: use WebUSB device enumeration.
   */
  async checkPrinterStatus(): Promise<{ connected: boolean; model?: string }> {
    if ("usb" in navigator) {
      try {
        const devices = await (navigator as any).usb.getDevices();
        const printer = devices.find(
          (d: any) =>
            d.vendorId === 0x0483 || // STMicroelectronics (common in POS printers)
            d.vendorId === 0x04b8 || // Epson
            d.vendorId === 0x067b // Prolific (USB-Serial adapters)
        );
        if (printer) {
          return {
            connected: true,
            model: printer.productName ?? "USB Thermal Printer",
          };
        }
      } catch {
        // Permission not granted yet
      }
    }
    // Simulate connected for demo
    return { connected: true, model: "PAX TP220 (Simulated)" };
  },
};

// ─── Biometric / Fingerprint Reader ──────────────────────────────────────────
export const biometric = {
  /**
   * Enrol a new fingerprint using WebAuthn.
   * In production: bridge to the PAX biometric SDK via native messaging.
   */
  async enrol(agentId: string, customerName: string): Promise<BiometricResult> {
    if (!window.PublicKeyCredential) {
      return { success: false, error: "WebAuthn not supported on this device" };
    }

    try {
      const challenge = crypto.getRandomValues(new Uint8Array(32));
      const credential = await navigator.credentials.create({
        publicKey: {
          challenge,
          rp: { name: "InsurePortal POS", id: window.location.hostname },
          user: {
            id: new TextEncoder().encode(agentId),
            name: customerName,
            displayName: customerName,
          },
          pubKeyCredParams: [
            { type: "public-key", alg: -7 }, // ES256
            { type: "public-key", alg: -257 }, // RS256
          ],
          authenticatorSelection: {
            authenticatorAttachment: "platform",
            userVerification: "required",
          },
          timeout: 60000,
        },
      });

      if (credential) {
        return {
          success: true,
          credentialId: btoa(
            Array.from(new Uint8Array((credential as any).rawId))
              .map(b => String.fromCharCode(b))
              .join("")
          ),
        };
      }
      return { success: false, error: "Enrolment cancelled" };
    } catch (err: any) {
      return {
        success: false,
        error: err.message ?? "Biometric enrolment failed",
      };
    }
  },

  /**
   * Verify fingerprint for a returning customer.
   */
  async verify(credentialId: string): Promise<BiometricResult> {
    if (!window.PublicKeyCredential) {
      // Simulate success for demo
      await new Promise(r => setTimeout(r, 1500));
      return { success: true, credentialId };
    }

    try {
      const challenge = crypto.getRandomValues(new Uint8Array(32));
      const assertion = await navigator.credentials.get({
        publicKey: {
          challenge,
          userVerification: "required",
          timeout: 60000,
        },
      });
      return { success: !!assertion, credentialId };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  },
};

// ─── NFC Card Reader ──────────────────────────────────────────────────────────
export const nfc = {
  /**
   * Read NFC card using Web NFC API.
   * In production: use the PAX NFC SDK via native bridge.
   */
  async readCard(): Promise<NFCResult> {
    // Web NFC API (Chrome on Android)
    if ("NDEFReader" in window) {
      try {
        const reader = new (window as any).NDEFReader();
        await reader.scan();
        return new Promise(resolve => {
          reader.onreading = (event: any) => {
            const record = event.message.records[0];
            resolve({
              success: true,
              cardNumber: `**** **** **** ${Math.floor(Math.random() * 9000 + 1000)}`,
              cardType: "Verve",
            });
          };
          reader.onreadingerror = () => {
            resolve({ success: false, error: "NFC read error" });
          };
          // Timeout after 30s
          setTimeout(
            () => resolve({ success: false, error: "NFC read timeout" }),
            30000
          );
        });
      } catch (err: any) {
        // Fall through to simulation
      }
    }

    // Simulation fallback
    await new Promise(r => setTimeout(r, 2000));
    const cardTypes = ["Verve", "Mastercard", "Visa"];
    return {
      success: true,
      cardNumber: `**** **** **** ${Math.floor(Math.random() * 9000 + 1000)}`,
      cardType: cardTypes[Math.floor(Math.random() * cardTypes.length)],
    };
  },
};

// ─── EMV Card Reader ──────────────────────────────────────────────────────────
export const emv = {
  /**
   * Simulate EMV chip card insertion and PIN verification.
   * In production: use the PAX EMV SDK.
   */
  async readCard(): Promise<CardResult> {
    await new Promise(r => setTimeout(r, 1500));
    const cardTypes = ["Verve", "Mastercard", "Visa"];
    const year = new Date().getFullYear() + Math.floor(Math.random() * 4 + 1);
    return {
      success: true,
      maskedPan: `**** **** **** ${Math.floor(Math.random() * 9000 + 1000)}`,
      cardType: cardTypes[Math.floor(Math.random() * cardTypes.length)],
      expiryMonth: String(Math.floor(Math.random() * 12 + 1)).padStart(2, "0"),
      expiryYear: String(year).slice(-2),
    };
  },

  async verifyPin(pin: string): Promise<{ success: boolean; error?: string }> {
    // Simulate DUKPT PIN block verification
    await new Promise(r => setTimeout(r, 800));
    // In production: encrypt PIN with DUKPT key and send to HSM
    return { success: pin.length === 4 };
  },
};

// ─── Hardware Health Monitor ──────────────────────────────────────────────────
export async function getHardwareStatus() {
  const [printerStatus] = await Promise.all([printer.checkPrinterStatus()]);
  return {
    printer: printerStatus,
    nfc: {
      connected: "NDEFReader" in window || true,
      model: "PAX NFC Module (Simulated)",
    },
    biometric: {
      connected: !!window.PublicKeyCredential,
      model: window.PublicKeyCredential
        ? "Platform Authenticator"
        : "PAX FP200 (Simulated)",
    },
    cardReader: { connected: true, model: "PAX EMV Module (Simulated)" },
    network: {
      connected: navigator.onLine,
      type: (navigator as any).connection?.effectiveType ?? "unknown",
    },
  };
}
