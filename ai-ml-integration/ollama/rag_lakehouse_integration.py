"""
RAG (Retrieval Augmented Generation) Integration with Lakehouse

This module provides context-aware AI responses by retrieving relevant data
from the lakehouse (Delta Lake) and using it to augment Ollama prompts.
"""

import os
import json
import hashlib
from typing import List, Dict, Any, Optional
from dataclasses import dataclass, field
from datetime import datetime, timedelta
import asyncio
import httpx
from pyspark.sql import SparkSession
from pyspark.sql.functions import col, desc, lit


@dataclass
class RetrievedContext:
    """Represents retrieved context from lakehouse"""
    source: str
    content: str
    relevance_score: float
    metadata: Dict[str, Any] = field(default_factory=dict)
    timestamp: str = field(default_factory=lambda: datetime.utcnow().isoformat())


@dataclass
class RAGResponse:
    """Response from RAG-augmented generation"""
    response: str
    contexts_used: List[RetrievedContext]
    model: str
    tokens_used: int
    latency_ms: float
    cache_hit: bool = False


class LakehouseRAGIntegration:
    """
    RAG integration that retrieves context from lakehouse Delta Lake tables
    and augments Ollama prompts for context-aware responses.
    """

    def __init__(
        self,
        ollama_url: str = "http://localhost:11434",
        trino_url: str = "http://trino-analytics:8080",
        default_model: str = "qwen2.5:latest",
        cache_ttl_minutes: int = 5,
    ):
        self.ollama_url = ollama_url
        self.trino_url = trino_url
        self.default_model = default_model
        self.cache_ttl = timedelta(minutes=cache_ttl_minutes)
        self.context_cache: Dict[str, tuple] = {}
        self.spark = self._create_spark_session()
        self.http_client = httpx.AsyncClient(timeout=60.0)

    def _create_spark_session(self) -> SparkSession:
        """Create Spark session for lakehouse access"""
        return (
            SparkSession.builder
            .appName("RAG-Lakehouse-Integration")
            .config("spark.sql.extensions", "io.delta.sql.DeltaSparkSessionExtension")
            .config("spark.sql.catalog.spark_catalog", "org.apache.spark.sql.delta.catalog.DeltaCatalog")
            .config("spark.hadoop.fs.s3a.endpoint", os.getenv("S3_ENDPOINT", "http://minio:9000"))
            .config("spark.hadoop.fs.s3a.access.key", os.getenv("S3_ACCESS_KEY", ""))
            .config("spark.hadoop.fs.s3a.secret.key", os.getenv("S3_SECRET_KEY", ""))
            .config("spark.hadoop.fs.s3a.path.style.access", "true")
            .getOrCreate()
        )

    def _get_cache_key(self, query: str, context_type: str) -> str:
        """Generate cache key for context retrieval"""
        return hashlib.md5(f"{query}:{context_type}".encode()).hexdigest()

    def _is_cache_valid(self, cache_key: str) -> bool:
        """Check if cached context is still valid"""
        if cache_key not in self.context_cache:
            return False
        _, timestamp = self.context_cache[cache_key]
        return datetime.utcnow() - timestamp < self.cache_ttl

    async def retrieve_policy_context(
        self,
        customer_id: Optional[str] = None,
        policy_type: Optional[str] = None,
        limit: int = 5,
    ) -> List[RetrievedContext]:
        """Retrieve policy context from lakehouse"""
        cache_key = self._get_cache_key(f"{customer_id}:{policy_type}", "policy")
        if self._is_cache_valid(cache_key):
            return self.context_cache[cache_key][0]

        contexts = []
        try:
            query = """
                SELECT 
                    policy_id,
                    customer_id,
                    policy_type,
                    status,
                    premium_amount,
                    coverage_amount,
                    start_date,
                    end_date,
                    risk_score
                FROM silver.policy_events
                WHERE 1=1
            """
            if customer_id:
                query += f" AND customer_id = '{customer_id}'"
            if policy_type:
                query += f" AND policy_type = '{policy_type}'"
            query += f" ORDER BY created_at DESC LIMIT {limit}"

            df = self.spark.sql(query)
            for row in df.collect():
                contexts.append(RetrievedContext(
                    source="silver.policy_events",
                    content=json.dumps(row.asDict(), default=str),
                    relevance_score=0.9,
                    metadata={"policy_id": row.policy_id, "type": "policy"}
                ))

            self.context_cache[cache_key] = (contexts, datetime.utcnow())
        except Exception as e:
            contexts.append(RetrievedContext(
                source="fallback",
                content=f"Policy context unavailable: {str(e)}",
                relevance_score=0.1,
                metadata={"error": True}
            ))

        return contexts

    async def retrieve_claims_context(
        self,
        customer_id: Optional[str] = None,
        policy_id: Optional[str] = None,
        limit: int = 5,
    ) -> List[RetrievedContext]:
        """Retrieve claims context from lakehouse"""
        cache_key = self._get_cache_key(f"{customer_id}:{policy_id}", "claims")
        if self._is_cache_valid(cache_key):
            return self.context_cache[cache_key][0]

        contexts = []
        try:
            query = """
                SELECT 
                    claim_id,
                    policy_id,
                    customer_id,
                    claim_type,
                    claim_amount,
                    status,
                    filed_date,
                    resolution_date,
                    fraud_score
                FROM silver.claim_events
                WHERE 1=1
            """
            if customer_id:
                query += f" AND customer_id = '{customer_id}'"
            if policy_id:
                query += f" AND policy_id = '{policy_id}'"
            query += f" ORDER BY filed_date DESC LIMIT {limit}"

            df = self.spark.sql(query)
            for row in df.collect():
                contexts.append(RetrievedContext(
                    source="silver.claim_events",
                    content=json.dumps(row.asDict(), default=str),
                    relevance_score=0.9,
                    metadata={"claim_id": row.claim_id, "type": "claim"}
                ))

            self.context_cache[cache_key] = (contexts, datetime.utcnow())
        except Exception as e:
            contexts.append(RetrievedContext(
                source="fallback",
                content=f"Claims context unavailable: {str(e)}",
                relevance_score=0.1,
                metadata={"error": True}
            ))

        return contexts

    async def retrieve_customer_context(
        self,
        customer_id: str,
    ) -> List[RetrievedContext]:
        """Retrieve customer 360 context from lakehouse"""
        cache_key = self._get_cache_key(customer_id, "customer")
        if self._is_cache_valid(cache_key):
            return self.context_cache[cache_key][0]

        contexts = []
        try:
            query = f"""
                SELECT 
                    customer_id,
                    name,
                    email,
                    phone,
                    segment,
                    lifetime_value,
                    risk_score,
                    total_policies,
                    total_claims,
                    claim_ratio,
                    payment_history_score
                FROM gold.customer_360
                WHERE customer_id = '{customer_id}'
            """

            df = self.spark.sql(query)
            for row in df.collect():
                contexts.append(RetrievedContext(
                    source="gold.customer_360",
                    content=json.dumps(row.asDict(), default=str),
                    relevance_score=0.95,
                    metadata={"customer_id": customer_id, "type": "customer_360"}
                ))

            self.context_cache[cache_key] = (contexts, datetime.utcnow())
        except Exception as e:
            contexts.append(RetrievedContext(
                source="fallback",
                content=f"Customer context unavailable: {str(e)}",
                relevance_score=0.1,
                metadata={"error": True}
            ))

        return contexts

    async def retrieve_fraud_context(
        self,
        customer_id: Optional[str] = None,
        transaction_id: Optional[str] = None,
    ) -> List[RetrievedContext]:
        """Retrieve fraud detection context from lakehouse"""
        cache_key = self._get_cache_key(f"{customer_id}:{transaction_id}", "fraud")
        if self._is_cache_valid(cache_key):
            return self.context_cache[cache_key][0]

        contexts = []
        try:
            query = """
                SELECT 
                    transaction_id,
                    customer_id,
                    amount,
                    fraud_score,
                    fraud_indicators,
                    model_version,
                    prediction_timestamp
                FROM silver.fraud_predictions
                WHERE fraud_score > 0.5
            """
            if customer_id:
                query += f" AND customer_id = '{customer_id}'"
            if transaction_id:
                query += f" AND transaction_id = '{transaction_id}'"
            query += " ORDER BY prediction_timestamp DESC LIMIT 10"

            df = self.spark.sql(query)
            for row in df.collect():
                contexts.append(RetrievedContext(
                    source="silver.fraud_predictions",
                    content=json.dumps(row.asDict(), default=str),
                    relevance_score=0.85,
                    metadata={"transaction_id": row.transaction_id, "type": "fraud"}
                ))

            self.context_cache[cache_key] = (contexts, datetime.utcnow())
        except Exception as e:
            contexts.append(RetrievedContext(
                source="fallback",
                content=f"Fraud context unavailable: {str(e)}",
                relevance_score=0.1,
                metadata={"error": True}
            ))

        return contexts

    async def retrieve_regulatory_context(
        self,
        topic: str,
    ) -> List[RetrievedContext]:
        """Retrieve Nigerian insurance regulatory context"""
        contexts = [
            RetrievedContext(
                source="naicom_regulations",
                content="""
                Nigerian Insurance Regulatory Framework:
                - NAICOM (National Insurance Commission) is the primary regulator
                - Insurance Act 2003 governs insurance operations
                - NIIRA 2025 sets new capital requirements:
                  * Life Insurance: ₦10 billion minimum
                  * Non-Life Insurance: ₦15 billion minimum
                  * Reinsurance: ₦35 billion minimum
                - No Premium, No Cover Rule (Section 50)
                - Compulsory Insurance: Motor Third Party, Group Life, Professional Indemnity
                """,
                relevance_score=0.9,
                metadata={"type": "regulatory", "source": "NAICOM"}
            ),
            RetrievedContext(
                source="compliance_guidelines",
                content="""
                Compliance Requirements:
                - KYC/AML compliance mandatory for all policies
                - Risk-Based Supervision Framework
                - Solvency Margin Requirements
                - Investment Guidelines for Policy Holders' Funds
                - Market Conduct and Business Practice Guidelines
                """,
                relevance_score=0.85,
                metadata={"type": "compliance", "source": "NAICOM"}
            ),
        ]
        return contexts

    def _build_augmented_prompt(
        self,
        user_query: str,
        contexts: List[RetrievedContext],
        system_prompt: Optional[str] = None,
    ) -> str:
        """Build prompt augmented with retrieved context"""
        if system_prompt is None:
            system_prompt = """You are an expert Nigerian insurance AI assistant. 
Use the provided context to give accurate, helpful responses about insurance policies, 
claims, regulations, and customer inquiries. Always cite relevant regulations when applicable."""

        context_text = "\n\n".join([
            f"[Source: {ctx.source}]\n{ctx.content}"
            for ctx in contexts
            if ctx.relevance_score > 0.5
        ])

        return f"""{system_prompt}

CONTEXT FROM LAKEHOUSE:
{context_text}

USER QUERY:
{user_query}

Please provide a helpful, accurate response based on the context above."""

    async def generate_with_context(
        self,
        query: str,
        context_types: List[str] = None,
        customer_id: Optional[str] = None,
        policy_id: Optional[str] = None,
        model: Optional[str] = None,
        system_prompt: Optional[str] = None,
    ) -> RAGResponse:
        """Generate response with RAG-augmented context from lakehouse"""
        start_time = datetime.utcnow()
        model = model or self.default_model
        context_types = context_types or ["policy", "claims", "customer", "regulatory"]

        # Retrieve relevant contexts
        all_contexts: List[RetrievedContext] = []

        if "policy" in context_types:
            all_contexts.extend(await self.retrieve_policy_context(customer_id))
        if "claims" in context_types:
            all_contexts.extend(await self.retrieve_claims_context(customer_id, policy_id))
        if "customer" in context_types and customer_id:
            all_contexts.extend(await self.retrieve_customer_context(customer_id))
        if "fraud" in context_types:
            all_contexts.extend(await self.retrieve_fraud_context(customer_id))
        if "regulatory" in context_types:
            all_contexts.extend(await self.retrieve_regulatory_context(query))

        # Sort by relevance and take top contexts
        all_contexts.sort(key=lambda x: x.relevance_score, reverse=True)
        top_contexts = all_contexts[:10]

        # Build augmented prompt
        augmented_prompt = self._build_augmented_prompt(query, top_contexts, system_prompt)

        # Call Ollama
        try:
            response = await self.http_client.post(
                f"{self.ollama_url}/api/generate",
                json={
                    "model": model,
                    "prompt": augmented_prompt,
                    "stream": False,
                    "options": {
                        "temperature": 0.1,
                        "num_ctx": 8192,
                    }
                }
            )
            response.raise_for_status()
            result = response.json()

            latency_ms = (datetime.utcnow() - start_time).total_seconds() * 1000

            return RAGResponse(
                response=result.get("response", ""),
                contexts_used=top_contexts,
                model=model,
                tokens_used=result.get("eval_count", 0),
                latency_ms=latency_ms,
                cache_hit=False,
            )

        except Exception as e:
            return RAGResponse(
                response=f"Error generating response: {str(e)}",
                contexts_used=top_contexts,
                model=model,
                tokens_used=0,
                latency_ms=(datetime.utcnow() - start_time).total_seconds() * 1000,
                cache_hit=False,
            )

    async def answer_underwriting_query(
        self,
        application_id: str,
        customer_id: str,
        query: str,
    ) -> RAGResponse:
        """Answer underwriting-related queries with full context"""
        system_prompt = """You are an expert insurance underwriter AI assistant for the Nigerian market.
Analyze the provided customer and policy context to answer underwriting queries.
Consider NAICOM regulations, risk factors, and market practices in your response.
Provide specific recommendations with reasoning."""

        return await self.generate_with_context(
            query=query,
            context_types=["policy", "customer", "fraud", "regulatory"],
            customer_id=customer_id,
            system_prompt=system_prompt,
        )

    async def answer_claims_query(
        self,
        claim_id: str,
        policy_id: str,
        customer_id: str,
        query: str,
    ) -> RAGResponse:
        """Answer claims-related queries with full context"""
        system_prompt = """You are an expert claims adjudicator AI assistant for the Nigerian insurance market.
Analyze the provided claims, policy, and customer context to answer claims queries.
Consider fraud indicators, policy coverage, and regulatory requirements in your response.
Provide specific recommendations with reasoning."""

        return await self.generate_with_context(
            query=query,
            context_types=["claims", "policy", "customer", "fraud", "regulatory"],
            customer_id=customer_id,
            policy_id=policy_id,
            system_prompt=system_prompt,
        )

    async def answer_customer_query(
        self,
        customer_id: str,
        query: str,
        language: str = "en",
    ) -> RAGResponse:
        """Answer customer service queries with personalized context"""
        language_prompts = {
            "en": "Respond in English.",
            "yo": "Respond in Yoruba language.",
            "ha": "Respond in Hausa language.",
            "ig": "Respond in Igbo language.",
            "pcm": "Respond in Nigerian Pidgin English.",
        }

        system_prompt = f"""You are a helpful Nigerian insurance customer service AI assistant.
Use the provided customer context to give personalized, helpful responses.
Be friendly, professional, and ensure customer satisfaction.
{language_prompts.get(language, language_prompts['en'])}"""

        return await self.generate_with_context(
            query=query,
            context_types=["policy", "claims", "customer"],
            customer_id=customer_id,
            system_prompt=system_prompt,
        )

    async def close(self):
        """Close resources"""
        await self.http_client.aclose()
        self.spark.stop()


# Temporal Activity for RAG queries
async def rag_query_activity(
    query: str,
    context_types: List[str],
    customer_id: Optional[str] = None,
    policy_id: Optional[str] = None,
) -> Dict[str, Any]:
    """Temporal activity for RAG-augmented queries"""
    rag = LakehouseRAGIntegration()
    try:
        response = await rag.generate_with_context(
            query=query,
            context_types=context_types,
            customer_id=customer_id,
            policy_id=policy_id,
        )
        return {
            "response": response.response,
            "contexts_count": len(response.contexts_used),
            "model": response.model,
            "tokens_used": response.tokens_used,
            "latency_ms": response.latency_ms,
        }
    finally:
        await rag.close()
