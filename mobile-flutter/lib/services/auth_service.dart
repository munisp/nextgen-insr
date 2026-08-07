import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:dio/dio.dart';

const String _baseUrl = String.fromEnvironment('API_BASE_URL', defaultValue: 'https://api.insureportal.ng');

class AuthState {
  final bool isAuthenticated;
  final String? token;
  final Map<String, dynamic>? user;

  const AuthState({this.isAuthenticated = false, this.token, this.user});

  AuthState copyWith({bool? isAuthenticated, String? token, Map<String, dynamic>? user}) {
    return AuthState(
      isAuthenticated: isAuthenticated ?? this.isAuthenticated,
      token: token ?? this.token,
      user: user ?? this.user,
    );
  }
}

class AuthNotifier extends StateNotifier<AuthState> {
  final Dio _dio;

  AuthNotifier() : _dio = Dio(BaseOptions(baseUrl: _baseUrl)), super(const AuthState());

  Future<void> login(String email, String password) async {
    final response = await _dio.post('/api/auth/login', data: {
      'email': email,
      'password': password,
    });
    final data = response.data as Map<String, dynamic>;
    final token = data['token'] as String?;
    if (token == null) throw Exception('No token received');
    _dio.options.headers['Authorization'] = 'Bearer $token';
    state = state.copyWith(
      isAuthenticated: true,
      token: token,
      user: data['user'] as Map<String, dynamic>?,
    );
  }

  Future<void> logout() async {
    try {
      await _dio.post('/api/auth/logout');
    } catch (_) {}
    state = const AuthState();
  }
}

final authProvider = StateNotifierProvider<AuthNotifier, AuthState>((ref) => AuthNotifier());
