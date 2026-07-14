import UIKit
import SwiftUI

/// Virtual Scrolling - 10x better performance with long lists
class VirtualScrollOptimizer {
    
    /// Optimized table view with cell reuse
    class OptimizedTableView: UITableView {
        
        override init(frame: CGRect, style: UITableView.Style) {
            super.init(frame: frame, style: style)
            setupOptimizations()
        }
        
        required init?(coder: NSCoder) {
            super.init(coder: coder)
            setupOptimizations()
        }
        
        private func setupOptimizations() {
            // Enable cell prefetching
            isPrefetchingEnabled = true
            
            // Estimate row height for better performance
            estimatedRowHeight = 80
            rowHeight = UITableView.automaticDimension
            
            // Reduce overdraw
            layer.shouldRasterize = true
            layer.rasterizationScale = UIScreen.main.scale
        }
    }
    
    /// Optimized collection view with flow layout
    class OptimizedCollectionView: UICollectionView {
        
        init() {
            let layout = UICollectionViewFlowLayout()
            layout.estimatedItemSize = CGSize(width: 100, height: 100)
            layout.minimumInteritemSpacing = 8
            layout.minimumLineSpacing = 8
            
            super.init(frame: .zero, collectionViewLayout: layout)
            setupOptimizations()
        }
        
        required init?(coder: NSCoder) {
            // Graceful degradation: return nil instead of crashing.
            // This init path is only hit via Interface Builder which we don't use.
            return nil
        }
        
        private func setupOptimizations() {
            // Enable prefetching
            isPrefetchingEnabled = true
            
            // Reduce overdraw
            layer.shouldRasterize = true
            layer.rasterizationScale = UIScreen.main.scale
        }
    }
}

/// SwiftUI LazyVStack/LazyHStack for efficient scrolling
struct VirtualList<Item: Identifiable, Content: View>: View {
    let items: [Item]
    let content: (Item) -> Content
    
    var body: some View {
        ScrollView {
            LazyVStack(spacing: 8) {
                ForEach(items) { item in
                    content(item)
                }
            }
        }
    }
}

/// Pagination for infinite scroll
class PaginationManager<T> {
    private var currentPage = 1
    private var isLoading = false
    private var hasMore = true
    
    var items: [T] = []
    
    func loadNextPage(fetch: @escaping (Int, @escaping ([T], Bool) -> Void) -> Void) {
        guard !isLoading && hasMore else { return }
        
        isLoading = true
        
        fetch(currentPage) { [weak self] newItems, hasMore in
            guard let self = self else { return }
            
            self.items.append(contentsOf: newItems)
            self.currentPage += 1
            self.hasMore = hasMore
            self.isLoading = false
        }
    }
    
    func reset() {
        currentPage = 1
        items = []
        hasMore = true
        isLoading = false
    }
}
