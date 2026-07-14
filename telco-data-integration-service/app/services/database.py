"""
Database module for telco-data-integration-service.

Provides SQLAlchemy session management and the get_db dependency.
"""
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, Session
from sqlalchemy.pool import StaticPool

# In production, use DATABASE_URL environment variable
DATABASE_URL = "sqlite:///./telco_data.db"

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def get_db() -> Session:
    """Yield a database session. Caller is responsible for closing it."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
