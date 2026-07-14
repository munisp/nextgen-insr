/// High-performance embedding comparison using cosine similarity and euclidean distance.

pub struct ComparisonResult {
    pub similarity: f64,
    pub distance: f64,
}

/// Compare two embedding vectors using cosine similarity.
pub fn compare_embeddings(source: &[f64], target: &[f64], _threshold: f64) -> ComparisonResult {
    if source.is_empty() || target.is_empty() || source.len() != target.len() {
        return ComparisonResult {
            similarity: 0.0,
            distance: f64::MAX,
        };
    }

    let cosine_sim = cosine_similarity(source, target);
    let euclidean_dist = euclidean_distance(source, target);

    ComparisonResult {
        similarity: cosine_sim.max(0.0).min(1.0),
        distance: euclidean_dist,
    }
}

/// Cosine similarity: dot(a,b) / (||a|| * ||b||)
fn cosine_similarity(a: &[f64], b: &[f64]) -> f64 {
    let mut dot = 0.0_f64;
    let mut norm_a = 0.0_f64;
    let mut norm_b = 0.0_f64;

    // SIMD-friendly loop (auto-vectorized by LLVM)
    for i in 0..a.len() {
        dot += a[i] * b[i];
        norm_a += a[i] * a[i];
        norm_b += b[i] * b[i];
    }

    let denom = norm_a.sqrt() * norm_b.sqrt();
    if denom < 1e-10 {
        return 0.0;
    }

    dot / denom
}

/// L2 (Euclidean) distance
fn euclidean_distance(a: &[f64], b: &[f64]) -> f64 {
    let mut sum = 0.0_f64;
    for i in 0..a.len() {
        let diff = a[i] - b[i];
        sum += diff * diff;
    }
    sum.sqrt()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_identical_vectors() {
        let v = vec![1.0, 2.0, 3.0, 4.0];
        let result = compare_embeddings(&v, &v, 0.5);
        assert!((result.similarity - 1.0).abs() < 1e-6);
        assert!(result.distance < 1e-6);
    }

    #[test]
    fn test_orthogonal_vectors() {
        let a = vec![1.0, 0.0, 0.0];
        let b = vec![0.0, 1.0, 0.0];
        let result = compare_embeddings(&a, &b, 0.5);
        assert!(result.similarity.abs() < 1e-6);
    }

    #[test]
    fn test_opposite_vectors() {
        let a = vec![1.0, 2.0, 3.0];
        let b = vec![-1.0, -2.0, -3.0];
        let result = compare_embeddings(&a, &b, 0.5);
        assert!((result.similarity - (-1.0)).abs() < 1e-6 || result.similarity < 0.01);
    }

    #[test]
    fn test_empty_vectors() {
        let result = compare_embeddings(&[], &[], 0.5);
        assert_eq!(result.similarity, 0.0);
    }

    #[test]
    fn test_mismatched_lengths() {
        let a = vec![1.0, 2.0];
        let b = vec![1.0, 2.0, 3.0];
        let result = compare_embeddings(&a, &b, 0.5);
        assert_eq!(result.similarity, 0.0);
    }

    #[test]
    fn test_similar_vectors() {
        let a = vec![1.0, 2.0, 3.0, 4.0, 5.0];
        let b = vec![1.1, 2.1, 2.9, 4.0, 5.1];
        let result = compare_embeddings(&a, &b, 0.9);
        assert!(result.similarity > 0.99);
    }
}
