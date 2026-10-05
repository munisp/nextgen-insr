/**
 * PaystackCheckoutScreen.tsx — 2026-10-06 (W10-B5)
 *
 * In-app Paystack hosted-checkout WebView, replacing the W10-B4b system-
 * browser handoff (Linking.openURL). Route params:
 *   { authorizationUrl: string; reference: string; title?: string }
 * (serializable scalars only — the completion channel is the module-level
 * outcome store in paystackCheckoutOutcome.ts, NOT a param callback).
 *
 * Completion detection is UX-ONLY and deliberately does NOT depend on a
 * known callback URL (the server sets callback_url only when
 * PAYSTACK_CALLBACK_URL is configured; it may be unset). Paystack's hosted
 * checkout always lands on a page carrying the transaction reference, so we
 * detect:
 *   (a) any navigation whose URL query carries the transaction reference as
 *       `reference=` or `trxref=`  → completed → record outcome, goBack;
 *   (b) any URL starting with https://standard.paystack.co/close → the user
 *       cancelled on Paystack's own close page → record 'cancelled', goBack;
 *   (c) the in-app back/close affordance → 'cancelled' (goBack, no outcome
 *       recorded — the panel treats "no outcome" as neutral).
 * Both intercepted navigations return false from onShouldStartLoadWithRequest
 * so the WebView never loads the callback/close page.
 *
 * Fail-closed: detection never marks anything paid. The recorded outcome only
 * auto-triggers the caller's confirm mutation (server-side verifyTransaction
 * is the sole source of truth); the manual "I've paid — verify" button
 * remains as fallback.
 */
import React, { useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { WebView, type WebViewNavigation } from 'react-native-webview';
import { setCheckoutOutcome } from './paystackCheckoutOutcome';

export interface PaystackCheckoutParams {
  authorizationUrl: string;
  reference: string;
  title?: string;
}

const CLOSE_URL_PREFIX = 'https://standard.paystack.co/close';

/**
 * True when `url` carries `reference` as a `reference=` or `trxref=` query
 * param. Deliberately matches ONLY the exact param value (fail-closed: a
 * reference substring elsewhere in the URL must not complete).
 */
export function urlCarriesReference(url: string, reference: string): boolean {
  if (!reference) return false;
  const m = /[?&](?:reference|trxref)=([^&#]*)/.exec(url);
  if (!m) return false;
  let value = m[1];
  try {
    value = decodeURIComponent(value);
  } catch {
    // Malformed encoding — compare the raw value, still exact-match only.
  }
  return value === reference;
}

/** True when the URL is Paystack's hosted-checkout "close" (user cancel). */
export function isPaystackCloseUrl(url: string): boolean {
  return url.startsWith(CLOSE_URL_PREFIX);
}

// Props typed loosely (`any`): the screen is registered via
// <Stack.Screen component={...}>, whose ScreenComponentType expects `{}`-
// compatible props (see AppNavigator, 2026-10-06). At runtime React
// Navigation always supplies { navigation, route } with the params below.
export function PaystackCheckoutScreen({
  navigation,
  route,
}: any) {
  const { authorizationUrl, reference, title } = route.params as PaystackCheckoutParams;

  const onShouldStartLoadWithRequest = useCallback(
    (request: WebViewNavigation): boolean => {
      const url = request.url;
      if (urlCarriesReference(url, reference)) {
        // Completed checkout (callback page carrying our reference). Block
        // the navigation, record the outcome, and return to the caller whose
        // focus listener auto-triggers the server-side confirm.
        setCheckoutOutcome({ outcome: 'completed', reference });
        navigation.goBack();
        return false;
      }
      if (isPaystackCloseUrl(url)) {
        // Paystack close page = user cancelled on the hosted checkout.
        setCheckoutOutcome({ outcome: 'cancelled', reference });
        navigation.goBack();
        return false;
      }
      return true;
    },
    [navigation, reference],
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        {/* (c) In-app close affordance = user cancel: no outcome recorded, no
            auto-confirm — the panel just stays put for a manual retry. */}
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          accessibilityLabel="Close checkout"
        >
          <Text style={styles.back}>← Cancel</Text>
        </TouchableOpacity>
        <Text style={styles.title}>{title ?? 'Secure checkout'}</Text>
        <Text style={styles.subtitle}>
          Complete the payment with Paystack. Your payment is verified by the
          server — never by this screen.
        </Text>
      </View>
      <WebView
        source={{ uri: authorizationUrl }}
        startInLoadingState
        onShouldStartLoadWithRequest={onShouldStartLoadWithRequest}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  header: { paddingHorizontal: 20, paddingTop: 60, paddingBottom: 12 },
  back: { fontSize: 16, color: '#2563eb', marginBottom: 8 },
  title: { fontSize: 20, fontWeight: '700', color: '#0f172a' },
  subtitle: { fontSize: 12, color: '#64748b', marginTop: 4 },
});
