"""
Continuous Learning Service - Phase 4
Automated model retraining and performance monitoring
"""
import os
import uuid
import logging
from datetime import datetime, timedelta
from typing import Dict, Any, List, Optional
from sqlalchemy.orm import Session

from app.services.data_collection_service import DataCollectionService
from app.services.ml_model_service import MLModelService
from app.models.loan_outcome import ModelPerformanceMetrics, LoanApplication

logger = logging.getLogger(__name__)


class ContinuousLearningService:
    """Service for continuous model learning and improvement"""

    def __init__(self, model_dir: str = "/app/models"):
        self.model_dir = model_dir
        self.data_service = DataCollectionService()
        self.ml_service = MLModelService(model_dir)

        # Retraining thresholds
        self.retraining_config = {
            "min_new_records": 1000,  # Minimum new records before retraining
            "performance_drop_threshold": 0.05,  # 5% drop in AUC triggers retraining
            "retraining_frequency_days": 30,  # Retrain at least monthly
            "min_records_for_training": 5000  # Minimum total records needed
        }

    async def check_retraining_needed(
        self,
        db_session: Session
    ) -> Dict[str, Any]:
        """Check if model retraining is needed"""

        # Get latest model performance
        latest_performance = db_session.query(ModelPerformanceMetrics).order_by(
            ModelPerformanceMetrics.evaluated_at.desc()
        ).first()

        # Get training data statistics
        stats = await self.data_service.get_training_data_statistics(db_session)

        # Check retraining criteria
        reasons = []
        should_retrain = False

        # 1. Check if enough new data collected
        if stats['disbursed_loans'] >= self.retraining_config['min_records_for_training']:
            if latest_performance:
                # Count new records since last training
                new_records = db_session.query(LoanApplication).filter(
                    LoanApplication.created_at > latest_performance.evaluation_end_date,
                    LoanApplication.disbursed.is_(True)
                ).count()

                if new_records >= self.retraining_config['min_new_records']:
                    reasons.append(f"New data available: {new_records} records")
                    should_retrain = True
            else:
                reasons.append("No previous model found - initial training needed")
                should_retrain = True

        # 2. Check if performance has dropped
        if latest_performance:
            current_auc = latest_performance.auc_roc

            # Get previous performance
            previous_performance = db_session.query(ModelPerformanceMetrics).filter(
                ModelPerformanceMetrics.evaluated_at < latest_performance.evaluated_at
            ).order_by(ModelPerformanceMetrics.evaluated_at.desc()).first()

            if previous_performance:
                auc_drop = previous_performance.auc_roc - current_auc
                if auc_drop >= self.retraining_config['performance_drop_threshold']:
                    reasons.append(f"Performance drop detected: {auc_drop:.3f} AUC decrease")
                    should_retrain = True

        # 3. Check if enough time has passed
        if latest_performance:
            days_since_training = (datetime.utcnow() - latest_performance.evaluated_at).days
            if days_since_training >= self.retraining_config['retraining_frequency_days']:
                reasons.append(f"Scheduled retraining: {days_since_training} days since last training")
                should_retrain = True

        result = {
            "should_retrain": should_retrain,
            "reasons": reasons,
            "data_statistics": stats,
            "latest_model_performance": {
                "model_version": latest_performance.model_version if latest_performance else None,
                "auc_roc": latest_performance.auc_roc if latest_performance else None,
                "evaluated_at": latest_performance.evaluated_at if latest_performance else None
            } if latest_performance else None
        }

        logger.info(f"Retraining check: {'NEEDED' if should_retrain else 'NOT NEEDED'}")
        if reasons:
            for reason in reasons:
                logger.info(f"  - {reason}")

        return result

    async def automated_retraining(
        self,
        model_type: str,
        db_session: Session
    ) -> Dict[str, Any]:
        """Perform automated model retraining"""

        logger.info(f"Starting automated retraining for {model_type} model...")

        # 1. Export latest training dataset
        dataset_version = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
        dataset_path = os.path.join(self.model_dir, f"training_data_{dataset_version}.csv")

        dataset = await self.data_service.export_training_dataset(
            dataset_name="automated_retraining",
            dataset_version=dataset_version,
            output_path=dataset_path,
            db_session=db_session
        )

        logger.info(f"Exported training dataset: {dataset.total_records} records")

        # 2. Prepare data
        X_train, X_test, y_train, y_test = self.ml_service.prepare_training_data(
            dataset_path=dataset_path
        )

        # 3. Train model
        model_version = f"v{dataset_version}"

        if model_type == "xgboost":
            result = self.ml_service.train_xgboost_model(
                X_train, y_train, X_test, y_test, model_version
            )
        elif model_type == "neural_net":
            result = self.ml_service.train_neural_network_model(
                X_train, y_train, X_test, y_test, model_version
            )
        else:
            raise ValueError(f"Unsupported model type: {model_type}")

        # 4. Analyze score bands
        score_band_metrics = self.ml_service.analyze_score_bands(
            result['model'], X_test, y_test
        )

        # 5. Save performance metrics
        self.ml_service.save_model_metrics(
            model_version=model_version,
            model_type=model_type.upper(),
            metrics=result['metrics'],
            score_band_metrics=score_band_metrics,
            evaluation_record_count=len(X_test),
            db_session=db_session
        )

        # 6. Save feature importance
        if 'feature_importance' in result:
            self.ml_service.save_feature_importance(
                model_version=model_version,
                feature_importance_list=result['feature_importance'],
                db_session=db_session
            )

        logger.info(f"Automated retraining completed: {model_version}")

        return {
            "model_version": model_version,
            "model_type": model_type,
            "model_path": result['model_path'],
            "metrics": result['metrics'],
            "training_records": len(X_train),
            "test_records": len(X_test),
            "retrained_at": datetime.utcnow()
        }

    async def ab_test_models(
        self,
        model_a_version: str,
        model_b_version: str,
        test_customers: List[str],
        db_session: Session
    ) -> Dict[str, Any]:
        """A/B test two model versions"""

        logger.info(f"Starting A/B test: {model_a_version} vs {model_b_version}")

        # Load both models
        model_a = self.ml_service.load_model(
            os.path.join(self.model_dir, f"xgboost_{model_a_version}.pkl")
        )
        model_b = self.ml_service.load_model(
            os.path.join(self.model_dir, f"xgboost_{model_b_version}.pkl")
        )

        # Get test data
        test_loans = db_session.query(LoanApplication).filter(
            LoanApplication.customer_id.in_(test_customers),
            LoanApplication.loan_status.in_(["COMPLETED", "DEFAULTED"])
        ).all()

        if len(test_loans) < 100:
            raise ValueError(f"Insufficient test data: {len(test_loans)} records (need 100+)")

        # Prepare test features
        X_test = []
        y_test = []
        for loan in test_loans:
            features = list(loan.telco_features_snapshot.values())
            X_test.append(features)
            y_test.append(1 if loan.default_occurred else 0)

        # Evaluate both models
        metrics_a = self.ml_service._evaluate_model(model_a, X_test, y_test, "MODEL_A")
        metrics_b = self.ml_service._evaluate_model(model_b, X_test, y_test, "MODEL_B")

        # Compare performance
        comparison = {
            "model_a": {
                "version": model_a_version,
                "metrics": metrics_a
            },
            "model_b": {
                "version": model_b_version,
                "metrics": metrics_b
            },
            "winner": model_a_version if metrics_a['auc_roc'] > metrics_b['auc_roc'] else model_b_version,
            "performance_difference": {
                "auc_roc": metrics_b['auc_roc'] - metrics_a['auc_roc'],
                "accuracy": metrics_b['accuracy'] - metrics_a['accuracy'],
                "gini": metrics_b['gini_coefficient'] - metrics_a['gini_coefficient']
            },
            "test_records": len(test_loans),
            "tested_at": datetime.utcnow()
        }

        logger.info(f"A/B test completed: Winner = {comparison['winner']}")
        logger.info(f"  Model A AUC: {metrics_a['auc_roc']:.4f}")
        logger.info(f"  Model B AUC: {metrics_b['auc_roc']:.4f}")
        logger.info(f"  Difference: {comparison['performance_difference']['auc_roc']:.4f}")

        return comparison

    async def monitor_model_drift(
        self,
        model_version: str,
        lookback_days: int,
        db_session: Session
    ) -> Dict[str, Any]:
        """Monitor for model drift over time"""

        logger.info(f"Monitoring model drift for {model_version} (last {lookback_days} days)")

        # Get recent loans
        cutoff_date = datetime.utcnow() - timedelta(days=lookback_days)
        recent_loans = db_session.query(LoanApplication).filter(
            LoanApplication.created_at >= cutoff_date,
            LoanApplication.loan_status.in_(["COMPLETED", "DEFAULTED"])
        ).all()

        if len(recent_loans) < 50:
            return {
                "drift_detected": False,
                "reason": f"Insufficient recent data: {len(recent_loans)} records"
            }

        # Load model
        model = self.ml_service.load_model(
            os.path.join(self.model_dir, f"xgboost_{model_version}.pkl")
        )

        # Prepare data
        X = []
        y = []
        for loan in recent_loans:
            features = list(loan.telco_features_snapshot.values())
            X.append(features)
            y.append(1 if loan.default_occurred else 0)

        # Evaluate current performance
        current_metrics = self.ml_service._evaluate_model(model, X, y, "CURRENT")

        # Get historical performance
        historical_performance = db_session.query(ModelPerformanceMetrics).filter(
            ModelPerformanceMetrics.model_version == model_version
        ).order_by(ModelPerformanceMetrics.evaluated_at.asc()).first()

        if not historical_performance:
            return {
                "drift_detected": False,
                "reason": "No historical performance data available"
            }

        # Calculate drift
        auc_drift = historical_performance.auc_roc - current_metrics['auc_roc']
        accuracy_drift = historical_performance.accuracy - current_metrics['accuracy']

        # Detect significant drift (>5% drop in AUC)
        drift_detected = auc_drift >= 0.05

        drift_analysis = {
            "drift_detected": drift_detected,
            "model_version": model_version,
            "lookback_days": lookback_days,
            "historical_performance": {
                "auc_roc": historical_performance.auc_roc,
                "accuracy": historical_performance.accuracy,
                "evaluated_at": historical_performance.evaluated_at
            },
            "current_performance": {
                "auc_roc": current_metrics['auc_roc'],
                "accuracy": current_metrics['accuracy'],
                "evaluated_at": datetime.utcnow()
            },
            "drift_metrics": {
                "auc_drift": round(auc_drift, 4),
                "accuracy_drift": round(accuracy_drift, 4)
            },
            "recent_records_analyzed": len(recent_loans)
        }

        if drift_detected:
            logger.warning(f"Model drift detected! AUC dropped by {auc_drift:.4f}")
        else:
            logger.info(f"No significant drift detected (AUC drift: {auc_drift:.4f})")

        return drift_analysis

    async def get_model_performance_history(
        self,
        model_version: Optional[str],
        limit: int,
        db_session: Session
    ) -> List[Dict[str, Any]]:
        """Get historical model performance"""

        query = db_session.query(ModelPerformanceMetrics)

        if model_version:
            query = query.filter(ModelPerformanceMetrics.model_version == model_version)

        performances = query.order_by(
            ModelPerformanceMetrics.evaluated_at.desc()
        ).limit(limit).all()

        history = []
        for perf in performances:
            history.append({
                "model_version": perf.model_version,
                "model_type": perf.model_type,
                "auc_roc": perf.auc_roc,
                "gini_coefficient": perf.gini_coefficient,
                "accuracy": perf.accuracy,
                "precision": perf.precision,
                "recall": perf.recall,
                "f1_score": perf.f1_score,
                "evaluated_at": perf.evaluated_at
            })

        return history

    async def schedule_retraining_job(
        self,
        model_type: str,
        frequency_days: int,
        db_session: Session
    ) -> Dict[str, Any]:
        """Schedule automated retraining job"""

        # This would integrate with a job scheduler like Celery, APScheduler, or Airflow
        # For now, we'll return the configuration

        job_config = {
            "job_id": str(uuid.uuid4()),
            "job_type": "automated_retraining",
            "model_type": model_type,
            "frequency_days": frequency_days,
            "next_run": datetime.utcnow() + timedelta(days=frequency_days),
            "enabled": True,
            "created_at": datetime.utcnow()
        }

        logger.info(f"Scheduled retraining job: {model_type} every {frequency_days} days")

        return job_config

    def get_retraining_config(self) -> Dict[str, Any]:
        """Get current retraining configuration"""
        return self.retraining_config

    def update_retraining_config(self, config: Dict[str, Any]):
        """Update retraining configuration"""
        self.retraining_config.update(config)
        logger.info(f"Updated retraining config: {config}")
