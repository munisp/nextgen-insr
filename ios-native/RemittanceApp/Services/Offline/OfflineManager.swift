//
//  OfflineManager.swift
//  RemittanceApp
//
//  Offline mode with background sync
//

import Foundation
import CoreData
import Combine

/// Offline manager for handling offline operations and sync
class OfflineManager: ObservableObject {
    
    // MARK: - Properties
    
    static let shared = OfflineManager()
    
    @Published var isOnline: Bool = true
    @Published var isSyncing: Bool = false
    @Published var pendingSyncCount: Int = 0
    
    private let networkMonitor = NetworkMonitor.shared
    private var cancellables = Set<AnyCancellable>()
    
    private let persistentContainer: NSPersistentContainer
    private let syncQueue = DispatchQueue(label: "com.remittance.sync", qos: .utility)
    
    // MARK: - Initialization
    
    private init() {
        // Setup Core Data
        persistentContainer = NSPersistentContainer(name: "RemittanceOffline")
        persistentContainer.loadPersistentStores { description, error in
            if let error = error {
                // Graceful degradation: log the error and report to monitoring.
                // Do NOT crash — offline features will be unavailable but the
                // app remains functional for online operations.
                print("[OfflineManager] Failed to load persistent stores: \(error)")
                #if canImport(os)
                os_log(.error, "CoreData persistent store load failed: %{public}@", error.localizedDescription)
                #endif
                // Attempt to delete corrupted store and retry on next launch
                if let storeURL = description.url {
                    try? FileManager.default.removeItem(at: storeURL)
                    print("[OfflineManager] Removed corrupted store, will retry on next launch")
                }
            }
        }
        
        setupNetworkMonitoring()
        setupBackgroundSync()
    }
    
    // MARK: - Network Monitoring
    
    private func setupNetworkMonitoring() {
        networkMonitor.$isConnected
            .receive(on: DispatchQueue.main)
            .sink { [weak self] isConnected in
                self?.isOnline = isConnected
                if isConnected {
                    self?.syncPendingOperations()
                }
            }
            .store(in: &cancellables)
    }
    
    // MARK: - Offline Operations
    
    /// Queue a transaction for offline processing
    func queueTransaction(_ transaction: Transaction) {
        let context = persistentContainer.viewContext
        
        let offlineTransaction = OfflineTransaction(context: context)
        offlineTransaction.id = transaction.id
        offlineTransaction.type = transaction.type.rawValue
        offlineTransaction.amount = NSDecimalNumber(decimal: transaction.amount)
        offlineTransaction.currency = transaction.currency
        offlineTransaction.recipientId = transaction.recipientId
        offlineTransaction.status = "pending_sync"
        offlineTransaction.createdAt = Date()
        offlineTransaction.data = try? JSONEncoder().encode(transaction)
        
        saveContext()
        updatePendingCount()
    }
    
    /// Queue a beneficiary for offline processing
    func queueBeneficiary(_ beneficiary: Beneficiary) {
        let context = persistentContainer.viewContext
        
        let offlineBeneficiary = OfflineBeneficiary(context: context)
        offlineBeneficiary.id = beneficiary.id
        offlineBeneficiary.name = beneficiary.name
        offlineBeneficiary.accountNumber = beneficiary.accountNumber
        offlineBeneficiary.bankName = beneficiary.bankName
        offlineBeneficiary.country = beneficiary.country
        offlineBeneficiary.status = "pending_sync"
        offlineBeneficiary.createdAt = Date()
        offlineBeneficiary.data = try? JSONEncoder().encode(beneficiary)
        
        saveContext()
        updatePendingCount()
    }
    
    /// Get cached transactions
    func getCachedTransactions() -> [Transaction] {
        let context = persistentContainer.viewContext
        let request: NSFetchRequest<OfflineTransaction> = OfflineTransaction.fetchRequest()
        request.sortDescriptors = [NSSortDescriptor(key: "createdAt", ascending: false)]
        
        do {
            let offlineTransactions = try context.fetch(request)
            return offlineTransactions.compactMap { offlineTransaction in
                guard let data = offlineTransaction.data else { return nil }
                return try? JSONDecoder().decode(Transaction.self, from: data)
            }
        } catch {
            print("Failed to fetch cached transactions: \(error)")
            return []
        }
    }
    
    /// Get cached beneficiaries
    func getCachedBeneficiaries() -> [Beneficiary] {
        let context = persistentContainer.viewContext
        let request: NSFetchRequest<OfflineBeneficiary> = OfflineBeneficiary.fetchRequest()
        request.sortDescriptors = [NSSortDescriptor(key: "createdAt", ascending: false)]
        
        do {
            let offlineBeneficiaries = try context.fetch(request)
            return offlineBeneficiaries.compactMap { offlineBeneficiary in
                guard let data = offlineBeneficiary.data else { return nil }
                return try? JSONDecoder().decode(Beneficiary.self, from: data)
            }
        } catch {
            print("Failed to fetch cached beneficiaries: \(error)")
            return []
        }
    }
    
    // MARK: - Sync Operations
    
    private func setupBackgroundSync() {
        // Sync every 5 minutes when online
        Timer.publish(every: 300, on: .main, in: .common)
            .autoconnect()
            .sink { [weak self] _ in
                if self?.isOnline == true {
                    self?.syncPendingOperations()
                }
            }
            .store(in: &cancellables)
    }
    
    /// Sync all pending operations
    func syncPendingOperations() {
        guard isOnline && !isSyncing else { return }
        
        DispatchQueue.main.async {
            self.isSyncing = true
        }
        
        syncQueue.async { [weak self] in
            self?.syncTransactions()
            self?.syncBeneficiaries()
            
            DispatchQueue.main.async {
                self?.isSyncing = false
                self?.updatePendingCount()
            }
        }
    }
    
    private func syncTransactions() {
        let context = persistentContainer.viewContext
        let request: NSFetchRequest<OfflineTransaction> = OfflineTransaction.fetchRequest()
        request.predicate = NSPredicate(format: "status == %@", "pending_sync")
        
        do {
            let pendingTransactions = try context.fetch(request)
            
            for offlineTransaction in pendingTransactions {
                guard let data = offlineTransaction.data,
                      let transaction = try? JSONDecoder().decode(Transaction.self, from: data) else {
                    continue
                }
                
                // Sync with backend
                Task {
                    do {
                        try await APIClient.shared.syncTransaction(transaction)
                        
                        // Mark as synced
                        await MainActor.run {
                            offlineTransaction.status = "synced"
                            offlineTransaction.syncedAt = Date()
                            self.saveContext()
                        }
                    } catch {
                        print("Failed to sync transaction: \(error)")
                        // Will retry on next sync
                    }
                }
            }
        } catch {
            print("Failed to fetch pending transactions: \(error)")
        }
    }
    
    private func syncBeneficiaries() {
        let context = persistentContainer.viewContext
        let request: NSFetchRequest<OfflineBeneficiary> = OfflineBeneficiary.fetchRequest()
        request.predicate = NSPredicate(format: "status == %@", "pending_sync")
        
        do {
            let pendingBeneficiaries = try context.fetch(request)
            
            for offlineBeneficiary in pendingBeneficiaries {
                guard let data = offlineBeneficiary.data,
                      let beneficiary = try? JSONDecoder().decode(Beneficiary.self, from: data) else {
                    continue
                }
                
                // Sync with backend
                Task {
                    do {
                        try await APIClient.shared.syncBeneficiary(beneficiary)
                        
                        // Mark as synced
                        await MainActor.run {
                            offlineBeneficiary.status = "synced"
                            offlineBeneficiary.syncedAt = Date()
                            self.saveContext()
                        }
                    } catch {
                        print("Failed to sync beneficiary: \(error)")
                    }
                }
            }
        } catch {
            print("Failed to fetch pending beneficiaries: \(error)")
        }
    }
    
    // MARK: - Helper Methods
    
    private func saveContext() {
        let context = persistentContainer.viewContext
        if context.hasChanges {
            do {
                try context.save()
            } catch {
                print("Failed to save context: \(error)")
            }
        }
    }
    
    private func updatePendingCount() {
        let context = persistentContainer.viewContext
        
        let transactionRequest: NSFetchRequest<OfflineTransaction> = OfflineTransaction.fetchRequest()
        transactionRequest.predicate = NSPredicate(format: "status == %@", "pending_sync")
        
        let beneficiaryRequest: NSFetchRequest<OfflineBeneficiary> = OfflineBeneficiary.fetchRequest()
        beneficiaryRequest.predicate = NSPredicate(format: "status == %@", "pending_sync")
        
        do {
            let transactionCount = try context.count(for: transactionRequest)
            let beneficiaryCount = try context.count(for: beneficiaryRequest)
            
            DispatchQueue.main.async {
                self.pendingSyncCount = transactionCount + beneficiaryCount
            }
        } catch {
            print("Failed to count pending items: \(error)")
        }
    }
    
    /// Clear synced items older than 30 days
    func cleanupOldSyncedItems() {
        let context = persistentContainer.viewContext
        let thirtyDaysAgo = Calendar.current.date(byAdding: .day, value: -30, to: Date())!
        
        // Clean transactions
        let transactionRequest: NSFetchRequest<OfflineTransaction> = OfflineTransaction.fetchRequest()
        transactionRequest.predicate = NSPredicate(
            format: "status == %@ AND syncedAt < %@",
            "synced",
            thirtyDaysAgo as NSDate
        )
        
        // Clean beneficiaries
        let beneficiaryRequest: NSFetchRequest<OfflineBeneficiary> = OfflineBeneficiary.fetchRequest()
        beneficiaryRequest.predicate = NSPredicate(
            format: "status == %@ AND syncedAt < %@",
            "synced",
            thirtyDaysAgo as NSDate
        )
        
        do {
            let oldTransactions = try context.fetch(transactionRequest)
            let oldBeneficiaries = try context.fetch(beneficiaryRequest)
            
            oldTransactions.forEach { context.delete($0) }
            oldBeneficiaries.forEach { context.delete($0) }
            
            saveContext()
        } catch {
            print("Failed to cleanup old items: \(error)")
        }
    }
}

// MARK: - Network Monitor

class NetworkMonitor: ObservableObject {
    static let shared = NetworkMonitor()
    
    @Published var isConnected: Bool = true
    
    private init() {
        // Implement network monitoring using Network framework
        // This is a simplified version
        startMonitoring()
    }
    
    private func startMonitoring() {
        // Use NWPathMonitor for actual implementation
        // For now, assume always connected
    }
}
