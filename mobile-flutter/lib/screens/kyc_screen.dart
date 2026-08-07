import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../services/api_service.dart';

class KYCScreen extends ConsumerWidget {
  const KYCScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final kycAsync = ref.watch(kycStatusProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('KYC Verification'),
        backgroundColor: const Color(0xFF0F172A),
        foregroundColor: Colors.white,
      ),
      body: kycAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => Center(child: Text('Error: $e')),
        data: (kyc) => ListView(
          padding: const EdgeInsets.all(16),
          children: [
            _buildStatusCard(context, kyc),
            const SizedBox(height: 16),
            _buildVerificationSteps(context, kyc),
          ],
        ),
      ),
    );
  }

  Widget _buildStatusCard(BuildContext context, Map<String, dynamic> kyc) {
    final status = kyc['status'] ?? 'pending';
    final isVerified = status == 'verified';
    return Card(
      color: isVerified ? Colors.green.shade50 : Colors.orange.shade50,
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Row(
          children: [
            Icon(isVerified ? Icons.verified_user : Icons.pending, size: 48, color: isVerified ? Colors.green : Colors.orange),
            const SizedBox(width: 16),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(isVerified ? 'KYC Verified' : 'KYC Pending', style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
                  Text(isVerified ? 'Your identity has been verified' : 'Complete verification to access all features'),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildVerificationSteps(BuildContext context, Map<String, dynamic> kyc) {
    final steps = [
      {'title': 'BVN Verification', 'key': 'bvnVerified', 'icon': Icons.fingerprint},
      {'title': 'NIN Verification', 'key': 'ninVerified', 'icon': Icons.badge},
      {'title': 'Document Upload', 'key': 'documentUploaded', 'icon': Icons.upload_file},
      {'title': 'Face Match', 'key': 'faceMatched', 'icon': Icons.face},
      {'title': 'Liveness Check', 'key': 'livenessVerified', 'icon': Icons.camera_front},
    ];

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text('Verification Steps', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
        const SizedBox(height: 8),
        ...steps.map((step) {
          final completed = kyc[step['key']] == true;
          return ListTile(
            leading: Icon(step['icon'] as IconData, color: completed ? Colors.green : Colors.grey),
            title: Text(step['title'] as String),
            trailing: Icon(completed ? Icons.check_circle : Icons.radio_button_unchecked, color: completed ? Colors.green : Colors.grey),
            onTap: completed ? null : () => Navigator.pushNamed(context, '/kyc/${step['key']}'),
          );
        }),
      ],
    );
  }
}
