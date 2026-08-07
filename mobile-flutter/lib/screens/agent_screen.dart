import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../services/api_service.dart';

class AgentScreen extends ConsumerWidget {
  const AgentScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final agentAsync = ref.watch(agentDashboardProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Agent Operations'),
        backgroundColor: const Color(0xFF0F172A),
        foregroundColor: Colors.white,
      ),
      body: agentAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => Center(child: Text('Error: $e')),
        data: (agent) => ListView(
          padding: const EdgeInsets.all(16),
          children: [
            _buildFloatCard(agent),
            const SizedBox(height: 16),
            _buildAgentActions(context),
            const SizedBox(height: 16),
            _buildTodayStats(agent),
          ],
        ),
      ),
    );
  }

  Widget _buildFloatCard(Map<String, dynamic> agent) {
    return Card(
      color: const Color(0xFF0F172A),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('Float Balance', style: TextStyle(color: Colors.white70)),
            const SizedBox(height: 8),
            Text('₦${agent['floatBalance'] ?? '0.00'}',
                style: const TextStyle(color: Colors.white, fontSize: 28, fontWeight: FontWeight.bold)),
            const SizedBox(height: 12),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text('Daily Limit: ₦${agent['dailyLimit'] ?? 0}', style: const TextStyle(color: Colors.white60)),
                Text('Used: ₦${agent['dailyUsed'] ?? 0}', style: const TextStyle(color: Colors.orangeAccent)),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildAgentActions(BuildContext context) {
    final actions = [
      {'label': 'Sell Policy', 'icon': Icons.policy, 'route': '/agent/sell'},
      {'label': 'Collect Premium', 'icon': Icons.payment, 'route': '/agent/collect'},
      {'label': 'Airtime', 'icon': Icons.phone_android, 'route': '/agent/airtime'},
      {'label': 'Bill Payment', 'icon': Icons.receipt, 'route': '/agent/bills'},
      {'label': 'Float Top-Up', 'icon': Icons.account_balance_wallet, 'route': '/agent/float'},
      {'label': 'Reconcile', 'icon': Icons.balance, 'route': '/agent/reconcile'},
    ];

    return GridView.count(
      crossAxisCount: 3,
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      crossAxisSpacing: 8,
      mainAxisSpacing: 8,
      childAspectRatio: 1.2,
      children: actions.map((a) => ElevatedButton(
        onPressed: () => Navigator.pushNamed(context, a['route'] as String),
        style: ElevatedButton.styleFrom(
          padding: const EdgeInsets.all(8),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
        ),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(a['icon'] as IconData, size: 22),
            const SizedBox(height: 4),
            Text(a['label'] as String, style: const TextStyle(fontSize: 11), textAlign: TextAlign.center),
          ],
        ),
      )).toList(),
    );
  }

  Widget _buildTodayStats(Map<String, dynamic> agent) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text("Today's Performance", style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
        const SizedBox(height: 8),
        Row(
          children: [
            Expanded(child: _statCard('Transactions', agent['todayTransactions']?.toString() ?? '0', Colors.blue)),
            const SizedBox(width: 8),
            Expanded(child: _statCard('Commission', '₦${agent['todayCommission'] ?? 0}', Colors.green)),
            const SizedBox(width: 8),
            Expanded(child: _statCard('Policies Sold', agent['todayPolicies']?.toString() ?? '0', Colors.purple)),
          ],
        ),
      ],
    );
  }

  Widget _statCard(String label, String value, Color color) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          children: [
            Text(value, style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: color)),
            Text(label, style: const TextStyle(fontSize: 11, color: Colors.grey)),
          ],
        ),
      ),
    );
  }
}
