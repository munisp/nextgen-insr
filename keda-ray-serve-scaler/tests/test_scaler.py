import os
import psycopg2
import psycopg2.extras
import logging

logger = logging.getLogger(__name__)

DATABASE_URL = os.environ.get("DATABASE_URL", "postgresql://ngapp:ngapp@localhost:5432/ngapp")
_db_conn = None

def get_db():
    global _db_conn
    if _db_conn is None or _db_conn.closed:
        try:
            _db_conn = psycopg2.connect(DATABASE_URL)
            _db_conn.autocommit = True
        except Exception as e:
            logger.warning(f"Database connection failed: {e}")
            return None
    return _db_conn

"""
Unit tests for KEDA Ray Serve External Scaler
"""
import pytest
import asyncio
from unittest.mock import AsyncMock, MagicMock, patch
from datetime import datetime

import sys
sys.path.insert(0, '../src')

from ray_serve_metrics import RayServeMetricsCollector, QueueMetrics, LatencyMetrics
from scaler_service import RayServeExternalScaler
import externalscaler_pb2


@pytest.fixture
async def metrics_collector():
    """Create metrics collector for testing"""
    collector = RayServeMetricsCollector(
        ray_serve_url="http://test:8000",
        prometheus_url="http://test:9090",
        scrape_interval=10
    )
    await collector.start()
    yield collector
    await collector.stop()


@pytest.fixture
def scaler_service(metrics_collector):
    """Create scaler service for testing"""
    return RayServeExternalScaler(metrics_collector)


@pytest.mark.asyncio
async def test_queue_metrics_collection(metrics_collector):
    """Test queue metrics collection"""
    # Mock HTTP response
    with patch.object(metrics_collector._session, 'get') as mock_get:
        mock_response = AsyncMock()
        mock_response.status = 200
        mock_response.json = AsyncMock(return_value={
            'queue_length': 25,
            'num_pending_requests': 30
        })
        mock_get.return_value.__aenter__.return_value = mock_response
        
        # Get metrics
        metrics = await metrics_collector.get_queue_metrics('fraud-detection')
        
        assert metrics is not None
        assert metrics.model_name == 'fraud-detection'
        assert metrics.queue_length == 25
        assert metrics.pending_requests == 30


@pytest.mark.asyncio
async def test_latency_metrics_collection(metrics_collector):
    """Test latency metrics collection"""
    # Mock Prometheus metrics response
    metrics_text = """
# HELP ray_serve_deployment_processing_latency_ms Processing latency
# TYPE ray_serve_deployment_processing_latency_ms histogram
ray_serve_deployment_processing_latency_ms{deployment="fraud-detection"} 150.5
ray_serve_deployment_processing_latency_ms{deployment="fraud-detection"} 200.3
ray_serve_deployment_processing_latency_ms{deployment="fraud-detection"} 180.7
ray_serve_deployment_processing_latency_ms{deployment="fraud-detection"} 250.2
ray_serve_deployment_processing_latency_ms{deployment="fraud-detection"} 300.1
"""
    
    with patch.object(metrics_collector._session, 'get') as mock_get:
        mock_response = AsyncMock()
        mock_response.status = 200
        mock_response.text = AsyncMock(return_value=metrics_text)
        mock_get.return_value.__aenter__.return_value = mock_response
        
        # Get metrics
        metrics = await metrics_collector.get_latency_metrics('fraud-detection')
        
        assert metrics is not None
        assert metrics.model_name == 'fraud-detection'
        assert metrics.p95_ms > 0
        assert metrics.avg_ms > 0


@pytest.mark.asyncio
async def test_combined_queue_length(metrics_collector):
    """Test combined queue length across models"""
    # Mock responses for multiple models
    with patch.object(metrics_collector._session, 'get') as mock_get:
        responses = [
            {'queue_length': 10, 'num_pending_requests': 10},
            {'queue_length': 15, 'num_pending_requests': 15},
            {'queue_length': 20, 'num_pending_requests': 20}
        ]
        
        mock_response = AsyncMock()
        mock_response.status = 200
        mock_response.json = AsyncMock(side_effect=responses)
        mock_get.return_value.__aenter__.return_value = mock_response
        
        # Get combined queue length
        total = await metrics_collector.get_combined_queue_length([
            'fraud-detection',
            'risk-scoring',
            'claims-prediction'
        ])
        
        assert total == 45  # 10 + 15 + 20


@pytest.mark.asyncio
async def test_is_active_queue_based(scaler_service, metrics_collector):
    """Test IsActive with queue-based scaling"""
    # Mock queue metrics
    with patch.object(metrics_collector, 'get_combined_queue_length', return_value=25):
        request = externalscaler_pb2.ScaledObjectRef(
            name='test-scaler',
            namespace='ray-serve',
            scalerMetadata={
                'modelNames': 'fraud-detection',
                'queueLengthThreshold': '20',
                'metricType': 'queue'
            }
        )
        
        response = await scaler_service.IsActive(request, None)
        
        assert response.result is True


@pytest.mark.asyncio
async def test_is_active_latency_based(scaler_service, metrics_collector):
    """Test IsActive with latency-based scaling"""
    # Mock latency metrics
    with patch.object(metrics_collector, 'get_max_latency_p95', return_value=600.0):
        request = externalscaler_pb2.ScaledObjectRef(
            name='test-scaler',
            namespace='ray-serve',
            scalerMetadata={
                'modelNames': 'fraud-detection',
                'latencyP95Threshold': '500',
                'metricType': 'latency'
            }
        )
        
        response = await scaler_service.IsActive(request, None)
        
        assert response.result is True


@pytest.mark.asyncio
async def test_get_metric_spec_queue(scaler_service):
    """Test GetMetricSpec for queue metrics"""
    request = externalscaler_pb2.ScaledObjectRef(
        name='test-scaler',
        namespace='ray-serve',
        scalerMetadata={
            'modelNames': 'fraud-detection',
            'queueLengthThreshold': '20',
            'metricType': 'queue'
        }
    )
    
    response = await scaler_service.GetMetricSpec(request, None)
    
    assert len(response.metricSpecs) == 1
    assert response.metricSpecs[0].metricName == 'ray-serve-queue-length'
    assert response.metricSpecs[0].targetSize == 20


@pytest.mark.asyncio
async def test_get_metric_spec_latency(scaler_service):
    """Test GetMetricSpec for latency metrics"""
    request = externalscaler_pb2.ScaledObjectRef(
        name='test-scaler',
        namespace='ray-serve',
        scalerMetadata={
            'modelNames': 'fraud-detection',
            'latencyP95Threshold': '500',
            'metricType': 'latency'
        }
    )
    
    response = await scaler_service.GetMetricSpec(request, None)
    
    assert len(response.metricSpecs) == 1
    assert response.metricSpecs[0].metricName == 'ray-serve-latency-p95'
    assert response.metricSpecs[0].targetSize == 500


@pytest.mark.asyncio
async def test_get_metrics_queue(scaler_service, metrics_collector):
    """Test GetMetrics for queue length"""
    with patch.object(metrics_collector, 'get_combined_queue_length', return_value=35):
        request = externalscaler_pb2.GetMetricsRequest(
            scaledObjectRef=externalscaler_pb2.ScaledObjectRef(
                name='test-scaler',
                namespace='ray-serve',
                scalerMetadata={
                    'modelNames': 'fraud-detection,risk-scoring',
                    'queueLengthThreshold': '20',
                    'metricType': 'queue'
                }
            ),
            metricName='ray-serve-queue-length'
        )
        
        response = await scaler_service.GetMetrics(request, None)
        
        assert len(response.metricValues) == 1
        assert response.metricValues[0].metricValue == 35


@pytest.mark.asyncio
async def test_get_metrics_latency(scaler_service, metrics_collector):
    """Test GetMetrics for latency"""
    with patch.object(metrics_collector, 'get_max_latency_p95', return_value=750.5):
        request = externalscaler_pb2.GetMetricsRequest(
            scaledObjectRef=externalscaler_pb2.ScaledObjectRef(
                name='test-scaler',
                namespace='ray-serve',
                scalerMetadata={
                    'modelNames': 'fraud-detection',
                    'latencyP95Threshold': '500',
                    'metricType': 'latency'
                }
            ),
            metricName='ray-serve-latency-p95'
        )
        
        response = await scaler_service.GetMetrics(request, None)
        
        assert len(response.metricValues) == 1
        assert response.metricValues[0].metricValue == 750


@pytest.mark.asyncio
async def test_metrics_caching(metrics_collector):
    """Test metrics caching behavior"""
    # Set initial metrics
    metrics = QueueMetrics(
        model_name='test-model',
        queue_length=10,
        pending_requests=10,
        timestamp=datetime.utcnow()
    )
    metrics_collector._queue_metrics['test-model'] = metrics
    
    # Check staleness
    assert not metrics_collector.is_metrics_stale('test-model', max_age_seconds=60)
    
    # Wait and check again
    await asyncio.sleep(0.1)
    assert not metrics_collector.is_metrics_stale('test-model', max_age_seconds=60)


@pytest.mark.asyncio
async def test_error_handling_queue_metrics(metrics_collector):
    """Test error handling in queue metrics collection"""
    with patch.object(metrics_collector._session, 'get') as mock_get:
        mock_get.side_effect = Exception("Connection error")
        
        # Should return None on error
        metrics = await metrics_collector.get_queue_metrics('fraud-detection')
        assert metrics is None


@pytest.mark.asyncio
async def test_error_handling_is_active(scaler_service, metrics_collector):
    """Test error handling in IsActive"""
    with patch.object(metrics_collector, 'get_combined_queue_length', side_effect=Exception("Error")):
        request = externalscaler_pb2.ScaledObjectRef(
            name='test-scaler',
            namespace='ray-serve',
            scalerMetadata={
                'modelNames': 'fraud-detection',
                'queueLengthThreshold': '20',
                'metricType': 'queue'
            }
        )
        
        # Should return True on error (fail-safe)
        response = await scaler_service.IsActive(request, None)
        assert response.result is True


if __name__ == '__main__':
    pytest.main([__file__, '-v'])
