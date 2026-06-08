# InsurePortal POS — Flutter Mobile App

Flutter implementation of the InsurePortal POS Shell for PAX A920 and Android POS terminals.

## Prerequisites

- Flutter SDK ≥ 3.10.0 (`flutter --version`)
- Android SDK with API level 26+ (PAX A920 runs Android 7.1 / API 25, use `minSdk 25`)
- Java 17 (`java -version`)

## Setup

```bash
cd mobile-flutter
flutter pub get
flutter pub run build_runner build --delete-conflicting-outputs
```

## Development

```bash
# Run on connected PAX A920 or emulator
flutter run --dart-define=API_BASE_URL=https://api.insureportal.ng/api/trpc

# Run with hot reload
flutter run -d <device_id>
```

## Build for PAX A920

```bash
# Release APK (PAX A920 is armeabi-v7a)
flutter build apk --release \
  --target-platform android-arm \
  --dart-define=API_BASE_URL=https://api.insureportal.ng/api/trpc

# Output: build/app/outputs/flutter-apk/app-release.apk
```

## Run Tests

```bash
flutter test
```

## Architecture

- **State Management:** Riverpod 2.x with StateNotifier
- **Navigation:** GoRouter with auth guard in SplashScreen
- **HTTP:** Dio with JWT interceptor and auto-retry
- **Secure Storage:** flutter_secure_storage for JWT token
- **Printing:** ESC/POS via bluetooth_print (PAX A920 built-in printer)
- **NFC:** nfc_manager for contactless payments
- **Biometrics:** local_auth for fingerprint PIN bypass

## Key Screens

| Screen            | Route           | Description                    |
| ----------------- | --------------- | ------------------------------ |
| SplashScreen      | `/splash`       | Auth check + brand splash      |
| LoginScreen       | `/login`        | Agent code + PIN login         |
| DashboardScreen   | `/dashboard`    | Float balance + quick actions  |
| CashInScreen      | `/cash-in`      | Customer deposit flow          |
| CashOutScreen     | `/cash-out`     | Customer withdrawal flow       |
| BillPaymentScreen | `/bill-payment` | Electricity, airtime, cable TV |
| ReceiptScreen     | `/receipt/:ref` | Print / SMS / WhatsApp receipt |
| FloatScreen       | `/float`        | Float top-up request           |
| HistoryScreen     | `/history`      | Transaction history            |
| SettingsScreen    | `/settings`     | Terminal config + logout       |

## PAX A920 Specifics

- Portrait-only orientation locked in `main.dart`
- ESC/POS thermal printer via `bluetooth_print` package
- NFC reader via `nfc_manager` (ISO 14443-A/B)
- Barcode scanner via camera (`mobile_scanner`)
- Terminal ID auto-populated from device serial number
