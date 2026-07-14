"""
InsurePortal Data Lakehouse: Bronze → Silver ETL Pipeline
Runs as a Spark Structured Streaming job reading from Kafka,
writing to Iceberg Silver layer on MinIO.

Usage:
  spark-submit \
    --packages org.apache.iceberg:iceberg-spark-runtime-3.5_2.12:1.5.0,\
               org.apache.kafka:kafka-clients:3.6.0,\
               org.apache.spark:spark-sql-kafka-0-10_2.12:3.5.0 \
    etl_bronze_to_silver.py
"""

from pyspark.sql import SparkSession
from pyspark.sql.functions import (
    col, from_json, to_timestamp, current_timestamp,
    when, lit, coalesce, to_date, hour, expr
)
from pyspark.sql.types import (
    StructType, StructField, StringType, IntegerType,
    LongType, DoubleType, BooleanType, TimestampType
)
import os

KAFKA_BROKERS = os.getenv("KAFKA_BROKERS", "kafka:9092")
MINIO_ENDPOINT = os.getenv("MINIO_ENDPOINT", "http://minio:9000")
MINIO_ACCESS_KEY = os.getenv("MINIO_ACCESS_KEY", "insureportal-admin")
MINIO_SECRET_KEY = os.getenv("MINIO_SECRET_KEY", "insureportal-minio-secret-2024")
ICEBERG_CATALOG_URI = os.getenv("ICEBERG_CATALOG_URI", "http://nessie:19120/api/v1")
CHECKPOINT_LOCATION = os.getenv("CHECKPOINT_LOCATION", "s3a://insureportal-lakehouse/checkpoints/bronze-to-silver")

TX_SCHEMA = StructType([
    StructField("id", LongType()),
    StructField("ref", StringType()),
    StructField("agentId", IntegerType()),
    StructField("agentCode", StringType()),
    StructField("agentTier", StringType()),
    StructField("type", StringType()),
    StructField("amount", DoubleType()),
    StructField("fee", DoubleType()),
    StructField("commission", DoubleType()),
    StructField("currency", StringType()),
    StructField("channel", StringType()),
    StructField("status", StringType()),
    StructField("fraudScore", DoubleType()),
    StructField("region", StringType()),
    StructField("state", StringType()),
    StructField("tenantId", IntegerType()),
    StructField("createdAt", StringType()),
])

def create_spark_session() -> SparkSession:
    return (
        SparkSession.builder
        .appName("insureportal-bronze-to-silver")
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
        .config("spark.sql.shuffle.partitions", "8")
        .getOrCreate()
    )


def run_etl(spark: SparkSession):
    # Read from Kafka topic: insureportal.transactions.bronze
    raw_stream = (
        spark.readStream
        .format("kafka")
        .option("kafka.bootstrap.servers", KAFKA_BROKERS)
        .option("subscribe", "insureportal.transactions.bronze")
        .option("startingOffsets", "latest")
        .option("maxOffsetsPerTrigger", 50_000)
        .load()
    )

    # Parse JSON payload
    parsed = raw_stream.select(
        from_json(col("value").cast("string"), TX_SCHEMA).alias("data"),
        col("timestamp").alias("kafka_ts")
    ).select("data.*", "kafka_ts")

    # Transform: clean, enrich, normalize
    silver = (
        parsed
        .filter(col("id").isNotNull() & col("ref").isNotNull())
        .withColumn("created_at", to_timestamp(col("createdAt")))
        .withColumn("processed_at", current_timestamp())
        .withColumn("tx_date", to_date(col("created_at")))
        .withColumn("tx_hour", hour(col("created_at")))
        .withColumn("is_fraud", when(col("fraudScore") >= 0.7, lit(True)).otherwise(lit(False)))
        # Normalize amount to NGN (simple passthrough; extend with FX rates table join)
        .withColumn("amount_ngn", when(col("currency") == "NGN", col("amount")).otherwise(col("amount")))
        .withColumnRenamed("agentId", "agent_id")
        .withColumnRenamed("agentCode", "agent_code")
        .withColumnRenamed("agentTier", "agent_tier")
        .withColumnRenamed("fraudScore", "fraud_score")
        .withColumnRenamed("tenantId", "tenant_id")
        .drop("createdAt", "kafka_ts")
    )

    # Write to Iceberg Silver table
    query = (
        silver.writeStream
        .format("iceberg")
        .outputMode("append")
        .option("path", "insureportal.silver.transactions")
        .option("checkpointLocation", CHECKPOINT_LOCATION)
        .trigger(processingTime="30 seconds")
        .start()
    )

    query.awaitTermination()


if __name__ == "__main__":
    spark = create_spark_session()
    spark.sparkContext.setLogLevel("WARN")
    run_etl(spark)
