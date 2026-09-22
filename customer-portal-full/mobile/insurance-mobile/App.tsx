import React, { useEffect } from 'react';
import { StatusBar, LogBox, InteractionManager } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import NetInfo from '@react-native-community/netinfo';
import { AppNavigator } from './src/navigation/AppNavigator';
import { AuthProvider } from './src/store/authStore';
import { OfflineSyncProvider } from './src/services/offlineSync';
import { NotificationService } from './src/services/notifications';
import { BiometricGate } from './src/components/BiometricGate';

LogBox.ignoreLogs(['Non-serializable values']);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      gcTime: 24 * 60 * 60 * 1000,
      // 2026-09-19 (P-wave): retry: 3 with exponential backoff up to 30s let a
      // failed boot query hang the UI for ~60s before the offline cache
      // fallback. One fast retry keeps flaky-network failure latency bounded;
      // the offline cache still serves as the fallback.
      retry: 1,
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 5000),
      // Honest placeholder: only data already fetched for a previous key is
      // shown (and is marked as placeholder by react-query) — nothing fake.
      placeholderData: (previousData: unknown) => previousData,
      networkMode: 'offlineFirst',
    },
    mutations: {
      networkMode: 'offlineFirst',
      retry: 2,
    },
  },
});

onlineManager.setEventListener((setOnline) => {
  return NetInfo.addEventListener((state) => {
    setOnline(!!state.isConnected);
  });
});

export default function App() {
  useEffect(() => {
    // 2026-09-19 (P-wave): notification init + permission prompt deferred
    // until after the first interactive frame — it must not sit on the
    // cold-start critical path.
    const task = InteractionManager.runAfterInteractions(() => {
      NotificationService.initialize();
      NotificationService.requestPermission();
    });
    return () => task.cancel();
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <OfflineSyncProvider>
          <BiometricGate>
            <NavigationContainer>
              <StatusBar barStyle="dark-content" backgroundColor="#ffffff" />
              <AppNavigator />
            </NavigationContainer>
          </BiometricGate>
        </OfflineSyncProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
