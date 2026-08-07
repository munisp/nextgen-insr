import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'screens/dashboard_screen.dart';
import 'screens/policies_screen.dart';
import 'screens/claims_screen.dart';
import 'screens/payments_screen.dart';
import 'screens/kyc_screen.dart';
import 'screens/agent_screen.dart';
import 'screens/login_screen.dart';
import 'services/auth_service.dart';

void main() {
  runApp(const ProviderScope(child: InsurePortalApp()));
}

class InsurePortalApp extends ConsumerWidget {
  const InsurePortalApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final authState = ref.watch(authProvider);

    return MaterialApp(
      title: 'InsurePortal',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xFF0F172A),
          brightness: Brightness.light,
        ),
        useMaterial3: true,
        fontFamily: 'Inter',
      ),
      darkTheme: ThemeData(
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xFF0F172A),
          brightness: Brightness.dark,
        ),
        useMaterial3: true,
        fontFamily: 'Inter',
      ),
      home: authState.isAuthenticated
          ? const MainNavigationScreen()
          : const LoginScreen(),
      routes: {
        '/login': (ctx) => const LoginScreen(),
        '/dashboard': (ctx) => const DashboardScreen(),
        '/policies': (ctx) => const PoliciesScreen(),
        '/claims': (ctx) => const ClaimsScreen(),
        '/payments': (ctx) => const PaymentsScreen(),
        '/kyc': (ctx) => const KYCScreen(),
        '/agent': (ctx) => const AgentScreen(),
      },
    );
  }
}

class MainNavigationScreen extends StatefulWidget {
  const MainNavigationScreen({super.key});

  @override
  State<MainNavigationScreen> createState() => _MainNavigationScreenState();
}

class _MainNavigationScreenState extends State<MainNavigationScreen> {
  int _selectedIndex = 0;

  final List<Widget> _screens = [
    const DashboardScreen(),
    const PoliciesScreen(),
    const ClaimsScreen(),
    const PaymentsScreen(),
    const AgentScreen(),
  ];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: IndexedStack(
        index: _selectedIndex,
        children: _screens,
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _selectedIndex,
        onDestinationSelected: (index) {
          setState(() => _selectedIndex = index);
        },
        destinations: const [
          NavigationDestination(
            icon: Icon(Icons.dashboard_outlined),
            selectedIcon: Icon(Icons.dashboard),
            label: 'Dashboard',
          ),
          NavigationDestination(
            icon: Icon(Icons.policy_outlined),
            selectedIcon: Icon(Icons.policy),
            label: 'Policies',
          ),
          NavigationDestination(
            icon: Icon(Icons.assignment_outlined),
            selectedIcon: Icon(Icons.assignment),
            label: 'Claims',
          ),
          NavigationDestination(
            icon: Icon(Icons.payment_outlined),
            selectedIcon: Icon(Icons.payment),
            label: 'Payments',
          ),
          NavigationDestination(
            icon: Icon(Icons.person_outlined),
            selectedIcon: Icon(Icons.person),
            label: 'Agent',
          ),
        ],
      ),
    );
  }
}
