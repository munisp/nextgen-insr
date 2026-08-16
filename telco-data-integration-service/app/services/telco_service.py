"""
Telco Service - Integration with Nigerian telco providers
"""
import uuid
import logging
import httpx
from datetime import datetime, timedelta
from typing import Optional, Dict, Any, List
from app.models.telco_data import TelcoData, TelcoProvider, TelcoDataStatus
from app.schemas.telco_schemas import TelcoDataRequest

logger = logging.getLogger(__name__)

class TelcoService:
    """Service for fetching telco data from providers"""

    def __init__(self):
        self.timeout = 30.0
        # In production, these would be real API endpoints and credentials
        self.provider_configs = {
            TelcoProvider.MTN: {
                "api_url": "https://api.mtn.ng/v1/customer-data",
                "api_key": "MTN_API_KEY",  # From environment
                "enabled": True
            },
            TelcoProvider.AIRTEL: {
                "api_url": "https://api.airtel.ng/v1/customer-data",
                "api_key": "AIRTEL_API_KEY",
                "enabled": True
            },
            TelcoProvider.GLO: {
                "api_url": "https://api.gloworld.com/v1/customer-data",
                "api_key": "GLO_API_KEY",
                "enabled": True
            },
            TelcoProvider.NINE_MOBILE: {
                "api_url": "https://api.9mobile.com.ng/v1/customer-data",
                "api_key": "9MOBILE_API_KEY",
                "enabled": True
            }
        }

    def detect_provider(self, phone_number: str) -> TelcoProvider:
        """Detect telco provider from phone number prefix"""
        # Nigerian phone number prefixes
        prefixes = {
            TelcoProvider.MTN: ["0803", "0806", "0810", "0813", "0814", "0816", "0903", "0906", "0913", "0916"],
            TelcoProvider.AIRTEL: ["0802", "0808", "0812", "0901", "0902", "0904", "0907", "0912"],
            TelcoProvider.GLO: ["0805", "0807", "0811", "0815", "0905", "0915"],
            TelcoProvider.NINE_MOBILE: ["0809", "0817", "0818", "0908", "0909"]
        }

        for provider, prefix_list in prefixes.items():
            if any(phone_number.startswith(prefix) for prefix in prefix_list):
                return provider

        # Default to MTN if unknown
        return TelcoProvider.MTN

    async def fetch_telco_data(self, request: TelcoDataRequest, db_session) -> TelcoData:
        """Fetch telco data from provider"""
        # Detect provider if not provided
        provider = request.provider or self.detect_provider(request.phone_number)

        # Create telco data record
        telco_data = TelcoData(
            id=str(uuid.uuid4()),
            customer_id=request.customer_id,
            phone_number=request.phone_number,
            provider=provider,
            status=TelcoDataStatus.PENDING
        )

        try:
            # Fetch data from telco provider
            data = await self._fetch_from_provider(provider, request.phone_number)

            # Parse and populate telco data
            telco_data.account_age_months = data.get("account_age_months", 0)
            telco_data.account_status = data.get("account_status", "ACTIVE")
            telco_data.avg_monthly_airtime = data.get("avg_monthly_airtime", 0.0)
            telco_data.avg_monthly_data = data.get("avg_monthly_data", 0.0)
            telco_data.total_spend_6months = data.get("total_spend_6months", 0.0)
            telco_data.total_spend_12months = data.get("total_spend_12months", 0.0)
            telco_data.payment_consistency_score = data.get("payment_consistency_score", 0.0)
            telco_data.late_payment_count = data.get("late_payment_count", 0)
            telco_data.failed_payment_count = data.get("failed_payment_count", 0)
            telco_data.prepaid_vs_postpaid = data.get("prepaid_vs_postpaid", "PREPAID")
            telco_data.transaction_count_30days = data.get("transaction_count_30days", 0)
            telco_data.avg_transaction_amount = data.get("avg_transaction_amount", 0.0)
            telco_data.max_transaction_amount = data.get("max_transaction_amount", 0.0)
            telco_data.min_transaction_amount = data.get("min_transaction_amount", 0.0)
            telco_data.night_usage_percentage = data.get("night_usage_percentage", 0.0)
            telco_data.weekend_usage_percentage = data.get("weekend_usage_percentage", 0.0)
            telco_data.data_to_airtime_ratio = data.get("data_to_airtime_ratio", 0.0)
            telco_data.raw_data = data
            telco_data.status = TelcoDataStatus.SUCCESS
            telco_data.fetched_at = datetime.utcnow()

            logger.info(f"Successfully fetched telco data for {request.phone_number} from {provider}")

        except Exception as e:
            logger.error(f"Failed to fetch telco data: {str(e)}")
            telco_data.status = TelcoDataStatus.FAILED
            telco_data.raw_data = {"error": str(e)}

        # Save to database
        db_session.add(telco_data)
        db_session.commit()
        db_session.refresh(telco_data)

        return telco_data

    async def _fetch_from_provider(self, provider: TelcoProvider, phone_number: str) -> Dict[str, Any]:
        """Fetch data from telco provider API"""
        config = self.provider_configs[provider]

        if not config["enabled"]:
            raise Exception(f"Provider {provider} is not enabled")

        # In production, this would make a real API call
        # For now, generate realistic mock data
        return self._generate_mock_telco_data(phone_number)

    def _generate_mock_telco_data(self, phone_number: str) -> Dict[str, Any]:
        """Generate realistic mock telco data for testing"""
        import random

        # Use phone number as seed for consistency
        seed = sum(ord(c) for c in phone_number)
        random.seed(seed)

        # Generate realistic data
        account_age_months = random.randint(6, 120)  # 6 months to 10 years
        is_good_customer = random.random() > 0.3  # 70% are good customers

        if is_good_customer:
            avg_monthly_airtime = random.uniform(2000, 10000)  # ₦2,000 - ₦10,000
            avg_monthly_data = random.uniform(1000, 5000)  # ₦1,000 - ₦5,000
            payment_consistency_score = random.uniform(70, 100)
            late_payment_count = random.randint(0, 2)
            failed_payment_count = random.randint(0, 1)
        else:
            avg_monthly_airtime = random.uniform(500, 2000)  # ₦500 - ₦2,000
            avg_monthly_data = random.uniform(200, 1000)  # ₦200 - ₦1,000
            payment_consistency_score = random.uniform(30, 70)
            late_payment_count = random.randint(3, 10)
            failed_payment_count = random.randint(2, 5)

        total_spend_6months = (avg_monthly_airtime + avg_monthly_data) * 6
        total_spend_12months = (avg_monthly_airtime + avg_monthly_data) * 12

        return {
            "account_age_months": account_age_months,
            "account_status": "ACTIVE" if is_good_customer else random.choice(["ACTIVE", "SUSPENDED"]),
            "avg_monthly_airtime": round(avg_monthly_airtime, 2),
            "avg_monthly_data": round(avg_monthly_data, 2),
            "total_spend_6months": round(total_spend_6months, 2),
            "total_spend_12months": round(total_spend_12months, 2),
            "payment_consistency_score": round(payment_consistency_score, 2),
            "late_payment_count": late_payment_count,
            "failed_payment_count": failed_payment_count,
            "prepaid_vs_postpaid": random.choice(["PREPAID", "PREPAID", "PREPAID", "POSTPAID"]),  # 75% prepaid
            "transaction_count_30days": random.randint(10, 100),
            "avg_transaction_amount": round(random.uniform(100, 2000), 2),
            "max_transaction_amount": round(random.uniform(5000, 20000), 2),
            "min_transaction_amount": round(random.uniform(50, 500), 2),
            "night_usage_percentage": round(random.uniform(10, 40), 2),
            "weekend_usage_percentage": round(random.uniform(20, 50), 2),
            "data_to_airtime_ratio": round(avg_monthly_data / avg_monthly_airtime if avg_monthly_airtime > 0 else 0, 2)
        }

    async def get_telco_data(self, customer_id: str, db_session) -> Optional[TelcoData]:
        """Get latest telco data for customer"""
        return db_session.query(TelcoData).filter(
            TelcoData.customer_id == customer_id,
            TelcoData.status == TelcoDataStatus.SUCCESS
        ).order_by(TelcoData.fetched_at.desc()).first()

    async def get_telco_data_by_phone(self, phone_number: str, db_session) -> Optional[TelcoData]:
        """Get latest telco data by phone number"""
        return db_session.query(TelcoData).filter(
            TelcoData.phone_number == phone_number,
            TelcoData.status == TelcoDataStatus.SUCCESS
        ).order_by(TelcoData.fetched_at.desc()).first()
