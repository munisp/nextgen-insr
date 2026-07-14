import Foundation
import Alamofire
import Combine

// MARK: - API Configuration
enum APIEnvironment {
    case production
    case staging
    case development
    
    // Base URL points to the 54Link pos-shell backend REST bridge.
    var baseURL: String {
        switch self {
        case .production:
            return "https://api.54link.ng/api/v1"
        case .staging:
            return "https://staging.54link.ng/api/v1"
        case .development:
            return "http://localhost:3000/api/v1"
        }
    }
}

// MARK: - API Client
class APIClient {
    static let shared = APIClient()
    
    private var session: Session!
    private var environment: APIEnvironment = .production
    private let tokenManager = TokenManager.shared
    
    private init() {}
    
    func configure(environment: APIEnvironment = .production) {
        self.environment = environment
        
        let configuration = URLSessionConfiguration.default
        configuration.timeoutIntervalForRequest = 30
        configuration.timeoutIntervalForResource = 300
        configuration.waitsForConnectivity = true
        
        let interceptor = AuthenticationInterceptor(tokenManager: tokenManager)
        
        // Certificate pinning for production and staging environments.
        // Uses CertificatePinning.shared as the URLSessionDelegate to validate
        // server certificates against pinned SHA-256 hashes.
        let serverTrustManager: ServerTrustManager? = {
            guard environment != .development else { return nil }
            let evaluators: [String: ServerTrustEvaluating] = [
                "api.54link.ng": PinnedCertificatesTrustEvaluator(),
                "staging.54link.ng": PinnedCertificatesTrustEvaluator(),
                "api.remittance.ng": PinnedCertificatesTrustEvaluator(),
                "secure.remittance.ng": PinnedCertificatesTrustEvaluator(),
            ]
            return ServerTrustManager(evaluators: evaluators)
        }()
        
        session = Session(
            configuration: configuration,
            interceptor: interceptor,
            serverTrustManager: serverTrustManager,
            eventMonitors: [APILogger()]
        )
    }
    
    // MARK: - Request Methods
    
    func request<T: Decodable>(
        _ endpoint: APIEndpoint,
        method: HTTPMethod = .get,
        parameters: Parameters? = nil,
        encoding: ParameterEncoding = JSONEncoding.default,
        headers: HTTPHeaders? = nil
    ) async throws -> T {
        let url = environment.baseURL + endpoint.path
        
        return try await withCheckedThrowingContinuation { continuation in
            session.request(
                url,
                method: method,
                parameters: parameters,
                encoding: encoding,
                headers: headers
            )
            .validate()
            .responseDecodable(of: T.self) { response in
                switch response.result {
                case .success(let value):
                    continuation.resume(returning: value)
                case .failure(let error):
                    continuation.resume(throwing: self.handleError(error, response: response.response))
                }
            }
        }
    }
    
    func upload<T: Decodable>(
        _ endpoint: APIEndpoint,
        multipartFormData: @escaping (MultipartFormData) -> Void,
        headers: HTTPHeaders? = nil
    ) async throws -> T {
        let url = environment.baseURL + endpoint.path
        
        return try await withCheckedThrowingContinuation { continuation in
            session.upload(
                multipartFormData: multipartFormData,
                to: url,
                headers: headers
            )
            .validate()
            .responseDecodable(of: T.self) { response in
                switch response.result {
                case .success(let value):
                    continuation.resume(returning: value)
                case .failure(let error):
                    continuation.resume(throwing: self.handleError(error, response: response.response))
                }
            }
        }
    }
    
    // MARK: - Error Handling
    
    private func handleError(_ error: AFError, response: HTTPURLResponse?) -> APIError {
        guard let statusCode = response?.statusCode else {
            return .networkError(error.localizedDescription)
        }
        
        switch statusCode {
        case 401:
            return .unauthorized
        case 403:
            return .forbidden
        case 404:
            return .notFound
        case 422:
            return .validationError("Invalid request parameters")
        case 429:
            return .rateLimitExceeded
        case 500...599:
            return .serverError
        default:
            return .unknown(error.localizedDescription)
        }
    }
}

// MARK: - Authentication Interceptor
class AuthenticationInterceptor: RequestInterceptor {
    private let tokenManager: TokenManager
    
    init(tokenManager: TokenManager) {
        self.tokenManager = tokenManager
    }
    
    func adapt(_ urlRequest: URLRequest, for session: Session, completion: @escaping (Result<URLRequest, Error>) -> Void) {
        var urlRequest = urlRequest
        
        if let token = tokenManager.accessToken {
            urlRequest.headers.add(.authorization(bearerToken: token))
        }
        
        urlRequest.headers.add(.accept("application/json"))
        urlRequest.headers.add(.contentType("application/json"))
        
        completion(.success(urlRequest))
    }
    
    func retry(_ request: Request, for session: Session, dueTo error: Error, completion: @escaping (RetryResult) -> Void) {
        guard let response = request.task?.response as? HTTPURLResponse,
              response.statusCode == 401 else {
            completion(.doNotRetryWithError(error))
            return
        }
        
        // Attempt to refresh token
        Task {
            do {
                try await tokenManager.refreshToken()
                completion(.retry)
            } catch {
                completion(.doNotRetryWithError(error))
            }
        }
    }
}

// MARK: - API Logger
class APILogger: EventMonitor {
    func requestDidFinish(_ request: Request) {
        #if DEBUG
        print("📤 Request: \(request.request?.url?.absoluteString ?? "")")
        print("Method: \(request.request?.httpMethod ?? "")")
        if let headers = request.request?.headers {
            print("Headers: \(headers)")
        }
        if let body = request.request?.httpBody,
           let bodyString = String(data: body, encoding: .utf8) {
            print("Body: \(bodyString)")
        }
        #endif
    }
    
    func request<Value>(_ request: DataRequest, didParseResponse response: DataResponse<Value, AFError>) {
        #if DEBUG
        print("📥 Response: \(request.request?.url?.absoluteString ?? "")")
        print("Status Code: \(response.response?.statusCode ?? 0)")
        if let data = response.data,
           let responseString = String(data: data, encoding: .utf8) {
            print("Response Data: \(responseString)")
        }
        #endif
    }
}

// MARK: - API Endpoints
enum APIEndpoint {
    // Authentication
    case login
    case register
    case refreshToken
    case logout
    case biometricRegister
    case biometricVerify
    
    // Wallet
    case walletBalances
    case virtualIBANs
    case transactions
    case transaction(String)
    
    // Transfers
    case transferQuote
    case transferInitiate
    case transferStatus(String)
    case transferHistory
    
    // Beneficiaries
    case beneficiaries
    case beneficiary(String)
    
    // Notifications
    case registerDevice
    case notifications
    case markNotificationRead(String)
    
    // Profile
    case profile
    case updateProfile
    case changePassword
    
    // Payment Systems
    case papssTransfer
    case cipsTransfer
    case pixTransfer
    case upiTransfer
    case mojaloopTransfer
    case nibssTransfer
    
    var path: String {
        switch self {
        // Authentication
        case .login: return "/auth/login"
        case .register: return "/auth/register"
        case .refreshToken: return "/auth/refresh"
        case .logout: return "/auth/logout"
        case .biometricRegister: return "/auth/biometric/register"
        case .biometricVerify: return "/auth/biometric/verify"
        
        // Wallet
        case .walletBalances: return "/wallet/balances"
        case .virtualIBANs: return "/wallet/virtual-ibans"
        case .transactions: return "/wallet/transactions"
        case .transaction(let id): return "/wallet/transactions/\(id)"
        
        // Transfers
        case .transferQuote: return "/transfers/quote"
        case .transferInitiate: return "/transfers/initiate"
        case .transferStatus(let id): return "/transfers/\(id)/status"
        case .transferHistory: return "/transfers/history"
        
        // Beneficiaries
        case .beneficiaries: return "/beneficiaries"
        case .beneficiary(let id): return "/beneficiaries/\(id)"
        
        // Notifications
        case .registerDevice: return "/notifications/register-device"
        case .notifications: return "/notifications"
        case .markNotificationRead(let id): return "/notifications/\(id)/read"
        
        // Profile
        case .profile: return "/profile"
        case .updateProfile: return "/profile/update"
        case .changePassword: return "/profile/change-password"
        
        // Payment Systems
        case .papssTransfer: return "/payments/papss/transfer"
        case .cipsTransfer: return "/payments/cips/transfer"
        case .pixTransfer: return "/payments/pix/transfer"
        case .upiTransfer: return "/payments/upi/transfer"
        case .mojaloopTransfer: return "/payments/mojaloop/transfer"
        case .nibssTransfer: return "/payments/nibss/transfer"
        }
    }
}

// MARK: - API Errors
enum APIError: LocalizedError {
    case networkError(String)
    case unauthorized
    case forbidden
    case notFound
    case validationError(String)
    case rateLimitExceeded
    case serverError
    case unknown(String)
    
    var errorDescription: String? {
        switch self {
        case .networkError(let message):
            return "Network error: \(message)"
        case .unauthorized:
            return "Unauthorized. Please login again."
        case .forbidden:
            return "Access forbidden"
        case .notFound:
            return "Resource not found"
        case .validationError(let message):
            return "Validation error: \(message)"
        case .rateLimitExceeded:
            return "Too many requests. Please try again later."
        case .serverError:
            return "Server error. Please try again later."
        case .unknown(let message):
            return "Unknown error: \(message)"
        }
    }
}
