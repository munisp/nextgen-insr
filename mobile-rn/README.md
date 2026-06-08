# InsurePortal Agent App — React Native

The InsurePortal Agent App is the mobile companion for field agents using the InsurePortal Agency Banking Platform. It provides cash-in/cash-out, airtime, bill payments, beneficiary management, recurring payments, FX rates, and KYC — all in a secure, offline-capable React Native app.

## Tech Stack

| Technology | Version | Purpose |
|-----------|---------|---------|
| React Native | 0.73+ | Cross-platform mobile framework |
| TypeScript | 5.x | Type safety |
| React Navigation | 6.x | Stack + Tab navigation |
| AsyncStorage | 1.x | Persistent local storage |
| react-native-biometrics | 3.x | Fingerprint/Face ID authentication |
| react-native-keychain | 8.x | Secure credential storage |

## Project Structure

```
src/
├── App.tsx                    # Root navigator (Stack + Bottom Tabs)
├── api/
│   └── APIClient.ts           # Typed HTTP client for all InsurePortal endpoints
├── screens/                   # 40+ screens covering all agent journeys
├── services/
│   ├── BiometricService.ts    # Fingerprint/Face ID helpers
│   ├── AnalyticsService.ts    # Event tracking
│   └── StorageService.ts      # AsyncStorage helpers
├── journeys/                  # Feature-organized screen groups
│   ├── auth/                  # Login, register, OTP, PIN setup
│   ├── transactions/          # Cash-in, cash-out, transfer
│   ├── bills/                 # Airtime, DSTV, NEPA, etc.
│   ├── float/                 # Float balance, top-up requests
│   ├── beneficiaries/         # Saved recipients
│   └── settings/              # Profile, security, notifications
└── types/
    └── navigation.ts          # Navigation type definitions
```

## Setup

```bash
# Install dependencies
npm install

# iOS
cd ios && pod install && cd ..
npx react-native run-ios

# Android
npx react-native run-android
```

## Configure API Base URL

Edit `src/api/APIClient.ts`:

```typescript
// Android emulator
private baseURL = 'http://10.0.2.2:3000/api/v1';

// iOS simulator
private baseURL = 'http://localhost:3000/api/v1';

// Production
private baseURL = 'https://api.insureportal.io/v1';
```

## API Client Usage

```typescript
import { apiClient } from '../api/APIClient';

// Cash-in transaction
await apiClient.cashIn({ amount: 5000, customerPhone: '08012345678', reference: 'REF_001' });

// Buy airtime
await apiClient.buyAirtime({ network: 'MTN', phone: '08012345678', amount: 1000 });

// Get beneficiaries
const beneficiaries = await apiClient.getBeneficiaries();
```

## Build for Production

```bash
# Android APK
cd android && ./gradlew assembleRelease

# Android AAB (Play Store)
cd android && ./gradlew bundleRelease

# iOS: Open ios/InsurePortalAgent.xcworkspace in Xcode → Product → Archive
```

## Security

The app implements certificate pinning, biometric authentication, secure Keychain/Keystore storage, root/jailbreak detection, screenshot prevention on sensitive screens, and 15-minute session timeout.
