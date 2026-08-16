"""
ML Model Service - Phase 2
Train and evaluate machine learning models for credit scoring
"""
import os
import uuid
import json
import logging
import joblib
import numpy as np
import pandas as pd
from datetime import datetime
from typing import Dict, Any, List, Tuple, Optional
from sqlalchemy.orm import Session

import xgboost as xgb
from sklearn.model_selection import train_test_split, cross_val_score, StratifiedKFold
from sklearn.metrics import (
    accuracy_score, precision_score, recall_score, f1_score,
    roc_auc_score, brier_score_loss, log_loss, confusion_matrix,
    classification_report
)
from sklearn.calibration import calibration_curve
from sklearn.preprocessing import StandardScaler

from app.models.loan_outcome import ModelPerformanceMetrics, FeatureImportance

logger = logging.getLogger(__name__)


class MLModelService:
    """Service for training and managing ML models"""

    def __init__(self, model_dir: str = "/app/models"):
        self.model_dir = model_dir
        os.makedirs(model_dir, exist_ok=True)
        self.scaler = StandardScaler()

    def prepare_training_data(
        self,
        dataset_path: str,
        test_size: float = 0.2,
        random_state: int = 42
    ) -> Tuple[pd.DataFrame, pd.DataFrame, pd.Series, pd.Series]:
        """Prepare data for training"""

        # Load dataset
        df = pd.read_csv(dataset_path)
        logger.info(f"Loaded dataset: {len(df)} records, {len(df.columns)} features")

        # Separate features and target
        target_col = 'default_occurred'
        feature_cols = [col for col in df.columns if col not in [target_col, 'days_to_default']]

        X = df[feature_cols]
        y = df[target_col]

        # Handle missing values
        X = X.fillna(X.median())

        # Encode categorical variables
        categorical_cols = X.select_dtypes(include=['object']).columns
        for col in categorical_cols:
            X[col] = pd.Categorical(X[col]).codes

        # Split data
        X_train, X_test, y_train, y_test = train_test_split(
            X, y, test_size=test_size, random_state=random_state, stratify=y
        )

        logger.info(f"Train set: {len(X_train)} records, Test set: {len(X_test)} records")
        logger.info(f"Default rate - Train: {y_train.mean():.2%}, Test: {y_test.mean():.2%}")

        return X_train, X_test, y_train, y_test

    def train_xgboost_model(
        self,
        X_train: pd.DataFrame,
        y_train: pd.Series,
        X_test: pd.DataFrame,
        y_test: pd.Series,
        model_version: str
    ) -> Dict[str, Any]:
        """Train XGBoost model"""

        logger.info("Training XGBoost model...")

        # Handle class imbalance
        scale_pos_weight = (len(y_train) - y_train.sum()) / y_train.sum()

        # XGBoost parameters
        params = {
            'max_depth': 6,
            'learning_rate': 0.1,
            'n_estimators': 200,
            'objective': 'binary:logistic',
            'eval_metric': 'auc',
            'scale_pos_weight': scale_pos_weight,
            'subsample': 0.8,
            'colsample_bytree': 0.8,
            'min_child_weight': 5,
            'gamma': 0.1,
            'reg_alpha': 0.1,
            'reg_lambda': 1.0,
            'random_state': 42
        }

        # Train model
        model = xgb.XGBClassifier(**params)

        eval_set = [(X_train, y_train), (X_test, y_test)]
        model.fit(
            X_train, y_train,
            eval_set=eval_set,
            early_stopping_rounds=20,
            verbose=False
        )

        # Save model
        model_path = os.path.join(self.model_dir, f"xgboost_{model_version}.pkl")
        joblib.dump(model, model_path)
        logger.info(f"Saved XGBoost model to {model_path}")

        # Evaluate model
        metrics = self._evaluate_model(model, X_test, y_test, "XGBOOST")

        # Feature importance
        feature_importance = self._get_feature_importance(model, X_train.columns)

        return {
            "model": model,
            "model_path": model_path,
            "metrics": metrics,
            "feature_importance": feature_importance
        }

    def train_neural_network_model(
        self,
        X_train: pd.DataFrame,
        y_train: pd.Series,
        X_test: pd.DataFrame,
        y_test: pd.Series,
        model_version: str
    ) -> Dict[str, Any]:
        """Train Neural Network model using TensorFlow"""

        import tensorflow as tf
        from tensorflow import keras
        from tensorflow.keras import layers, callbacks

        logger.info("Training Neural Network model...")

        # Scale features
        X_train_scaled = self.scaler.fit_transform(X_train)
        X_test_scaled = self.scaler.transform(X_test)

        # Calculate class weights
        class_weight = {
            0: 1.0,
            1: (len(y_train) - y_train.sum()) / y_train.sum()
        }

        # Build model
        model = keras.Sequential([
            layers.Dense(128, activation='relu', input_shape=(X_train.shape[1],)),
            layers.BatchNormalization(),
            layers.Dropout(0.3),

            layers.Dense(64, activation='relu'),
            layers.BatchNormalization(),
            layers.Dropout(0.3),

            layers.Dense(32, activation='relu'),
            layers.BatchNormalization(),
            layers.Dropout(0.2),

            layers.Dense(16, activation='relu'),
            layers.Dropout(0.2),

            layers.Dense(1, activation='sigmoid')
        ])

        # Compile model
        model.compile(
            optimizer=keras.optimizers.Adam(learning_rate=0.001),
            loss='binary_crossentropy',
            metrics=['accuracy', keras.metrics.AUC(name='auc')]
        )

        # Callbacks
        early_stop = callbacks.EarlyStopping(
            monitor='val_auc',
            patience=15,
            restore_best_weights=True,
            mode='max'
        )

        reduce_lr = callbacks.ReduceLROnPlateau(
            monitor='val_loss',
            factor=0.5,
            patience=5,
            min_lr=0.00001
        )

        # Train model
        history = model.fit(
            X_train_scaled, y_train,
            validation_data=(X_test_scaled, y_test),
            epochs=100,
            batch_size=32,
            class_weight=class_weight,
            callbacks=[early_stop, reduce_lr],
            verbose=0
        )

        # Save model
        model_path = os.path.join(self.model_dir, f"neural_net_{model_version}.h5")
        model.save(model_path)

        # Save scaler
        scaler_path = os.path.join(self.model_dir, f"scaler_{model_version}.pkl")
        joblib.dump(self.scaler, scaler_path)

        logger.info(f"Saved Neural Network model to {model_path}")

        # Evaluate model
        y_pred_proba = model.predict(X_test_scaled).flatten()
        y_pred = (y_pred_proba > 0.5).astype(int)

        metrics = {
            "accuracy": accuracy_score(y_test, y_pred),
            "precision": precision_score(y_test, y_pred),
            "recall": recall_score(y_test, y_pred),
            "f1_score": f1_score(y_test, y_pred),
            "auc_roc": roc_auc_score(y_test, y_pred_proba),
            "brier_score": brier_score_loss(y_test, y_pred_proba),
            "log_loss": log_loss(y_test, y_pred_proba)
        }

        # Calculate Gini coefficient
        metrics['gini_coefficient'] = 2 * metrics['auc_roc'] - 1

        logger.info(f"Neural Network - AUC: {metrics['auc_roc']:.4f}, Gini: {metrics['gini_coefficient']:.4f}")

        return {
            "model": model,
            "model_path": model_path,
            "scaler_path": scaler_path,
            "metrics": metrics,
            "training_history": history.history
        }

    def _evaluate_model(
        self,
        model,
        X_test: pd.DataFrame,
        y_test: pd.Series,
        model_type: str
    ) -> Dict[str, float]:
        """Evaluate model performance"""

        # Predictions
        y_pred_proba = model.predict_proba(X_test)[:, 1]
        y_pred = (y_pred_proba > 0.5).astype(int)

        # Calculate metrics
        metrics = {
            "accuracy": accuracy_score(y_test, y_pred),
            "precision": precision_score(y_test, y_pred, zero_division=0),
            "recall": recall_score(y_test, y_pred, zero_division=0),
            "f1_score": f1_score(y_test, y_pred, zero_division=0),
            "auc_roc": roc_auc_score(y_test, y_pred_proba),
            "brier_score": brier_score_loss(y_test, y_pred_proba),
            "log_loss": log_loss(y_test, y_pred_proba)
        }

        # Calculate Gini coefficient
        metrics['gini_coefficient'] = 2 * metrics['auc_roc'] - 1

        # Confusion matrix
        cm = confusion_matrix(y_test, y_pred)
        tn, fp, fn, tp = cm.ravel()

        metrics['true_negatives'] = int(tn)
        metrics['false_positives'] = int(fp)
        metrics['false_negatives'] = int(fn)
        metrics['true_positives'] = int(tp)

        logger.info(f"{model_type} Model Performance:")
        logger.info(f"  Accuracy: {metrics['accuracy']:.4f}")
        logger.info(f"  Precision: {metrics['precision']:.4f}")
        logger.info(f"  Recall: {metrics['recall']:.4f}")
        logger.info(f"  F1 Score: {metrics['f1_score']:.4f}")
        logger.info(f"  AUC-ROC: {metrics['auc_roc']:.4f}")
        logger.info(f"  Gini: {metrics['gini_coefficient']:.4f}")

        return metrics

    def _get_feature_importance(
        self,
        model,
        feature_names: List[str]
    ) -> List[Dict[str, Any]]:
        """Get feature importance from model"""

        importance_scores = model.feature_importances_

        # Sort by importance
        indices = np.argsort(importance_scores)[::-1]

        feature_importance = []
        total_importance = importance_scores.sum()

        for rank, idx in enumerate(indices, 1):
            feature_importance.append({
                "feature_name": feature_names[idx],
                "importance_score": float(importance_scores[idx]),
                "importance_rank": rank,
                "importance_percentage": float(importance_scores[idx] / total_importance * 100)
            })

        # Log top 10 features
        logger.info("Top 10 Most Important Features:")
        for item in feature_importance[:10]:
            logger.info(f"  {item['importance_rank']}. {item['feature_name']}: "
                       f"{item['importance_percentage']:.2f}%")

        return feature_importance

    def cross_validate_model(
        self,
        model,
        X: pd.DataFrame,
        y: pd.Series,
        cv_folds: int = 5
    ) -> Dict[str, Any]:
        """Perform cross-validation"""

        logger.info(f"Performing {cv_folds}-fold cross-validation...")

        cv = StratifiedKFold(n_splits=cv_folds, shuffle=True, random_state=42)

        # Cross-validation scores
        cv_scores = cross_val_score(model, X, y, cv=cv, scoring='roc_auc')

        results = {
            "cv_scores": cv_scores.tolist(),
            "mean_auc": cv_scores.mean(),
            "std_auc": cv_scores.std(),
            "min_auc": cv_scores.min(),
            "max_auc": cv_scores.max()
        }

        logger.info(f"Cross-validation AUC: {results['mean_auc']:.4f} (+/- {results['std_auc']:.4f})")

        return results

    def analyze_score_bands(
        self,
        model,
        X_test: pd.DataFrame,
        y_test: pd.Series
    ) -> Dict[str, Dict[str, Any]]:
        """Analyze model performance by credit score bands"""

        # Get predicted probabilities
        y_pred_proba = model.predict_proba(X_test)[:, 1] if hasattr(model, 'predict_proba') else model.predict(X_test).flatten()

        # Convert to credit scores (inverse relationship with default probability)
        credit_scores = 850 - (y_pred_proba * 550)

        # Define score bands
        bands = {
            "EXCELLENT": (750, 850),
            "GOOD": (700, 749),
            "FAIR": (650, 699),
            "POOR": (600, 649),
            "VERY_POOR": (300, 599)
        }

        band_analysis = {}

        for band_name, (min_score, max_score) in bands.items():
            # Filter records in this band
            mask = (credit_scores >= min_score) & (credit_scores <= max_score)

            if mask.sum() == 0:
                continue

            band_y_test = y_test[mask]
            band_y_pred_proba = y_pred_proba[mask]

            # Calculate metrics for this band
            predicted_default_rate = band_y_pred_proba.mean()
            actual_default_rate = band_y_test.mean()
            error = abs(predicted_default_rate - actual_default_rate)

            band_analysis[band_name] = {
                "count": int(mask.sum()),
                "predicted_default_rate": float(predicted_default_rate),
                "actual_default_rate": float(actual_default_rate),
                "prediction_error": float(error),
                "score_range": f"{min_score}-{max_score}"
            }

            logger.info(f"{band_name} ({min_score}-{max_score}): "
                       f"Count={mask.sum()}, "
                       f"Predicted={predicted_default_rate:.2%}, "
                       f"Actual={actual_default_rate:.2%}, "
                       f"Error={error:.2%}")

        return band_analysis

    def save_model_metrics(
        self,
        model_version: str,
        model_type: str,
        metrics: Dict[str, float],
        score_band_metrics: Dict[str, Dict[str, Any]],
        evaluation_record_count: int,
        db_session: Session
    ) -> ModelPerformanceMetrics:
        """Save model performance metrics to database"""

        performance = ModelPerformanceMetrics(
            id=str(uuid.uuid4()),
            model_version=model_version,
            model_type=model_type,
            accuracy=metrics.get('accuracy'),
            precision=metrics.get('precision'),
            recall=metrics.get('recall'),
            f1_score=metrics.get('f1_score'),
            auc_roc=metrics.get('auc_roc'),
            gini_coefficient=metrics.get('gini_coefficient'),
            brier_score=metrics.get('brier_score'),
            log_loss=metrics.get('log_loss'),
            score_band_metrics=score_band_metrics,
            evaluation_start_date=datetime.utcnow(),
            evaluation_end_date=datetime.utcnow(),
            evaluation_record_count=evaluation_record_count,
            evaluated_by="ml_model_service"
        )

        db_session.add(performance)
        db_session.commit()
        db_session.refresh(performance)

        logger.info(f"Saved performance metrics for {model_type} model version {model_version}")
        return performance

    def save_feature_importance(
        self,
        model_version: str,
        feature_importance_list: List[Dict[str, Any]],
        db_session: Session
    ) -> List[FeatureImportance]:
        """Save feature importance to database"""

        records = []
        for item in feature_importance_list:
            record = FeatureImportance(
                id=str(uuid.uuid4()),
                model_version=model_version,
                feature_name=item['feature_name'],
                importance_score=item['importance_score'],
                importance_rank=item['importance_rank'],
                importance_percentage=item['importance_percentage']
            )
            records.append(record)
            db_session.add(record)

        db_session.commit()

        logger.info(f"Saved {len(records)} feature importance records for model {model_version}")
        return records

    def load_model(self, model_path: str):
        """Load a trained model"""
        if model_path.endswith('.pkl'):
            return joblib.load(model_path)
        elif model_path.endswith('.h5'):
            import tensorflow as tf
            return tf.keras.models.load_model(model_path)
        else:
            raise ValueError(f"Unsupported model format: {model_path}")
