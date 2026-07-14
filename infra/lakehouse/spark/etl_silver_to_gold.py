"""
InsurePortal Data Lakehouse: Silver → Gold Aggregation Pipeline
Runs as a Spark batch job (scheduled daily via Airflow/cron).
Computes daily agent summaries and hourly metrics.

Usage:
  spark-submit \
    --packages org.apache.iceberg:iceberg-spark-runtime-3.5_2.12:1.5.0 \
    etl_silver_to_gold.py --date 2024-01-15
"""

import argparse
from datetime import date, timedelta
from pyspark.sql import SparkSession
from pyspark.sql.functions import (
    col, count, sum as spark_sum, avg, countDistinct,
    current_timestamp, lit, when, percentile_approx
)
import os

MINIO_ENDPOINT = os.getenv("MINIO_ENDPOINT", "http://minio:9000")
MINIO_ACCESS_KEY = os.getenv("MINIO_ACCESS_KEY", "insureportal-admin")
MINIO_SECRET_KEY = os.getenv("MINIO_SECRET_KEY", "insureportal-minio-secret-2024")
ICEBERG_CATALOG_URI = os.getenv("ICEBERG_CATALOG_URI", "http://nessie:19120/api/v1")


def create_spark_session() -> SparkSession:
    return (
        SparkSession.builder
        .appName("insureportal-silver-to-gold")
        .config("spark.sql.extensions", "org.apache.iceberg.spark.extensions.IcebergSparkSessionExtensions")
        .config("spark.sql.catalog.insureportal", "org.apache.iceberg.spark.SparkCatalog")
        .config("spark.sql.catalog.insureportal.type", "nessie")
        .config("spark.sql.catalog.insureportal.uri", ICEBERG_CATALOG_URI)
        .config("spark.sql.catalog.insureportal.warehouse", "s3a://insureportal-lakehouse/warehouse")
        .config("spark.hadoop.fs.s3a.endpoint", MINIO_ENDPOINT)
        .config("spark.hadoop.fs.s3a.access.key", MINIO_ACCESS_KEY)
        .config("spark.hadoop.fs.s3a.secret.key", MINIO_SECRET_KEY)
        .config("spark.hadoop.fs.s3a.path.style.access", "true")
        .config("spark.hadoop.fs.s3a.impl", "org.apache.hadoop.fs.s3a.S3AFileSystem")
        .config("spark.sql.shuffle.partitions", "4")
        .getOrCreate()
    )


def compute_daily_agent_summary(spark: SparkSession, run_date: str):
    silver = spark.table("insureportal.silver.transactions").filter(col("tx_date") == run_date)

    summary = (
        silver.groupBy("tx_date", "tenant_id", "agent_id", "agent_code", "agent_tier")
        .agg(
            count("*").alias("tx_count"),
            spark_sum("amount_ngn").alias("tx_volume"),
            spark_sum("fee").alias("tx_fees"),
            spark_sum("commission").alias("tx_commission"),
            spark_sum(when(col("is_fraud"), 1).otherwise(0)).alias("fraud_count"),
            spark_sum(when(col("is_fraud"), col("amount_ngn")).otherwise(0)).alias("fraud_volume"),
            (count(when(col("status") == "success", True)) / count("*")).alias("success_rate"),
            avg("amount_ngn").alias("avg_tx_amount"),
            countDistinct("customer_phone").alias("unique_customers"),
        )
        .withColumn("computed_at", current_timestamp())
    )

    # Upsert into Gold table (delete partition then insert)
    spark.sql(f"DELETE FROM insureportal.gold.daily_agent_summary WHERE summary_date = '{run_date}'")
    summary.writeTo("insureportal.gold.daily_agent_summary").append()
    print(f"[Gold] daily_agent_summary for {run_date}: {summary.count()} rows written")


def compute_cbn_monthly_summary(spark: SparkSession, run_date: str):
    report_month = run_date[:7]  # YYYY-MM
    silver = spark.table("insureportal.silver.transactions").filter(
        col("tx_date").startswith(report_month)
    )

    cbn = (
        silver.groupBy("tenant_id")
        .agg(
            count("*").alias("total_tx_count"),
            spark_sum("amount_ngn").alias("total_volume"),
            spark_sum(when(col("type") == "Cash In", col("amount_ngn")).otherwise(0)).alias("cash_in_volume"),
            spark_sum(when(col("type") == "Cash Out", col("amount_ngn")).otherwise(0)).alias("cash_out_volume"),
            spark_sum(when(col("type") == "Transfer", col("amount_ngn")).otherwise(0)).alias("transfer_volume"),
            countDistinct("agent_id").alias("active_agents"),
            spark_sum(when(col("is_fraud"), 1).otherwise(0)).alias("fraud_cases"),
            spark_sum(when(col("type") == "Reversal", 1).otherwise(0)).alias("reversal_count"),
            spark_sum(when(col("type") == "Reversal", col("amount_ngn")).otherwise(0)).alias("reversal_volume"),
        )
        .withColumn("report_month", lit(report_month))
        .withColumn("new_agents", lit(0))  # Computed separately from agents table
        .withColumn("kyc_verified", lit(0))  # Computed separately from kyc table
        .withColumn("computed_at", current_timestamp())
    )

    spark.sql(f"DELETE FROM insureportal.gold.cbn_monthly_summary WHERE report_month = '{report_month}'")
    cbn.writeTo("insureportal.gold.cbn_monthly_summary").append()
    print(f"[Gold] cbn_monthly_summary for {report_month}: {cbn.count()} rows written")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--date", default=str(date.today() - timedelta(days=1)))
    args = parser.parse_args()

    spark = create_spark_session()
    spark.sparkContext.setLogLevel("WARN")

    compute_daily_agent_summary(spark, args.date)
    compute_cbn_monthly_summary(spark, args.date)

    spark.stop()
    print("[Gold] ETL complete")
