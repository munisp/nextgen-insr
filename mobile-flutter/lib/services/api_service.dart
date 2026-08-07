import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:dio/dio.dart';
import 'dart:convert';

const String _baseUrl = String.fromEnvironment('API_BASE_URL', defaultValue: 'https://api.insureportal.ng');

final _dio = Dio(BaseOptions(
  baseUrl: _baseUrl,
  connectTimeout: const Duration(seconds: 10),
  receiveTimeout: const Duration(seconds: 30),
  headers: {'Content-Type': 'application/json'},
));

// ── Providers ─────────────────────────────────────────────────────────────────

final dashboardKpiProvider = FutureProvider<Map<String, dynamic>>((ref) async {
  final response = await _dio.get('/api/trpc/insuranceKpiDashboard.getKpi');
  return (response.data as Map<String, dynamic>)['result']?['data'] ?? {};
});

final policiesProvider = FutureProvider<List<Map<String, dynamic>>>((ref) async {
  final response = await _dio.get('/api/trpc/policies.list');
  final data = (response.data as Map<String, dynamic>)['result']?['data'];
  return (data as List<dynamic>?)?.cast<Map<String, dynamic>>() ?? [];
});

final claimsProvider = FutureProvider<List<Map<String, dynamic>>>((ref) async {
  final response = await _dio.get('/api/trpc/claims.list');
  final data = (response.data as Map<String, dynamic>)['result']?['data'];
  return (data as List<dynamic>?)?.cast<Map<String, dynamic>>() ?? [];
});

final walletProvider = FutureProvider<Map<String, dynamic>>((ref) async {
  final response = await _dio.get('/api/trpc/agentFloatTransfer.getBalance');
  return (response.data as Map<String, dynamic>)['result']?['data'] ?? {};
});

final kycStatusProvider = FutureProvider<Map<String, dynamic>>((ref) async {
  final response = await _dio.get('/api/trpc/kycVerification.getStatus');
  return (response.data as Map<String, dynamic>)['result']?['data'] ?? {};
});

final agentDashboardProvider = FutureProvider<Map<String, dynamic>>((ref) async {
  final response = await _dio.get('/api/trpc/agentManagement.getDashboard');
  return (response.data as Map<String, dynamic>)['result']?['data'] ?? {};
});
