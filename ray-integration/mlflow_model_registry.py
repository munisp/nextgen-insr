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
MLflow Model Registry Integration for Ray ML

Provides model versioning, staging, and deployment management
integrated with Ray Serve for the insurance platform.
"""

import os
import json
import logging
from datetime import datetime
from typing import Any, Dict, List, Optional
from dataclasses import dataclass, asdict
from enum import Enum

import mlflow
from mlflow.tracking import MlflowClient
from mlflow.models import Model
from mlflow.exceptions import MlflowException

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class ModelStage(Enum):
    """Model lifecycle stages"""
    NONE = "None"
    STAGING = "Staging"
    PRODUCTION = "Production"
    ARCHIVED = "Archived"


@dataclass
class ModelVersion:
    """Model version information"""
    name: str
    version: str
    stage: str
    description: str
    run_id: str
    source: str
    creation_timestamp: int
    last_updated_timestamp: int
    tags: Dict[str, str]
    metrics: Dict[str, float]


@dataclass
class ModelDeployment:
    """Model deployment information"""
    model_name: str
    model_version: str
    deployment_name: str
    ray_serve_url: str
    replicas: int
    status: str
    created_at: str
    updated_at: str


class MLflowModelRegistry:
    """MLflow Model Registry integration for insurance ML models"""
    
    def __init__(
        self,
        tracking_uri: Optional[str] = None,
        registry_uri: Optional[str] = None,
        experiment_name: str = "insurance-ml"
    ):
        self.tracking_uri = tracking_uri or os.getenv(
            "MLFLOW_TRACKING_URI", "http://mlflow:5000"
        )
        self.registry_uri = registry_uri or os.getenv(
            "MLFLOW_REGISTRY_URI", self.tracking_uri
        )
        self.experiment_name = experiment_name
        
        # Initialize MLflow
        mlflow.set_tracking_uri(self.tracking_uri)
        mlflow.set_registry_uri(self.registry_uri)
        
        self.client = MlflowClient()
        
        # Ensure experiment exists
        self._ensure_experiment()
        
        logger.info(f"MLflow Model Registry initialized: {self.tracking_uri}")
    
    def _ensure_experiment(self):
        """Ensure the experiment exists"""
        try:
            experiment = mlflow.get_experiment_by_name(self.experiment_name)
            if experiment is None:
                mlflow.create_experiment(self.experiment_name)
                logger.info(f"Created experiment: {self.experiment_name}")
        except MlflowException as e:
            logger.warning(f"Failed to create experiment: {e}")
    
    def start_run(
        self,
        run_name: str,
        tags: Optional[Dict[str, str]] = None
    ) -> str:
        """
        Start a new MLflow run
        
        Args:
            run_name: Name for the run
            tags: Optional tags for the run
            
        Returns:
            Run ID
        """
        mlflow.set_experiment(self.experiment_name)
        
        run = mlflow.start_run(run_name=run_name, tags=tags)
        run_id = run.info.run_id
        
        logger.info(f"Started MLflow run: {run_id}")
        return run_id
    
    def end_run(self, status: str = "FINISHED"):
        """End the current MLflow run"""
        mlflow.end_run(status=status)
        logger.info(f"Ended MLflow run with status: {status}")
    
    def log_params(self, params: Dict[str, Any]):
        """Log parameters to current run"""
        mlflow.log_params(params)
    
    def log_metrics(self, metrics: Dict[str, float], step: Optional[int] = None):
        """Log metrics to current run"""
        mlflow.log_metrics(metrics, step=step)
    
    def log_model(
        self,
        model: Any,
        artifact_path: str,
        model_type: str = "sklearn",
        registered_model_name: Optional[str] = None,
        signature: Optional[Any] = None,
        input_example: Optional[Any] = None
    ) -> str:
        """
        Log model to MLflow
        
        Args:
            model: The model object
            artifact_path: Path to store the model artifact
            model_type: Type of model (sklearn, xgboost, pytorch, etc.)
            registered_model_name: Name to register the model under
            signature: Model signature
            input_example: Example input for the model
            
        Returns:
            Model URI
        """
        log_func = getattr(mlflow, model_type, mlflow.sklearn)
        
        model_info = log_func.log_model(
            model,
            artifact_path,
            registered_model_name=registered_model_name,
            signature=signature,
            input_example=input_example
        )
        
        logger.info(f"Logged model to: {model_info.model_uri}")
        return model_info.model_uri
    
    def register_model(
        self,
        model_uri: str,
        name: str,
        tags: Optional[Dict[str, str]] = None,
        description: Optional[str] = None
    ) -> ModelVersion:
        """
        Register a model to the Model Registry
        
        Args:
            model_uri: URI of the model artifact
            name: Name for the registered model
            tags: Optional tags
            description: Optional description
            
        Returns:
            ModelVersion object
        """
        # Register the model
        result = mlflow.register_model(model_uri, name)
        
        # Add tags and description
        if tags:
            for key, value in tags.items():
                self.client.set_model_version_tag(
                    name, result.version, key, value
                )
        
        if description:
            self.client.update_model_version(
                name, result.version, description=description
            )
        
        logger.info(f"Registered model: {name} version {result.version}")
        
        return self._to_model_version(result)
    
    def get_model_version(self, name: str, version: str) -> Optional[ModelVersion]:
        """Get a specific model version"""
        try:
            mv = self.client.get_model_version(name, version)
            return self._to_model_version(mv)
        except MlflowException:
            return None
    
    def get_latest_versions(
        self,
        name: str,
        stages: Optional[List[str]] = None
    ) -> List[ModelVersion]:
        """Get latest versions of a model for given stages"""
        try:
            versions = self.client.get_latest_versions(name, stages)
            return [self._to_model_version(v) for v in versions]
        except MlflowException:
            return []
    
    def transition_model_stage(
        self,
        name: str,
        version: str,
        stage: ModelStage,
        archive_existing: bool = True
    ) -> ModelVersion:
        """
        Transition a model version to a new stage
        
        Args:
            name: Model name
            version: Model version
            stage: Target stage
            archive_existing: Whether to archive existing models in the stage
            
        Returns:
            Updated ModelVersion
        """
        result = self.client.transition_model_version_stage(
            name=name,
            version=version,
            stage=stage.value,
            archive_existing_versions=archive_existing
        )
        
        logger.info(f"Transitioned {name} v{version} to {stage.value}")
        return self._to_model_version(result)
    
    def load_model(
        self,
        name: str,
        version: Optional[str] = None,
        stage: Optional[ModelStage] = None
    ) -> Any:
        """
        Load a model from the registry
        
        Args:
            name: Model name
            version: Specific version (optional)
            stage: Stage to load from (optional)
            
        Returns:
            Loaded model
        """
        if version:
            model_uri = f"models:/{name}/{version}"
        elif stage:
            model_uri = f"models:/{name}/{stage.value}"
        else:
            model_uri = f"models:/{name}/latest"
        
        model = mlflow.pyfunc.load_model(model_uri)
        logger.info(f"Loaded model from: {model_uri}")
        return model
    
    def delete_model_version(self, name: str, version: str):
        """Delete a specific model version"""
        self.client.delete_model_version(name, version)
        logger.info(f"Deleted model version: {name} v{version}")
    
    def search_models(
        self,
        filter_string: Optional[str] = None,
        max_results: int = 100
    ) -> List[Dict[str, Any]]:
        """Search registered models"""
        results = self.client.search_registered_models(
            filter_string=filter_string,
            max_results=max_results
        )
        return [
            {
                "name": r.name,
                "description": r.description,
                "creation_timestamp": r.creation_timestamp,
                "last_updated_timestamp": r.last_updated_timestamp,
                "latest_versions": [
                    self._to_model_version(v).__dict__ 
                    for v in r.latest_versions
                ]
            }
            for r in results
        ]
    
    def _to_model_version(self, mv) -> ModelVersion:
        """Convert MLflow ModelVersion to our ModelVersion"""
        # Get metrics from the run
        metrics = {}
        try:
            run = self.client.get_run(mv.run_id)
            metrics = run.data.metrics
        except Exception:
            pass
        
        return ModelVersion(
            name=mv.name,
            version=mv.version,
            stage=mv.current_stage,
            description=mv.description or "",
            run_id=mv.run_id,
            source=mv.source,
            creation_timestamp=mv.creation_timestamp,
            last_updated_timestamp=mv.last_updated_timestamp,
            tags=mv.tags or {},
            metrics=metrics
        )


class InsuranceModelRegistry(MLflowModelRegistry):
    """Insurance-specific model registry with predefined model types"""
    
    # Predefined insurance models
    MODEL_CONFIGS = {
        "fraud-detection": {
            "description": "Fraud detection model for payment transactions",
            "min_auc": 0.85,
            "model_type": "xgboost",
            "features": ["amount", "customer_history", "device_info", "time_features"]
        },
        "risk-scoring": {
            "description": "Risk scoring model for policy underwriting",
            "min_auc": 0.80,
            "model_type": "xgboost",
            "features": ["customer_profile", "policy_type", "coverage", "location"]
        },
        "claims-prediction": {
            "description": "Claims amount and approval prediction",
            "min_auc": 0.75,
            "model_type": "xgboost",
            "features": ["policy_details", "claim_type", "customer_history"]
        },
        "churn-prediction": {
            "description": "Customer churn prediction model",
            "min_auc": 0.78,
            "model_type": "sklearn",
            "features": ["engagement", "payment_history", "policy_count"]
        },
        "premium-optimization": {
            "description": "Dynamic premium optimization model",
            "min_auc": 0.70,
            "model_type": "sklearn",
            "features": ["risk_score", "market_data", "customer_segment"]
        }
    }
    
    def __init__(self, **kwargs):
        super().__init__(experiment_name="insurance-ml-models", **kwargs)
    
    def register_insurance_model(
        self,
        model_name: str,
        model: Any,
        metrics: Dict[str, float],
        run_name: Optional[str] = None,
        extra_tags: Optional[Dict[str, str]] = None
    ) -> Optional[ModelVersion]:
        """
        Register an insurance model with validation
        
        Args:
            model_name: One of the predefined model names
            model: The trained model
            metrics: Model metrics including 'auc'
            run_name: Optional run name
            extra_tags: Additional tags
            
        Returns:
            ModelVersion if successful, None if validation fails
        """
        if model_name not in self.MODEL_CONFIGS:
            raise ValueError(f"Unknown model: {model_name}. Must be one of {list(self.MODEL_CONFIGS.keys())}")
        
        config = self.MODEL_CONFIGS[model_name]
        
        # Validate model performance
        auc = metrics.get("auc", 0)
        if auc < config["min_auc"]:
            logger.warning(
                f"Model {model_name} AUC {auc:.3f} below threshold {config['min_auc']}"
            )
            return None
        
        # Start run and log model
        run_id = self.start_run(
            run_name=run_name or f"{model_name}-training",
            tags={
                "model_type": config["model_type"],
                "insurance_model": model_name
            }
        )
        
        try:
            # Log parameters
            self.log_params({
                "model_name": model_name,
                "model_type": config["model_type"],
                "min_auc_threshold": config["min_auc"]
            })
            
            # Log metrics
            self.log_metrics(metrics)
            
            # Log model
            model_uri = self.log_model(
                model=model,
                artifact_path="model",
                model_type=config["model_type"],
                registered_model_name=model_name
            )
            
            # Get the registered version
            versions = self.get_latest_versions(model_name, stages=["None"])
            if versions:
                version = versions[0]
                
                # Add tags
                tags = {
                    "auc": str(auc),
                    "trained_at": datetime.utcnow().isoformat(),
                    **(extra_tags or {})
                }
                for key, value in tags.items():
                    self.client.set_model_version_tag(
                        model_name, version.version, key, value
                    )
                
                logger.info(f"Registered {model_name} v{version.version} with AUC {auc:.3f}")
                return version
            
        finally:
            self.end_run()
        
        return None
    
    def promote_to_production(
        self,
        model_name: str,
        version: str,
        require_staging: bool = True
    ) -> Optional[ModelVersion]:
        """
        Promote a model version to production
        
        Args:
            model_name: Model name
            version: Version to promote
            require_staging: Whether the model must be in Staging first
            
        Returns:
            Updated ModelVersion or None if validation fails
        """
        mv = self.get_model_version(model_name, version)
        if not mv:
            logger.error(f"Model version not found: {model_name} v{version}")
            return None
        
        if require_staging and mv.stage != ModelStage.STAGING.value:
            logger.error(f"Model must be in Staging before Production. Current: {mv.stage}")
            return None
        
        # Validate metrics
        config = self.MODEL_CONFIGS.get(model_name, {})
        min_auc = config.get("min_auc", 0.7)
        auc = mv.metrics.get("auc", 0)
        
        if auc < min_auc:
            logger.error(f"Model AUC {auc:.3f} below production threshold {min_auc}")
            return None
        
        return self.transition_model_stage(
            model_name, version, ModelStage.PRODUCTION
        )
    
    def get_production_model(self, model_name: str) -> Optional[Any]:
        """Get the current production model"""
        try:
            return self.load_model(model_name, stage=ModelStage.PRODUCTION)
        except Exception as e:
            logger.error(f"Failed to load production model {model_name}: {e}")
            return None
    
    def get_model_lineage(self, model_name: str) -> List[Dict[str, Any]]:
        """Get the version history of a model"""
        versions = []
        try:
            for stage in [None, "Staging", "Production", "Archived"]:
                stage_versions = self.get_latest_versions(
                    model_name, 
                    stages=[stage] if stage else None
                )
                for v in stage_versions:
                    versions.append(asdict(v))
        except Exception as e:
            logger.error(f"Failed to get model lineage: {e}")
        
        return sorted(versions, key=lambda x: x["creation_timestamp"], reverse=True)


def main():
    """Example usage"""
    registry = InsuranceModelRegistry()
    
    # Example: Register a fraud detection model
    # In production, this would be a real trained model
    from sklearn.ensemble import RandomForestClassifier
    model = RandomForestClassifier(n_estimators=100)
    
    # Simulate training
    import numpy as np
    X = np.random.rand(1000, 10)
    y = np.random.randint(0, 2, 1000)
    model.fit(X, y)
    
    # Register the model
    metrics = {
        "auc": 0.92,
        "accuracy": 0.89,
        "precision": 0.87,
        "recall": 0.85,
        "f1_score": 0.86
    }
    
    version = registry.register_insurance_model(
        model_name="fraud-detection",
        model=model,
        metrics=metrics,
        run_name="fraud-detection-v1"
    )
    
    if version:
        print(f"Registered model: {version.name} v{version.version}")
        
        # Transition to staging
        registry.transition_model_stage(
            version.name, version.version, ModelStage.STAGING
        )
        
        # Promote to production
        prod_version = registry.promote_to_production(
            version.name, version.version
        )
        
        if prod_version:
            print(f"Promoted to production: v{prod_version.version}")


if __name__ == "__main__":
    main()
