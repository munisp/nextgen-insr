"""
Silver Layer Data Population Pipeline

Populates the Lakehouse Silver layer with processed data
for Ray ML training. Integrates with Kafka, Spark, and Delta Lake.
"""

import os
import json
import logging
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional
from dataclasses import dataclass
from concurrent.futures import ThreadPoolExecutor

from pyspark.sql import SparkSession, DataFrame
from pyspark.sql.functions import (
    col, from_json, to_timestamp, current_timestamp,
    year, month, dayofmonth, hour, lit, when,
    regexp_replace, trim, lower, upper, coalesce,
    count, sum as spark_sum, avg, min as spark_min, max as spark_max,
    window, lag, lead, row_number, dense_rank
)
from pyspark.sql.types import (
    StructType, StructField, StringType, LongType,
    TimestampType, DoubleType, BooleanType, ArrayType, MapType
)
from pyspark.sql.window import Window
from delta import DeltaTable

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@dataclass
class PipelineConfig:
    """Configuration for the data pipeline"""
    s3_endpoint: str = "http://minio:9000"
    s3_access_key: str = os.getenv("S3_ACCESS_KEY", "")
    s3_secret_key: str = os.getenv("S3_SECRET_KEY", "")
    lakehouse_bucket: str = "lakehouse"
    bronze_path: str = "s3a://lakehouse/bronze"
    silver_path: str = "s3a://lakehouse/silver"
    gold_path: str = "s3a://lakehouse/gold"
    kafka_brokers: str = "kafka-0:9092,kafka-1:9092,kafka-2:9092"
    checkpoint_path: str = "s3a://lakehouse/checkpoints"


class SilverLayerDataPipeline:
    """Pipeline to populate Silver layer for ML training"""
    
    def __init__(self, config: Optional[PipelineConfig] = None):
        self.config = config or PipelineConfig(
            s3_endpoint=os.getenv("S3_ENDPOINT", "http://minio:9000"),
            s3_access_key=os.getenv("S3_ACCESS_KEY", ""),
            s3_secret_key=os.getenv("S3_SECRET_KEY", ""),
            kafka_brokers=os.getenv("KAFKA_BROKERS", "kafka-0:9092,kafka-1:9092,kafka-2:9092")
        )
        
        self.spark = self._create_spark_session()
        logger.info("Silver Layer Data Pipeline initialized")
    
    def _create_spark_session(self) -> SparkSession:
        """Create Spark session with Delta Lake and S3 support"""
        return SparkSession.builder \
            .appName("Insurance Platform - Silver Layer Pipeline") \
            .config("spark.sql.extensions", "io.delta.sql.DeltaSparkSessionExtension") \
            .config("spark.sql.catalog.spark_catalog", "org.apache.spark.sql.delta.catalog.DeltaCatalog") \
            .config("spark.hadoop.fs.s3a.endpoint", self.config.s3_endpoint) \
            .config("spark.hadoop.fs.s3a.access.key", self.config.s3_access_key) \
            .config("spark.hadoop.fs.s3a.secret.key", self.config.s3_secret_key) \
            .config("spark.hadoop.fs.s3a.path.style.access", "true") \
            .config("spark.hadoop.fs.s3a.impl", "org.apache.hadoop.fs.s3a.S3AFileSystem") \
            .config("spark.sql.adaptive.enabled", "true") \
            .config("spark.sql.adaptive.coalescePartitions.enabled", "true") \
            .getOrCreate()
    
    def process_payment_events_for_fraud_detection(self) -> DataFrame:
        """
        Process payment events for fraud detection ML training
        
        Creates features:
        - Transaction amount features (log, zscore, deviation)
        - Time-based features (hour, day, weekend)
        - Customer behavior features (avg, std, count)
        - Velocity features (transactions per hour/day)
        """
        logger.info("Processing payment events for fraud detection")
        
        bronze_path = f"{self.config.bronze_path}/payment_events"
        silver_path = f"{self.config.silver_path}/payment_events_fraud_features"
        
        # Read bronze data
        df = self.spark.read.format("delta").load(bronze_path)
        
        # Parse JSON payload
        payment_schema = StructType([
            StructField("payment_id", StringType(), False),
            StructField("transaction_id", StringType(), False),
            StructField("policy_id", StringType(), True),
            StructField("customer_id", StringType(), False),
            StructField("amount", LongType(), False),
            StructField("currency", StringType(), False),
            StructField("payment_type", StringType(), False),
            StructField("payment_method", StringType(), True),
            StructField("status", StringType(), False),
            StructField("failure_reason", StringType(), True),
            StructField("device_id", StringType(), True),
            StructField("ip_address", StringType(), True),
            StructField("location", StringType(), True),
            StructField("timestamp", TimestampType(), False)
        ])
        
        parsed_df = df.withColumn("data", from_json(col("payload"), payment_schema))
        
        # Extract and clean fields
        base_df = parsed_df.select(
            col("data.payment_id").alias("payment_id"),
            col("data.transaction_id").alias("transaction_id"),
            col("data.policy_id").alias("policy_id"),
            col("data.customer_id").alias("customer_id"),
            col("data.amount").alias("amount"),
            upper(trim(col("data.currency"))).alias("currency"),
            upper(trim(col("data.payment_type"))).alias("payment_type"),
            upper(trim(col("data.payment_method"))).alias("payment_method"),
            upper(trim(col("data.status"))).alias("status"),
            col("data.failure_reason").alias("failure_reason"),
            col("data.device_id").alias("device_id"),
            col("data.ip_address").alias("ip_address"),
            col("data.location").alias("location"),
            col("data.timestamp").alias("event_timestamp"),
            col("ingestion_timestamp")
        ).filter(col("payment_id").isNotNull())
        
        # Time-based features
        time_df = base_df.withColumn("hour_of_day", hour(col("event_timestamp"))) \
            .withColumn("day_of_week", dayofmonth(col("event_timestamp")) % 7) \
            .withColumn("is_weekend", when(col("day_of_week").isin([0, 6]), 1).otherwise(0)) \
            .withColumn("is_night", when(col("hour_of_day").between(22, 6), 1).otherwise(0))
        
        # Amount features
        from pyspark.sql.functions import log1p
        amount_df = time_df.withColumn("amount_log", log1p(col("amount")))
        
        # Customer window for aggregations
        customer_window = Window.partitionBy("customer_id")
        
        # Customer behavior features
        customer_df = amount_df \
            .withColumn("customer_avg_amount", avg(col("amount")).over(customer_window)) \
            .withColumn("customer_std_amount", 
                       (spark_sum(col("amount") * col("amount")).over(customer_window) / 
                        count("*").over(customer_window) - 
                        avg(col("amount")).over(customer_window) ** 2) ** 0.5) \
            .withColumn("customer_min_amount", spark_min(col("amount")).over(customer_window)) \
            .withColumn("customer_max_amount", spark_max(col("amount")).over(customer_window)) \
            .withColumn("customer_transaction_count", count("*").over(customer_window))
        
        # Amount deviation from customer average
        deviation_df = customer_df.withColumn(
            "amount_deviation",
            (col("amount") - col("customer_avg_amount")) / 
            (col("customer_std_amount") + lit(1))
        )
        
        # Velocity features (transactions in last hour/day)
        time_window_1h = Window.partitionBy("customer_id") \
            .orderBy(col("event_timestamp").cast("long")) \
            .rangeBetween(-3600, 0)
        
        time_window_24h = Window.partitionBy("customer_id") \
            .orderBy(col("event_timestamp").cast("long")) \
            .rangeBetween(-86400, 0)
        
        velocity_df = deviation_df \
            .withColumn("transactions_last_hour", count("*").over(time_window_1h)) \
            .withColumn("transactions_last_day", count("*").over(time_window_24h)) \
            .withColumn("amount_last_hour", spark_sum(col("amount")).over(time_window_1h)) \
            .withColumn("amount_last_day", spark_sum(col("amount")).over(time_window_24h))
        
        # Fraud label (for historical data with known outcomes)
        labeled_df = velocity_df.withColumn(
            "is_fraud",
            when(
                (col("status") == "FAILED") & 
                (col("failure_reason").contains("fraud")),
                1
            ).otherwise(0)
        )
        
        # Add processing metadata
        final_df = labeled_df \
            .withColumn("processed_timestamp", current_timestamp()) \
            .withColumn("year", year(col("event_timestamp"))) \
            .withColumn("month", month(col("event_timestamp"))) \
            .withColumn("day", dayofmonth(col("event_timestamp")))
        
        # Write to Silver layer
        final_df.write \
            .format("delta") \
            .mode("overwrite") \
            .partitionBy("year", "month", "day") \
            .option("overwriteSchema", "true") \
            .save(silver_path)
        
        logger.info(f"Wrote {final_df.count()} records to {silver_path}")
        return final_df
    
    def process_policy_events_for_risk_scoring(self) -> DataFrame:
        """
        Process policy events for risk scoring ML training
        
        Creates features:
        - Policy characteristics (type, coverage, premium)
        - Customer profile features
        - Historical claims ratio
        - Geographic risk factors
        """
        logger.info("Processing policy events for risk scoring")
        
        bronze_path = f"{self.config.bronze_path}/policy_events"
        silver_path = f"{self.config.silver_path}/policy_events_risk_features"
        
        # Read bronze data
        df = self.spark.read.format("delta").load(bronze_path)
        
        # Parse JSON payload
        policy_schema = StructType([
            StructField("policy_id", StringType(), False),
            StructField("policy_number", StringType(), False),
            StructField("customer_id", StringType(), False),
            StructField("policy_type", StringType(), False),
            StructField("coverage_amount", LongType(), True),
            StructField("premium_amount", LongType(), True),
            StructField("deductible", LongType(), True),
            StructField("start_date", TimestampType(), True),
            StructField("end_date", TimestampType(), True),
            StructField("status", StringType(), False),
            StructField("risk_category", StringType(), True),
            StructField("location_state", StringType(), True),
            StructField("location_lga", StringType(), True),
            StructField("timestamp", TimestampType(), False)
        ])
        
        parsed_df = df.withColumn("data", from_json(col("payload"), policy_schema))
        
        # Extract and clean fields
        base_df = parsed_df.select(
            col("data.policy_id").alias("policy_id"),
            col("data.policy_number").alias("policy_number"),
            col("data.customer_id").alias("customer_id"),
            upper(trim(col("data.policy_type"))).alias("policy_type"),
            col("data.coverage_amount").alias("coverage_amount"),
            col("data.premium_amount").alias("premium_amount"),
            col("data.deductible").alias("deductible"),
            col("data.start_date").alias("start_date"),
            col("data.end_date").alias("end_date"),
            upper(trim(col("data.status"))).alias("status"),
            col("data.risk_category").alias("risk_category"),
            col("data.location_state").alias("location_state"),
            col("data.location_lga").alias("location_lga"),
            col("data.timestamp").alias("event_timestamp"),
            col("ingestion_timestamp")
        ).filter(col("policy_id").isNotNull())
        
        # Policy type encoding
        policy_type_df = base_df.withColumn(
            "policy_type_encoded",
            when(col("policy_type") == "MOTOR", 1)
            .when(col("policy_type") == "HEALTH", 2)
            .when(col("policy_type") == "LIFE", 3)
            .when(col("policy_type") == "PROPERTY", 4)
            .when(col("policy_type") == "MARINE", 5)
            .when(col("policy_type") == "TRAVEL", 6)
            .when(col("policy_type") == "MICRO", 7)
            .otherwise(0)
        )
        
        # Coverage to premium ratio
        ratio_df = policy_type_df.withColumn(
            "coverage_premium_ratio",
            col("coverage_amount") / (col("premium_amount") + lit(1))
        )
        
        # Customer window for aggregations
        customer_window = Window.partitionBy("customer_id")
        
        # Customer policy features
        customer_df = ratio_df \
            .withColumn("customer_policy_count", count("*").over(customer_window)) \
            .withColumn("customer_total_coverage", spark_sum(col("coverage_amount")).over(customer_window)) \
            .withColumn("customer_total_premium", spark_sum(col("premium_amount")).over(customer_window)) \
            .withColumn("customer_avg_coverage", avg(col("coverage_amount")).over(customer_window))
        
        # Risk category encoding
        risk_df = customer_df.withColumn(
            "risk_score",
            when(col("risk_category") == "LOW", 0.2)
            .when(col("risk_category") == "MEDIUM", 0.5)
            .when(col("risk_category") == "HIGH", 0.8)
            .otherwise(0.5)
        )
        
        # Geographic risk (simplified - in production would use actual risk data)
        geo_df = risk_df.withColumn(
            "geo_risk_factor",
            when(col("location_state").isin(["LAGOS", "RIVERS", "ABUJA"]), 1.2)
            .when(col("location_state").isin(["KANO", "KADUNA"]), 1.1)
            .otherwise(1.0)
        )
        
        # Add processing metadata
        final_df = geo_df \
            .withColumn("processed_timestamp", current_timestamp()) \
            .withColumn("year", year(col("event_timestamp"))) \
            .withColumn("month", month(col("event_timestamp"))) \
            .withColumn("day", dayofmonth(col("event_timestamp")))
        
        # Write to Silver layer
        final_df.write \
            .format("delta") \
            .mode("overwrite") \
            .partitionBy("year", "month", "day") \
            .option("overwriteSchema", "true") \
            .save(silver_path)
        
        logger.info(f"Wrote {final_df.count()} records to {silver_path}")
        return final_df
    
    def process_claim_events_for_prediction(self) -> DataFrame:
        """
        Process claim events for claims prediction ML training
        
        Creates features:
        - Claim characteristics (type, amount, status)
        - Policy relationship features
        - Processing time features
        - Historical claim patterns
        """
        logger.info("Processing claim events for claims prediction")
        
        bronze_path = f"{self.config.bronze_path}/claim_events"
        silver_path = f"{self.config.silver_path}/claim_events_prediction_features"
        
        # Read bronze data
        df = self.spark.read.format("delta").load(bronze_path)
        
        # Parse JSON payload
        claim_schema = StructType([
            StructField("claim_id", StringType(), False),
            StructField("policy_id", StringType(), False),
            StructField("customer_id", StringType(), False),
            StructField("claim_type", StringType(), False),
            StructField("claim_amount", LongType(), False),
            StructField("approved_amount", LongType(), True),
            StructField("status", StringType(), False),
            StructField("submission_date", TimestampType(), True),
            StructField("processing_date", TimestampType(), True),
            StructField("decision_date", TimestampType(), True),
            StructField("description", StringType(), True),
            StructField("documents_count", LongType(), True),
            StructField("timestamp", TimestampType(), False)
        ])
        
        parsed_df = df.withColumn("data", from_json(col("payload"), claim_schema))
        
        # Extract and clean fields
        base_df = parsed_df.select(
            col("data.claim_id").alias("claim_id"),
            col("data.policy_id").alias("policy_id"),
            col("data.customer_id").alias("customer_id"),
            upper(trim(col("data.claim_type"))).alias("claim_type"),
            col("data.claim_amount").alias("claim_amount"),
            col("data.approved_amount").alias("approved_amount"),
            upper(trim(col("data.status"))).alias("status"),
            col("data.submission_date").alias("submission_date"),
            col("data.processing_date").alias("processing_date"),
            col("data.decision_date").alias("decision_date"),
            col("data.description").alias("description"),
            col("data.documents_count").alias("documents_count"),
            col("data.timestamp").alias("event_timestamp"),
            col("ingestion_timestamp")
        ).filter(col("claim_id").isNotNull())
        
        # Claim type encoding
        type_df = base_df.withColumn(
            "claim_type_encoded",
            when(col("claim_type") == "ACCIDENT", 1)
            .when(col("claim_type") == "THEFT", 2)
            .when(col("claim_type") == "MEDICAL", 3)
            .when(col("claim_type") == "PROPERTY_DAMAGE", 4)
            .when(col("claim_type") == "DEATH", 5)
            .otherwise(0)
        )
        
        # Amount features
        from pyspark.sql.functions import log1p
        amount_df = type_df.withColumn("claim_amount_log", log1p(col("claim_amount")))
        
        # Approval ratio (for completed claims)
        approval_df = amount_df.withColumn(
            "approval_ratio",
            when(col("status") == "APPROVED", 
                 col("approved_amount") / (col("claim_amount") + lit(1)))
            .otherwise(lit(0.0))
        )
        
        # Customer window for aggregations
        customer_window = Window.partitionBy("customer_id")
        
        # Customer claim history
        customer_df = approval_df \
            .withColumn("customer_claim_count", count("*").over(customer_window)) \
            .withColumn("customer_total_claimed", spark_sum(col("claim_amount")).over(customer_window)) \
            .withColumn("customer_total_approved", spark_sum(col("approved_amount")).over(customer_window)) \
            .withColumn("customer_avg_claim", avg(col("claim_amount")).over(customer_window))
        
        # Claim outcome label
        labeled_df = customer_df.withColumn(
            "is_approved",
            when(col("status") == "APPROVED", 1).otherwise(0)
        )
        
        # Add processing metadata
        final_df = labeled_df \
            .withColumn("processed_timestamp", current_timestamp()) \
            .withColumn("year", year(col("event_timestamp"))) \
            .withColumn("month", month(col("event_timestamp"))) \
            .withColumn("day", dayofmonth(col("event_timestamp")))
        
        # Write to Silver layer
        final_df.write \
            .format("delta") \
            .mode("overwrite") \
            .partitionBy("year", "month", "day") \
            .option("overwriteSchema", "true") \
            .save(silver_path)
        
        logger.info(f"Wrote {final_df.count()} records to {silver_path}")
        return final_df
    
    def run_full_pipeline(self):
        """Run the complete Silver layer data pipeline"""
        logger.info("Starting full Silver layer data pipeline")
        
        try:
            # Process all event types
            self.process_payment_events_for_fraud_detection()
            self.process_policy_events_for_risk_scoring()
            self.process_claim_events_for_prediction()
            
            # Optimize Delta tables
            self._optimize_delta_tables()
            
            logger.info("Silver layer data pipeline completed successfully")
            
        except Exception as e:
            logger.error(f"Pipeline failed: {e}")
            raise
        finally:
            self.spark.stop()
    
    def _optimize_delta_tables(self):
        """Optimize Delta tables with OPTIMIZE and VACUUM"""
        tables = [
            f"{self.config.silver_path}/payment_events_fraud_features",
            f"{self.config.silver_path}/policy_events_risk_features",
            f"{self.config.silver_path}/claim_events_prediction_features"
        ]
        
        for table_path in tables:
            try:
                logger.info(f"Optimizing: {table_path}")
                self.spark.sql(f"OPTIMIZE delta.`{table_path}`")
                self.spark.sql(f"VACUUM delta.`{table_path}` RETAIN 168 HOURS")
            except Exception as e:
                logger.warning(f"Failed to optimize {table_path}: {e}")


def main():
    """Run the Silver layer data pipeline"""
    pipeline = SilverLayerDataPipeline()
    pipeline.run_full_pipeline()


if __name__ == "__main__":
    main()
