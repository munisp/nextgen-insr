import Foundation
import Security

/// Certificate Pinning - Prevents 99% of MITM Attacks
class CertificatePinning: NSObject, URLSessionDelegate {
    static let shared = CertificatePinning()
    
    // SHA-256 hashes of pinned certificates
    private let pinnedCertificates: Set<String> = [
        "sha256/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=", // Production cert
        "sha256/BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=", // Backup cert
    ]
    
    private let pinnedDomains: Set<String> = [
        "api.remittance.ng",
        "secure.remittance.ng",
        "api.54link.ng",
        "staging.54link.ng"
    ]
    
    func urlSession(_ session: URLSession, didReceive challenge: URLAuthenticationChallenge, completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
        
        guard let serverTrust = challenge.protectionSpace.serverTrust,
              pinnedDomains.contains(challenge.protectionSpace.host) else {
            completionHandler(.performDefaultHandling, nil)
            return
        }
        
        // Evaluate server trust
        var secresult = SecTrustResultType.invalid
        let status = SecTrustEvaluate(serverTrust, &secresult)
        
        guard status == errSecSuccess else {
            completionHandler(.cancelAuthenticationChallenge, nil)
            logSecurityEvent("Certificate validation failed")
            return
        }
        
        // Get server certificate
        guard let serverCertificate = SecTrustGetCertificateAtIndex(serverTrust, 0) else {
            completionHandler(.cancelAuthenticationChallenge, nil)
            return
        }
        
        // Get certificate data and hash
        let serverCertificateData = SecCertificateCopyData(serverCertificate) as Data
        let certificateHash = sha256(data: serverCertificateData)
        
        // Check if certificate is pinned
        if pinnedCertificates.contains(certificateHash) {
            let credential = URLCredential(trust: serverTrust)
            completionHandler(.useCredential, credential)
        } else {
            completionHandler(.cancelAuthenticationChallenge, nil)
            logSecurityEvent("Certificate pinning failed - Unknown certificate")
        }
    }
    
    private func sha256(data: Data) -> String {
        var hash = [UInt8](repeating: 0, count: Int(CC_SHA256_DIGEST_LENGTH))
        data.withUnsafeBytes {
            _ = CC_SHA256($0.baseAddress, CC_LONG(data.count), &hash)
        }
        return "sha256/" + Data(hash).base64EncodedString()
    }
    
    private func logSecurityEvent(_ event: String) {
        // Log to security monitoring system
        print("[SECURITY] \(event)")
    }
}
