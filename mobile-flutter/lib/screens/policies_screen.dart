import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../services/api_service.dart';

class PoliciesScreen extends ConsumerWidget {
  const PoliciesScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final policiesAsync = ref.watch(policiesProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('My Policies'),
        backgroundColor: const Color(0xFF0F172A),
        foregroundColor: Colors.white,
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => Navigator.pushNamed(context, '/policies/new'),
        icon: const Icon(Icons.add),
        label: const Text('New Policy'),
      ),
      body: policiesAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => Center(child: Text('Error: $e')),
        data: (policies) => policies.isEmpty
            ? const Center(child: Text('No policies found. Purchase your first policy!'))
            : ListView.builder(
                padding: const EdgeInsets.all(16),
                itemCount: policies.length,
                itemBuilder: (ctx, i) => _policyCard(context, policies[i]),
              ),
      ),
    );
  }

  Widget _policyCard(BuildContext context, Map<String, dynamic> policy) {
    final status = policy['status'] ?? 'unknown';
    final statusColor = status == 'active' ? Colors.green : status == 'expired' ? Colors.red : Colors.orange;
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: ListTile(
        leading: CircleAvatar(
          backgroundColor: statusColor.withOpacity(0.1),
          child: Icon(Icons.policy, color: statusColor),
        ),
        title: Text(policy['productName'] ?? 'Policy', style: const TextStyle(fontWeight: FontWeight.bold)),
        subtitle: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Policy No: ${policy['policyNumber'] ?? 'N/A'}'),
            Text('Premium: ₦${policy['premiumAmount'] ?? 0}'),
            Text('Expires: ${policy['expiryDate'] ?? 'N/A'}'),
          ],
        ),
        trailing: Chip(
          label: Text(status.toUpperCase(), style: const TextStyle(fontSize: 10)),
          backgroundColor: statusColor.withOpacity(0.1),
          labelStyle: TextStyle(color: statusColor),
        ),
        isThreeLine: true,
        onTap: () => Navigator.pushNamed(context, '/policies/detail', arguments: policy['id']),
      ),
    );
  }
}
