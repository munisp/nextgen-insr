import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../services/api_service.dart';

class PaymentsScreen extends ConsumerWidget {
  const PaymentsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final walletAsync = ref.watch(walletProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Payments & Wallet'),
        backgroundColor: const Color(0xFF0F172A),
        foregroundColor: Colors.white,
      ),
      body: walletAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => Center(child: Text('Error: $e')),
        data: (wallet) => ListView(
          padding: const EdgeInsets.all(16),
          children: [
            _buildWalletCard(context, wallet),
            const SizedBox(height: 16),
            _buildPaymentActions(context),
            const SizedBox(height: 16),
            _buildTransactionHistory(wallet),
          ],
        ),
      ),
    );
  }

  Widget _buildWalletCard(BuildContext context, Map<String, dynamic> wallet) {
    return Card(
      color: const Color(0xFF1E3A5F),
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('Wallet Balance', style: TextStyle(color: Colors.white70, fontSize: 14)),
            const SizedBox(height: 8),
            Text('₦${wallet['balance'] ?? '0.00'}',
                style: const TextStyle(color: Colors.white, fontSize: 32, fontWeight: FontWeight.bold)),
            const SizedBox(height: 16),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text('Account: ${wallet['accountNumber'] ?? 'N/A'}', style: const TextStyle(color: Colors.white60)),
                Text('Float: ₦${wallet['floatBalance'] ?? '0'}', style: const TextStyle(color: Colors.greenAccent)),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildPaymentActions(BuildContext context) {
    return Row(
      children: [
        Expanded(child: _paymentAction(context, 'Pay Premium', Icons.payment, Colors.blue, '/payments/premium')),
        const SizedBox(width: 8),
        Expanded(child: _paymentAction(context, 'Top Up Float', Icons.account_balance_wallet, Colors.green, '/payments/topup')),
        const SizedBox(width: 8),
        Expanded(child: _paymentAction(context, 'Transfer', Icons.send, Colors.orange, '/payments/transfer')),
      ],
    );
  }

  Widget _paymentAction(BuildContext context, String label, IconData icon, Color color, String route) {
    return ElevatedButton(
      onPressed: () => Navigator.pushNamed(context, route),
      style: ElevatedButton.styleFrom(
        backgroundColor: color.withOpacity(0.1),
        foregroundColor: color,
        padding: const EdgeInsets.symmetric(vertical: 16),
      ),
      child: Column(
        children: [
          Icon(icon, size: 24),
          const SizedBox(height: 4),
          Text(label, style: const TextStyle(fontSize: 11)),
        ],
      ),
    );
  }

  Widget _buildTransactionHistory(Map<String, dynamic> wallet) {
    final txns = (wallet['recentTransactions'] as List<dynamic>?) ?? [];
    if (txns.isEmpty) return const SizedBox.shrink();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text('Recent Transactions', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
        const SizedBox(height: 8),
        ...txns.take(10).map((t) => ListTile(
          leading: Icon(
            t['type'] == 'credit' ? Icons.arrow_downward : Icons.arrow_upward,
            color: t['type'] == 'credit' ? Colors.green : Colors.red,
          ),
          title: Text(t['description'] ?? 'Transaction'),
          subtitle: Text(t['timestamp'] ?? ''),
          trailing: Text(
            '${t['type'] == 'credit' ? '+' : '-'}₦${t['amount'] ?? 0}',
            style: TextStyle(
              color: t['type'] == 'credit' ? Colors.green : Colors.red,
              fontWeight: FontWeight.bold,
            ),
          ),
          dense: true,
        )),
      ],
    );
  }
}
