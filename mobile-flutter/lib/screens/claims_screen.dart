import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../services/api_service.dart';

class ClaimsScreen extends ConsumerWidget {
  const ClaimsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final claimsAsync = ref.watch(claimsProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Claims'),
        backgroundColor: const Color(0xFF0F172A),
        foregroundColor: Colors.white,
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => Navigator.pushNamed(context, '/claims/file'),
        icon: const Icon(Icons.add),
        label: const Text('File Claim'),
        backgroundColor: Colors.red,
      ),
      body: claimsAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => Center(child: Text('Error: $e')),
        data: (claims) => claims.isEmpty
            ? const Center(child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(Icons.assignment_outlined, size: 64, color: Colors.grey),
                  SizedBox(height: 16),
                  Text('No claims filed yet'),
                ],
              ))
            : ListView.builder(
                padding: const EdgeInsets.all(16),
                itemCount: claims.length,
                itemBuilder: (ctx, i) => _claimCard(context, claims[i]),
              ),
      ),
    );
  }

  Widget _claimCard(BuildContext context, Map<String, dynamic> claim) {
    final status = claim['status'] ?? 'pending';
    final statusColors = {
      'approved': Colors.green,
      'rejected': Colors.red,
      'pending': Colors.orange,
      'under_review': Colors.blue,
    };
    final color = statusColors[status] ?? Colors.grey;
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: ExpansionTile(
        leading: CircleAvatar(
          backgroundColor: color.withOpacity(0.1),
          child: Icon(Icons.assignment, color: color),
        ),
        title: Text('Claim #${claim['claimNumber'] ?? 'N/A'}', style: const TextStyle(fontWeight: FontWeight.bold)),
        subtitle: Text(claim['incidentType'] ?? 'General Claim'),
        trailing: Chip(
          label: Text(status.replaceAll('_', ' ').toUpperCase(), style: const TextStyle(fontSize: 10)),
          backgroundColor: color.withOpacity(0.1),
          labelStyle: TextStyle(color: color),
        ),
        children: [
          Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Amount Claimed: ₦${claim['claimAmount'] ?? 0}'),
                Text('Filed: ${claim['createdAt'] ?? 'N/A'}'),
                Text('Description: ${claim['description'] ?? 'N/A'}'),
                if (claim['settlementAmount'] != null)
                  Text('Settlement: ₦${claim['settlementAmount']}', style: const TextStyle(color: Colors.green, fontWeight: FontWeight.bold)),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
