import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../services/api_service.dart';

class DashboardScreen extends ConsumerWidget {
  const DashboardScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final kpiAsync = ref.watch(dashboardKpiProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('InsurePortal'),
        backgroundColor: const Color(0xFF0F172A),
        foregroundColor: Colors.white,
        actions: [
          IconButton(
            icon: const Icon(Icons.notifications_outlined),
            onPressed: () => Navigator.pushNamed(context, '/notifications'),
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: () async => ref.invalidate(dashboardKpiProvider),
        child: kpiAsync.when(
          loading: () => const Center(child: CircularProgressIndicator()),
          error: (e, _) => Center(child: Text('Error: $e')),
          data: (kpi) => ListView(
            padding: const EdgeInsets.all(16),
            children: [
              _buildWelcomeCard(context),
              const SizedBox(height: 16),
              _buildKpiGrid(kpi),
              const SizedBox(height: 16),
              _buildQuickActions(context),
              const SizedBox(height: 16),
              _buildRecentActivity(kpi),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildWelcomeCard(BuildContext context) {
    return Card(
      color: const Color(0xFF0F172A),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Welcome back', style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: Colors.white70)),
            const SizedBox(height: 4),
            Text('InsurePortal Dashboard', style: Theme.of(context).textTheme.headlineSmall?.copyWith(color: Colors.white, fontWeight: FontWeight.bold)),
            const SizedBox(height: 12),
            Row(
              children: [
                const Icon(Icons.shield_outlined, color: Colors.greenAccent, size: 16),
                const SizedBox(width: 8),
                Text('Platform Status: Operational', style: TextStyle(color: Colors.greenAccent)),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildKpiGrid(Map<String, dynamic> kpi) {
    return GridView.count(
      crossAxisCount: 2,
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      crossAxisSpacing: 12,
      mainAxisSpacing: 12,
      childAspectRatio: 1.5,
      children: [
        _kpiCard('Active Policies', kpi['activePolicies']?.toString() ?? '0', Icons.policy, Colors.blue),
        _kpiCard('Open Claims', kpi['openClaims']?.toString() ?? '0', Icons.assignment_late, Colors.orange),
        _kpiCard('Premium Due', '₦${kpi['premiumDue'] ?? 0}', Icons.payments, Colors.green),
        _kpiCard('Agents Online', kpi['agentsOnline']?.toString() ?? '0', Icons.people, Colors.purple),
      ],
    );
  }

  Widget _kpiCard(String label, String value, IconData icon, Color color) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Icon(icon, color: color, size: 24),
            Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(value, style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold, color: color)),
                Text(label, style: const TextStyle(fontSize: 12, color: Colors.grey)),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildQuickActions(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text('Quick Actions', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
        const SizedBox(height: 12),
        Row(
          children: [
            Expanded(child: _actionButton(context, 'File Claim', Icons.add_circle, '/claims')),
            const SizedBox(width: 8),
            Expanded(child: _actionButton(context, 'Pay Premium', Icons.payment, '/payments')),
            const SizedBox(width: 8),
            Expanded(child: _actionButton(context, 'My Policies', Icons.policy, '/policies')),
          ],
        ),
      ],
    );
  }

  Widget _actionButton(BuildContext context, String label, IconData icon, String route) {
    return ElevatedButton(
      onPressed: () => Navigator.pushNamed(context, route),
      style: ElevatedButton.styleFrom(
        padding: const EdgeInsets.symmetric(vertical: 12),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
      ),
      child: Column(
        children: [
          Icon(icon, size: 20),
          const SizedBox(height: 4),
          Text(label, style: const TextStyle(fontSize: 11)),
        ],
      ),
    );
  }

  Widget _buildRecentActivity(Map<String, dynamic> kpi) {
    final activities = (kpi['recentActivity'] as List<dynamic>?) ?? [];
    if (activities.isEmpty) return const SizedBox.shrink();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text('Recent Activity', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
        const SizedBox(height: 8),
        ...activities.take(5).map((a) => ListTile(
          leading: const Icon(Icons.circle, size: 8, color: Colors.blue),
          title: Text(a['description'] ?? '', style: const TextStyle(fontSize: 14)),
          subtitle: Text(a['timestamp'] ?? '', style: const TextStyle(fontSize: 12)),
          dense: true,
        )),
      ],
    );
  }
}
