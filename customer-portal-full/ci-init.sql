--
-- PostgreSQL database dump
--


-- Dumped from database version 14.22 (Ubuntu 14.22-0ubuntu0.22.04.1)
-- Dumped by pg_dump version 14.22 (Ubuntu 14.22-0ubuntu0.22.04.1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: ad_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.ad_status AS ENUM (
    'draft',
    'active',
    'paused',
    'completed',
    'expired',
    'rejected'
);


--
-- Name: agent_tier; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.agent_tier AS ENUM (
    'Bronze',
    'Silver',
    'Gold',
    'Platinum'
);


--
-- Name: api_key_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.api_key_status AS ENUM (
    'active',
    'revoked',
    'expired'
);


--
-- Name: audit_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.audit_status AS ENUM (
    'success',
    'failure',
    'warning'
);


--
-- Name: billing_audit_action; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.billing_audit_action AS ENUM (
    'config_created',
    'config_updated',
    'config_deleted',
    'split_recorded',
    'reconciliation_run',
    'discrepancy_resolved',
    'tenant_billing_provisioned',
    'billing_model_changed',
    'permission_granted',
    'permission_revoked',
    'export_generated',
    'invoice_generated',
    'payment_recorded',
    'subscription_created',
    'subscription_updated',
    'subscription_cancelled',
    'credit_applied',
    'refund_processed',
    'late_fee_applied',
    'usage_recorded',
    'proration_applied'
);


--
-- Name: billing_permission; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.billing_permission AS ENUM (
    'view_ledger',
    'record_split',
    'run_reconciliation',
    'manage_billing_config',
    'view_dashboard',
    'export_data',
    'resolve_discrepancy',
    'manage_tenant_billing'
);


--
-- Name: billing_role; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.billing_role AS ENUM (
    'platform_admin',
    'billing_admin',
    'billing_analyst',
    'billing_viewer'
);


--
-- Name: chat_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.chat_status AS ENUM (
    'open',
    'assigned',
    'resolved',
    'escalated'
);


--
-- Name: claim_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.claim_status AS ENUM (
    'Submitted',
    'Under Review',
    'Approved',
    'Rejected',
    'Paid',
    'Escalated'
);


--
-- Name: commission_payout_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.commission_payout_status AS ENUM (
    'pending',
    'approved',
    'processing',
    'completed',
    'failed',
    'rejected'
);


--
-- Name: commission_rule_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.commission_rule_type AS ENUM (
    'percentage',
    'flat',
    'tiered'
);


--
-- Name: connectivity_quality; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.connectivity_quality AS ENUM (
    'Excellent',
    'Good',
    'Poor',
    'Offline'
);


--
-- Name: corridor_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.corridor_status AS ENUM (
    'active',
    'paused',
    'disabled'
);


--
-- Name: credit_application_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.credit_application_status AS ENUM (
    'pending',
    'approved',
    'rejected',
    'disbursed',
    'repaid',
    'defaulted'
);


--
-- Name: credit_rating; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.credit_rating AS ENUM (
    'AAA',
    'AA',
    'A',
    'BBB',
    'BB',
    'B',
    'CCC',
    'D',
    'N/A'
);


--
-- Name: customer_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.customer_status AS ENUM (
    'pending_kyc',
    'active',
    'suspended',
    'blacklisted'
);


--
-- Name: email_provider; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.email_provider AS ENUM (
    'sendgrid',
    'ses',
    'smtp',
    'console'
);


--
-- Name: email_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.email_status AS ENUM (
    'queued',
    'sent',
    'failed',
    'bounced'
);


--
-- Name: erp_sync_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.erp_sync_status AS ENUM (
    'pending',
    'synced',
    'failed',
    'skipped'
);


--
-- Name: erp_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.erp_type AS ENUM (
    'odoo',
    'sap',
    'netsuite',
    'quickbooks',
    'sage',
    'dynamics365',
    'custom',
    'erpnext'
);


--
-- Name: erpnext_sync_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.erpnext_sync_status AS ENUM (
    'Pending',
    'Synced',
    'Failed',
    'Conflict'
);


--
-- Name: fee_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.fee_type AS ENUM (
    'percentage',
    'flat',
    'tiered'
);


--
-- Name: fido2_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.fido2_status AS ENUM (
    'active',
    'revoked'
);


--
-- Name: fraud_decision; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.fraud_decision AS ENUM (
    'allow',
    'flag',
    'review',
    'block'
);


--
-- Name: fraud_rule_category; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.fraud_rule_category AS ENUM (
    'velocity',
    'geofence',
    'device_fingerprint',
    'amount_anomaly',
    'time_of_day',
    'blacklist',
    'custom'
);


--
-- Name: fraud_severity; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.fraud_severity AS ENUM (
    'critical',
    'high',
    'medium',
    'low'
);


--
-- Name: fraud_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.fraud_status AS ENUM (
    'open',
    'investigating',
    'escalated',
    'dismissed',
    'resolved'
);


--
-- Name: inventory_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.inventory_status AS ENUM (
    'in_stock',
    'low_stock',
    'out_of_stock',
    'discontinued'
);


--
-- Name: invite_code_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.invite_code_status AS ENUM (
    'active',
    'used',
    'expired',
    'revoked'
);


--
-- Name: invite_code_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.invite_code_type AS ENUM (
    'one_time',
    'multi_use'
);


--
-- Name: link_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.link_status AS ENUM (
    'active',
    'expired',
    'paused',
    'deleted',
    'used',
    'revoked'
);


--
-- Name: link_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.link_type AS ENUM (
    'payment',
    'collection',
    'profile',
    'invoice',
    'subscription',
    'donation'
);


--
-- Name: load_test_run_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.load_test_run_status AS ENUM (
    'running',
    'completed',
    'failed',
    'cancelled'
);


--
-- Name: loan_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.loan_status AS ENUM (
    'pending',
    'approved',
    'disbursed',
    'repaying',
    'completed',
    'defaulted',
    'rejected'
);


--
-- Name: loyalty_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.loyalty_type AS ENUM (
    'earned',
    'redeemed',
    'bonus',
    'penalty',
    'challenge'
);


--
-- Name: merchant_category; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.merchant_category AS ENUM (
    'retail',
    'food_beverage',
    'health',
    'education',
    'transport',
    'utilities',
    'government',
    'other'
);


--
-- Name: merchant_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.merchant_status AS ENUM (
    'pending',
    'active',
    'suspended',
    'closed'
);


--
-- Name: mqtt_qos; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.mqtt_qos AS ENUM (
    '0',
    '1',
    '2'
);


--
-- Name: onboarding_step; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.onboarding_step AS ENUM (
    'profile',
    'kyc',
    'float',
    'terminal',
    'training',
    'activated'
);


--
-- Name: payment_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.payment_status AS ENUM (
    'Pending',
    'Completed',
    'Failed',
    'Refunded',
    'Partial'
);


--
-- Name: policy_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.policy_status AS ENUM (
    'Active',
    'Expired',
    'Cancelled',
    'Pending',
    'Suspended'
);


--
-- Name: policy_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.policy_type AS ENUM (
    'Health',
    'Auto',
    'Property',
    'Life',
    'Group_Life',
    'Microinsurance',
    'Agricultural',
    'Parametric'
);


--
-- Name: qr_code_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.qr_code_status AS ENUM (
    'active',
    'used',
    'expired',
    'revoked'
);


--
-- Name: qr_code_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.qr_code_type AS ENUM (
    'payment',
    'profile',
    'collection',
    'agent_id',
    'product',
    'event',
    'loyalty'
);


--
-- Name: rate_alert_direction; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.rate_alert_direction AS ENUM (
    'above',
    'below'
);


--
-- Name: rate_alert_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.rate_alert_status AS ENUM (
    'active',
    'paused',
    'triggered',
    'expired'
);


--
-- Name: reconciliation_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.reconciliation_status AS ENUM (
    'pending',
    'matched',
    'discrepancy',
    'resolved'
);


--
-- Name: referral_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.referral_status AS ENUM (
    'Pending',
    'Completed',
    'Rewarded'
);


--
-- Name: reversal_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.reversal_status AS ENUM (
    'pending',
    'approved',
    'rejected',
    'processed',
    'completed',
    'failed'
);


--
-- Name: review_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.review_type AS ENUM (
    'Agent',
    'Service',
    'Claim',
    'Policy'
);


--
-- Name: risk_level; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.risk_level AS ENUM (
    'low',
    'medium',
    'high',
    'critical'
);


--
-- Name: role; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.role AS ENUM (
    'user',
    'admin',
    'supervisor'
);


--
-- Name: sender_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.sender_type AS ENUM (
    'agent',
    'support',
    'system'
);


--
-- Name: sim_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.sim_status AS ENUM (
    'active',
    'inactive',
    'suspended',
    'standby',
    'failed',
    'disabled'
);


--
-- Name: tenant_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.tenant_status AS ENUM (
    'trial',
    'active',
    'suspended',
    'churned'
);


--
-- Name: tenant_user_role; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.tenant_user_role AS ENUM (
    'tenant_admin',
    'tenant_operator',
    'tenant_viewer'
);


--
-- Name: topup_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.topup_status AS ENUM (
    'pending',
    'approved',
    'rejected'
);


--
-- Name: tx_channel; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.tx_channel AS ENUM (
    'Cash',
    'Card',
    'USSD',
    'QR',
    'NFC',
    'App'
);


--
-- Name: tx_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.tx_status AS ENUM (
    'success',
    'pending',
    'failed',
    'reversed',
    'pending_reversal_approval'
);


--
-- Name: tx_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.tx_type AS ENUM (
    'Cash In',
    'Cash Out',
    'Transfer',
    'Card Payment',
    'QR Payment',
    'NFC Payment',
    'Airtime',
    'Bill Payment',
    'Reversal',
    'Nano Loan',
    'Insurance'
);


--
-- Name: vat_rate_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.vat_rate_type AS ENUM (
    'standard',
    'zero',
    'exempt'
);


--
-- Name: webhook_delivery_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.webhook_delivery_status AS ENUM (
    'pending',
    'delivered',
    'failed',
    'retrying'
);


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: _migrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public._migrations (
    id integer NOT NULL,
    name character varying(255) NOT NULL,
    applied_at timestamp without time zone DEFAULT now(),
    checksum character varying(64)
);


--
-- Name: _migrations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public._migrations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: _migrations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public._migrations_id_seq OWNED BY public._migrations.id;


--
-- Name: ab_experiments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ab_experiments (
    id integer NOT NULL,
    name character varying(150) NOT NULL,
    description text,
    status character varying(20) DEFAULT 'active'::character varying,
    variant_a character varying(100) NOT NULL,
    variant_b character varying(100) NOT NULL,
    winner character varying(5),
    traffic_split numeric(3,2) DEFAULT 0.50,
    start_date date NOT NULL,
    end_date date,
    metric character varying(100),
    variant_a_conversion numeric(5,4),
    variant_b_conversion numeric(5,4),
    sample_size integer DEFAULT 0,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: ab_experiments_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ab_experiments_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ab_experiments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ab_experiments_id_seq OWNED BY public.ab_experiments.id;


--
-- Name: achievements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.achievements (
    id integer NOT NULL,
    name character varying(100) NOT NULL,
    description text,
    category character varying(50),
    points_reward integer DEFAULT 0,
    icon character varying(50),
    criteria_type character varying(30),
    criteria_value integer,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: achievements_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.achievements_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: achievements_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.achievements_id_seq OWNED BY public.achievements.id;


--
-- Name: actuarial_calculations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.actuarial_calculations (
    id integer NOT NULL,
    "userId" integer NOT NULL,
    "calculationType" character varying(64) NOT NULL,
    "policyType" character varying(64),
    "inputParams" text,
    result numeric(15,4),
    breakdown text,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: actuarial_calculations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.actuarial_calculations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: actuarial_calculations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.actuarial_calculations_id_seq OWNED BY public.actuarial_calculations.id;


--
-- Name: actuarial_calculations_userId_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."actuarial_calculations_userId_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: actuarial_calculations_userId_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."actuarial_calculations_userId_seq" OWNED BY public.actuarial_calculations."userId";


--
-- Name: agent_achievements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_achievements (
    id integer NOT NULL,
    agent_id integer NOT NULL,
    achievement_type text NOT NULL,
    title text NOT NULL,
    description text,
    badge_icon text,
    points integer DEFAULT 0,
    level integer DEFAULT 1,
    unlocked_at timestamp without time zone DEFAULT now(),
    metadata text
);


--
-- Name: agent_achievements_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.agent_achievements_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: agent_achievements_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.agent_achievements_id_seq OWNED BY public.agent_achievements.id;


--
-- Name: agent_badges; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_badges (
    id integer NOT NULL,
    name text NOT NULL,
    description text,
    icon text NOT NULL,
    category text NOT NULL,
    requirement text NOT NULL,
    points_value integer DEFAULT 0,
    is_active boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: agent_badges_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.agent_badges_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: agent_badges_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.agent_badges_id_seq OWNED BY public.agent_badges.id;


--
-- Name: agent_bank_accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_bank_accounts (
    id integer NOT NULL,
    agent_id integer NOT NULL,
    bank_name text NOT NULL,
    bank_code text NOT NULL,
    account_number text NOT NULL,
    account_name text NOT NULL,
    is_default boolean DEFAULT false,
    verified boolean DEFAULT false,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);


--
-- Name: agent_bank_accounts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.agent_bank_accounts_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: agent_bank_accounts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.agent_bank_accounts_id_seq OWNED BY public.agent_bank_accounts.id;


--
-- Name: agent_commissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_commissions (
    id integer NOT NULL,
    "agentId" integer NOT NULL,
    "policyId" integer NOT NULL,
    "commissionAmount" numeric(10,2) NOT NULL,
    "commissionRate" numeric(5,4) NOT NULL,
    status character varying(32) DEFAULT 'Pending'::character varying,
    "paidAt" timestamp without time zone,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: agent_commissions_agentId_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."agent_commissions_agentId_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: agent_commissions_agentId_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."agent_commissions_agentId_seq" OWNED BY public.agent_commissions."agentId";


--
-- Name: agent_commissions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.agent_commissions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: agent_commissions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.agent_commissions_id_seq OWNED BY public.agent_commissions.id;


--
-- Name: agent_commissions_policyId_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."agent_commissions_policyId_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: agent_commissions_policyId_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."agent_commissions_policyId_seq" OWNED BY public.agent_commissions."policyId";


--
-- Name: agent_geofence_zones; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_geofence_zones (
    id integer NOT NULL,
    "agentId" integer NOT NULL,
    "zoneId" integer NOT NULL,
    "assignedBy" character varying(64),
    "assignedAt" timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: agent_geofence_zones_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.agent_geofence_zones_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: agent_geofence_zones_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.agent_geofence_zones_id_seq OWNED BY public.agent_geofence_zones.id;


--
-- Name: agent_loans; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_loans (
    id integer NOT NULL,
    agent_id integer NOT NULL,
    loan_type text NOT NULL,
    principal_amount numeric(15,2) NOT NULL,
    interest_rate numeric(5,2) NOT NULL,
    tenor_days integer NOT NULL,
    total_repayable numeric(15,2) NOT NULL,
    amount_repaid numeric(15,2) DEFAULT '0'::numeric,
    status public.loan_status DEFAULT 'pending'::public.loan_status NOT NULL,
    disbursed_at timestamp without time zone,
    due_date timestamp without time zone,
    approved_by integer,
    credit_score integer,
    collateral_type text,
    collateral_value numeric(15,2),
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);


--
-- Name: agent_loans_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.agent_loans_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: agent_loans_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.agent_loans_id_seq OWNED BY public.agent_loans.id;


--
-- Name: agent_onboarding_progress; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_onboarding_progress (
    id integer NOT NULL,
    agent_id integer NOT NULL,
    agent_code character varying(32) NOT NULL,
    current_step public.onboarding_step DEFAULT 'profile'::public.onboarding_step NOT NULL,
    profile_complete boolean DEFAULT false NOT NULL,
    kyc_complete boolean DEFAULT false NOT NULL,
    float_funded boolean DEFAULT false NOT NULL,
    terminal_assigned boolean DEFAULT false NOT NULL,
    training_complete boolean DEFAULT false NOT NULL,
    activated_at timestamp without time zone,
    notes text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: agent_onboarding_progress_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.agent_onboarding_progress_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: agent_onboarding_progress_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.agent_onboarding_progress_id_seq OWNED BY public.agent_onboarding_progress.id;


--
-- Name: agent_performance_scores; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_performance_scores (
    id integer NOT NULL,
    agent_id integer NOT NULL,
    period text NOT NULL,
    tx_volume numeric(15,2) DEFAULT '0'::numeric,
    tx_count integer DEFAULT 0,
    commission_earned numeric(15,2) DEFAULT '0'::numeric,
    customer_count integer DEFAULT 0,
    dispute_rate numeric(5,4) DEFAULT '0'::numeric,
    uptime_percent numeric(5,2) DEFAULT '100'::numeric,
    overall_score numeric(5,2) DEFAULT '0'::numeric,
    rank integer,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: agent_performance_scores_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.agent_performance_scores_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: agent_performance_scores_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.agent_performance_scores_id_seq OWNED BY public.agent_performance_scores.id;


--
-- Name: agent_push_subscriptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_push_subscriptions (
    id integer NOT NULL,
    "agentCode" character varying(32) NOT NULL,
    endpoint text NOT NULL,
    "p256dhKey" text NOT NULL,
    "authKey" text NOT NULL,
    "userAgent" text,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp without time zone DEFAULT now() NOT NULL,
    "lastAlertedAt" timestamp without time zone
);


--
-- Name: agent_push_subscriptions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.agent_push_subscriptions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: agent_push_subscriptions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.agent_push_subscriptions_id_seq OWNED BY public.agent_push_subscriptions.id;


--
-- Name: agent_suspension_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_suspension_log (
    id integer NOT NULL,
    agent_id integer NOT NULL,
    action text NOT NULL,
    reason text NOT NULL,
    performed_by integer NOT NULL,
    previous_status text,
    new_status text,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: agent_suspension_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.agent_suspension_log_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: agent_suspension_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.agent_suspension_log_id_seq OWNED BY public.agent_suspension_log.id;


--
-- Name: agents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agents (
    id integer NOT NULL,
    "userId" integer NOT NULL,
    "agentCode" character varying(32) NOT NULL,
    "licenseNumber" character varying(64),
    "agencyName" character varying(255),
    region character varying(64),
    tier character varying(32) DEFAULT 'standard'::character varying,
    "commissionRate" numeric(5,4),
    "totalPoliciesSold" integer DEFAULT 0,
    "totalPremiumCollected" numeric(15,2) DEFAULT '0'::numeric,
    status character varying(32) DEFAULT 'Active'::character varying,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp without time zone DEFAULT now() NOT NULL,
    role character varying(32) DEFAULT 'agent'::character varying NOT NULL,
    "floatLocked" boolean DEFAULT false NOT NULL,
    "terminalEnabled" boolean DEFAULT true NOT NULL,
    "terminalDisabledReason" text,
    "deletedAt" timestamp without time zone,
    "tenantId" integer,
    "creditScore" integer DEFAULT 0,
    "creditLimit" numeric(15,2) DEFAULT 0.00,
    "creditRating" public.credit_rating DEFAULT 'N/A'::public.credit_rating,
    "parentAgentId" integer,
    "hierarchyRole" character varying(32) DEFAULT 'agent'::character varying,
    "hierarchyLevel" integer DEFAULT 3,
    "commissionSplitOverride" numeric(5,2),
    "escalationLimit" numeric(15,2) DEFAULT 500000
);


--
-- Name: agents_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.agents_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: agents_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.agents_id_seq OWNED BY public.agents.id;


--
-- Name: agents_userId_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."agents_userId_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: agents_userId_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."agents_userId_seq" OWNED BY public.agents."userId";


--
-- Name: agricultural_schemes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agricultural_schemes (
    id integer NOT NULL,
    name character varying(150) NOT NULL,
    scheme_type character varying(30) NOT NULL,
    coverage_type character varying(50) NOT NULL,
    max_payout numeric(15,2) NOT NULL,
    subsidy_pct numeric(5,2) DEFAULT 0,
    administering_body character varying(100),
    eligible_states text[],
    enrollment_count integer DEFAULT 0,
    status character varying(20) DEFAULT 'active'::character varying,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: agricultural_schemes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.agricultural_schemes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: agricultural_schemes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.agricultural_schemes_id_seq OWNED BY public.agricultural_schemes.id;


--
-- Name: agricultural_trigger_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agricultural_trigger_events (
    id integer NOT NULL,
    event_type character varying(50) NOT NULL,
    region character varying(100) NOT NULL,
    severity character varying(20) NOT NULL,
    event_date date NOT NULL,
    affected_policies integer DEFAULT 0,
    total_exposure numeric(15,2) DEFAULT 0,
    payout_triggered boolean DEFAULT false,
    payout_amount numeric(15,2),
    data_source character varying(100),
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: agricultural_trigger_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.agricultural_trigger_events_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: agricultural_trigger_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.agricultural_trigger_events_id_seq OWNED BY public.agricultural_trigger_events.id;


--
-- Name: agricultural_underwriting_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agricultural_underwriting_rules (
    id integer NOT NULL,
    name character varying(100) NOT NULL,
    factor character varying(50) NOT NULL,
    weight numeric(4,2) NOT NULL,
    description text,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: agricultural_underwriting_rules_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.agricultural_underwriting_rules_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: agricultural_underwriting_rules_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.agricultural_underwriting_rules_id_seq OWNED BY public.agricultural_underwriting_rules.id;


--
-- Name: analytics_dashboards; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.analytics_dashboards (
    id integer NOT NULL,
    name text NOT NULL,
    description text,
    owner_id integer NOT NULL,
    is_public boolean DEFAULT false,
    layout text,
    filters text,
    refresh_interval integer DEFAULT 300,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);


--
-- Name: analytics_dashboards_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.analytics_dashboards_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: analytics_dashboards_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.analytics_dashboards_id_seq OWNED BY public.analytics_dashboards.id;


--
-- Name: analytics_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.analytics_events (
    id integer NOT NULL,
    "userId" integer NOT NULL,
    "eventType" character varying(64) NOT NULL,
    "entityType" character varying(64),
    "entityId" character varying(128),
    properties text,
    "sessionId" character varying(128),
    "ipAddress" character varying(45),
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: analytics_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.analytics_events_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: analytics_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.analytics_events_id_seq OWNED BY public.analytics_events.id;


--
-- Name: analytics_events_userId_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."analytics_events_userId_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: analytics_events_userId_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."analytics_events_userId_seq" OWNED BY public.analytics_events."userId";


--
-- Name: analytics_metrics; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.analytics_metrics (
    id bigint NOT NULL,
    "metricName" character varying(128) NOT NULL,
    value numeric(20,4) NOT NULL,
    "bucketMinute" timestamp without time zone NOT NULL,
    tags json DEFAULT '{}'::json,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: analytics_metrics_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.analytics_metrics_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: analytics_metrics_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.analytics_metrics_id_seq OWNED BY public.analytics_metrics.id;


--
-- Name: api_key_usage; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.api_key_usage (
    id bigint NOT NULL,
    "apiKeyId" integer NOT NULL,
    endpoint character varying(256) NOT NULL,
    method character varying(8) NOT NULL,
    "statusCode" integer NOT NULL,
    "responseMs" integer,
    "ipAddress" character varying(45),
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: api_key_usage_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.api_key_usage_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: api_key_usage_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.api_key_usage_id_seq OWNED BY public.api_key_usage.id;


--
-- Name: api_keys; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.api_keys (
    id integer NOT NULL,
    "keyHash" character varying(128) NOT NULL,
    "keyPrefix" character varying(12) NOT NULL,
    name character varying(128) NOT NULL,
    description text,
    "userId" integer NOT NULL,
    "tenantId" integer,
    status public.api_key_status DEFAULT 'active'::public.api_key_status NOT NULL,
    scopes json DEFAULT '[]'::json,
    "rateLimit" integer DEFAULT 1000 NOT NULL,
    "lastUsedAt" timestamp without time zone,
    "expiresAt" timestamp without time zone,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL,
    "revokedAt" timestamp without time zone
);


--
-- Name: api_keys_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.api_keys_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: api_keys_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.api_keys_id_seq OWNED BY public.api_keys.id;


--
-- Name: approval_chains; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.approval_chains (
    id integer NOT NULL,
    name character varying(200) NOT NULL,
    entity_type character varying(50) NOT NULL,
    threshold_amount numeric(15,2) DEFAULT 0,
    steps jsonb DEFAULT '[]'::jsonb NOT NULL,
    is_active boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);


--
-- Name: approval_chains_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.approval_chains_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: approval_chains_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.approval_chains_id_seq OWNED BY public.approval_chains.id;


--
-- Name: approval_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.approval_requests (
    id integer NOT NULL,
    chain_id integer,
    entity_type character varying(50) NOT NULL,
    entity_id integer NOT NULL,
    current_step integer DEFAULT 0,
    status character varying(30) DEFAULT 'pending'::character varying,
    submitted_by character varying(100),
    submitted_at timestamp without time zone DEFAULT now(),
    completed_at timestamp without time zone,
    notes text,
    history jsonb DEFAULT '[]'::jsonb
);


--
-- Name: approval_requests_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.approval_requests_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: approval_requests_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.approval_requests_id_seq OWNED BY public.approval_requests.id;


--
-- Name: audit_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_log (
    id bigint NOT NULL,
    "agentId" integer,
    "agentCode" character varying(32),
    action character varying(128) NOT NULL,
    resource character varying(64),
    "resourceId" character varying(64),
    "ipAddress" character varying(45),
    "userAgent" character varying(256),
    status public.audit_status DEFAULT 'success'::public.audit_status,
    metadata json,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL,
    "tenantId" integer
);


--
-- Name: audit_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.audit_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: audit_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.audit_log_id_seq OWNED BY public.audit_log.id;


--
-- Name: audit_trail; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_trail (
    id integer NOT NULL,
    "userId" integer NOT NULL,
    action character varying(128) NOT NULL,
    "entityType" character varying(64) NOT NULL,
    "entityId" character varying(128),
    "oldValues" text,
    "newValues" text,
    "ipAddress" character varying(45),
    "userAgent" text,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: audit_trail_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.audit_trail_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: audit_trail_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.audit_trail_id_seq OWNED BY public.audit_trail.id;


--
-- Name: audit_trail_userId_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."audit_trail_userId_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: audit_trail_userId_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."audit_trail_userId_seq" OWNED BY public.audit_trail."userId";


--
-- Name: backup_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.backup_snapshots (
    id integer NOT NULL,
    snapshot_type text NOT NULL,
    status text DEFAULT 'in_progress'::text NOT NULL,
    size_bytes integer,
    storage_url text,
    tables_included integer,
    rows_backed_up integer,
    duration_ms integer,
    rto_minutes integer,
    rpo_minutes integer,
    triggered_by text NOT NULL,
    completed_at timestamp without time zone,
    expires_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: backup_snapshots_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.backup_snapshots_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: backup_snapshots_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.backup_snapshots_id_seq OWNED BY public.backup_snapshots.id;


--
-- Name: bancassurance_offers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bancassurance_offers (
    id integer NOT NULL,
    "userId" integer NOT NULL,
    "partnerId" integer NOT NULL,
    "offerType" character varying(64) NOT NULL,
    premium numeric(10,2),
    "sumAssured" numeric(15,2),
    status character varying(32) DEFAULT 'Pending'::character varying,
    "expiresAt" timestamp without time zone,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: bancassurance_offers_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.bancassurance_offers_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: bancassurance_offers_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.bancassurance_offers_id_seq OWNED BY public.bancassurance_offers.id;


--
-- Name: bancassurance_offers_partnerId_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."bancassurance_offers_partnerId_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: bancassurance_offers_partnerId_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."bancassurance_offers_partnerId_seq" OWNED BY public.bancassurance_offers."partnerId";


--
-- Name: bancassurance_offers_userId_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."bancassurance_offers_userId_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: bancassurance_offers_userId_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."bancassurance_offers_userId_seq" OWNED BY public.bancassurance_offers."userId";


--
-- Name: bancassurance_partners; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bancassurance_partners (
    id integer NOT NULL,
    "bankName" character varying(255) NOT NULL,
    "bankCode" character varying(20),
    "commissionRate" numeric(5,4),
    products text[],
    status character varying(32) DEFAULT 'Active'::character varying,
    "apiEndpoint" text,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: bancassurance_partners_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.bancassurance_partners_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: bancassurance_partners_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.bancassurance_partners_id_seq OWNED BY public.bancassurance_partners.id;


--
-- Name: bi_report_definitions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bi_report_definitions (
    id integer NOT NULL,
    name text NOT NULL,
    description text,
    report_type text NOT NULL,
    data_source text NOT NULL,
    query text,
    schedule text,
    recipients text,
    last_run_at timestamp without time zone,
    is_active boolean DEFAULT true,
    created_by integer,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: bi_report_definitions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.bi_report_definitions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: bi_report_definitions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.bi_report_definitions_id_seq OWNED BY public.bi_report_definitions.id;


--
-- Name: billing_audit_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.billing_audit_log (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    user_id integer NOT NULL,
    user_name character varying(128),
    action public.billing_audit_action NOT NULL,
    resource_type character varying(64) NOT NULL,
    resource_id character varying(128),
    before_state json,
    after_state json,
    metadata json,
    ip_address character varying(45),
    user_agent character varying(512),
    session_id character varying(128),
    kafka_offset character varying(64),
    notification_sent boolean DEFAULT false,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: billing_audit_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.billing_audit_log_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: billing_audit_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.billing_audit_log_id_seq OWNED BY public.billing_audit_log.id;


--
-- Name: billing_provisioning_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.billing_provisioning_history (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    step character varying(64) NOT NULL,
    status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    details json,
    temporal_workflow_id character varying(128),
    started_at timestamp without time zone DEFAULT now() NOT NULL,
    completed_at timestamp without time zone,
    error text
);


--
-- Name: billing_provisioning_history_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.billing_provisioning_history_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: billing_provisioning_history_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.billing_provisioning_history_id_seq OWNED BY public.billing_provisioning_history.id;


--
-- Name: billing_role_assignments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.billing_role_assignments (
    id integer NOT NULL,
    user_id integer NOT NULL,
    tenant_id integer NOT NULL,
    billing_role public.billing_role NOT NULL,
    permissions json,
    granted_by integer NOT NULL,
    granted_at timestamp without time zone DEFAULT now() NOT NULL,
    expires_at timestamp without time zone,
    is_active boolean DEFAULT true NOT NULL
);


--
-- Name: billing_role_assignments_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.billing_role_assignments_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: billing_role_assignments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.billing_role_assignments_id_seq OWNED BY public.billing_role_assignments.id;


--
-- Name: biometric_audit_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.biometric_audit_events (
    id integer NOT NULL,
    "sessionId" character varying(128) NOT NULL,
    "userId" integer,
    "eventType" character varying(64) NOT NULL,
    outcome character varying(32) NOT NULL,
    "confidenceScore" numeric(5,4),
    "spoofType" character varying(64),
    "spoofScore" numeric(5,4),
    "livenessMethod" character varying(32),
    "matchScore" numeric(5,4),
    "processingTimeMs" integer,
    "deviceInfo" json,
    "ipAddress" character varying(64),
    "geoLocation" json,
    "errorDetails" text,
    "tenantId" integer,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: biometric_audit_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.biometric_audit_events_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: biometric_audit_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.biometric_audit_events_id_seq OWNED BY public.biometric_audit_events.id;


--
-- Name: broker_api_keys; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.broker_api_keys (
    id integer NOT NULL,
    "userId" integer NOT NULL,
    name character varying(255) NOT NULL,
    "apiKey" character varying(64) NOT NULL,
    permissions text[] NOT NULL,
    "rateLimit" integer DEFAULT 1000 NOT NULL,
    status character varying(32) DEFAULT 'Active'::character varying NOT NULL,
    "lastUsedAt" timestamp without time zone,
    "expiresAt" timestamp without time zone,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: broker_api_keys_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.broker_api_keys_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: broker_api_keys_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.broker_api_keys_id_seq OWNED BY public.broker_api_keys.id;


--
-- Name: broker_api_keys_userId_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."broker_api_keys_userId_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: broker_api_keys_userId_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."broker_api_keys_userId_seq" OWNED BY public.broker_api_keys."userId";


--
-- Name: broker_api_usage; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.broker_api_usage (
    id integer NOT NULL,
    "keyId" integer NOT NULL,
    "userId" integer NOT NULL,
    endpoint character varying(255) NOT NULL,
    method character varying(8) NOT NULL,
    "statusCode" integer NOT NULL,
    "responseTimeMs" integer NOT NULL,
    "requestDate" timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: broker_api_usage_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.broker_api_usage_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: broker_api_usage_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.broker_api_usage_id_seq OWNED BY public.broker_api_usage.id;


--
-- Name: broker_api_usage_keyId_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."broker_api_usage_keyId_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: broker_api_usage_keyId_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."broker_api_usage_keyId_seq" OWNED BY public.broker_api_usage."keyId";


--
-- Name: broker_api_usage_responseTimeMs_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."broker_api_usage_responseTimeMs_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: broker_api_usage_responseTimeMs_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."broker_api_usage_responseTimeMs_seq" OWNED BY public.broker_api_usage."responseTimeMs";


--
-- Name: broker_api_usage_statusCode_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."broker_api_usage_statusCode_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: broker_api_usage_statusCode_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."broker_api_usage_statusCode_seq" OWNED BY public.broker_api_usage."statusCode";


--
-- Name: broker_api_usage_userId_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."broker_api_usage_userId_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: broker_api_usage_userId_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."broker_api_usage_userId_seq" OWNED BY public.broker_api_usage."userId";


--
-- Name: chat_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chat_messages (
    id integer NOT NULL,
    "sessionId" integer NOT NULL,
    "senderType" public.sender_type NOT NULL,
    "senderName" character varying(128),
    content text NOT NULL,
    "isRead" boolean DEFAULT false,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: chat_messages_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.chat_messages_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: chat_messages_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.chat_messages_id_seq OWNED BY public.chat_messages.id;


--
-- Name: chat_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chat_sessions (
    id integer NOT NULL,
    "sessionRef" character varying(32) NOT NULL,
    "agentId" integer NOT NULL,
    category character varying(64),
    subject character varying(256),
    status public.chat_status DEFAULT 'open'::public.chat_status NOT NULL,
    "supportAgentName" character varying(128),
    rating integer,
    "resolvedAt" timestamp without time zone,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: chat_sessions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.chat_sessions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: chat_sessions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.chat_sessions_id_seq OWNED BY public.chat_sessions.id;


--
-- Name: chatbot_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chatbot_config (
    id integer NOT NULL,
    config_key character varying(50) NOT NULL,
    config_value jsonb NOT NULL,
    updated_at timestamp without time zone DEFAULT now()
);


--
-- Name: chatbot_config_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.chatbot_config_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: chatbot_config_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.chatbot_config_id_seq OWNED BY public.chatbot_config.id;


--
-- Name: claim_evidence; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.claim_evidence (
    id integer NOT NULL,
    "userId" integer NOT NULL,
    "claimId" integer NOT NULL,
    "evidenceType" character varying(64) NOT NULL,
    "fileName" character varying(255),
    "fileUrl" text,
    description text,
    status character varying(32) DEFAULT 'Uploaded'::character varying,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: claim_evidence_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.claim_evidence_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: claim_evidence_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.claim_evidence_id_seq OWNED BY public.claim_evidence.id;


--
-- Name: claim_evidence_userId_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."claim_evidence_userId_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: claim_evidence_userId_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."claim_evidence_userId_seq" OWNED BY public.claim_evidence."userId";


--
-- Name: claim_routing_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.claim_routing_rules (
    id integer NOT NULL,
    name character varying(100) NOT NULL,
    condition_field character varying(50) NOT NULL,
    operator character varying(20) NOT NULL,
    threshold character varying(50) NOT NULL,
    action character varying(100) NOT NULL,
    target_team character varying(100),
    priority integer DEFAULT 1,
    is_active boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: claim_routing_rules_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.claim_routing_rules_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: claim_routing_rules_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.claim_routing_rules_id_seq OWNED BY public.claim_routing_rules.id;


--
-- Name: claims; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.claims (
    id integer NOT NULL,
    "userId" integer NOT NULL,
    "policyId" integer NOT NULL,
    "claimNumber" character varying(50) NOT NULL,
    amount numeric(10,2) NOT NULL,
    status public.claim_status DEFAULT 'Submitted'::public.claim_status NOT NULL,
    "incidentDate" timestamp without time zone NOT NULL,
    description text NOT NULL,
    "fraudScore" numeric(5,2),
    "adjudicatorId" integer,
    "settlementAmount" numeric(10,2),
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp without time zone DEFAULT now() NOT NULL,
    "tenantId" character varying(50) DEFAULT 'default'::character varying
);


--
-- Name: claims_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.claims_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: claims_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.claims_id_seq OWNED BY public.claims.id;


--
-- Name: claims_payouts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.claims_payouts (
    id integer NOT NULL,
    "claimId" integer NOT NULL,
    "beneficiaryName" character varying(200),
    "bankName" character varying(100),
    "accountNumber" character varying(20),
    amount numeric(15,2) NOT NULL,
    status character varying(30) DEFAULT 'pending'::character varying,
    "approvedBy" character varying(100),
    "approvedAt" timestamp without time zone,
    "paidAt" timestamp without time zone,
    "paymentRef" character varying(100),
    "createdAt" timestamp without time zone DEFAULT now(),
    CONSTRAINT claims_payouts_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'approved'::character varying, 'processing'::character varying, 'paid'::character varying, 'failed'::character varying, 'reversed'::character varying])::text[])))
);


--
-- Name: claims_payouts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.claims_payouts_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: claims_payouts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.claims_payouts_id_seq OWNED BY public.claims_payouts.id;


--
-- Name: claims_policyId_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."claims_policyId_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: claims_policyId_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."claims_policyId_seq" OWNED BY public.claims."policyId";


--
-- Name: claims_userId_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."claims_userId_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: claims_userId_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."claims_userId_seq" OWNED BY public.claims."userId";


--
-- Name: commission_audit_trail; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.commission_audit_trail (
    id integer NOT NULL,
    entity_type character varying(32) NOT NULL,
    entity_id character varying(32) NOT NULL,
    action character varying(32) NOT NULL,
    previous_value json,
    new_value json,
    performed_by character varying(64) NOT NULL,
    reason text,
    ip_address character varying(45),
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: commission_audit_trail_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.commission_audit_trail_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: commission_audit_trail_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.commission_audit_trail_id_seq OWNED BY public.commission_audit_trail.id;


--
-- Name: commission_cascade_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.commission_cascade_history (
    id integer NOT NULL,
    "transactionId" integer NOT NULL,
    "transactionRef" character varying(64) NOT NULL,
    "transactionType" character varying(32) NOT NULL,
    "transactionAmount" numeric(15,2) NOT NULL,
    "totalCommission" numeric(15,2) NOT NULL,
    "originAgentId" integer NOT NULL,
    "originAgentCode" character varying(32) NOT NULL,
    "recipientAgentId" integer NOT NULL,
    "recipientAgentCode" character varying(32) NOT NULL,
    "recipientHierarchyRole" character varying(32) NOT NULL,
    "recipientHierarchyLevel" integer NOT NULL,
    "splitPercentage" numeric(5,2) NOT NULL,
    "commissionAmount" numeric(15,2) NOT NULL,
    status character varying(16) DEFAULT 'credited'::character varying NOT NULL,
    "creditedAt" timestamp without time zone DEFAULT now(),
    "tenantId" integer,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: commission_cascade_history_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.commission_cascade_history_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: commission_cascade_history_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.commission_cascade_history_id_seq OWNED BY public.commission_cascade_history.id;


--
-- Name: commission_clawbacks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.commission_clawbacks (
    id integer NOT NULL,
    reversal_request_id integer NOT NULL,
    agent_id integer NOT NULL,
    original_commission numeric(15,2) NOT NULL,
    clawback_amount numeric(15,2) NOT NULL,
    cascade_level text NOT NULL,
    status text DEFAULT 'pending'::text,
    applied_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: commission_clawbacks_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.commission_clawbacks_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: commission_clawbacks_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.commission_clawbacks_id_seq OWNED BY public.commission_clawbacks.id;


--
-- Name: commission_payouts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.commission_payouts (
    id integer NOT NULL,
    agent_id integer NOT NULL,
    agent_code character varying(32) NOT NULL,
    amount numeric(18,2) NOT NULL,
    currency character varying(3) DEFAULT 'NGN'::character varying NOT NULL,
    status public.commission_payout_status DEFAULT 'pending'::public.commission_payout_status NOT NULL,
    requested_by integer,
    approved_by integer,
    rejected_by integer,
    rejection_reason text,
    bank_code character varying(10),
    account_number character varying(20),
    account_name character varying(100),
    nuban_ref character varying(64),
    processed_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: commission_payouts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.commission_payouts_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: commission_payouts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.commission_payouts_id_seq OWNED BY public.commission_payouts.id;


--
-- Name: commission_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.commission_rules (
    id integer NOT NULL,
    name character varying(128) NOT NULL,
    "txType" public.tx_type NOT NULL,
    "ruleType" public.commission_rule_type DEFAULT 'percentage'::public.commission_rule_type NOT NULL,
    value numeric(10,4) NOT NULL,
    "minAmount" numeric(15,2),
    "maxAmount" numeric(15,2),
    "tieredJson" json,
    "agentTier" public.agent_tier,
    "isActive" boolean DEFAULT true NOT NULL,
    "effectiveFrom" timestamp without time zone DEFAULT now() NOT NULL,
    "effectiveTo" timestamp without time zone,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: commission_rules_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.commission_rules_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: commission_rules_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.commission_rules_id_seq OWNED BY public.commission_rules.id;


--
-- Name: commission_splits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.commission_splits (
    id integer NOT NULL,
    split_id character varying(16) NOT NULL,
    transaction_type character varying(32) NOT NULL,
    super_agent_share numeric(5,2) NOT NULL,
    master_agent_share numeric(5,2) NOT NULL,
    agent_share numeric(5,2) NOT NULL,
    sub_agent_share numeric(5,2) NOT NULL,
    platform_share numeric(5,2) NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    effective_from timestamp without time zone DEFAULT now() NOT NULL,
    effective_to timestamp without time zone,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: commission_splits_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.commission_splits_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: commission_splits_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.commission_splits_id_seq OWNED BY public.commission_splits.id;


--
-- Name: commission_tiers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.commission_tiers (
    id integer NOT NULL,
    tier_id character varying(16) NOT NULL,
    name character varying(128) NOT NULL,
    transaction_type character varying(32) NOT NULL,
    min_volume numeric(15,2) DEFAULT '0'::numeric NOT NULL,
    max_volume numeric(15,2) DEFAULT '999999999'::numeric NOT NULL,
    rate numeric(8,4) NOT NULL,
    flat_fee numeric(10,2) DEFAULT '0'::numeric NOT NULL,
    bonus_rate numeric(8,4) DEFAULT '0'::numeric NOT NULL,
    agent_role character varying(32) DEFAULT 'agent'::character varying NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    effective_from timestamp without time zone DEFAULT now() NOT NULL,
    effective_to timestamp without time zone,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: commission_tiers_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.commission_tiers_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: commission_tiers_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.commission_tiers_id_seq OWNED BY public.commission_tiers.id;


--
-- Name: communication_preferences; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.communication_preferences (
    id integer NOT NULL,
    user_id integer,
    email_enabled boolean DEFAULT true,
    sms_enabled boolean DEFAULT true,
    push_enabled boolean DEFAULT true,
    whatsapp_enabled boolean DEFAULT false,
    telegram_enabled boolean DEFAULT false,
    frequency character varying(20) DEFAULT 'immediate'::character varying,
    language character varying(10) DEFAULT 'en'::character varying,
    quiet_hours_start time without time zone,
    quiet_hours_end time without time zone,
    updated_at timestamp without time zone DEFAULT now()
);


--
-- Name: communication_preferences_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.communication_preferences_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: communication_preferences_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.communication_preferences_id_seq OWNED BY public.communication_preferences.id;


--
-- Name: compliance_checks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.compliance_checks (
    id integer NOT NULL,
    agent_id integer,
    transaction_id integer,
    check_type text NOT NULL,
    rule_code text NOT NULL,
    result text NOT NULL,
    details text,
    flagged_amount numeric(15,2),
    reported_to_regulator boolean DEFAULT false,
    reported_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: compliance_checks_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.compliance_checks_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: compliance_checks_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.compliance_checks_id_seq OWNED BY public.compliance_checks.id;


--
-- Name: compliance_filings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.compliance_filings (
    id integer NOT NULL,
    filing_type text NOT NULL,
    reference_number text NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    reporting_period text,
    submitted_to text,
    submitted_at timestamp without time zone,
    acknowledged_at timestamp without time zone,
    total_transactions integer DEFAULT 0,
    total_amount numeric(15,2),
    flagged_count integer DEFAULT 0,
    filing_data text,
    prepared_by integer,
    reviewed_by integer,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: compliance_filings_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.compliance_filings_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: compliance_filings_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.compliance_filings_id_seq OWNED BY public.compliance_filings.id;


--
-- Name: compliance_reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.compliance_reports (
    id integer NOT NULL,
    "periodStart" timestamp without time zone,
    "periodEnd" timestamp without time zone,
    "totalAlerts" integer DEFAULT 0 NOT NULL,
    "highAlerts" integer DEFAULT 0 NOT NULL,
    "mediumAlerts" integer DEFAULT 0 NOT NULL,
    "lowAlerts" integer DEFAULT 0 NOT NULL,
    "escalatedAlerts" integer DEFAULT 0 NOT NULL,
    "resolvedAlerts" integer DEFAULT 0 NOT NULL,
    "topOffendersJson" json,
    "pdfUrl" text,
    "pdfKey" character varying(256),
    "generatedBy" character varying(64),
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL,
    "reportType" character varying(64) DEFAULT 'compliance'::character varying,
    period character varying(32) DEFAULT ''::character varying,
    status character varying(32) DEFAULT 'draft'::character varying NOT NULL,
    "fileUrl" text,
    summary json,
    "tenantId" integer,
    "updatedAt" timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: compliance_reports_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.compliance_reports_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: compliance_reports_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.compliance_reports_id_seq OWNED BY public.compliance_reports.id;


--
-- Name: connectivity_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.connectivity_log (
    id integer NOT NULL,
    "agentCode" character varying(32) NOT NULL,
    quality public.connectivity_quality NOT NULL,
    "latencyMs" integer,
    "recordedAt" timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: connectivity_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.connectivity_log_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: connectivity_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.connectivity_log_id_seq OWNED BY public.connectivity_log.id;


--
-- Name: credit_applications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.credit_applications (
    id integer NOT NULL,
    "agentId" integer NOT NULL,
    "requestedAmount" numeric(15,2) NOT NULL,
    "approvedAmount" numeric(15,2),
    "interestRate" numeric(5,4) DEFAULT 0.05,
    "termDays" integer DEFAULT 30 NOT NULL,
    status public.credit_application_status DEFAULT 'pending'::public.credit_application_status NOT NULL,
    "scoreAtApplication" integer,
    "reviewedBy" character varying(64),
    "reviewNote" text,
    "reviewedAt" timestamp without time zone,
    "disbursedAt" timestamp without time zone,
    "dueAt" timestamp without time zone,
    "repaidAt" timestamp without time zone,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: credit_applications_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.credit_applications_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: credit_applications_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.credit_applications_id_seq OWNED BY public.credit_applications.id;


--
-- Name: credit_score_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.credit_score_history (
    id integer NOT NULL,
    "agentId" integer NOT NULL,
    score integer NOT NULL,
    rating public.credit_rating NOT NULL,
    factors json DEFAULT '{}'::json,
    "computedAt" timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: credit_score_history_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.credit_score_history_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: credit_score_history_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.credit_score_history_id_seq OWNED BY public.credit_score_history.id;


--
-- Name: currency_rates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.currency_rates (
    id integer NOT NULL,
    from_currency character varying(5) NOT NULL,
    to_currency character varying(5) NOT NULL,
    rate numeric(12,8) NOT NULL,
    source character varying(50) DEFAULT 'CBN'::character varying,
    last_updated timestamp without time zone DEFAULT now()
);


--
-- Name: currency_rates_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.currency_rates_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: currency_rates_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.currency_rates_id_seq OWNED BY public.currency_rates.id;


--
-- Name: customer_feedback; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customer_feedback (
    id integer NOT NULL,
    "userId" integer NOT NULL,
    "feedbackType" character varying(64),
    subject character varying(255),
    message text,
    rating integer,
    status character varying(32) DEFAULT 'Open'::character varying,
    "ticketId" character varying(128),
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: customer_feedback_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.customer_feedback_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: customer_feedback_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.customer_feedback_id_seq OWNED BY public.customer_feedback.id;


--
-- Name: customer_feedback_userId_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."customer_feedback_userId_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: customer_feedback_userId_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."customer_feedback_userId_seq" OWNED BY public.customer_feedback."userId";


--
-- Name: customer_journey_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customer_journey_events (
    id integer NOT NULL,
    customer_id text NOT NULL,
    event_type text NOT NULL,
    event_source text NOT NULL,
    event_data text,
    session_id text,
    device_type text,
    channel text,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: customer_journey_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.customer_journey_events_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: customer_journey_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.customer_journey_events_id_seq OWNED BY public.customer_journey_events.id;


--
-- Name: customer_journey_steps; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customer_journey_steps (
    id integer NOT NULL,
    customer_id integer NOT NULL,
    step_type text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    completed_at timestamp without time zone,
    metadata text,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: customer_journey_steps_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.customer_journey_steps_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: customer_journey_steps_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.customer_journey_steps_id_seq OWNED BY public.customer_journey_steps.id;


--
-- Name: customers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customers (
    id integer NOT NULL,
    "externalId" character varying(128),
    "firstName" character varying(64) NOT NULL,
    "lastName" character varying(64) NOT NULL,
    email character varying(320),
    phone character varying(20) NOT NULL,
    bvn character varying(11),
    nin character varying(11),
    "dateOfBirth" character varying(10),
    address text,
    status public.customer_status DEFAULT 'pending_kyc'::public.customer_status NOT NULL,
    "kycLevel" integer DEFAULT 0 NOT NULL,
    "walletBalance" numeric(15,2) DEFAULT 0.00 NOT NULL,
    "dailyLimit" numeric(15,2) DEFAULT 50000.00 NOT NULL,
    "monthlyLimit" numeric(15,2) DEFAULT 300000.00 NOT NULL,
    "preferredAgentId" integer,
    "keycloakSub" character varying(128),
    "passwordHash" character varying(256),
    "refreshToken" text,
    "lastLoginAt" timestamp without time zone,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp without time zone DEFAULT now() NOT NULL,
    "deletedAt" timestamp without time zone,
    "tenantId" integer
);


--
-- Name: customers_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.customers_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: customers_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.customers_id_seq OWNED BY public.customers.id;


--
-- Name: data_consent_records; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.data_consent_records (
    id integer NOT NULL,
    entity_type text NOT NULL,
    entity_id integer NOT NULL,
    consent_type text NOT NULL,
    granted boolean NOT NULL,
    granted_at timestamp without time zone,
    revoked_at timestamp without time zone,
    ip_address text,
    user_agent text,
    version integer DEFAULT 1,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: data_consent_records_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.data_consent_records_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: data_consent_records_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.data_consent_records_id_seq OWNED BY public.data_consent_records.id;


--
-- Name: data_export_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.data_export_jobs (
    id integer NOT NULL,
    name text NOT NULL,
    export_type text NOT NULL,
    format text DEFAULT 'csv'::text NOT NULL,
    filters text,
    status text DEFAULT 'pending'::text NOT NULL,
    file_url text,
    file_size integer,
    record_count integer,
    requested_by text NOT NULL,
    started_at timestamp without time zone,
    completed_at timestamp without time zone,
    expires_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: data_export_jobs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.data_export_jobs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: data_export_jobs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.data_export_jobs_id_seq OWNED BY public.data_export_jobs.id;


--
-- Name: data_rights_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.data_rights_requests (
    id integer NOT NULL,
    "requestType" character varying(32) NOT NULL,
    "requesterId" integer,
    "requesterType" character varying(32) NOT NULL,
    "requesterEmail" character varying(320) NOT NULL,
    status character varying(32) DEFAULT 'pending'::character varying NOT NULL,
    "exportFileUrl" text,
    "processedBy" character varying(64),
    "processedAt" timestamp without time zone,
    notes text,
    "tenantId" integer,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: data_rights_requests_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.data_rights_requests_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: data_rights_requests_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.data_rights_requests_id_seq OWNED BY public.data_rights_requests.id;


--
-- Name: db_scaling_metrics; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.db_scaling_metrics (
    id integer NOT NULL,
    metric_name character varying(100) NOT NULL,
    current_value numeric(15,2),
    threshold_value numeric(15,2),
    recommendation text,
    priority character varying(10),
    category character varying(30),
    measured_at timestamp without time zone DEFAULT now()
);


--
-- Name: db_scaling_metrics_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.db_scaling_metrics_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: db_scaling_metrics_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.db_scaling_metrics_id_seq OWNED BY public.db_scaling_metrics.id;


--
-- Name: device_commands; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.device_commands (
    id integer NOT NULL,
    "deviceId" integer NOT NULL,
    command character varying(64) NOT NULL,
    payload json,
    status character varying(32) DEFAULT 'pending'::character varying NOT NULL,
    "issuedBy" character varying(64),
    "issuedAt" timestamp without time zone DEFAULT now(),
    "acknowledgedAt" timestamp without time zone,
    "completedAt" timestamp without time zone,
    "errorMessage" text,
    "executedAt" timestamp without time zone,
    result json,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: device_commands_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.device_commands_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: device_commands_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.device_commands_id_seq OWNED BY public.device_commands.id;


--
-- Name: device_compliance_policies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.device_compliance_policies (
    id integer NOT NULL,
    name character varying(128) NOT NULL,
    description text,
    "tenantId" integer,
    rules json NOT NULL,
    severity character varying(16) DEFAULT 'medium'::character varying NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    "enforcementAction" character varying(32) DEFAULT 'notify'::character varying,
    "createdBy" character varying(64),
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: device_compliance_policies_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.device_compliance_policies_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: device_compliance_policies_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.device_compliance_policies_id_seq OWNED BY public.device_compliance_policies.id;


--
-- Name: device_compliance_violations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.device_compliance_violations (
    id integer NOT NULL,
    "deviceId" integer NOT NULL,
    "policyId" integer NOT NULL,
    "serialNumber" character varying(64) NOT NULL,
    "agentCode" character varying(32),
    "violationType" character varying(64) NOT NULL,
    severity character varying(16) NOT NULL,
    details json,
    status character varying(32) DEFAULT 'open'::character varying NOT NULL,
    "enforcementAction" character varying(32),
    "resolvedAt" timestamp without time zone,
    "resolvedBy" character varying(64),
    "detectedAt" timestamp without time zone DEFAULT now() NOT NULL,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: device_compliance_violations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.device_compliance_violations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: device_compliance_violations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.device_compliance_violations_id_seq OWNED BY public.device_compliance_violations.id;


--
-- Name: device_locations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.device_locations (
    id integer NOT NULL,
    "deviceId" integer NOT NULL,
    "agentId" integer,
    latitude numeric(10,7),
    longitude numeric(10,7),
    accuracy numeric(8,2),
    "withinZone" boolean DEFAULT true,
    "reportedAt" timestamp without time zone DEFAULT now(),
    lat numeric(10,7),
    lng numeric(10,7),
    altitude numeric(8,2),
    speed numeric(6,2),
    heading numeric(6,2),
    source character varying(32) DEFAULT 'gps'::character varying,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: device_locations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.device_locations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: device_locations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.device_locations_id_seq OWNED BY public.device_locations.id;


--
-- Name: devices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.devices (
    id integer NOT NULL,
    "agentId" integer,
    "serialNumber" character varying(64) NOT NULL,
    model character varying(64) DEFAULT 'PAX A920 MAX'::character varying,
    "osVersion" character varying(32),
    "appVersion" character varying(32),
    "firmwareVersion" character varying(32),
    "ipAddress" character varying(45),
    location character varying(128),
    status character varying(32) DEFAULT 'active'::character varying NOT NULL,
    "configJson" json,
    "lastSeenAt" timestamp without time zone,
    "enrolledAt" timestamp without time zone DEFAULT now(),
    "updatedAt" timestamp without time zone DEFAULT now() NOT NULL,
    "enrollmentToken" character varying(128),
    "enrollmentExpiresAt" timestamp without time zone,
    "deviceToken" character varying(64),
    imei character varying(20),
    "simIccid" character varying(22),
    "lastLocation" json,
    "deletedAt" timestamp without time zone,
    "tenantId" integer,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL,
    "batteryLevel" integer,
    "batteryCharging" boolean DEFAULT false,
    "wifiSsid" character varying(64),
    "wifiRssi" integer,
    "wifiIpAddress" character varying(45),
    "networkType" character varying(16),
    "screenshotUrl" text,
    "lastScreenshotAt" timestamp without time zone,
    "complianceStatus" character varying(32) DEFAULT 'unknown'::character varying,
    "lastComplianceCheckAt" timestamp without time zone
);


--
-- Name: devices_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.devices_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: devices_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.devices_id_seq OWNED BY public.devices.id;


--
-- Name: disaster_recovery_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.disaster_recovery_config (
    id integer NOT NULL,
    component character varying(100) NOT NULL,
    rto_hours numeric(5,1) NOT NULL,
    rpo_hours numeric(5,1) NOT NULL,
    replication_lag_seconds numeric(6,2),
    last_test_date date,
    last_test_result character varying(20),
    backup_location character varying(200),
    failover_type character varying(30),
    status character varying(20) DEFAULT 'healthy'::character varying,
    updated_at timestamp without time zone DEFAULT now()
);


--
-- Name: disaster_recovery_config_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.disaster_recovery_config_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: disaster_recovery_config_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.disaster_recovery_config_id_seq OWNED BY public.disaster_recovery_config.id;


--
-- Name: dispute_evidence; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dispute_evidence (
    id integer NOT NULL,
    dispute_id integer NOT NULL,
    file_name character varying(256) NOT NULL,
    file_url text NOT NULL,
    file_key character varying(256) NOT NULL,
    mime_type character varying(64),
    file_size integer,
    uploaded_by character varying(64) NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: dispute_evidence_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.dispute_evidence_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: dispute_evidence_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.dispute_evidence_id_seq OWNED BY public.dispute_evidence.id;


--
-- Name: dispute_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dispute_messages (
    id integer NOT NULL,
    "disputeId" integer NOT NULL,
    "authorId" integer,
    "authorName" character varying(128),
    "authorRole" character varying(32),
    message text,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL,
    "senderType" character varying(32),
    "senderName" character varying(128),
    content text,
    "attachmentUrl" text
);


--
-- Name: dispute_messages_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.dispute_messages_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: dispute_messages_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.dispute_messages_id_seq OWNED BY public.dispute_messages.id;


--
-- Name: disputes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.disputes (
    id integer NOT NULL,
    ref character varying(32) NOT NULL,
    "transactionId" integer,
    "transactionRef" character varying(32),
    "agentId" integer NOT NULL,
    reason character varying(256),
    evidence text,
    status character varying(32) DEFAULT 'open'::character varying NOT NULL,
    resolution text,
    "resolvedBy" character varying(64),
    "resolvedAt" timestamp without time zone,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp without time zone DEFAULT now() NOT NULL,
    "slaDeadlineAt" timestamp without time zone,
    type character varying(64) DEFAULT 'general'::character varying,
    priority character varying(16) DEFAULT 'medium'::character varying NOT NULL,
    description text DEFAULT ''::text,
    "assignedTo" character varying(64),
    "deletedAt" timestamp without time zone,
    "tenantId" integer,
    amount numeric(15,2) DEFAULT '0'::numeric,
    "createdBy" character varying(64)
);


--
-- Name: disputes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.disputes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: disputes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.disputes_id_seq OWNED BY public.disputes.id;


--
-- Name: dlq_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dlq_messages (
    id integer NOT NULL,
    topic character varying(128) NOT NULL,
    partition integer DEFAULT 0 NOT NULL,
    "offset" character varying(32) DEFAULT '0'::character varying NOT NULL,
    "errorMessage" text DEFAULT ''::text NOT NULL,
    "retryCount" integer DEFAULT 0 NOT NULL,
    payload text DEFAULT '{}'::text NOT NULL,
    status character varying(32) DEFAULT 'pending_retry'::character varying NOT NULL,
    "resolvedAt" timestamp without time zone,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: dlq_messages_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.dlq_messages_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: dlq_messages_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.dlq_messages_id_seq OWNED BY public.dlq_messages.id;


--
-- Name: documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.documents (
    id integer NOT NULL,
    "userId" integer NOT NULL,
    "entityType" character varying(64) NOT NULL,
    "entityId" integer,
    "documentType" character varying(64) NOT NULL,
    "fileName" character varying(255) NOT NULL,
    "fileUrl" text NOT NULL,
    "fileSize" integer,
    "mimeType" character varying(128),
    status character varying(32) DEFAULT 'Active'::character varying,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: documents_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.documents_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: documents_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.documents_id_seq OWNED BY public.documents.id;


--
-- Name: documents_userId_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."documents_userId_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: documents_userId_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."documents_userId_seq" OWNED BY public.documents."userId";


--
-- Name: dynamic_pricing_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dynamic_pricing_history (
    id integer NOT NULL,
    "userId" integer NOT NULL,
    "productType" character varying(64) NOT NULL,
    "basePremium" numeric(10,2),
    "adjustedPremium" numeric(10,2),
    "riskScore" integer,
    "quoteId" character varying(128),
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: dynamic_pricing_history_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.dynamic_pricing_history_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: dynamic_pricing_history_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.dynamic_pricing_history_id_seq OWNED BY public.dynamic_pricing_history.id;


--
-- Name: dynamic_pricing_history_userId_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."dynamic_pricing_history_userId_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: dynamic_pricing_history_userId_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."dynamic_pricing_history_userId_seq" OWNED BY public.dynamic_pricing_history."userId";


--
-- Name: email_delivery_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_delivery_log (
    id bigint NOT NULL,
    email_queue_id integer,
    provider public.email_provider NOT NULL,
    provider_message_id character varying(128),
    to_address character varying(320) NOT NULL,
    subject character varying(256) NOT NULL,
    status character varying(32) DEFAULT 'sent'::character varying NOT NULL,
    opened_at timestamp without time zone,
    clicked_at timestamp without time zone,
    bounced_at timestamp without time zone,
    error_message text,
    metadata json DEFAULT '{}'::json,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: email_delivery_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.email_delivery_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: email_delivery_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.email_delivery_log_id_seq OWNED BY public.email_delivery_log.id;


--
-- Name: email_queue; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_queue (
    id bigint NOT NULL,
    "toAddress" character varying(320) NOT NULL,
    "toName" character varying(128),
    subject character varying(256) NOT NULL,
    "templateName" character varying(64) NOT NULL,
    "templateData" json DEFAULT '{}'::json,
    status public.email_status DEFAULT 'queued'::public.email_status NOT NULL,
    "sentAt" timestamp without time zone,
    "errorMessage" text,
    "retryCount" integer DEFAULT 0 NOT NULL,
    "tenantId" integer,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: email_queue_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.email_queue_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: email_queue_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.email_queue_id_seq OWNED BY public.email_queue.id;


--
-- Name: embedded_distribution; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.embedded_distribution (
    id integer NOT NULL,
    channel_name character varying(100) NOT NULL,
    partner_name character varying(100) NOT NULL,
    integration_type character varying(30) NOT NULL,
    product_types text[],
    monthly_policies integer DEFAULT 0,
    monthly_premium numeric(15,2) DEFAULT 0,
    commission_rate numeric(4,2) DEFAULT 0,
    status character varying(20) DEFAULT 'active'::character varying,
    api_version character varying(10),
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: embedded_distribution_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.embedded_distribution_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: embedded_distribution_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.embedded_distribution_id_seq OWNED BY public.embedded_distribution.id;


--
-- Name: embedded_partners; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.embedded_partners (
    id integer NOT NULL,
    name character varying(100),
    type character varying(50),
    integration_type character varying(50),
    api_endpoint character varying(255),
    status character varying(20) DEFAULT 'active'::character varying,
    monthly_revenue numeric(12,2) DEFAULT 0,
    total_policies integer DEFAULT 0,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: embedded_partners_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.embedded_partners_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: embedded_partners_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.embedded_partners_id_seq OWNED BY public.embedded_partners.id;


--
-- Name: emergency_incidents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.emergency_incidents (
    id integer NOT NULL,
    "userId" integer NOT NULL,
    "incidentType" character varying(64) NOT NULL,
    latitude numeric(10,7),
    longitude numeric(10,7),
    description text,
    status character varying(32) DEFAULT 'Dispatched'::character varying,
    "emergencyServices" text[],
    "resolvedAt" timestamp without time zone,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: emergency_incidents_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.emergency_incidents_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: emergency_incidents_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.emergency_incidents_id_seq OWNED BY public.emergency_incidents.id;


--
-- Name: emergency_incidents_userId_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."emergency_incidents_userId_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: emergency_incidents_userId_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."emergency_incidents_userId_seq" OWNED BY public.emergency_incidents."userId";


--
-- Name: encrypted_fields; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.encrypted_fields (
    id integer NOT NULL,
    table_name text NOT NULL,
    field_name text NOT NULL,
    encryption_key_id text NOT NULL,
    algorithm text DEFAULT 'AES-256-GCM'::text NOT NULL,
    last_rotated_at timestamp without time zone,
    is_active boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: encrypted_fields_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.encrypted_fields_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: encrypted_fields_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.encrypted_fields_id_seq OWNED BY public.encrypted_fields.id;


--
-- Name: erp_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.erp_config (
    id integer NOT NULL,
    "erpType" public.erp_type DEFAULT 'odoo'::public.erp_type NOT NULL,
    name character varying(128) DEFAULT 'Default ERP'::character varying NOT NULL,
    "baseUrl" text DEFAULT ''::text NOT NULL,
    "apiKey" text DEFAULT ''::text,
    username character varying(128) DEFAULT ''::character varying,
    database character varying(128) DEFAULT ''::character varying,
    "fieldMappings" json DEFAULT '{}'::json,
    "syncEnabled" boolean DEFAULT false NOT NULL,
    "syncIntervalMinutes" integer DEFAULT 60 NOT NULL,
    "syncTransactions" boolean DEFAULT true NOT NULL,
    "syncAgents" boolean DEFAULT false NOT NULL,
    "syncInventory" boolean DEFAULT false NOT NULL,
    "lastSyncAt" timestamp without time zone,
    "lastSyncStatus" character varying(32) DEFAULT 'never'::character varying,
    "lastSyncError" text,
    "lastSyncCount" integer DEFAULT 0,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: erp_config_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.erp_config_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: erp_config_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.erp_config_id_seq OWNED BY public.erp_config.id;


--
-- Name: erp_sync_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.erp_sync_log (
    id integer NOT NULL,
    "entityType" character varying(64) NOT NULL,
    "entityId" character varying(64) NOT NULL,
    "erpDocType" character varying(64),
    "erpDocName" character varying(128),
    status public.erp_sync_status DEFAULT 'pending'::public.erp_sync_status NOT NULL,
    "errorMessage" text,
    payload json,
    "syncedAt" timestamp without time zone,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL,
    "retryCount" integer DEFAULT 0 NOT NULL,
    "maxRetries" integer DEFAULT 5 NOT NULL,
    "nextRetryAt" timestamp without time zone
);


--
-- Name: erp_sync_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.erp_sync_log_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: erp_sync_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.erp_sync_log_id_seq OWNED BY public.erp_sync_log.id;


--
-- Name: erpnext_reconciliation; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.erpnext_reconciliation (
    id integer NOT NULL,
    "userId" integer NOT NULL,
    period character varying(7) NOT NULL,
    "localAmount" numeric(15,2) NOT NULL,
    "erpAmount" numeric(15,2) NOT NULL,
    variance numeric(15,2) NOT NULL,
    status character varying(32) DEFAULT 'Pending'::character varying NOT NULL,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: erpnext_reconciliation_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.erpnext_reconciliation_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: erpnext_reconciliation_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.erpnext_reconciliation_id_seq OWNED BY public.erpnext_reconciliation.id;


--
-- Name: erpnext_reconciliation_userId_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."erpnext_reconciliation_userId_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: erpnext_reconciliation_userId_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."erpnext_reconciliation_userId_seq" OWNED BY public.erpnext_reconciliation."userId";


--
-- Name: erpnext_transactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.erpnext_transactions (
    id integer NOT NULL,
    "userId" integer NOT NULL,
    "erpDocType" character varying(64) NOT NULL,
    "erpDocId" character varying(128) NOT NULL,
    "localEntityType" character varying(64) NOT NULL,
    "localEntityId" character varying(128) NOT NULL,
    "syncStatus" public.erpnext_sync_status DEFAULT 'Pending'::public.erpnext_sync_status NOT NULL,
    amount numeric(15,2),
    currency character varying(8) DEFAULT 'NGN'::character varying,
    "lastSyncAt" timestamp without time zone,
    "errorMessage" text,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: erpnext_transactions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.erpnext_transactions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: erpnext_transactions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.erpnext_transactions_id_seq OWNED BY public.erpnext_transactions.id;


--
-- Name: erpnext_transactions_userId_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."erpnext_transactions_userId_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: erpnext_transactions_userId_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."erpnext_transactions_userId_seq" OWNED BY public.erpnext_transactions."userId";


--
-- Name: face_enrollments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.face_enrollments (
    id integer NOT NULL,
    "userId" integer NOT NULL,
    "enrollmentType" character varying(32) DEFAULT 'kyc'::character varying NOT NULL,
    "embeddingVector" text NOT NULL,
    "embeddingVersion" character varying(32) DEFAULT 'arcface_w600k_r50'::character varying NOT NULL,
    "qualityScore" numeric(5,4),
    "livenessScore" numeric(5,4),
    "antiSpoofScore" numeric(5,4),
    "sourceImageHash" character varying(128),
    "deviceFingerprint" character varying(256),
    "ipAddress" character varying(64),
    "isActive" boolean DEFAULT true NOT NULL,
    "revokedAt" timestamp without time zone,
    "revokedReason" text,
    "expiresAt" timestamp without time zone,
    "tenantId" integer,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: face_enrollments_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.face_enrollments_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: face_enrollments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.face_enrollments_id_seq OWNED BY public.face_enrollments.id;


--
-- Name: family_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.family_members (
    id integer NOT NULL,
    "userId" integer NOT NULL,
    "memberName" character varying(255) NOT NULL,
    relationship character varying(64) NOT NULL,
    "dateOfBirth" timestamp without time zone,
    gender character varying(16),
    "coveredPolicyId" integer,
    status character varying(32) DEFAULT 'Active'::character varying,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: family_members_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.family_members_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: family_members_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.family_members_id_seq OWNED BY public.family_members.id;


--
-- Name: family_members_userId_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."family_members_userId_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: family_members_userId_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."family_members_userId_seq" OWNED BY public.family_members."userId";


--
-- Name: fee_audit_trail; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fee_audit_trail (
    id integer NOT NULL,
    transaction_id integer,
    fee_rule_id integer,
    tx_amount numeric(15,2) NOT NULL,
    calculated_fee numeric(15,2) NOT NULL,
    applied_fee numeric(15,2) NOT NULL,
    waiver_applied boolean DEFAULT false,
    waiver_reason text,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: fee_audit_trail_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.fee_audit_trail_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: fee_audit_trail_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.fee_audit_trail_id_seq OWNED BY public.fee_audit_trail.id;


--
-- Name: fee_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fee_rules (
    id integer NOT NULL,
    name text NOT NULL,
    tx_type text NOT NULL,
    agent_tier text,
    min_amount numeric(15,2) DEFAULT '0'::numeric,
    max_amount numeric(15,2),
    fee_type text NOT NULL,
    fee_value numeric(10,4) NOT NULL,
    min_fee numeric(15,2),
    max_fee numeric(15,2),
    is_promotional boolean DEFAULT false,
    promo_start_date timestamp without time zone,
    promo_end_date timestamp without time zone,
    is_active boolean DEFAULT true,
    priority integer DEFAULT 0,
    created_by integer,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);


--
-- Name: fee_rules_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.fee_rules_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: fee_rules_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.fee_rules_id_seq OWNED BY public.fee_rules.id;


--
-- Name: fido2_challenges; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fido2_challenges (
    id integer NOT NULL,
    challenge character varying(128) NOT NULL,
    "userId" integer,
    "agentId" integer,
    type character varying(32) NOT NULL,
    "expiresAt" timestamp without time zone NOT NULL,
    "usedAt" timestamp without time zone,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: fido2_challenges_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.fido2_challenges_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: fido2_challenges_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.fido2_challenges_id_seq OWNED BY public.fido2_challenges.id;


--
-- Name: fido2_credentials; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fido2_credentials (
    id integer NOT NULL,
    "userId" integer,
    "agentId" integer,
    "credentialId" text NOT NULL,
    "publicKey" text NOT NULL,
    counter integer DEFAULT 0 NOT NULL,
    "deviceType" character varying(64),
    transports json DEFAULT '[]'::json,
    status public.fido2_status DEFAULT 'active'::public.fido2_status NOT NULL,
    "lastUsedAt" timestamp without time zone,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: fido2_credentials_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.fido2_credentials_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: fido2_credentials_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.fido2_credentials_id_seq OWNED BY public.fido2_credentials.id;


--
-- Name: file_uploads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.file_uploads (
    id integer NOT NULL,
    "userId" integer,
    "tenantId" character varying(50) DEFAULT 'default'::character varying,
    filename character varying(500) NOT NULL,
    "originalName" character varying(500) NOT NULL,
    "mimeType" character varying(100),
    size integer,
    "storageKey" character varying(1000) NOT NULL,
    "storageProvider" character varying(20) DEFAULT 'local'::character varying,
    "entityType" character varying(50),
    "entityId" integer,
    url text,
    "createdAt" timestamp without time zone DEFAULT now()
);


--
-- Name: file_uploads_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.file_uploads_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: file_uploads_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.file_uploads_id_seq OWNED BY public.file_uploads.id;


--
-- Name: financial_metrics; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.financial_metrics (
    id integer NOT NULL,
    metric_name character varying(100) NOT NULL,
    metric_type character varying(30) NOT NULL,
    period character varying(20) NOT NULL,
    value numeric(18,2) NOT NULL,
    previous_value numeric(18,2),
    target_value numeric(18,2),
    variance_pct numeric(6,2),
    category character varying(50),
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: financial_metrics_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.financial_metrics_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: financial_metrics_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.financial_metrics_id_seq OWNED BY public.financial_metrics.id;


--
-- Name: financial_transactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.financial_transactions (
    id integer NOT NULL,
    "transactionType" character varying(50) NOT NULL,
    "entityType" character varying(50),
    "entityId" integer,
    "debitAccount" character varying(100),
    "creditAccount" character varying(100),
    amount numeric(15,2) NOT NULL,
    currency character varying(3) DEFAULT 'NGN'::character varying,
    description text,
    "transactionDate" date DEFAULT CURRENT_DATE,
    "createdAt" timestamp without time zone DEFAULT now()
);


--
-- Name: financial_transactions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.financial_transactions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: financial_transactions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.financial_transactions_id_seq OWNED BY public.financial_transactions.id;


--
-- Name: float_reconciliations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.float_reconciliations (
    id integer NOT NULL,
    agent_id integer NOT NULL,
    date timestamp without time zone NOT NULL,
    expected_balance numeric(15,2) NOT NULL,
    actual_balance numeric(15,2) NOT NULL,
    discrepancy numeric(15,2) NOT NULL,
    status text DEFAULT 'pending'::text,
    resolved_by integer,
    resolved_at timestamp without time zone,
    notes text,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: float_reconciliations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.float_reconciliations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: float_reconciliations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.float_reconciliations_id_seq OWNED BY public.float_reconciliations.id;


--
-- Name: float_topup_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.float_topup_requests (
    id integer NOT NULL,
    "agentId" integer NOT NULL,
    "requestedAmount" numeric(15,2) NOT NULL,
    status public.topup_status DEFAULT 'pending'::public.topup_status NOT NULL,
    "approvedBy" character varying(64),
    notes text,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp without time zone DEFAULT now() NOT NULL,
    "supervisorApprovalRequired" boolean DEFAULT false NOT NULL,
    "supervisorApprovedBy" character varying(64),
    "supervisorApprovedAt" timestamp without time zone,
    "tenantId" integer
);


--
-- Name: float_topup_requests_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.float_topup_requests_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: float_topup_requests_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.float_topup_requests_id_seq OWNED BY public.float_topup_requests.id;


--
-- Name: fraud_alerts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fraud_alerts (
    id integer NOT NULL,
    "userId" integer NOT NULL,
    "alertId" character varying(64) NOT NULL,
    severity public.risk_level NOT NULL,
    "entityType" character varying(64) NOT NULL,
    "entityId" character varying(128) NOT NULL,
    message text NOT NULL,
    resolved boolean DEFAULT false NOT NULL,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL,
    "resolvedAt" timestamp without time zone,
    "snoozedUntil" timestamp without time zone,
    "escalatedAt" timestamp without time zone,
    "escalatedTo" character varying(64),
    "deletedAt" timestamp without time zone,
    "tenantId" integer
);


--
-- Name: fraud_alerts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.fraud_alerts_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: fraud_alerts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.fraud_alerts_id_seq OWNED BY public.fraud_alerts.id;


--
-- Name: fraud_alerts_userId_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."fraud_alerts_userId_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: fraud_alerts_userId_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."fraud_alerts_userId_seq" OWNED BY public.fraud_alerts."userId";


--
-- Name: fraud_ml_scores; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fraud_ml_scores (
    id integer NOT NULL,
    transaction_id integer,
    agent_id integer,
    risk_score numeric(5,2) NOT NULL,
    model_version text NOT NULL,
    features text,
    prediction text NOT NULL,
    confidence numeric(5,4),
    false_positive boolean DEFAULT false,
    reviewed_by integer,
    reviewed_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: fraud_ml_scores_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.fraud_ml_scores_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: fraud_ml_scores_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.fraud_ml_scores_id_seq OWNED BY public.fraud_ml_scores.id;


--
-- Name: fraud_rings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fraud_rings (
    id integer NOT NULL,
    "userId" integer NOT NULL,
    "ringId" character varying(64) NOT NULL,
    name character varying(255) NOT NULL,
    status character varying(32) DEFAULT 'active'::character varying NOT NULL,
    "memberCount" integer DEFAULT 0 NOT NULL,
    "totalLoss" numeric(15,2) DEFAULT '0'::numeric,
    "detectedAt" timestamp without time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: fraud_rings_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.fraud_rings_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: fraud_rings_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.fraud_rings_id_seq OWNED BY public.fraud_rings.id;


--
-- Name: fraud_rings_userId_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."fraud_rings_userId_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: fraud_rings_userId_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."fraud_rings_userId_seq" OWNED BY public.fraud_rings."userId";


--
-- Name: fraud_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fraud_rules (
    id integer NOT NULL,
    name character varying(128) NOT NULL,
    category public.fraud_rule_category NOT NULL,
    description text,
    threshold numeric(5,4) DEFAULT 0.7000 NOT NULL,
    "windowSeconds" integer DEFAULT 3600,
    "maxCount" integer DEFAULT 5,
    enabled boolean DEFAULT true NOT NULL,
    "hitCount" integer DEFAULT 0 NOT NULL,
    "lastHitAt" timestamp without time zone,
    "createdBy" character varying(64),
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: fraud_rules_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.fraud_rules_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: fraud_rules_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.fraud_rules_id_seq OWNED BY public.fraud_rules.id;


--
-- Name: fraud_scores; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fraud_scores (
    id integer NOT NULL,
    "userId" integer NOT NULL,
    "scoreId" character varying(64) NOT NULL,
    "entityType" character varying(64) NOT NULL,
    "entityId" character varying(128) NOT NULL,
    score numeric(5,4) NOT NULL,
    "riskLevel" public.risk_level NOT NULL,
    decision public.fraud_decision NOT NULL,
    confidence numeric(5,4) NOT NULL,
    "processingTime" integer NOT NULL,
    "topFactors" text[],
    "matchedRules" text[],
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: fraud_scores_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.fraud_scores_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: fraud_scores_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.fraud_scores_id_seq OWNED BY public.fraud_scores.id;


--
-- Name: fraud_scores_processingTime_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."fraud_scores_processingTime_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: fraud_scores_processingTime_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."fraud_scores_processingTime_seq" OWNED BY public.fraud_scores."processingTime";


--
-- Name: fraud_scores_userId_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."fraud_scores_userId_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: fraud_scores_userId_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."fraud_scores_userId_seq" OWNED BY public.fraud_scores."userId";


--
-- Name: gamification_levels; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.gamification_levels (
    id integer NOT NULL,
    level_name character varying(50) NOT NULL,
    level_number integer NOT NULL,
    points_required integer NOT NULL,
    badge_icon character varying(50),
    perks text[],
    description text
);


--
-- Name: gamification_levels_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.gamification_levels_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: gamification_levels_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.gamification_levels_id_seq OWNED BY public.gamification_levels.id;


--
-- Name: geo_fences; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.geo_fences (
    id integer NOT NULL,
    name text NOT NULL,
    region_code text NOT NULL,
    center_lat numeric(10,7) NOT NULL,
    center_lng numeric(10,7) NOT NULL,
    radius_km numeric(8,2) NOT NULL,
    is_active boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: geo_fences_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.geo_fences_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: geo_fences_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.geo_fences_id_seq OWNED BY public.geo_fences.id;


--
-- Name: geofence_zones; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.geofence_zones (
    id integer NOT NULL,
    name character varying(128) NOT NULL,
    description text,
    latitude numeric(10,7),
    longitude numeric(10,7),
    "radiusMetres" integer DEFAULT 500,
    "isActive" boolean DEFAULT true NOT NULL,
    "createdBy" character varying(64),
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp without time zone DEFAULT now() NOT NULL,
    type character varying(32) DEFAULT 'circle'::character varying NOT NULL,
    "centerLat" numeric(10,7),
    "centerLng" numeric(10,7),
    "radiusMeters" integer,
    "polygonJson" json
);


--
-- Name: geofence_zones_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.geofence_zones_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: geofence_zones_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.geofence_zones_id_seq OWNED BY public.geofence_zones.id;


--
-- Name: geospatial_zones; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.geospatial_zones (
    id integer NOT NULL,
    name character varying(100) NOT NULL,
    zone_type character varying(30) NOT NULL,
    risk_level character varying(20),
    policy_count integer DEFAULT 0,
    claims_count integer DEFAULT 0,
    loss_ratio numeric(5,2),
    latitude numeric(10,6),
    longitude numeric(10,6),
    polygon jsonb,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: geospatial_zones_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.geospatial_zones_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: geospatial_zones_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.geospatial_zones_id_seq OWNED BY public.geospatial_zones.id;


--
-- Name: gig_coverage_policies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.gig_coverage_policies (
    id integer NOT NULL,
    "userId" integer NOT NULL,
    "planId" character varying(64) NOT NULL,
    "planName" character varying(255),
    platform character varying(64),
    premium numeric(10,2),
    coverage numeric(15,2),
    status character varying(32) DEFAULT 'Active'::character varying,
    "activatedAt" timestamp without time zone DEFAULT now() NOT NULL,
    "expiresAt" timestamp without time zone,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: gig_coverage_policies_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.gig_coverage_policies_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: gig_coverage_policies_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.gig_coverage_policies_id_seq OWNED BY public.gig_coverage_policies.id;


--
-- Name: gig_coverage_policies_userId_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."gig_coverage_policies_userId_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: gig_coverage_policies_userId_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."gig_coverage_policies_userId_seq" OWNED BY public.gig_coverage_policies."userId";


--
-- Name: gl_accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.gl_accounts (
    id integer NOT NULL,
    account_code text NOT NULL,
    account_name text NOT NULL,
    account_type text NOT NULL,
    parent_account_id integer,
    currency text DEFAULT 'NGN'::text NOT NULL,
    balance integer DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true,
    description text,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone
);


--
-- Name: gl_accounts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.gl_accounts_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: gl_accounts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.gl_accounts_id_seq OWNED BY public.gl_accounts.id;


--
-- Name: gl_entries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.gl_entries (
    id integer NOT NULL,
    account_code text NOT NULL,
    account_name text NOT NULL,
    entry_type text NOT NULL,
    amount numeric(15,2) NOT NULL,
    currency text DEFAULT 'NGN'::text NOT NULL,
    reference text NOT NULL,
    description text,
    period_date timestamp without time zone NOT NULL,
    posted_by integer,
    is_reversed boolean DEFAULT false,
    reversal_ref text,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: gl_entries_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.gl_entries_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: gl_entries_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.gl_entries_id_seq OWNED BY public.gl_entries.id;


--
-- Name: gl_journal_entries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.gl_journal_entries (
    id integer NOT NULL,
    entry_number text NOT NULL,
    description text NOT NULL,
    debit_account_id integer NOT NULL,
    credit_account_id integer NOT NULL,
    amount integer NOT NULL,
    currency text DEFAULT 'NGN'::text NOT NULL,
    reference_type text,
    reference_id text,
    posted_by text,
    reversed_entry_id integer,
    status text DEFAULT 'posted'::text NOT NULL,
    posted_at timestamp without time zone DEFAULT now(),
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: gl_journal_entries_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.gl_journal_entries_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: gl_journal_entries_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.gl_journal_entries_id_seq OWNED BY public.gl_journal_entries.id;


--
-- Name: group_life_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.group_life_members (
    id integer NOT NULL,
    "schemeId" integer NOT NULL,
    "memberName" character varying(255) NOT NULL,
    "staffId" character varying(64),
    "dateOfBirth" timestamp without time zone,
    salary numeric(15,2),
    "sumAssured" numeric(15,2),
    status character varying(32) DEFAULT 'Active'::character varying,
    "enrolledAt" timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: group_life_members_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.group_life_members_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: group_life_members_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.group_life_members_id_seq OWNED BY public.group_life_members.id;


--
-- Name: group_life_members_schemeId_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."group_life_members_schemeId_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: group_life_members_schemeId_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."group_life_members_schemeId_seq" OWNED BY public.group_life_members."schemeId";


--
-- Name: group_life_schemes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.group_life_schemes (
    id integer NOT NULL,
    "userId" integer NOT NULL,
    "schemeName" character varying(255) NOT NULL,
    "employerName" character varying(255),
    "employerId" character varying(64),
    "schemeType" character varying(32) DEFAULT 'contributory'::character varying,
    "totalMembers" integer DEFAULT 0,
    "totalSumAssured" numeric(15,2),
    "annualPremium" numeric(15,2),
    status character varying(32) DEFAULT 'Active'::character varying,
    "renewalDate" timestamp without time zone,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: group_life_schemes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.group_life_schemes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: group_life_schemes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.group_life_schemes_id_seq OWNED BY public.group_life_schemes.id;


--
-- Name: group_life_schemes_userId_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."group_life_schemes_userId_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: group_life_schemes_userId_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."group_life_schemes_userId_seq" OWNED BY public.group_life_schemes."userId";


--
-- Name: health_programs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.health_programs (
    id integer NOT NULL,
    name character varying(100) NOT NULL,
    description text,
    frequency character varying(30) NOT NULL,
    category character varying(50) DEFAULT 'wellness'::character varying,
    points_reward integer DEFAULT 0,
    enrolled_count integer DEFAULT 0,
    is_active boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: health_programs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.health_programs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: health_programs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.health_programs_id_seq OWNED BY public.health_programs.id;


--
-- Name: ifrs17_cashflow_scenarios; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ifrs17_cashflow_scenarios (
    id integer NOT NULL,
    group_code character varying(20),
    scenario_name character varying(50) NOT NULL,
    probability_weight numeric(5,4) NOT NULL,
    premium_inflows numeric(18,2) NOT NULL,
    claims_outflows numeric(18,2) NOT NULL,
    expense_outflows numeric(18,2) NOT NULL,
    investment_income numeric(18,2) DEFAULT 0,
    discount_rate numeric(8,6) NOT NULL,
    present_value numeric(18,2) NOT NULL,
    reporting_period character varying(10) NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: ifrs17_cashflow_scenarios_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ifrs17_cashflow_scenarios_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ifrs17_cashflow_scenarios_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ifrs17_cashflow_scenarios_id_seq OWNED BY public.ifrs17_cashflow_scenarios.id;


--
-- Name: ifrs17_contract_groups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ifrs17_contract_groups (
    id integer NOT NULL,
    group_code character varying(20) NOT NULL,
    group_name character varying(100) NOT NULL,
    measurement_model character varying(10) NOT NULL,
    portfolio character varying(50) NOT NULL,
    cohort_year integer NOT NULL,
    is_onerous boolean DEFAULT false,
    transition_approach character varying(30) DEFAULT 'full_retrospective'::character varying,
    inception_date date NOT NULL,
    coverage_period_months integer NOT NULL,
    created_at timestamp without time zone DEFAULT now(),
    CONSTRAINT ifrs17_contract_groups_measurement_model_check CHECK (((measurement_model)::text = ANY ((ARRAY['PAA'::character varying, 'GMM'::character varying, 'VFA'::character varying])::text[])))
);


--
-- Name: ifrs17_contract_groups_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ifrs17_contract_groups_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ifrs17_contract_groups_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ifrs17_contract_groups_id_seq OWNED BY public.ifrs17_contract_groups.id;


--
-- Name: ifrs17_contracts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ifrs17_contracts (
    id integer NOT NULL,
    contract_group character varying(100),
    measurement_model character varying(50),
    premium_allocated numeric(15,2),
    claims_incurred numeric(15,2),
    csm_balance numeric(15,2),
    risk_adjustment numeric(15,2),
    reporting_period character varying(10),
    status character varying(20) DEFAULT 'active'::character varying,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: ifrs17_contracts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ifrs17_contracts_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ifrs17_contracts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ifrs17_contracts_id_seq OWNED BY public.ifrs17_contracts.id;


--
-- Name: ifrs17_csm_rollforward; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ifrs17_csm_rollforward (
    id integer NOT NULL,
    group_code character varying(20),
    reporting_period character varying(10) NOT NULL,
    opening_csm numeric(18,2) NOT NULL,
    new_contracts numeric(18,2) DEFAULT 0,
    interest_accretion numeric(18,2) DEFAULT 0,
    changes_in_estimates numeric(18,2) DEFAULT 0,
    experience_adjustments numeric(18,2) DEFAULT 0,
    fx_movements numeric(18,2) DEFAULT 0,
    csm_release numeric(18,2) DEFAULT 0,
    closing_csm numeric(18,2) NOT NULL,
    loss_component numeric(18,2) DEFAULT 0,
    coverage_units_total integer DEFAULT 0,
    coverage_units_recognized integer DEFAULT 0,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: ifrs17_csm_rollforward_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ifrs17_csm_rollforward_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ifrs17_csm_rollforward_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ifrs17_csm_rollforward_id_seq OWNED BY public.ifrs17_csm_rollforward.id;


--
-- Name: ifrs17_discount_curves; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ifrs17_discount_curves (
    id integer NOT NULL,
    curve_name character varying(100) NOT NULL,
    currency character varying(3) DEFAULT 'NGN'::character varying,
    effective_date date NOT NULL,
    term_months integer NOT NULL,
    spot_rate numeric(8,6) NOT NULL,
    forward_rate numeric(8,6),
    source character varying(50) DEFAULT 'CBN'::character varying,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: ifrs17_discount_curves_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ifrs17_discount_curves_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ifrs17_discount_curves_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ifrs17_discount_curves_id_seq OWNED BY public.ifrs17_discount_curves.id;


--
-- Name: ifrs17_pnl; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ifrs17_pnl (
    id integer NOT NULL,
    group_code character varying(20),
    reporting_period character varying(10) NOT NULL,
    insurance_revenue numeric(18,2) NOT NULL,
    insurance_service_expense numeric(18,2) NOT NULL,
    insurance_service_result numeric(18,2) NOT NULL,
    investment_income numeric(18,2) DEFAULT 0,
    insurance_finance_expense numeric(18,2) DEFAULT 0,
    net_financial_result numeric(18,2) DEFAULT 0,
    loss_component_release numeric(18,2) DEFAULT 0,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: ifrs17_pnl_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ifrs17_pnl_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ifrs17_pnl_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ifrs17_pnl_id_seq OWNED BY public.ifrs17_pnl.id;


--
-- Name: ifrs17_reinsurance_held; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ifrs17_reinsurance_held (
    id integer NOT NULL,
    group_code character varying(20),
    reinsurer character varying(100) NOT NULL,
    treaty_type character varying(30) NOT NULL,
    cession_percentage numeric(5,2),
    csm_reinsurance numeric(18,2) DEFAULT 0,
    loss_recovery numeric(18,2) DEFAULT 0,
    premium_ceded numeric(18,2) DEFAULT 0,
    claims_recovered numeric(18,2) DEFAULT 0,
    reporting_period character varying(10) NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: ifrs17_reinsurance_held_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ifrs17_reinsurance_held_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ifrs17_reinsurance_held_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ifrs17_reinsurance_held_id_seq OWNED BY public.ifrs17_reinsurance_held.id;


--
-- Name: ifrs17_transition; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ifrs17_transition (
    id integer NOT NULL,
    group_code character varying(20),
    approach character varying(30) NOT NULL,
    ifrs4_liability numeric(18,2) NOT NULL,
    ifrs17_liability numeric(18,2) NOT NULL,
    transition_adjustment numeric(18,2) NOT NULL,
    equity_impact numeric(18,2) NOT NULL,
    effective_date date NOT NULL,
    created_at timestamp without time zone DEFAULT now(),
    CONSTRAINT ifrs17_transition_approach_check CHECK (((approach)::text = ANY ((ARRAY['full_retrospective'::character varying, 'modified_retrospective'::character varying, 'fair_value'::character varying])::text[])))
);


--
-- Name: ifrs17_transition_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ifrs17_transition_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ifrs17_transition_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ifrs17_transition_id_seq OWNED BY public.ifrs17_transition.id;


--
-- Name: insurance_applications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.insurance_applications (
    id integer NOT NULL,
    "userId" integer NOT NULL,
    "applicationId" character varying(128) NOT NULL,
    "productType" character varying(64),
    status character varying(32) DEFAULT 'Draft'::character varying,
    "currentStep" character varying(64),
    "totalSteps" integer DEFAULT 5,
    "submittedAt" timestamp without time zone,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: insurance_applications_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.insurance_applications_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: insurance_applications_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.insurance_applications_id_seq OWNED BY public.insurance_applications.id;


--
-- Name: insurance_applications_userId_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."insurance_applications_userId_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: insurance_applications_userId_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."insurance_applications_userId_seq" OWNED BY public.insurance_applications."userId";


--
-- Name: insurance_products; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.insurance_products (
    id integer NOT NULL,
    code character varying(50) NOT NULL,
    name character varying(200) NOT NULL,
    category character varying(50) NOT NULL,
    "subCategory" character varying(100),
    description text,
    "coverageType" character varying(50),
    "minPremium" numeric(15,2),
    "maxPremium" numeric(15,2),
    "minSumAssured" numeric(15,2),
    "maxSumAssured" numeric(15,2),
    "minAge" integer DEFAULT 18,
    "maxAge" integer DEFAULT 65,
    "minTerm" integer DEFAULT 1,
    "maxTerm" integer DEFAULT 30,
    "termUnit" character varying(10) DEFAULT 'years'::character varying,
    "requiredDocuments" jsonb DEFAULT '[]'::jsonb,
    "requiredKycLevel" integer DEFAULT 1,
    "naicomClass" character varying(100),
    "naicomApprovalRef" character varying(100),
    benefits jsonb DEFAULT '[]'::jsonb,
    exclusions jsonb DEFAULT '[]'::jsonb,
    "ratingFactors" jsonb DEFAULT '[]'::jsonb,
    "isCompulsory" boolean DEFAULT false,
    status character varying(20) DEFAULT 'active'::character varying,
    "effectiveDate" date DEFAULT CURRENT_DATE,
    "expiryDate" date,
    "createdAt" timestamp without time zone DEFAULT now(),
    "updatedAt" timestamp without time zone DEFAULT now()
);


--
-- Name: insurance_products_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.insurance_products_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: insurance_products_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.insurance_products_id_seq OWNED BY public.insurance_products.id;


--
-- Name: insurance_radar_alerts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.insurance_radar_alerts (
    id integer NOT NULL,
    title character varying(200) NOT NULL,
    description text,
    alert_type character varying(30) NOT NULL,
    severity character varying(20) DEFAULT 'info'::character varying,
    source character varying(100),
    published_date date,
    action_required boolean DEFAULT false,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: insurance_radar_alerts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.insurance_radar_alerts_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: insurance_radar_alerts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.insurance_radar_alerts_id_seq OWNED BY public.insurance_radar_alerts.id;


--
-- Name: insuretech_innovations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.insuretech_innovations (
    id integer NOT NULL,
    name character varying(100) NOT NULL,
    description text,
    category character varying(50),
    status character varying(20) DEFAULT 'active'::character varying,
    adoption_pct numeric(5,2) DEFAULT 0,
    launch_date date,
    technology_stack text[],
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: insuretech_innovations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.insuretech_innovations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: insuretech_innovations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.insuretech_innovations_id_seq OWNED BY public.insuretech_innovations.id;


--
-- Name: inventory_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inventory_items (
    id integer NOT NULL,
    sku character varying(64) NOT NULL,
    name character varying(128) NOT NULL,
    category character varying(64),
    description text,
    "quantityOnHand" integer DEFAULT 0 NOT NULL,
    "quantityReserved" integer DEFAULT 0 NOT NULL,
    "reorderPoint" integer DEFAULT 10 NOT NULL,
    "unitCost" numeric(15,2),
    status public.inventory_status DEFAULT 'in_stock'::public.inventory_status NOT NULL,
    "warehouseLocation" character varying(64),
    "supplierId" character varying(64),
    "lastRestockedAt" timestamp without time zone,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: inventory_items_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.inventory_items_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: inventory_items_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.inventory_items_id_seq OWNED BY public.inventory_items.id;


--
-- Name: invite_codes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invite_codes (
    id integer NOT NULL,
    code character varying(32) NOT NULL,
    type public.invite_code_type DEFAULT 'one_time'::public.invite_code_type NOT NULL,
    status public.invite_code_status DEFAULT 'active'::public.invite_code_status NOT NULL,
    "maxUses" integer DEFAULT 1 NOT NULL,
    "usedCount" integer DEFAULT 0 NOT NULL,
    "createdBy" integer,
    "assignedTenantId" integer,
    "partnerName" character varying(128),
    "partnerEmail" character varying(320),
    notes text,
    "expiresAt" timestamp without time zone,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: invite_codes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.invite_codes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: invite_codes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.invite_codes_id_seq OWNED BY public.invite_codes.id;


--
-- Name: knowledge_entities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.knowledge_entities (
    id integer NOT NULL,
    entity_name character varying(150) NOT NULL,
    entity_type character varying(50) NOT NULL,
    properties jsonb,
    related_to integer[],
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: knowledge_entities_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.knowledge_entities_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: knowledge_entities_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.knowledge_entities_id_seq OWNED BY public.knowledge_entities.id;


--
-- Name: knowledge_graph_edges; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.knowledge_graph_edges (
    id integer NOT NULL,
    "userId" integer NOT NULL,
    "sourceNodeId" character varying(128) NOT NULL,
    "targetNodeId" character varying(128) NOT NULL,
    relationship character varying(128) NOT NULL,
    weight numeric(5,4) DEFAULT 1.0,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: knowledge_graph_edges_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.knowledge_graph_edges_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: knowledge_graph_edges_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.knowledge_graph_edges_id_seq OWNED BY public.knowledge_graph_edges.id;


--
-- Name: knowledge_graph_edges_userId_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."knowledge_graph_edges_userId_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: knowledge_graph_edges_userId_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."knowledge_graph_edges_userId_seq" OWNED BY public.knowledge_graph_edges."userId";


--
-- Name: knowledge_graph_nodes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.knowledge_graph_nodes (
    id integer NOT NULL,
    "userId" integer NOT NULL,
    "nodeId" character varying(128) NOT NULL,
    "entityType" character varying(64) NOT NULL,
    label character varying(255) NOT NULL,
    properties text,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: knowledge_graph_nodes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.knowledge_graph_nodes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: knowledge_graph_nodes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.knowledge_graph_nodes_id_seq OWNED BY public.knowledge_graph_nodes.id;


--
-- Name: knowledge_graph_nodes_userId_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."knowledge_graph_nodes_userId_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: knowledge_graph_nodes_userId_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."knowledge_graph_nodes_userId_seq" OWNED BY public.knowledge_graph_nodes."userId";


--
-- Name: kyb_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.kyb_profiles (
    id integer NOT NULL,
    "userId" integer NOT NULL,
    "companyName" character varying(200),
    "rcNumber" character varying(50),
    "tinNumber" character varying(50),
    "businessType" character varying(50),
    "incorporationDate" date,
    "registeredAddress" text,
    "cacVerified" boolean DEFAULT false,
    "tinVerified" boolean DEFAULT false,
    "directorVerified" boolean DEFAULT false,
    "financialStatements" boolean DEFAULT false,
    "kybStatus" character varying(30) DEFAULT 'pending'::character varying,
    "kybLevel" integer DEFAULT 0,
    "createdAt" timestamp without time zone DEFAULT now()
);


--
-- Name: kyb_profiles_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.kyb_profiles_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: kyb_profiles_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.kyb_profiles_id_seq OWNED BY public.kyb_profiles.id;


--
-- Name: kyc_documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.kyc_documents (
    id integer NOT NULL,
    agent_id integer NOT NULL,
    doc_type text NOT NULL,
    doc_number text,
    doc_url text,
    status text DEFAULT 'pending'::text,
    verified_by integer,
    verified_at timestamp without time zone,
    rejection_reason text,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);


--
-- Name: kyc_documents_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.kyc_documents_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: kyc_documents_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.kyc_documents_id_seq OWNED BY public.kyc_documents.id;


--
-- Name: kyc_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.kyc_profiles (
    id integer NOT NULL,
    "userId" integer NOT NULL,
    "kycLevel" integer DEFAULT 0,
    "kycStatus" character varying(30) DEFAULT 'pending'::character varying,
    "bvnVerified" boolean DEFAULT false,
    "ninVerified" boolean DEFAULT false,
    "phoneVerified" boolean DEFAULT false,
    "addressVerified" boolean DEFAULT false,
    "idDocVerified" boolean DEFAULT false,
    "facialMatchScore" numeric(5,2),
    "riskRating" character varying(20) DEFAULT 'standard'::character varying,
    "pepStatus" boolean DEFAULT false,
    "sanctionsCheck" boolean DEFAULT false,
    bvn character varying(20),
    nin character varying(20),
    "dateOfBirth" date,
    occupation character varying(100),
    "annualIncome" numeric(15,2),
    "sourceOfFunds" character varying(100),
    "lastVerificationDate" timestamp without time zone,
    "nextReviewDate" timestamp without time zone,
    "createdAt" timestamp without time zone DEFAULT now(),
    "updatedAt" timestamp without time zone DEFAULT now(),
    CONSTRAINT "kyc_profiles_kycStatus_check" CHECK ((("kycStatus")::text = ANY ((ARRAY['pending'::character varying, 'in_progress'::character varying, 'verified'::character varying, 'rejected'::character varying, 'expired'::character varying])::text[])))
);


--
-- Name: kyc_profiles_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.kyc_profiles_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: kyc_profiles_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.kyc_profiles_id_seq OWNED BY public.kyc_profiles.id;


--
-- Name: kyc_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.kyc_sessions (
    id integer NOT NULL,
    "agentId" integer,
    status character varying(32) DEFAULT 'pending'::character varying NOT NULL,
    "livenessScore" numeric(5,2),
    "livenessMethod" character varying(64),
    "livenessChallenge" character varying(128),
    "livenessPassed" boolean,
    "docType" character varying(32),
    "docExtractedName" character varying(256),
    "docExtractedDob" character varying(32),
    "docExtractedIdNumber" character varying(64),
    "docConfidence" numeric(5,4),
    "docFraudIndicators" json,
    "livenessRaw" json,
    "ocrRaw" json,
    "complianceRecordId" character varying(64),
    "rejectionReason" text,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp without time zone DEFAULT now() NOT NULL,
    "customerId" integer,
    "sessionRef" character varying(64) DEFAULT gen_random_uuid() NOT NULL,
    type character varying(32) DEFAULT 'agent_onboarding'::character varying NOT NULL,
    bvn character varying(11),
    nin character varying(11),
    "selfieUrl" text,
    "idDocUrl" text,
    "idDocType" character varying(32),
    "idDocNumber" character varying(64),
    "matchScore" numeric(5,2),
    "reviewedBy" character varying(64),
    "reviewNote" text,
    "reviewedAt" timestamp without time zone,
    "expiresAt" timestamp without time zone,
    "deletedAt" timestamp without time zone,
    "tenantId" integer
);


--
-- Name: kyc_sessions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.kyc_sessions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: kyc_sessions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.kyc_sessions_id_seq OWNED BY public.kyc_sessions.id;


--
-- Name: kyc_verifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.kyc_verifications (
    id integer NOT NULL,
    "userId" integer NOT NULL,
    "verificationType" character varying(32) NOT NULL,
    "documentType" character varying(64),
    "documentNumber" character varying(128),
    status character varying(32) DEFAULT 'Pending'::character varying,
    "verifiedAt" timestamp without time zone,
    "expiresAt" timestamp without time zone,
    "riskScore" numeric(5,4),
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: kyc_verifications_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.kyc_verifications_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: kyc_verifications_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.kyc_verifications_id_seq OWNED BY public.kyc_verifications.id;


--
-- Name: kyc_verifications_userId_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."kyc_verifications_userId_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: kyc_verifications_userId_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."kyc_verifications_userId_seq" OWNED BY public.kyc_verifications."userId";


--
-- Name: load_test_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.load_test_runs (
    id integer NOT NULL,
    run_id character varying(64) NOT NULL,
    status public.load_test_run_status DEFAULT 'running'::public.load_test_run_status NOT NULL,
    started_at timestamp without time zone DEFAULT now() NOT NULL,
    completed_at timestamp without time zone,
    triggered_by character varying(128),
    target_rps integer DEFAULT 100 NOT NULL,
    duration_seconds integer DEFAULT 60 NOT NULL,
    concurrency integer DEFAULT 10 NOT NULL,
    zipf_skew numeric(4,2) DEFAULT 1.07,
    merchant_count integer DEFAULT 1000,
    results json,
    error_message text
);


--
-- Name: load_test_runs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.load_test_runs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: load_test_runs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.load_test_runs_id_seq OWNED BY public.load_test_runs.id;


--
-- Name: loyalty_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.loyalty_history (
    id integer NOT NULL,
    "agentId" integer NOT NULL,
    "transactionId" integer,
    type public.loyalty_type NOT NULL,
    points integer NOT NULL,
    description character varying(256),
    "balanceAfter" integer NOT NULL,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: loyalty_history_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.loyalty_history_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: loyalty_history_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.loyalty_history_id_seq OWNED BY public.loyalty_history.id;


--
-- Name: loyalty_points; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.loyalty_points (
    id integer NOT NULL,
    "userId" integer NOT NULL,
    points integer DEFAULT 0 NOT NULL,
    tier character varying(32) DEFAULT 'Bronze'::character varying,
    "totalEarned" integer DEFAULT 0 NOT NULL,
    "totalRedeemed" integer DEFAULT 0 NOT NULL,
    "updatedAt" timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: loyalty_points_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.loyalty_points_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: loyalty_points_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.loyalty_points_id_seq OWNED BY public.loyalty_points.id;


--
-- Name: loyalty_points_userId_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."loyalty_points_userId_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: loyalty_points_userId_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."loyalty_points_userId_seq" OWNED BY public.loyalty_points."userId";


--
-- Name: loyalty_tiers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.loyalty_tiers (
    id integer NOT NULL,
    name character varying(30) NOT NULL,
    min_points integer NOT NULL,
    discount_pct numeric(4,2) DEFAULT 0,
    benefits text[] NOT NULL,
    color character varying(20),
    icon character varying(50)
);


--
-- Name: loyalty_tiers_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.loyalty_tiers_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: loyalty_tiers_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.loyalty_tiers_id_seq OWNED BY public.loyalty_tiers.id;


--
-- Name: loyalty_transactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.loyalty_transactions (
    id integer NOT NULL,
    "userId" integer NOT NULL,
    points integer NOT NULL,
    "transactionType" character varying(32) NOT NULL,
    description text,
    "referenceId" character varying(128),
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: loyalty_transactions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.loyalty_transactions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: loyalty_transactions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.loyalty_transactions_id_seq OWNED BY public.loyalty_transactions.id;


--
-- Name: loyalty_transactions_userId_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."loyalty_transactions_userId_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: loyalty_transactions_userId_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."loyalty_transactions_userId_seq" OWNED BY public.loyalty_transactions."userId";


--
-- Name: mcmc_results; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mcmc_results (
    id integer NOT NULL,
    "userId" integer NOT NULL,
    "simulationId" character varying(128) NOT NULL,
    iterations integer,
    "meanLoss" numeric(15,2),
    "stdDev" numeric(15,2),
    var95 numeric(15,2),
    var99 numeric(15,2),
    "processingTime" numeric(8,2),
    status character varying(32) DEFAULT 'Completed'::character varying,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: mcmc_results_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.mcmc_results_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: mcmc_results_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.mcmc_results_id_seq OWNED BY public.mcmc_results.id;


--
-- Name: mcmc_results_userId_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."mcmc_results_userId_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: mcmc_results_userId_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."mcmc_results_userId_seq" OWNED BY public.mcmc_results."userId";


--
-- Name: mcmc_simulations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mcmc_simulations (
    id integer NOT NULL,
    simulation_id character varying(50) NOT NULL,
    model_type character varying(50) NOT NULL,
    iterations integer NOT NULL,
    burn_in integer NOT NULL,
    converged boolean DEFAULT false,
    r_hat numeric(5,3),
    effective_sample_size integer,
    posterior_means jsonb,
    credible_intervals jsonb,
    run_date timestamp without time zone DEFAULT now()
);


--
-- Name: mcmc_simulations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.mcmc_simulations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: mcmc_simulations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.mcmc_simulations_id_seq OWNED BY public.mcmc_simulations.id;


--
-- Name: mdm_geofence_violations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mdm_geofence_violations (
    id integer NOT NULL,
    "deviceId" integer NOT NULL,
    "serialNumber" character varying(64) NOT NULL,
    "agentCode" character varying(32),
    "zoneId" integer,
    "zoneName" character varying(128),
    "violationType" character varying(32) NOT NULL,
    "latE6" integer,
    "lonE6" integer,
    "distanceMeters" integer,
    status character varying(32) DEFAULT 'open'::character varying NOT NULL,
    "notifiedAt" timestamp without time zone,
    "resolvedAt" timestamp without time zone,
    "detectedAt" timestamp without time zone DEFAULT now() NOT NULL,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: mdm_geofence_violations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.mdm_geofence_violations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: mdm_geofence_violations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.mdm_geofence_violations_id_seq OWNED BY public.mdm_geofence_violations.id;


--
-- Name: merchant_kyc_docs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.merchant_kyc_docs (
    id integer NOT NULL,
    merchant_id integer NOT NULL,
    doc_type text NOT NULL,
    doc_url text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    verified_by integer,
    verified_at timestamp without time zone,
    rejection_reason text,
    expires_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: merchant_kyc_docs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.merchant_kyc_docs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: merchant_kyc_docs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.merchant_kyc_docs_id_seq OWNED BY public.merchant_kyc_docs.id;


--
-- Name: merchant_payouts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.merchant_payouts (
    id integer NOT NULL,
    merchant_id integer NOT NULL,
    amount numeric(15,2) NOT NULL,
    currency text DEFAULT 'NGN'::text NOT NULL,
    bank_code text NOT NULL,
    account_number text NOT NULL,
    account_name text NOT NULL,
    reference text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    processed_at timestamp without time zone,
    failure_reason text,
    period_start timestamp without time zone NOT NULL,
    period_end timestamp without time zone NOT NULL,
    tx_count integer DEFAULT 0,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: merchant_payouts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.merchant_payouts_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: merchant_payouts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.merchant_payouts_id_seq OWNED BY public.merchant_payouts.id;


--
-- Name: merchant_settlements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.merchant_settlements (
    id integer NOT NULL,
    "merchantId" integer NOT NULL,
    period character varying(10) NOT NULL,
    "grossAmount" numeric(15,2) NOT NULL,
    "feeAmount" numeric(15,2) DEFAULT 0.00 NOT NULL,
    "netAmount" numeric(15,2) NOT NULL,
    currency character varying(3) DEFAULT 'NGN'::character varying NOT NULL,
    status character varying(32) DEFAULT 'pending'::character varying NOT NULL,
    "settledAt" timestamp without time zone,
    "bankRef" character varying(64),
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: merchant_settlements_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.merchant_settlements_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: merchant_settlements_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.merchant_settlements_id_seq OWNED BY public.merchant_settlements.id;


--
-- Name: merchants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.merchants (
    id integer NOT NULL,
    "merchantCode" character varying(32) NOT NULL,
    "businessName" character varying(128) NOT NULL,
    "ownerName" character varying(128) NOT NULL,
    email character varying(320),
    phone character varying(20) NOT NULL,
    address text,
    category public.merchant_category DEFAULT 'retail'::public.merchant_category NOT NULL,
    status public.merchant_status DEFAULT 'pending'::public.merchant_status NOT NULL,
    "rcNumber" character varying(32),
    "tinNumber" character varying(32),
    "settlementAccountNumber" character varying(20),
    "settlementBankCode" character varying(10),
    "settlementBankName" character varying(64),
    "walletBalance" numeric(15,2) DEFAULT 0.00 NOT NULL,
    "totalVolume" numeric(20,2) DEFAULT 0.00 NOT NULL,
    "totalTransactions" integer DEFAULT 0 NOT NULL,
    "preferredAgentId" integer,
    "keycloakSub" character varying(128),
    "passwordHash" character varying(256),
    "deletedAt" timestamp without time zone,
    "tenantId" integer,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: merchants_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.merchants_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: merchants_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.merchants_id_seq OWNED BY public.merchants.id;


--
-- Name: microinsurance_policies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.microinsurance_policies (
    id integer NOT NULL,
    "userId" integer NOT NULL,
    "productId" character varying(64) NOT NULL,
    "productName" character varying(255),
    premium numeric(10,2),
    coverage numeric(15,2),
    duration integer NOT NULL,
    status character varying(32) DEFAULT 'Active'::character varying,
    "expiresAt" timestamp without time zone,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: microinsurance_policies_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.microinsurance_policies_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: microinsurance_policies_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.microinsurance_policies_id_seq OWNED BY public.microinsurance_policies.id;


--
-- Name: microinsurance_policies_userId_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."microinsurance_policies_userId_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: microinsurance_policies_userId_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."microinsurance_policies_userId_seq" OWNED BY public.microinsurance_policies."userId";


--
-- Name: model_security_audits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.model_security_audits (
    id integer NOT NULL,
    model_name character varying(100) NOT NULL,
    audit_date date NOT NULL,
    overall_score integer NOT NULL,
    vulnerabilities_found integer DEFAULT 0,
    vulnerabilities_patched integer DEFAULT 0,
    recommendations text[],
    adversarial_tests_passed integer,
    adversarial_tests_total integer,
    data_leakage_risk character varying(20),
    encryption_status character varying(20),
    inference_logging boolean DEFAULT false,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: model_security_audits_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.model_security_audits_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: model_security_audits_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.model_security_audits_id_seq OWNED BY public.model_security_audits.id;


--
-- Name: mqtt_bridge_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mqtt_bridge_config (
    id integer NOT NULL,
    name character varying(128) DEFAULT 'POS MQTT Bridge'::character varying NOT NULL,
    "brokerUrl" text DEFAULT 'mqtt://broker.54link.io:1883'::text NOT NULL,
    port integer DEFAULT 1883 NOT NULL,
    "useTls" boolean DEFAULT false NOT NULL,
    username character varying(128) DEFAULT ''::character varying,
    password text DEFAULT ''::text,
    "clientId" character varying(128) DEFAULT '54link-fluvio-bridge'::character varying,
    "topicMappings" json DEFAULT '[]'::json,
    qos public.mqtt_qos DEFAULT '1'::public.mqtt_qos NOT NULL,
    "keepAliveSeconds" integer DEFAULT 60 NOT NULL,
    "reconnectDelayMs" integer DEFAULT 5000 NOT NULL,
    enabled boolean DEFAULT false NOT NULL,
    "lastTestAt" timestamp without time zone,
    "lastTestStatus" character varying(32) DEFAULT 'never'::character varying,
    "lastTestError" text,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: mqtt_bridge_config_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.mqtt_bridge_config_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: mqtt_bridge_config_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.mqtt_bridge_config_id_seq OWNED BY public.mqtt_bridge_config.id;


--
-- Name: multi_sim_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.multi_sim_profiles (
    id integer NOT NULL,
    "terminalId" integer NOT NULL,
    "simSlot" integer DEFAULT 1 NOT NULL,
    carrier character varying(64) NOT NULL,
    iccid character varying(22),
    "phoneNumber" character varying(20),
    status public.sim_status DEFAULT 'active'::public.sim_status NOT NULL,
    "signalStrength" integer,
    "dataUsageMb" numeric(12,2) DEFAULT '0'::numeric,
    "failoverPriority" integer DEFAULT 1 NOT NULL,
    "lastCheckedAt" timestamp without time zone,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: multi_sim_profiles_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.multi_sim_profiles_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: multi_sim_profiles_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.multi_sim_profiles_id_seq OWNED BY public.multi_sim_profiles.id;


--
-- Name: naicom_automated_reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.naicom_automated_reports (
    id integer NOT NULL,
    report_type character varying(50),
    report_code character varying(50),
    period character varying(20),
    data jsonb,
    status character varying(20) DEFAULT 'draft'::character varying,
    submitted_at timestamp without time zone,
    due_date date,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: naicom_automated_reports_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.naicom_automated_reports_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: naicom_automated_reports_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.naicom_automated_reports_id_seq OWNED BY public.naicom_automated_reports.id;


--
-- Name: naicom_data_exchange; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.naicom_data_exchange (
    id integer NOT NULL,
    direction character varying(10) NOT NULL,
    data_type character varying(50) NOT NULL,
    payload jsonb,
    status character varying(20) DEFAULT 'pending'::character varying,
    naicom_ref character varying(50),
    error_message text,
    sent_at timestamp without time zone,
    acknowledged_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now(),
    CONSTRAINT naicom_data_exchange_direction_check CHECK (((direction)::text = ANY ((ARRAY['outbound'::character varying, 'inbound'::character varying])::text[]))),
    CONSTRAINT naicom_data_exchange_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'sent'::character varying, 'received'::character varying, 'acknowledged'::character varying, 'failed'::character varying])::text[])))
);


--
-- Name: naicom_data_exchange_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.naicom_data_exchange_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: naicom_data_exchange_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.naicom_data_exchange_id_seq OWNED BY public.naicom_data_exchange.id;


--
-- Name: naicom_filings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.naicom_filings (
    id integer NOT NULL,
    "userId" integer NOT NULL,
    "filingType" character varying(64) NOT NULL,
    period character varying(7) NOT NULL,
    status character varying(32) DEFAULT 'Draft'::character varying,
    "submittedAt" timestamp without time zone,
    "dueDate" timestamp without time zone,
    "filingRef" character varying(128),
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: naicom_filings_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.naicom_filings_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: naicom_filings_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.naicom_filings_id_seq OWNED BY public.naicom_filings.id;


--
-- Name: naicom_filings_userId_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."naicom_filings_userId_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: naicom_filings_userId_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."naicom_filings_userId_seq" OWNED BY public.naicom_filings."userId";


--
-- Name: naicom_financial_reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.naicom_financial_reports (
    id integer NOT NULL,
    report_type character varying(100) NOT NULL,
    period character varying(20) NOT NULL,
    status character varying(30) DEFAULT 'draft'::character varying,
    data jsonb DEFAULT '{}'::jsonb NOT NULL,
    validation_errors jsonb DEFAULT '[]'::jsonb,
    submitted_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);


--
-- Name: naicom_financial_reports_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.naicom_financial_reports_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: naicom_financial_reports_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.naicom_financial_reports_id_seq OWNED BY public.naicom_financial_reports.id;


--
-- Name: naicom_penalties; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.naicom_penalties (
    id integer NOT NULL,
    report_type character varying(100) NOT NULL,
    period character varying(20) NOT NULL,
    penalty_type character varying(50) NOT NULL,
    amount numeric(18,2) NOT NULL,
    reason text,
    status character varying(20) DEFAULT 'outstanding'::character varying,
    due_date date NOT NULL,
    paid_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now(),
    CONSTRAINT naicom_penalties_status_check CHECK (((status)::text = ANY ((ARRAY['outstanding'::character varying, 'paid'::character varying, 'waived'::character varying, 'disputed'::character varying])::text[])))
);


--
-- Name: naicom_penalties_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.naicom_penalties_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: naicom_penalties_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.naicom_penalties_id_seq OWNED BY public.naicom_penalties.id;


--
-- Name: naicom_reporting_schedule; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.naicom_reporting_schedule (
    id integer NOT NULL,
    report_type character varying(100) NOT NULL,
    frequency character varying(20) NOT NULL,
    due_date date NOT NULL,
    status character varying(20) DEFAULT 'upcoming'::character varying,
    penalty_amount numeric(18,2) DEFAULT 0,
    naicom_ref character varying(50),
    circular_ref character varying(50),
    created_at timestamp without time zone DEFAULT now(),
    CONSTRAINT naicom_reporting_schedule_frequency_check CHECK (((frequency)::text = ANY ((ARRAY['Monthly'::character varying, 'Quarterly'::character varying, 'Semi-Annual'::character varying, 'Annual'::character varying])::text[]))),
    CONSTRAINT naicom_reporting_schedule_status_check CHECK (((status)::text = ANY ((ARRAY['upcoming'::character varying, 'overdue'::character varying, 'submitted'::character varying, 'acknowledged'::character varying])::text[])))
);


--
-- Name: naicom_reporting_schedule_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.naicom_reporting_schedule_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: naicom_reporting_schedule_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.naicom_reporting_schedule_id_seq OWNED BY public.naicom_reporting_schedule.id;


--
-- Name: naicom_returns; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.naicom_returns (
    id integer NOT NULL,
    "returnType" character varying(100) NOT NULL,
    "reportingPeriod" character varying(20) NOT NULL,
    "dueDate" date NOT NULL,
    "submissionDate" timestamp without time zone,
    status character varying(30) DEFAULT 'draft'::character varying,
    "dataPayload" jsonb DEFAULT '{}'::jsonb,
    "validationErrors" jsonb DEFAULT '[]'::jsonb,
    "submissionRef" character varying(100),
    "naicomAckRef" character varying(100),
    "createdAt" timestamp without time zone DEFAULT now()
);


--
-- Name: naicom_returns_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.naicom_returns_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: naicom_returns_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.naicom_returns_id_seq OWNED BY public.naicom_returns.id;


--
-- Name: ndvi_readings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ndvi_readings (
    id integer NOT NULL,
    region character varying(100) NOT NULL,
    reading_date date NOT NULL,
    ndvi_value numeric(4,3) NOT NULL,
    status character varying(20) NOT NULL,
    satellite character varying(50) DEFAULT 'Sentinel-2'::character varying,
    resolution_meters integer DEFAULT 10,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: ndvi_readings_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ndvi_readings_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ndvi_readings_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ndvi_readings_id_seq OWNED BY public.ndvi_readings.id;


--
-- Name: niira_insurance_classes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.niira_insurance_classes (
    id integer NOT NULL,
    class_name character varying(100) NOT NULL,
    category character varying(50) NOT NULL,
    is_compulsory boolean DEFAULT false,
    naicom_code character varying(20),
    minimum_premium numeric(12,2),
    description text,
    applicable_to text[],
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: niira_insurance_classes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.niira_insurance_classes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: niira_insurance_classes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.niira_insurance_classes_id_seq OWNED BY public.niira_insurance_classes.id;


--
-- Name: niira_registrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.niira_registrations (
    id integer NOT NULL,
    registration_id character varying(50) NOT NULL,
    company_name character varying(200),
    compulsory_products integer DEFAULT 0,
    registration_date date NOT NULL,
    renewal_date date NOT NULL,
    status character varying(20) DEFAULT 'active'::character varying,
    compliance_score numeric(5,2),
    classes text[]
);


--
-- Name: niira_registrations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.niira_registrations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: niira_registrations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.niira_registrations_id_seq OWNED BY public.niira_registrations.id;


--
-- Name: nmid_verifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.nmid_verifications (
    id integer NOT NULL,
    "userId" integer NOT NULL,
    "vehicleRegistration" character varying(20) NOT NULL,
    "chassisNumber" character varying(64),
    "engineNumber" character varying(64),
    "vehicleMake" character varying(64),
    "vehicleModel" character varying(64),
    "vehicleYear" integer,
    "ownerName" character varying(255),
    "verificationStatus" character varying(32) DEFAULT 'pending'::character varying,
    "nmidRef" character varying(128),
    "verifiedAt" timestamp without time zone,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: nmid_verifications_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.nmid_verifications_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: nmid_verifications_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.nmid_verifications_id_seq OWNED BY public.nmid_verifications.id;


--
-- Name: nmid_verifications_userId_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."nmid_verifications_userId_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: nmid_verifications_userId_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."nmid_verifications_userId_seq" OWNED BY public.nmid_verifications."userId";


--
-- Name: notification_channels; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notification_channels (
    id integer NOT NULL,
    name text NOT NULL,
    channel_type text NOT NULL,
    config text,
    is_active boolean DEFAULT true,
    priority integer DEFAULT 0,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone
);


--
-- Name: notification_channels_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.notification_channels_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: notification_channels_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.notification_channels_id_seq OWNED BY public.notification_channels.id;


--
-- Name: notification_dispatch_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notification_dispatch_log (
    id integer NOT NULL,
    recipient_id integer,
    recipient_type text NOT NULL,
    channel text NOT NULL,
    template_id text,
    subject text,
    body text NOT NULL,
    status text DEFAULT 'queued'::text NOT NULL,
    external_id text,
    retry_count integer DEFAULT 0,
    max_retries integer DEFAULT 3,
    next_retry_at timestamp without time zone,
    delivered_at timestamp without time zone,
    failure_reason text,
    metadata text,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: notification_dispatch_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.notification_dispatch_log_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: notification_dispatch_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.notification_dispatch_log_id_seq OWNED BY public.notification_dispatch_log.id;


--
-- Name: notification_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notification_logs (
    id integer NOT NULL,
    channel_id integer,
    recipient_id text NOT NULL,
    recipient_type text NOT NULL,
    subject text,
    body text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    sent_at timestamp without time zone,
    delivered_at timestamp without time zone,
    failure_reason text,
    retry_count integer DEFAULT 0,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: notification_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.notification_logs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: notification_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.notification_logs_id_seq OWNED BY public.notification_logs.id;


--
-- Name: notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notifications (
    id integer NOT NULL,
    "userId" integer NOT NULL,
    title character varying(255) NOT NULL,
    message text NOT NULL,
    type character varying(32) NOT NULL,
    channel character varying(32) DEFAULT 'in_app'::character varying,
    "isRead" boolean DEFAULT false NOT NULL,
    "readAt" timestamp without time zone,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: notifications_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.notifications_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: notifications_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.notifications_id_seq OWNED BY public.notifications.id;


--
-- Name: notifications_userId_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."notifications_userId_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: notifications_userId_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."notifications_userId_seq" OWNED BY public.notifications."userId";


--
-- Name: observability_alerts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.observability_alerts (
    id integer NOT NULL,
    alert_name text NOT NULL,
    service text NOT NULL,
    severity text NOT NULL,
    metric text NOT NULL,
    threshold numeric(10,2) NOT NULL,
    current_value numeric(10,2),
    status text DEFAULT 'firing'::text NOT NULL,
    acknowledged_by integer,
    acknowledged_at timestamp without time zone,
    resolved_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: observability_alerts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.observability_alerts_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: observability_alerts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.observability_alerts_id_seq OWNED BY public.observability_alerts.id;


--
-- Name: ota_releases; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ota_releases (
    id integer NOT NULL,
    version character varying(32) NOT NULL,
    "releaseNotes" text,
    "s3Key" text NOT NULL,
    "downloadUrl" text NOT NULL,
    checksum character varying(128) NOT NULL,
    "fileSize" integer NOT NULL,
    "isForced" boolean DEFAULT false NOT NULL,
    "rolloutPercent" integer DEFAULT 100 NOT NULL,
    "targetModels" json DEFAULT '[]'::json,
    "minCurrentVersion" character varying(32),
    status character varying(32) DEFAULT 'draft'::character varying NOT NULL,
    "publishedAt" timestamp without time zone,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: ota_releases_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ota_releases_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ota_releases_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ota_releases_id_seq OWNED BY public.ota_releases.id;


--
-- Name: ota_update_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ota_update_log (
    id integer NOT NULL,
    "deviceId" integer NOT NULL,
    "releaseId" integer NOT NULL,
    "fromVersion" character varying(32),
    "toVersion" character varying(32) NOT NULL,
    status character varying(32) DEFAULT 'pending'::character varying NOT NULL,
    "startedAt" timestamp without time zone,
    "completedAt" timestamp without time zone,
    "errorMessage" text,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: ota_update_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ota_update_log_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ota_update_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ota_update_log_id_seq OWNED BY public.ota_update_log.id;


--
-- Name: otp_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.otp_tokens (
    id integer NOT NULL,
    "agentId" integer NOT NULL,
    "hashedOtp" character varying(128) NOT NULL,
    "expiresAt" timestamp without time zone NOT NULL,
    used boolean DEFAULT false NOT NULL,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL,
    purpose character varying(32) DEFAULT 'pin_reset'::character varying NOT NULL,
    "usedAt" timestamp without time zone
);


--
-- Name: otp_tokens_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.otp_tokens_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: otp_tokens_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.otp_tokens_id_seq OWNED BY public.otp_tokens.id;


--
-- Name: p2p_memberships; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.p2p_memberships (
    id integer NOT NULL,
    "userId" integer NOT NULL,
    "poolId" integer NOT NULL,
    contribution numeric(10,2),
    status character varying(32) DEFAULT 'Active'::character varying,
    "joinedAt" timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: p2p_memberships_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.p2p_memberships_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: p2p_memberships_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.p2p_memberships_id_seq OWNED BY public.p2p_memberships.id;


--
-- Name: p2p_memberships_poolId_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."p2p_memberships_poolId_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: p2p_memberships_poolId_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."p2p_memberships_poolId_seq" OWNED BY public.p2p_memberships."poolId";


--
-- Name: p2p_memberships_userId_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."p2p_memberships_userId_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: p2p_memberships_userId_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."p2p_memberships_userId_seq" OWNED BY public.p2p_memberships."userId";


--
-- Name: p2p_pools; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.p2p_pools (
    id integer NOT NULL,
    "poolName" character varying(255) NOT NULL,
    "totalFund" numeric(15,2) DEFAULT '0'::numeric,
    "coveragePerMember" numeric(15,2),
    "monthlyContribution" numeric(10,2),
    "memberCount" integer DEFAULT 0,
    status character varying(32) DEFAULT 'Active'::character varying,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: p2p_pools_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.p2p_pools_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: p2p_pools_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.p2p_pools_id_seq OWNED BY public.p2p_pools.id;


--
-- Name: parametric_triggers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.parametric_triggers (
    id integer NOT NULL,
    name character varying(100) NOT NULL,
    trigger_type character varying(50) NOT NULL,
    threshold numeric(10,2) NOT NULL,
    unit character varying(20) NOT NULL,
    region character varying(100) NOT NULL,
    payout_amount numeric(15,2) NOT NULL,
    policy_count integer DEFAULT 0,
    last_triggered timestamp without time zone,
    status character varying(20) DEFAULT 'active'::character varying,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: parametric_triggers_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.parametric_triggers_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: parametric_triggers_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.parametric_triggers_id_seq OWNED BY public.parametric_triggers.id;


--
-- Name: password_resets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.password_resets (
    user_id integer NOT NULL,
    token character varying(10) NOT NULL,
    expires_at timestamp without time zone NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: payment_transactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payment_transactions (
    id integer NOT NULL,
    gateway character varying(30),
    reference character varying(100),
    amount numeric(12,2),
    currency character varying(3) DEFAULT 'NGN'::character varying,
    type character varying(30),
    status character varying(20) DEFAULT 'pending'::character varying,
    metadata jsonb DEFAULT '{}'::jsonb,
    customer_email character varying(255),
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: payment_transactions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.payment_transactions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: payment_transactions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.payment_transactions_id_seq OWNED BY public.payment_transactions.id;


--
-- Name: payments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payments (
    id integer NOT NULL,
    "userId" integer NOT NULL,
    "policyId" integer NOT NULL,
    amount numeric(10,2) NOT NULL,
    status public.payment_status DEFAULT 'Pending'::public.payment_status NOT NULL,
    "dueDate" timestamp without time zone NOT NULL,
    "paidDate" timestamp without time zone,
    "paymentMethod" character varying(50),
    "transactionRef" character varying(128),
    currency character varying(8) DEFAULT 'NGN'::character varying,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp without time zone DEFAULT now() NOT NULL,
    "tenantId" character varying(50) DEFAULT 'default'::character varying
);


--
-- Name: payments_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.payments_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: payments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.payments_id_seq OWNED BY public.payments.id;


--
-- Name: payments_policyId_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."payments_policyId_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: payments_policyId_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."payments_policyId_seq" OWNED BY public.payments."policyId";


--
-- Name: payments_userId_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."payments_userId_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: payments_userId_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."payments_userId_seq" OWNED BY public.payments."userId";


--
-- Name: performance_metrics; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.performance_metrics (
    id integer NOT NULL,
    service_name character varying(100) NOT NULL,
    metric_type character varying(30) NOT NULL,
    value numeric(10,3) NOT NULL,
    unit character varying(20),
    threshold_warning numeric(10,3),
    threshold_critical numeric(10,3),
    measured_at timestamp without time zone DEFAULT now()
);


--
-- Name: performance_metrics_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.performance_metrics_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: performance_metrics_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.performance_metrics_id_seq OWNED BY public.performance_metrics.id;


--
-- Name: pfa_annuities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pfa_annuities (
    id integer NOT NULL,
    user_id integer,
    provider character varying(100) NOT NULL,
    annuity_type character varying(30) NOT NULL,
    monthly_payout numeric(12,2) NOT NULL,
    start_date date,
    lump_sum numeric(15,2),
    status character varying(20) DEFAULT 'active'::character varying
);


--
-- Name: pfa_annuities_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.pfa_annuities_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: pfa_annuities_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.pfa_annuities_id_seq OWNED BY public.pfa_annuities.id;


--
-- Name: pfa_annuity_quotes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pfa_annuity_quotes (
    id integer NOT NULL,
    "userId" integer NOT NULL,
    "pfaId" integer NOT NULL,
    "rsaPin" character varying(32),
    "retirementAge" integer,
    "accumulatedFund" numeric(15,2),
    "monthlyAnnuity" numeric(10,2),
    "annuityType" character varying(64),
    "quoteRef" character varying(128),
    "validUntil" timestamp without time zone,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: pfa_annuity_quotes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.pfa_annuity_quotes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: pfa_annuity_quotes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.pfa_annuity_quotes_id_seq OWNED BY public.pfa_annuity_quotes.id;


--
-- Name: pfa_annuity_quotes_pfaId_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."pfa_annuity_quotes_pfaId_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: pfa_annuity_quotes_pfaId_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."pfa_annuity_quotes_pfaId_seq" OWNED BY public.pfa_annuity_quotes."pfaId";


--
-- Name: pfa_annuity_quotes_userId_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."pfa_annuity_quotes_userId_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: pfa_annuity_quotes_userId_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."pfa_annuity_quotes_userId_seq" OWNED BY public.pfa_annuity_quotes."userId";


--
-- Name: pfa_integration; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pfa_integration (
    id integer NOT NULL,
    user_id integer,
    provider character varying(100) NOT NULL,
    rsa_pin character varying(20),
    total_contributions numeric(15,2) DEFAULT 0,
    account_balance numeric(15,2) DEFAULT 0,
    employer_contribution numeric(15,2) DEFAULT 0,
    employee_contribution numeric(15,2) DEFAULT 0,
    last_sync date,
    status character varying(20) DEFAULT 'active'::character varying
);


--
-- Name: pfa_integration_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.pfa_integration_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: pfa_integration_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.pfa_integration_id_seq OWNED BY public.pfa_integration.id;


--
-- Name: pfa_partners; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pfa_partners (
    id integer NOT NULL,
    "pfaName" character varying(255) NOT NULL,
    "pfaCode" character varying(20),
    "licenseNumber" character varying(64),
    "commissionRate" numeric(5,4),
    products text[],
    status character varying(32) DEFAULT 'Active'::character varying,
    "apiEndpoint" text,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: pfa_partners_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.pfa_partners_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: pfa_partners_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.pfa_partners_id_seq OWNED BY public.pfa_partners.id;


--
-- Name: platform_health_checks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.platform_health_checks (
    id integer NOT NULL,
    service_name text NOT NULL,
    check_type text NOT NULL,
    status text DEFAULT 'healthy'::text NOT NULL,
    response_time integer,
    status_code integer,
    message text,
    metadata text,
    checked_at timestamp without time zone DEFAULT now()
);


--
-- Name: platform_health_checks_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.platform_health_checks_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: platform_health_checks_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.platform_health_checks_id_seq OWNED BY public.platform_health_checks.id;


--
-- Name: platform_incidents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.platform_incidents (
    id integer NOT NULL,
    title text NOT NULL,
    description text,
    severity text DEFAULT 'medium'::text NOT NULL,
    status text DEFAULT 'open'::text NOT NULL,
    affected_services text,
    root_cause text,
    resolution text,
    reported_by text,
    assigned_to text,
    started_at timestamp without time zone DEFAULT now(),
    resolved_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone
);


--
-- Name: platform_incidents_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.platform_incidents_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: platform_incidents_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.platform_incidents_id_seq OWNED BY public.platform_incidents.id;


--
-- Name: platform_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.platform_settings (
    id integer NOT NULL,
    key character varying(128) NOT NULL,
    value text,
    description text,
    "updatedBy" character varying(64),
    "updatedAt" timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: platform_settings_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.platform_settings_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: platform_settings_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.platform_settings_id_seq OWNED BY public.platform_settings.id;


--
-- Name: pnl_reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pnl_reports (
    id integer NOT NULL,
    period text NOT NULL,
    period_type text NOT NULL,
    agent_id integer,
    region_code text,
    total_revenue numeric(15,2) DEFAULT '0'::numeric,
    total_commission numeric(15,2) DEFAULT '0'::numeric,
    total_fees numeric(15,2) DEFAULT '0'::numeric,
    operating_costs numeric(15,2) DEFAULT '0'::numeric,
    net_margin numeric(15,2) DEFAULT '0'::numeric,
    tx_count integer DEFAULT 0,
    tx_volume numeric(15,2) DEFAULT '0'::numeric,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: pnl_reports_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.pnl_reports_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: pnl_reports_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.pnl_reports_id_seq OWNED BY public.pnl_reports.id;


--
-- Name: policies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.policies (
    id integer NOT NULL,
    "userId" integer NOT NULL,
    "policyNumber" character varying(50) NOT NULL,
    name character varying(255) NOT NULL,
    type public.policy_type NOT NULL,
    premium numeric(10,2) NOT NULL,
    status public.policy_status DEFAULT 'Active'::public.policy_status NOT NULL,
    "startDate" timestamp without time zone NOT NULL,
    "expiryDate" timestamp without time zone NOT NULL,
    "sumAssured" numeric(15,2),
    "coverageDetails" text,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp without time zone DEFAULT now() NOT NULL,
    "tenantId" character varying(50) DEFAULT 'default'::character varying
);


--
-- Name: policies_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.policies_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: policies_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.policies_id_seq OWNED BY public.policies.id;


--
-- Name: policies_userId_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."policies_userId_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: policies_userId_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."policies_userId_seq" OWNED BY public.policies."userId";


--
-- Name: pos_terminals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pos_terminals (
    id integer NOT NULL,
    "serialNumber" character varying(64) NOT NULL,
    model character varying(64) DEFAULT 'PAX A920 MAX'::character varying,
    "firmwareVersion" character varying(32),
    "appVersion" character varying(32),
    "agentId" integer,
    status character varying(32) DEFAULT 'unassigned'::character varying NOT NULL,
    "lastCommandAt" timestamp without time zone,
    "lastCommand" character varying(64),
    "configJson" json,
    "groupId" integer,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp without time zone DEFAULT now() NOT NULL,
    "osVersion" character varying(32),
    imei character varying(20),
    "simIccid" character varying(22),
    "lastSeenAt" timestamp without time zone,
    "lastLocation" json,
    "deletedAt" timestamp without time zone,
    "tenantId" integer
);


--
-- Name: pos_terminals_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.pos_terminals_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: pos_terminals_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.pos_terminals_id_seq OWNED BY public.pos_terminals.id;


--
-- Name: premium_collections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.premium_collections (
    id integer NOT NULL,
    "policyId" integer NOT NULL,
    "customerId" integer,
    amount numeric(15,2) NOT NULL,
    "paymentMethod" character varying(50) NOT NULL,
    "paymentRef" character varying(100),
    "paymentGateway" character varying(50),
    "transactionId" character varying(100),
    status character varying(30) DEFAULT 'pending'::character varying,
    "collectionDate" timestamp without time zone DEFAULT now(),
    "dueDate" date,
    "receiptNumber" character varying(50),
    narration text,
    "createdAt" timestamp without time zone DEFAULT now(),
    CONSTRAINT premium_collections_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'processing'::character varying, 'completed'::character varying, 'failed'::character varying, 'refunded'::character varying])::text[])))
);


--
-- Name: premium_collections_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.premium_collections_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: premium_collections_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.premium_collections_id_seq OWNED BY public.premium_collections.id;


--
-- Name: premium_rate_audit_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.premium_rate_audit_logs (
    id integer NOT NULL,
    "userId" integer NOT NULL,
    action character varying(64) NOT NULL,
    "entityType" character varying(64) NOT NULL,
    "entityId" integer NOT NULL,
    details text,
    "ipAddress" character varying(45),
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: premium_rate_audit_logs_entityId_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."premium_rate_audit_logs_entityId_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: premium_rate_audit_logs_entityId_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."premium_rate_audit_logs_entityId_seq" OWNED BY public.premium_rate_audit_logs."entityId";


--
-- Name: premium_rate_audit_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.premium_rate_audit_logs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: premium_rate_audit_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.premium_rate_audit_logs_id_seq OWNED BY public.premium_rate_audit_logs.id;


--
-- Name: premium_rate_audit_logs_userId_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."premium_rate_audit_logs_userId_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: premium_rate_audit_logs_userId_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."premium_rate_audit_logs_userId_seq" OWNED BY public.premium_rate_audit_logs."userId";


--
-- Name: premium_rate_changes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.premium_rate_changes (
    id integer NOT NULL,
    "tableId" integer NOT NULL,
    "factorId" integer NOT NULL,
    "oldRate" numeric(8,4) NOT NULL,
    "newRate" numeric(8,4) NOT NULL,
    "changedBy" integer NOT NULL,
    reason text NOT NULL,
    "effectiveDate" timestamp without time zone NOT NULL,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: premium_rate_changes_changedBy_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."premium_rate_changes_changedBy_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: premium_rate_changes_changedBy_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."premium_rate_changes_changedBy_seq" OWNED BY public.premium_rate_changes."changedBy";


--
-- Name: premium_rate_changes_factorId_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."premium_rate_changes_factorId_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: premium_rate_changes_factorId_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."premium_rate_changes_factorId_seq" OWNED BY public.premium_rate_changes."factorId";


--
-- Name: premium_rate_changes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.premium_rate_changes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: premium_rate_changes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.premium_rate_changes_id_seq OWNED BY public.premium_rate_changes.id;


--
-- Name: premium_rate_changes_tableId_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."premium_rate_changes_tableId_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: premium_rate_changes_tableId_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."premium_rate_changes_tableId_seq" OWNED BY public.premium_rate_changes."tableId";


--
-- Name: premium_rate_tables; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.premium_rate_tables (
    id integer NOT NULL,
    "userId" integer NOT NULL,
    name character varying(255) NOT NULL,
    "productType" character varying(64) NOT NULL,
    "effectiveDate" timestamp without time zone NOT NULL,
    "expiryDate" timestamp without time zone,
    status character varying(32) DEFAULT 'Active'::character varying NOT NULL,
    "baseRate" numeric(8,4) NOT NULL,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: premium_rate_tables_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.premium_rate_tables_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: premium_rate_tables_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.premium_rate_tables_id_seq OWNED BY public.premium_rate_tables.id;


--
-- Name: premium_rate_tables_userId_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."premium_rate_tables_userId_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: premium_rate_tables_userId_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."premium_rate_tables_userId_seq" OWNED BY public.premium_rate_tables."userId";


--
-- Name: premium_risk_factors; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.premium_risk_factors (
    id integer NOT NULL,
    "tableId" integer NOT NULL,
    name character varying(255) NOT NULL,
    category character varying(64) NOT NULL,
    weight numeric(5,4) NOT NULL,
    "minValue" numeric(10,4),
    "maxValue" numeric(10,4),
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: premium_risk_factors_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.premium_risk_factors_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: premium_risk_factors_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.premium_risk_factors_id_seq OWNED BY public.premium_risk_factors.id;


--
-- Name: premium_risk_factors_tableId_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."premium_risk_factors_tableId_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: premium_risk_factors_tableId_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."premium_risk_factors_tableId_seq" OWNED BY public.premium_risk_factors."tableId";


--
-- Name: qr_codes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.qr_codes (
    id integer NOT NULL,
    code character varying(256) NOT NULL,
    type public.qr_code_type DEFAULT 'payment'::public.qr_code_type NOT NULL,
    status public.qr_code_status DEFAULT 'active'::public.qr_code_status NOT NULL,
    "agentId" integer,
    amount numeric(15,2),
    currency character varying(3) DEFAULT 'NGN'::character varying NOT NULL,
    description text,
    metadata json,
    "expiresAt" timestamp without time zone,
    "usedAt" timestamp without time zone,
    "usedByCustomerId" integer,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: qr_codes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.qr_codes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: qr_codes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.qr_codes_id_seq OWNED BY public.qr_codes.id;


--
-- Name: rate_alerts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rate_alerts (
    id bigint NOT NULL,
    agent_id integer NOT NULL,
    base_currency character varying(3) NOT NULL,
    target_currency character varying(3) NOT NULL,
    target_rate numeric(18,8) NOT NULL,
    direction public.rate_alert_direction NOT NULL,
    status public.rate_alert_status DEFAULT 'active'::public.rate_alert_status NOT NULL,
    current_rate numeric(18,8),
    triggered_at timestamp without time zone,
    notified_via json DEFAULT '[]'::json,
    expires_at timestamp without time zone,
    note character varying(256),
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: rate_alerts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.rate_alerts_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: rate_alerts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.rate_alerts_id_seq OWNED BY public.rate_alerts.id;


--
-- Name: rate_limit_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rate_limit_rules (
    id integer NOT NULL,
    endpoint text NOT NULL,
    method text DEFAULT '*'::text NOT NULL,
    max_requests integer NOT NULL,
    window_seconds integer NOT NULL,
    burst_limit integer,
    scope text DEFAULT 'global'::text NOT NULL,
    is_active boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: rate_limit_rules_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.rate_limit_rules_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: rate_limit_rules_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.rate_limit_rules_id_seq OWNED BY public.rate_limit_rules.id;


--
-- Name: realtime_tx_alerts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.realtime_tx_alerts (
    id integer NOT NULL,
    transaction_id text NOT NULL,
    alert_type text NOT NULL,
    severity text DEFAULT 'medium'::text NOT NULL,
    message text NOT NULL,
    metadata text,
    acknowledged boolean DEFAULT false,
    acknowledged_by text,
    acknowledged_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: realtime_tx_alerts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.realtime_tx_alerts_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: realtime_tx_alerts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.realtime_tx_alerts_id_seq OWNED BY public.realtime_tx_alerts.id;


--
-- Name: reconciliation_batches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reconciliation_batches (
    id integer NOT NULL,
    batch_reference text NOT NULL,
    source_type text NOT NULL,
    file_name text,
    file_url text,
    total_records integer DEFAULT 0,
    matched_count integer DEFAULT 0,
    unmatched_count integer DEFAULT 0,
    discrepancy_count integer DEFAULT 0,
    total_amount numeric(15,2),
    status text DEFAULT 'pending'::text NOT NULL,
    processed_by integer,
    processed_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: reconciliation_batches_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.reconciliation_batches_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: reconciliation_batches_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.reconciliation_batches_id_seq OWNED BY public.reconciliation_batches.id;


--
-- Name: reconciliation_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reconciliation_items (
    id integer NOT NULL,
    batch_id integer NOT NULL,
    external_ref text NOT NULL,
    internal_ref text,
    external_amount numeric(15,2) NOT NULL,
    internal_amount numeric(15,2),
    discrepancy numeric(15,2),
    match_status text NOT NULL,
    resolution text,
    resolved_by integer,
    resolved_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: reconciliation_items_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.reconciliation_items_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: reconciliation_items_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.reconciliation_items_id_seq OWNED BY public.reconciliation_items.id;


--
-- Name: referrals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.referrals (
    id integer NOT NULL,
    "referrerId" integer NOT NULL,
    "referredUserId" integer NOT NULL,
    "referredEmail" character varying(320),
    "referredPhone" character varying(20),
    "referralCode" character varying(20) NOT NULL,
    status public.referral_status DEFAULT 'Pending'::public.referral_status NOT NULL,
    "rewardAmount" numeric(10,2) DEFAULT 500.00 NOT NULL,
    "rewardPaidDate" timestamp without time zone,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL,
    "completedAt" timestamp without time zone,
    "updatedAt" timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: referrals_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.referrals_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: referrals_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.referrals_id_seq OWNED BY public.referrals.id;


--
-- Name: referrals_referredUserId_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."referrals_referredUserId_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: referrals_referredUserId_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."referrals_referredUserId_seq" OWNED BY public.referrals."referredUserId";


--
-- Name: referrals_referrerId_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."referrals_referrerId_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: referrals_referrerId_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."referrals_referrerId_seq" OWNED BY public.referrals."referrerId";


--
-- Name: refunds; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.refunds (
    id integer NOT NULL,
    ref character varying(32) NOT NULL,
    "disputeId" integer,
    "transactionId" integer,
    "transactionRef" character varying(32),
    "agentId" integer NOT NULL,
    "customerId" integer,
    "customerName" character varying(128),
    "customerPhone" character varying(20),
    "originalAmount" integer NOT NULL,
    "refundAmount" integer NOT NULL,
    currency character varying(3) DEFAULT 'NGN'::character varying NOT NULL,
    reason character varying(256) NOT NULL,
    category character varying(64) DEFAULT 'general'::character varying NOT NULL,
    status character varying(32) DEFAULT 'pending'::character varying NOT NULL,
    method character varying(32) DEFAULT 'original_method'::character varying NOT NULL,
    "approvedBy" character varying(128),
    "approvedAt" timestamp without time zone,
    "processedAt" timestamp without time zone,
    "rejectedBy" character varying(128),
    "rejectedAt" timestamp without time zone,
    "rejectionReason" text,
    notes text,
    metadata text,
    "tenantId" integer,
    "deletedAt" timestamp without time zone,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: refunds_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.refunds_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: refunds_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.refunds_id_seq OWNED BY public.refunds.id;


--
-- Name: reinsurance_bordereaux; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reinsurance_bordereaux (
    id integer NOT NULL,
    treaty_id integer,
    period character varying(20) NOT NULL,
    type character varying(30) NOT NULL,
    total_amount numeric(18,2) NOT NULL,
    line_items integer DEFAULT 0,
    status character varying(20) DEFAULT 'draft'::character varying,
    sent_at timestamp without time zone,
    acknowledged_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now(),
    CONSTRAINT reinsurance_bordereaux_status_check CHECK (((status)::text = ANY ((ARRAY['draft'::character varying, 'sent'::character varying, 'acknowledged'::character varying, 'reconciled'::character varying])::text[]))),
    CONSTRAINT reinsurance_bordereaux_type_check CHECK (((type)::text = ANY ((ARRAY['premium'::character varying, 'claims'::character varying, 'settlement'::character varying])::text[])))
);


--
-- Name: reinsurance_bordereaux_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.reinsurance_bordereaux_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: reinsurance_bordereaux_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.reinsurance_bordereaux_id_seq OWNED BY public.reinsurance_bordereaux.id;


--
-- Name: reinsurance_cessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reinsurance_cessions (
    id integer NOT NULL,
    "treatyId" integer NOT NULL,
    "policyId" integer NOT NULL,
    "cedingAmount" numeric(15,2) NOT NULL,
    "retainedAmount" numeric(15,2) NOT NULL,
    "reinsurerPremium" numeric(10,2),
    status character varying(32) DEFAULT 'Active'::character varying,
    "cessionDate" timestamp without time zone DEFAULT now() NOT NULL,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: reinsurance_cessions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.reinsurance_cessions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: reinsurance_cessions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.reinsurance_cessions_id_seq OWNED BY public.reinsurance_cessions.id;


--
-- Name: reinsurance_cessions_policyId_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."reinsurance_cessions_policyId_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: reinsurance_cessions_policyId_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."reinsurance_cessions_policyId_seq" OWNED BY public.reinsurance_cessions."policyId";


--
-- Name: reinsurance_cessions_treatyId_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."reinsurance_cessions_treatyId_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: reinsurance_cessions_treatyId_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."reinsurance_cessions_treatyId_seq" OWNED BY public.reinsurance_cessions."treatyId";


--
-- Name: reinsurance_claims_recovery; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reinsurance_claims_recovery (
    id integer NOT NULL,
    cession_id integer,
    treaty_id integer,
    claim_id integer,
    claim_amount numeric(18,2) NOT NULL,
    recoverable_amount numeric(18,2) NOT NULL,
    recovered_amount numeric(18,2) DEFAULT 0,
    status character varying(20) DEFAULT 'pending'::character varying,
    recovery_ref character varying(50),
    notified_at timestamp without time zone,
    paid_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now(),
    CONSTRAINT reinsurance_claims_recovery_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'notified'::character varying, 'approved'::character varying, 'paid'::character varying, 'disputed'::character varying])::text[])))
);


--
-- Name: reinsurance_claims_recovery_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.reinsurance_claims_recovery_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: reinsurance_claims_recovery_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.reinsurance_claims_recovery_id_seq OWNED BY public.reinsurance_claims_recovery.id;


--
-- Name: reinsurance_facultative; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reinsurance_facultative (
    id integer NOT NULL,
    policy_id integer,
    sum_assured numeric(18,2) NOT NULL,
    risk_description text,
    placement_status character varying(20) DEFAULT 'open'::character varying,
    placed_with character varying(100),
    placement_percentage numeric(5,2),
    premium_rate numeric(8,6),
    premium_amount numeric(18,2),
    valid_from date,
    valid_to date,
    created_at timestamp without time zone DEFAULT now(),
    CONSTRAINT reinsurance_facultative_placement_status_check CHECK (((placement_status)::text = ANY ((ARRAY['open'::character varying, 'placed'::character varying, 'declined'::character varying, 'expired'::character varying])::text[])))
);


--
-- Name: reinsurance_facultative_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.reinsurance_facultative_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: reinsurance_facultative_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.reinsurance_facultative_id_seq OWNED BY public.reinsurance_facultative.id;


--
-- Name: reinsurance_settlements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reinsurance_settlements (
    id integer NOT NULL,
    treaty_id integer,
    settlement_type character varying(30) NOT NULL,
    period character varying(20) NOT NULL,
    amount numeric(18,2) NOT NULL,
    currency character varying(3) DEFAULT 'NGN'::character varying,
    status character varying(20) DEFAULT 'pending'::character varying,
    due_date date,
    paid_at timestamp without time zone,
    reference character varying(50),
    created_at timestamp without time zone DEFAULT now(),
    CONSTRAINT reinsurance_settlements_settlement_type_check CHECK (((settlement_type)::text = ANY ((ARRAY['premium_cession'::character varying, 'claims_recovery'::character varying, 'commission'::character varying, 'profit_commission'::character varying, 'cash_call'::character varying])::text[]))),
    CONSTRAINT reinsurance_settlements_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'invoiced'::character varying, 'paid'::character varying, 'overdue'::character varying])::text[])))
);


--
-- Name: reinsurance_settlements_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.reinsurance_settlements_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: reinsurance_settlements_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.reinsurance_settlements_id_seq OWNED BY public.reinsurance_settlements.id;


--
-- Name: reinsurance_treaties; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reinsurance_treaties (
    id integer NOT NULL,
    "userId" integer NOT NULL,
    "treatyName" character varying(255) NOT NULL,
    "treatyType" character varying(64) NOT NULL,
    reinsurer character varying(255),
    "reinsurerShare" numeric(5,4),
    "retentionLimit" numeric(15,2),
    "coverLimit" numeric(15,2),
    "commissionRate" numeric(5,4),
    "effectiveDate" timestamp without time zone,
    "expiryDate" timestamp without time zone,
    status character varying(32) DEFAULT 'Active'::character varying,
    "linesOfBusiness" text[],
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: reinsurance_treaties_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.reinsurance_treaties_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: reinsurance_treaties_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.reinsurance_treaties_id_seq OWNED BY public.reinsurance_treaties.id;


--
-- Name: reinsurance_treaties_userId_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."reinsurance_treaties_userId_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: reinsurance_treaties_userId_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."reinsurance_treaties_userId_seq" OWNED BY public.reinsurance_treaties."userId";


--
-- Name: reversal_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reversal_requests (
    id integer NOT NULL,
    "transactionId" character varying(64) NOT NULL,
    "agentId" integer NOT NULL,
    reason text NOT NULL,
    amount numeric(15,2) NOT NULL,
    currency character varying(3) DEFAULT 'NGN'::character varying NOT NULL,
    status public.reversal_status DEFAULT 'pending'::public.reversal_status NOT NULL,
    "reviewedBy" integer,
    "reviewedAt" timestamp without time zone,
    "reviewNote" text,
    "tbReversalId" character varying(64),
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: reversal_requests_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.reversal_requests_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: reversal_requests_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.reversal_requests_id_seq OWNED BY public.reversal_requests.id;


--
-- Name: reviews; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reviews (
    id integer NOT NULL,
    "userId" integer NOT NULL,
    "reviewType" public.review_type NOT NULL,
    "entityId" integer NOT NULL,
    rating integer NOT NULL,
    comment text,
    "agentName" character varying(255),
    "isPublic" boolean DEFAULT true NOT NULL,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: reviews_entityId_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."reviews_entityId_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: reviews_entityId_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."reviews_entityId_seq" OWNED BY public.reviews."entityId";


--
-- Name: reviews_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.reviews_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: reviews_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.reviews_id_seq OWNED BY public.reviews.id;


--
-- Name: reviews_rating_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.reviews_rating_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: reviews_rating_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.reviews_rating_seq OWNED BY public.reviews.rating;


--
-- Name: reviews_userId_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."reviews_userId_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: reviews_userId_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."reviews_userId_seq" OWNED BY public.reviews."userId";


--
-- Name: roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.roles (
    id integer NOT NULL,
    name character varying(50) NOT NULL,
    description text,
    permissions jsonb DEFAULT '[]'::jsonb NOT NULL,
    "isSystem" boolean DEFAULT false,
    "createdAt" timestamp without time zone DEFAULT now()
);


--
-- Name: roles_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.roles_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: roles_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.roles_id_seq OWNED BY public.roles.id;


--
-- Name: savings_accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.savings_accounts (
    id integer NOT NULL,
    "userId" integer NOT NULL,
    "planId" character varying(64) NOT NULL,
    "planName" character varying(255),
    balance numeric(15,2) DEFAULT '0'::numeric,
    "targetAmount" numeric(15,2),
    "interestRate" numeric(5,4),
    status character varying(32) DEFAULT 'Active'::character varying,
    "maturityDate" timestamp without time zone,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: savings_accounts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.savings_accounts_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: savings_accounts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.savings_accounts_id_seq OWNED BY public.savings_accounts.id;


--
-- Name: savings_accounts_userId_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."savings_accounts_userId_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: savings_accounts_userId_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."savings_accounts_userId_seq" OWNED BY public.savings_accounts."userId";


--
-- Name: savings_plans; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.savings_plans (
    id integer NOT NULL,
    user_id integer,
    name character varying(100),
    target_amount numeric(12,2),
    current_amount numeric(12,2) DEFAULT 0,
    interest_rate numeric(5,2) DEFAULT 8.5,
    frequency character varying(20) DEFAULT 'monthly'::character varying,
    status character varying(20) DEFAULT 'active'::character varying,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: savings_plans_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.savings_plans_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: savings_plans_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.savings_plans_id_seq OWNED BY public.savings_plans.id;


--
-- Name: score_improvement_tips; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.score_improvement_tips (
    id integer NOT NULL,
    suggestion text NOT NULL,
    impact character varying(30) NOT NULL,
    priority character varying(10) NOT NULL,
    category character varying(50),
    applicable_score_range int4range,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: score_improvement_tips_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.score_improvement_tips_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: score_improvement_tips_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.score_improvement_tips_id_seq OWNED BY public.score_improvement_tips.id;


--
-- Name: service_records; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.service_records (
    id integer NOT NULL,
    "terminalId" integer NOT NULL,
    "technicianName" character varying(128),
    "issueDescription" text NOT NULL,
    resolution text,
    "partsReplaced" json,
    "serviceDate" timestamp without time zone DEFAULT now() NOT NULL,
    "nextServiceDate" timestamp without time zone,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: service_records_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.service_records_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: service_records_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.service_records_id_seq OWNED BY public.service_records.id;


--
-- Name: settlement_reconciliation; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.settlement_reconciliation (
    id integer NOT NULL,
    settlement_date character varying(10) NOT NULL,
    agent_id integer,
    agent_code character varying(32),
    expected_amount numeric(18,2) NOT NULL,
    actual_amount numeric(18,2) NOT NULL,
    discrepancy numeric(18,2) DEFAULT '0'::numeric NOT NULL,
    status public.reconciliation_status DEFAULT 'pending'::public.reconciliation_status NOT NULL,
    resolved_by integer,
    resolution_note text,
    resolved_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: settlement_reconciliation_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.settlement_reconciliation_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: settlement_reconciliation_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.settlement_reconciliation_id_seq OWNED BY public.settlement_reconciliation.id;


--
-- Name: shareable_links; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.shareable_links (
    id integer NOT NULL,
    slug character varying(64) NOT NULL,
    type public.link_type DEFAULT 'payment'::public.link_type NOT NULL,
    status public.link_status DEFAULT 'active'::public.link_status NOT NULL,
    "agentId" integer NOT NULL,
    amount numeric(15,2),
    currency character varying(3) DEFAULT 'NGN'::character varying NOT NULL,
    description text,
    metadata json,
    "clickCount" integer DEFAULT 0 NOT NULL,
    "conversionCount" integer DEFAULT 0 NOT NULL,
    "expiresAt" timestamp without time zone,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: shareable_links_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.shareable_links_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: shareable_links_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.shareable_links_id_seq OWNED BY public.shareable_links.id;


--
-- Name: sim_failover_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sim_failover_log (
    id integer NOT NULL,
    "terminalId" character varying(32) NOT NULL,
    "agentCode" character varying(32) NOT NULL,
    "fromSlot" integer NOT NULL,
    "toSlot" integer NOT NULL,
    reason character varying(32) NOT NULL,
    "latencyMs" integer NOT NULL,
    "lossX10" integer NOT NULL,
    "txRef" character varying(64),
    "switchedAt" timestamp without time zone DEFAULT now() NOT NULL,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: sim_failover_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.sim_failover_log_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sim_failover_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.sim_failover_log_id_seq OWNED BY public.sim_failover_log.id;


--
-- Name: sim_orchestrator_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sim_orchestrator_config (
    id integer NOT NULL,
    "terminalId" character varying(32) NOT NULL,
    "probeIntervalMs" integer DEFAULT 30000 NOT NULL,
    "relayEndpoint" character varying(256) DEFAULT 'https://api.54link.io/api/trpc/simOrchestrator.ingestProbe'::character varying NOT NULL,
    "apiKey" character varying(128) DEFAULT '54link-sim-orchestrator-default-key'::character varying NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: sim_orchestrator_config_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.sim_orchestrator_config_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sim_orchestrator_config_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.sim_orchestrator_config_id_seq OWNED BY public.sim_orchestrator_config.id;


--
-- Name: sim_probe_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sim_probe_log (
    id integer NOT NULL,
    "agentCode" character varying(32) NOT NULL,
    "terminalId" character varying(32) NOT NULL,
    slot character varying(8) NOT NULL,
    carrier character varying(32) NOT NULL,
    "mccMnc" integer NOT NULL,
    rssi integer NOT NULL,
    "regStatus" integer NOT NULL,
    "latencyMs" integer NOT NULL,
    "packetLossX10" integer NOT NULL,
    score integer NOT NULL,
    selected boolean DEFAULT false NOT NULL,
    "latE6" integer,
    "lonE6" integer,
    "fwVersion" character varying(16),
    "probedAt" timestamp without time zone NOT NULL,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: sim_probe_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.sim_probe_log_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sim_probe_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.sim_probe_log_id_seq OWNED BY public.sim_probe_log.id;


--
-- Name: sla_breaches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sla_breaches (
    id integer NOT NULL,
    sla_definition_id integer NOT NULL,
    breach_type text NOT NULL,
    actual_value integer NOT NULL,
    target_value integer NOT NULL,
    duration integer,
    impact_level text DEFAULT 'medium'::text NOT NULL,
    resolved_at timestamp without time zone,
    resolution text,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: sla_breaches_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.sla_breaches_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sla_breaches_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.sla_breaches_id_seq OWNED BY public.sla_breaches.id;


--
-- Name: sla_definitions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sla_definitions (
    id integer NOT NULL,
    name text NOT NULL,
    service_type text NOT NULL,
    metric_type text NOT NULL,
    target_value integer NOT NULL,
    warning_threshold integer,
    critical_threshold integer,
    measurement_window text DEFAULT '1h'::text NOT NULL,
    is_active boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone
);


--
-- Name: sla_definitions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.sla_definitions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sla_definitions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.sla_definitions_id_seq OWNED BY public.sla_definitions.id;


--
-- Name: sme_policies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sme_policies (
    id integer NOT NULL,
    "userId" integer NOT NULL,
    "productId" character varying(64) NOT NULL,
    "businessName" character varying(255),
    "businessType" character varying(64),
    "annualPremium" numeric(10,2),
    "coverageAmount" numeric(15,2),
    status character varying(32) DEFAULT 'Active'::character varying,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: sme_policies_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.sme_policies_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sme_policies_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.sme_policies_id_seq OWNED BY public.sme_policies.id;


--
-- Name: sme_policies_userId_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."sme_policies_userId_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sme_policies_userId_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."sme_policies_userId_seq" OWNED BY public.sme_policies."userId";


--
-- Name: software_updates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.software_updates (
    id integer NOT NULL,
    version character varying(32) NOT NULL,
    "releaseNotes" text,
    "downloadUrl" text NOT NULL,
    checksum character varying(128),
    "isForced" boolean DEFAULT false NOT NULL,
    "targetModels" json,
    "appliedCount" integer DEFAULT 0 NOT NULL,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: software_updates_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.software_updates_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: software_updates_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.software_updates_id_seq OWNED BY public.software_updates.id;


--
-- Name: storefront_ads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.storefront_ads (
    id integer NOT NULL,
    title character varying(128) NOT NULL,
    body text,
    "imageUrl" text,
    "targetUrl" text,
    "agentId" integer,
    status public.ad_status DEFAULT 'draft'::public.ad_status NOT NULL,
    impressions integer DEFAULT 0 NOT NULL,
    clicks integer DEFAULT 0 NOT NULL,
    budget numeric(12,2),
    spent numeric(12,2) DEFAULT 0.00 NOT NULL,
    "startsAt" timestamp without time zone,
    "endsAt" timestamp without time zone,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: storefront_ads_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.storefront_ads_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: storefront_ads_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.storefront_ads_id_seq OWNED BY public.storefront_ads.id;


--
-- Name: supervisor_agents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.supervisor_agents (
    id integer NOT NULL,
    "supervisorUserId" integer,
    "agentId" integer NOT NULL,
    "assignedAt" timestamp without time zone DEFAULT now() NOT NULL,
    "supervisorId" integer,
    "removedAt" timestamp without time zone
);


--
-- Name: supervisor_agents_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.supervisor_agents_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: supervisor_agents_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.supervisor_agents_id_seq OWNED BY public.supervisor_agents.id;


--
-- Name: system_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.system_config (
    id integer NOT NULL,
    key character varying(128) NOT NULL,
    value text NOT NULL,
    description text,
    "updatedBy" character varying(64),
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: system_config_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.system_config_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: system_config_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.system_config_id_seq OWNED BY public.system_config.id;


--
-- Name: system_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.system_settings (
    id integer NOT NULL,
    category character varying(50) NOT NULL,
    key character varying(100) NOT NULL,
    value jsonb NOT NULL,
    description text,
    updated_by character varying(100) DEFAULT 'system'::character varying,
    updated_at timestamp without time zone DEFAULT now()
);


--
-- Name: system_settings_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.system_settings_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: system_settings_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.system_settings_id_seq OWNED BY public.system_settings.id;


--
-- Name: takaful_pools; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.takaful_pools (
    id integer NOT NULL,
    name character varying(100) NOT NULL,
    pool_type character varying(30) NOT NULL,
    total_contributions numeric(15,2) DEFAULT 0,
    member_count integer DEFAULT 0,
    surplus_distributed numeric(15,2) DEFAULT 0,
    wakala_fee_pct numeric(4,2) DEFAULT 0,
    status character varying(20) DEFAULT 'active'::character varying,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: takaful_pools_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.takaful_pools_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: takaful_pools_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.takaful_pools_id_seq OWNED BY public.takaful_pools.id;


--
-- Name: takaful_sharia_principles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.takaful_sharia_principles (
    id integer NOT NULL,
    name character varying(100) NOT NULL,
    description text NOT NULL,
    category character varying(30),
    order_num integer DEFAULT 0
);


--
-- Name: takaful_sharia_principles_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.takaful_sharia_principles_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: takaful_sharia_principles_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.takaful_sharia_principles_id_seq OWNED BY public.takaful_sharia_principles.id;


--
-- Name: telco_credit_scores; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.telco_credit_scores (
    id integer NOT NULL,
    "userId" integer NOT NULL,
    "phoneNumber" character varying(20) NOT NULL,
    provider character varying(64) NOT NULL,
    score integer NOT NULL,
    grade character varying(2) NOT NULL,
    factors text[],
    "consentGiven" boolean DEFAULT false NOT NULL,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL,
    "expiresAt" timestamp without time zone
);


--
-- Name: telco_credit_scores_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.telco_credit_scores_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: telco_credit_scores_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.telco_credit_scores_id_seq OWNED BY public.telco_credit_scores.id;


--
-- Name: telco_credit_scores_score_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.telco_credit_scores_score_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: telco_credit_scores_score_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.telco_credit_scores_score_seq OWNED BY public.telco_credit_scores.score;


--
-- Name: telco_credit_scores_userId_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."telco_credit_scores_userId_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: telco_credit_scores_userId_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."telco_credit_scores_userId_seq" OWNED BY public.telco_credit_scores."userId";


--
-- Name: telematics_devices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.telematics_devices (
    id integer NOT NULL,
    "userId" integer DEFAULT 1 NOT NULL,
    "deviceId" character varying(64) NOT NULL,
    name character varying(255),
    device_type character varying(64),
    make character varying(128),
    model character varying(128),
    imei character varying(20),
    vehicle_vin character varying(20),
    install_date timestamp without time zone,
    last_ping timestamp without time zone,
    avg_daily_km numeric(8,2),
    harsh_braking_events integer DEFAULT 0,
    speeding_events integer DEFAULT 0,
    night_driving_pct integer DEFAULT 0,
    driver_score integer DEFAULT 80,
    status character varying(32) DEFAULT 'Active'::character varying,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: telematics_devices_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.telematics_devices_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: telematics_devices_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.telematics_devices_id_seq OWNED BY public.telematics_devices.id;


--
-- Name: tenant_branding; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tenant_branding (
    id integer NOT NULL,
    "tenantId" integer NOT NULL,
    "logoUrl" text,
    "faviconUrl" text,
    "primaryColor" character varying(9) DEFAULT '#2563EB'::character varying NOT NULL,
    "secondaryColor" character varying(9) DEFAULT '#1E40AF'::character varying NOT NULL,
    "accentColor" character varying(9) DEFAULT '#F59E0B'::character varying NOT NULL,
    "backgroundColor" character varying(9) DEFAULT '#0F172A'::character varying NOT NULL,
    "textColor" character varying(9) DEFAULT '#F8FAFC'::character varying NOT NULL,
    "fontFamily" character varying(64) DEFAULT 'Inter'::character varying NOT NULL,
    "brandName" character varying(128),
    tagline character varying(256),
    "customDomain" character varying(256),
    "supportEmail" character varying(320),
    "supportPhone" character varying(20),
    "termsUrl" text,
    "privacyUrl" text,
    "customCss" text,
    "isLive" boolean DEFAULT false NOT NULL,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: tenant_branding_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.tenant_branding_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: tenant_branding_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.tenant_branding_id_seq OWNED BY public.tenant_branding.id;


--
-- Name: tenant_corridors; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tenant_corridors (
    id integer NOT NULL,
    "tenantId" integer NOT NULL,
    "sourceCountry" character varying(3) NOT NULL,
    "sourceCurrency" character varying(3) NOT NULL,
    "destinationCountry" character varying(3) NOT NULL,
    "destinationCurrency" character varying(3) NOT NULL,
    status public.corridor_status DEFAULT 'active'::public.corridor_status NOT NULL,
    "minAmount" numeric(20,2) DEFAULT 10.00 NOT NULL,
    "maxAmount" numeric(20,2) DEFAULT 1000000.00 NOT NULL,
    "dailyLimit" numeric(20,2) DEFAULT 5000000.00 NOT NULL,
    "estimatedDeliveryMinutes" integer DEFAULT 30 NOT NULL,
    "paymentMethods" json DEFAULT '["bank_transfer","mobile_money"]'::json,
    "deliveryMethods" json DEFAULT '["bank_deposit","mobile_wallet"]'::json,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: tenant_corridors_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.tenant_corridors_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: tenant_corridors_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.tenant_corridors_id_seq OWNED BY public.tenant_corridors.id;


--
-- Name: tenant_feature_toggles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tenant_feature_toggles (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    feature_key text NOT NULL,
    enabled boolean DEFAULT false,
    config text,
    enabled_by integer,
    enabled_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: tenant_feature_toggles_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.tenant_feature_toggles_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: tenant_feature_toggles_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.tenant_feature_toggles_id_seq OWNED BY public.tenant_feature_toggles.id;


--
-- Name: tenant_fee_overrides; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tenant_fee_overrides (
    id integer NOT NULL,
    "tenantId" integer NOT NULL,
    "corridorId" integer,
    "txType" character varying(64) DEFAULT 'transfer'::character varying NOT NULL,
    "feeType" public.fee_type DEFAULT 'percentage'::public.fee_type NOT NULL,
    "feeValue" numeric(10,4) DEFAULT 1.5000 NOT NULL,
    "minFee" numeric(20,2) DEFAULT 100.00 NOT NULL,
    "maxFee" numeric(20,2) DEFAULT 50000.00 NOT NULL,
    "tieredRules" json,
    description text,
    "isActive" boolean DEFAULT true NOT NULL,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: tenant_fee_overrides_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.tenant_fee_overrides_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: tenant_fee_overrides_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.tenant_fee_overrides_id_seq OWNED BY public.tenant_fee_overrides.id;


--
-- Name: tenant_users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tenant_users (
    id integer NOT NULL,
    "tenantId" integer NOT NULL,
    "userId" integer,
    email character varying(320) NOT NULL,
    name character varying(128),
    role public.tenant_user_role DEFAULT 'tenant_viewer'::public.tenant_user_role NOT NULL,
    "isActive" boolean DEFAULT true NOT NULL,
    "invitedBy" integer,
    "invitedAt" timestamp without time zone DEFAULT now() NOT NULL,
    "acceptedAt" timestamp without time zone,
    "lastActiveAt" timestamp without time zone,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: tenant_users_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.tenant_users_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: tenant_users_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.tenant_users_id_seq OWNED BY public.tenant_users.id;


--
-- Name: tenants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tenants (
    id integer NOT NULL,
    slug character varying(64) NOT NULL,
    name character varying(128) NOT NULL,
    country character varying(3) DEFAULT 'NGA'::character varying NOT NULL,
    currency character varying(3) DEFAULT 'NGN'::character varying NOT NULL,
    status public.tenant_status DEFAULT 'trial'::public.tenant_status NOT NULL,
    "planId" character varying(64),
    "agentCount" integer DEFAULT 0 NOT NULL,
    "terminalCount" integer DEFAULT 0 NOT NULL,
    "monthlyVolume" numeric(20,2) DEFAULT 0.00 NOT NULL,
    "contactEmail" character varying(320),
    "contactPhone" character varying(20),
    "configJson" json,
    "keycloakRealmId" character varying(128),
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp without time zone DEFAULT now() NOT NULL,
    "webhookSecret" character varying(128),
    domain character varying(255),
    settings jsonb DEFAULT '{}'::jsonb
);


--
-- Name: tenants_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.tenants_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: tenants_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.tenants_id_seq OWNED BY public.tenants.id;


--
-- Name: terminal_groups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.terminal_groups (
    id integer NOT NULL,
    name character varying(128) NOT NULL,
    description text,
    "configJson" json,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: terminal_groups_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.terminal_groups_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: terminal_groups_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.terminal_groups_id_seq OWNED BY public.terminal_groups.id;


--
-- Name: training_courses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.training_courses (
    id integer NOT NULL,
    title text NOT NULL,
    description text,
    category text NOT NULL,
    content_type text NOT NULL,
    content_url text,
    duration_minutes integer,
    passing_score integer DEFAULT 70,
    is_mandatory boolean DEFAULT false,
    is_active boolean DEFAULT true,
    version integer DEFAULT 1,
    created_by integer,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: training_courses_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.training_courses_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: training_courses_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.training_courses_id_seq OWNED BY public.training_courses.id;


--
-- Name: training_enrollments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.training_enrollments (
    id integer NOT NULL,
    course_id integer NOT NULL,
    agent_id integer NOT NULL,
    status text DEFAULT 'enrolled'::text NOT NULL,
    progress integer DEFAULT 0,
    score integer,
    started_at timestamp without time zone,
    completed_at timestamp without time zone,
    certificate_url text,
    expires_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: training_enrollments_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.training_enrollments_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: training_enrollments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.training_enrollments_id_seq OWNED BY public.training_enrollments.id;


--
-- Name: transaction_limits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.transaction_limits (
    id integer NOT NULL,
    agent_tier text NOT NULL,
    tx_type text NOT NULL,
    daily_limit numeric(15,2) NOT NULL,
    monthly_limit numeric(15,2) NOT NULL,
    per_tx_limit numeric(15,2) NOT NULL,
    is_active boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);


--
-- Name: transaction_limits_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.transaction_limits_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: transaction_limits_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.transaction_limits_id_seq OWNED BY public.transaction_limits.id;


--
-- Name: transactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.transactions (
    id integer NOT NULL,
    ref character varying(32) NOT NULL,
    "agentId" integer NOT NULL,
    type public.tx_type NOT NULL,
    amount numeric(15,2) NOT NULL,
    fee numeric(10,2) DEFAULT 0.00,
    commission numeric(10,2) DEFAULT 0.00,
    "customerName" character varying(128),
    "customerPhone" character varying(20),
    "customerAccount" character varying(20),
    "destinationBank" character varying(64),
    "destinationAccount" character varying(20),
    channel public.tx_channel DEFAULT 'Cash'::public.tx_channel,
    status public.tx_status DEFAULT 'pending'::public.tx_status NOT NULL,
    "failureReason" text,
    "receiptPrinted" boolean DEFAULT false,
    "smsSent" boolean DEFAULT false,
    "fraudScore" numeric(5,2) DEFAULT 0.00,
    metadata json,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp without time zone DEFAULT now() NOT NULL,
    "velocityBreached" boolean DEFAULT false,
    "velocityReason" text,
    "approvalRequired" boolean DEFAULT false,
    "approvedBy" character varying(64),
    "approvedAt" timestamp without time zone,
    "deviceToken" character varying(64),
    "idempotencyKey" character varying(64),
    currency character varying(8) DEFAULT 'NGN'::character varying NOT NULL,
    "deletedAt" timestamp without time zone,
    "tenantId" integer
);


--
-- Name: transactions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.transactions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: transactions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.transactions_id_seq OWNED BY public.transactions.id;


--
-- Name: tx_monitoring_alerts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tx_monitoring_alerts (
    id integer NOT NULL,
    transaction_id integer,
    alert_type text NOT NULL,
    severity text NOT NULL,
    description text NOT NULL,
    risk_score numeric(5,2),
    agent_id integer,
    resolved boolean DEFAULT false,
    resolved_by integer,
    resolved_at timestamp without time zone,
    metadata text,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: tx_monitoring_alerts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.tx_monitoring_alerts_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: tx_monitoring_alerts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.tx_monitoring_alerts_id_seq OWNED BY public.tx_monitoring_alerts.id;


--
-- Name: underwriting_decisions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.underwriting_decisions (
    id integer NOT NULL,
    "applicationId" integer,
    "customerId" integer,
    "productType" character varying(100),
    decision character varying(30) NOT NULL,
    "riskScore" numeric(5,2),
    "riskCategory" character varying(20),
    "premiumLoading" numeric(5,2) DEFAULT 0,
    exclusions jsonb DEFAULT '[]'::jsonb,
    conditions jsonb DEFAULT '[]'::jsonb,
    "rulesApplied" jsonb DEFAULT '[]'::jsonb,
    "underwriterId" integer,
    notes text,
    "decisionDate" timestamp without time zone DEFAULT now(),
    "createdAt" timestamp without time zone DEFAULT now(),
    CONSTRAINT underwriting_decisions_decision_check CHECK (((decision)::text = ANY ((ARRAY['auto_approved'::character varying, 'referred'::character varying, 'declined'::character varying, 'counter_offer'::character varying])::text[])))
);


--
-- Name: underwriting_decisions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.underwriting_decisions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: underwriting_decisions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.underwriting_decisions_id_seq OWNED BY public.underwriting_decisions.id;


--
-- Name: underwriting_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.underwriting_rules (
    id integer NOT NULL,
    "productType" character varying(100) NOT NULL,
    "ruleName" character varying(200) NOT NULL,
    "ruleType" character varying(50) NOT NULL,
    conditions jsonb DEFAULT '{}'::jsonb NOT NULL,
    action jsonb DEFAULT '{}'::jsonb NOT NULL,
    priority integer DEFAULT 100 NOT NULL,
    "isActive" boolean DEFAULT true NOT NULL,
    "naicomRef" character varying(100),
    "createdAt" timestamp without time zone DEFAULT now(),
    "updatedAt" timestamp without time zone DEFAULT now(),
    CONSTRAINT "underwriting_rules_ruleType_check" CHECK ((("ruleType")::text = ANY ((ARRAY['eligibility'::character varying, 'pricing'::character varying, 'exclusion'::character varying, 'limit'::character varying, 'sublimit'::character varying])::text[])))
);


--
-- Name: underwriting_rules_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.underwriting_rules_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: underwriting_rules_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.underwriting_rules_id_seq OWNED BY public.underwriting_rules.id;


--
-- Name: user_achievements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_achievements (
    id integer NOT NULL,
    user_id integer,
    achievement_id integer,
    earned_at timestamp without time zone,
    progress integer DEFAULT 0,
    target integer DEFAULT 1
);


--
-- Name: user_achievements_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.user_achievements_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: user_achievements_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.user_achievements_id_seq OWNED BY public.user_achievements.id;


--
-- Name: user_roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_roles (
    id integer NOT NULL,
    "userId" integer NOT NULL,
    "roleId" integer NOT NULL,
    "assignedBy" integer,
    "assignedAt" timestamp without time zone DEFAULT now()
);


--
-- Name: user_roles_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.user_roles_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: user_roles_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.user_roles_id_seq OWNED BY public.user_roles.id;


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id integer NOT NULL,
    name text,
    email character varying(320),
    "loginMethod" character varying(64),
    role public.role DEFAULT 'user'::public.role NOT NULL,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp without time zone DEFAULT now() NOT NULL,
    "lastSignedIn" timestamp without time zone DEFAULT now() NOT NULL,
    "mfaEnabled" boolean DEFAULT false NOT NULL,
    "mfaEnforcedAt" timestamp without time zone,
    "tenantId" integer,
    "stripeCustomerId" character varying(255),
    "stripeSubscriptionId" character varying(255),
    "stripePlanId" character varying(128),
    "passwordHash" text,
    "displayName" text,
    phone text,
    "totpSecret" character varying(64),
    "totpEnabled" boolean DEFAULT false
);


--
-- Name: users_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.users_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: users_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.users_id_seq OWNED BY public.users.id;


--
-- Name: ussd_analytics; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ussd_analytics (
    id integer NOT NULL,
    date date NOT NULL,
    total_sessions integer DEFAULT 0,
    completed_sessions integer DEFAULT 0,
    timeout_sessions integer DEFAULT 0,
    policy_lookups integer DEFAULT 0,
    claims_filed integer DEFAULT 0,
    payments_initiated integer DEFAULT 0,
    quotes_requested integer DEFAULT 0,
    avg_session_duration_seconds integer DEFAULT 0,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: ussd_analytics_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ussd_analytics_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ussd_analytics_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ussd_analytics_id_seq OWNED BY public.ussd_analytics.id;


--
-- Name: ussd_pins; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ussd_pins (
    id integer NOT NULL,
    phone character varying(20) NOT NULL,
    pin_hash character varying(100) NOT NULL,
    attempts integer DEFAULT 0,
    locked_until timestamp without time zone,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: ussd_pins_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ussd_pins_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ussd_pins_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ussd_pins_id_seq OWNED BY public.ussd_pins.id;


--
-- Name: ussd_session_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ussd_session_log (
    id integer NOT NULL,
    session_id character varying(50) NOT NULL,
    phone character varying(20) NOT NULL,
    menu_level integer DEFAULT 0,
    user_input text,
    response text,
    status character varying(20) DEFAULT 'active'::character varying,
    pin_verified boolean DEFAULT false,
    transaction_ref character varying(50),
    expires_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now(),
    CONSTRAINT ussd_session_log_status_check CHECK (((status)::text = ANY ((ARRAY['active'::character varying, 'completed'::character varying, 'timeout'::character varying, 'error'::character varying])::text[])))
);


--
-- Name: ussd_session_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ussd_session_log_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ussd_session_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ussd_session_log_id_seq OWNED BY public.ussd_session_log.id;


--
-- Name: ussd_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ussd_sessions (
    id integer NOT NULL,
    "sessionId" character varying(128) NOT NULL,
    "phoneNumber" character varying(20) NOT NULL,
    "currentMenu" character varying(64),
    "sessionData" text,
    status character varying(32) DEFAULT 'active'::character varying,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: ussd_sessions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ussd_sessions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ussd_sessions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ussd_sessions_id_seq OWNED BY public.ussd_sessions.id;


--
-- Name: vat_records; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vat_records (
    id integer NOT NULL,
    "transactionId" character varying(64) NOT NULL,
    "agentId" integer NOT NULL,
    "taxableAmount" numeric(15,2) NOT NULL,
    "vatAmount" numeric(15,2) NOT NULL,
    "vatRate" numeric(5,4) DEFAULT 0.075 NOT NULL,
    "rateType" public.vat_rate_type DEFAULT 'standard'::public.vat_rate_type NOT NULL,
    "tinNumber" character varying(32),
    period character varying(7) NOT NULL,
    "remittedAt" timestamp without time zone,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: vat_records_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.vat_records_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: vat_records_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.vat_records_id_seq OWNED BY public.vat_records.id;


--
-- Name: velocity_limits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.velocity_limits (
    id integer NOT NULL,
    tier public.agent_tier NOT NULL,
    "maxTxPerHour" integer DEFAULT 20 NOT NULL,
    "maxSingleTxAmount" numeric(15,2) DEFAULT 50000.00 NOT NULL,
    "maxDailyVolume" numeric(15,2) DEFAULT 500000.00 NOT NULL,
    "updatedAt" timestamp without time zone DEFAULT now() NOT NULL,
    "dailyTxLimit" numeric(15,2) DEFAULT 500000.00 NOT NULL,
    "singleTxLimit" numeric(15,2) DEFAULT 100000.00 NOT NULL,
    "hourlyTxCount" integer DEFAULT 50 NOT NULL,
    "dailyTxCount" integer DEFAULT 200 NOT NULL
);


--
-- Name: velocity_limits_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.velocity_limits_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: velocity_limits_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.velocity_limits_id_seq OWNED BY public.velocity_limits.id;


--
-- Name: voice_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.voice_config (
    id integer NOT NULL,
    language_code character varying(10) NOT NULL,
    language_name character varying(50) NOT NULL,
    is_enabled boolean DEFAULT true,
    tts_provider character varying(50) DEFAULT 'google'::character varying,
    stt_provider character varying(50) DEFAULT 'google'::character varying,
    greeting text,
    capabilities text[]
);


--
-- Name: voice_config_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.voice_config_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: voice_config_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.voice_config_id_seq OWNED BY public.voice_config.id;


--
-- Name: voice_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.voice_sessions (
    id integer NOT NULL,
    "userId" integer NOT NULL,
    language character varying(8) DEFAULT 'en'::character varying,
    transcription text,
    confidence numeric(5,4),
    intent character varying(128),
    status character varying(32) DEFAULT 'Completed'::character varying,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: voice_sessions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.voice_sessions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: voice_sessions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.voice_sessions_id_seq OWNED BY public.voice_sessions.id;


--
-- Name: voice_sessions_userId_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."voice_sessions_userId_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: voice_sessions_userId_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."voice_sessions_userId_seq" OWNED BY public.voice_sessions."userId";


--
-- Name: wallet_transactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.wallet_transactions (
    id integer NOT NULL,
    user_id integer,
    type character varying(20),
    amount numeric(12,2),
    balance_after numeric(12,2),
    reference character varying(100),
    status character varying(20) DEFAULT 'completed'::character varying,
    narration text,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: wallet_transactions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.wallet_transactions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: wallet_transactions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.wallet_transactions_id_seq OWNED BY public.wallet_transactions.id;


--
-- Name: wallets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.wallets (
    id integer NOT NULL,
    user_id integer,
    balance numeric(12,2) DEFAULT 0,
    currency character varying(3) DEFAULT 'NGN'::character varying,
    status character varying(20) DEFAULT 'active'::character varying,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: wallets_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.wallets_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: wallets_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.wallets_id_seq OWNED BY public.wallets.id;


--
-- Name: webhook_deliveries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.webhook_deliveries (
    id integer NOT NULL,
    endpoint_id integer NOT NULL,
    event_type character varying(64) NOT NULL,
    payload json NOT NULL,
    status public.webhook_delivery_status DEFAULT 'pending'::public.webhook_delivery_status NOT NULL,
    status_code integer,
    response_body text,
    attempt_count integer DEFAULT 0 NOT NULL,
    max_attempts integer DEFAULT 3 NOT NULL,
    next_retry_at timestamp without time zone,
    delivered_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    subscription_id integer,
    response_code integer,
    response_time integer,
    retry_count integer DEFAULT 0 NOT NULL,
    updated_at timestamp without time zone
);


--
-- Name: webhook_deliveries_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.webhook_deliveries_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: webhook_deliveries_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.webhook_deliveries_id_seq OWNED BY public.webhook_deliveries.id;


--
-- Name: webhook_endpoints; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.webhook_endpoints (
    id integer NOT NULL,
    name character varying(100) NOT NULL,
    url text NOT NULL,
    secret character varying(64) NOT NULL,
    events text[] DEFAULT '{}'::text[] NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    tenant_id integer,
    created_by integer,
    failure_count integer DEFAULT 0 NOT NULL,
    last_delivery_at timestamp without time zone,
    last_status_code integer,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: webhook_endpoints_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.webhook_endpoints_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: webhook_endpoints_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.webhook_endpoints_id_seq OWNED BY public.webhook_endpoints.id;


--
-- Name: webhook_secrets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.webhook_secrets (
    id integer NOT NULL,
    "integrationName" character varying(64) NOT NULL,
    secret character varying(256) NOT NULL,
    algorithm character varying(32) DEFAULT 'sha256'::character varying NOT NULL,
    "isActive" boolean DEFAULT true NOT NULL,
    "lastRotatedAt" timestamp without time zone DEFAULT now() NOT NULL,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: webhook_secrets_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.webhook_secrets_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: webhook_secrets_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.webhook_secrets_id_seq OWNED BY public.webhook_secrets.id;


--
-- Name: whatsapp_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.whatsapp_messages (
    id integer NOT NULL,
    "userId" integer NOT NULL,
    "phoneNumber" character varying(20),
    direction character varying(16) NOT NULL,
    "messageType" character varying(32) DEFAULT 'text'::character varying,
    content text,
    status character varying(32) DEFAULT 'sent'::character varying,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: whatsapp_messages_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.whatsapp_messages_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: whatsapp_messages_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.whatsapp_messages_id_seq OWNED BY public.whatsapp_messages.id;


--
-- Name: whatsapp_messages_userId_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."whatsapp_messages_userId_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: whatsapp_messages_userId_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."whatsapp_messages_userId_seq" OWNED BY public.whatsapp_messages."userId";


--
-- Name: workflow_definitions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workflow_definitions (
    id integer NOT NULL,
    name character varying(200) NOT NULL,
    entity_type character varying(50) NOT NULL,
    states jsonb DEFAULT '[]'::jsonb NOT NULL,
    transitions jsonb DEFAULT '[]'::jsonb NOT NULL,
    is_active boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: workflow_definitions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.workflow_definitions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: workflow_definitions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.workflow_definitions_id_seq OWNED BY public.workflow_definitions.id;


--
-- Name: workflow_instances; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workflow_instances (
    id integer NOT NULL,
    workflow_id integer NOT NULL,
    entity_type character varying(50) NOT NULL,
    entity_id integer NOT NULL,
    current_state character varying(50) NOT NULL,
    history jsonb DEFAULT '[]'::jsonb,
    assigned_to character varying(100),
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);


--
-- Name: workflow_instances_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.workflow_instances_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: workflow_instances_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.workflow_instances_id_seq OWNED BY public.workflow_instances.id;


--
-- Name: _migrations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public._migrations ALTER COLUMN id SET DEFAULT nextval('public._migrations_id_seq'::regclass);


--
-- Name: ab_experiments id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ab_experiments ALTER COLUMN id SET DEFAULT nextval('public.ab_experiments_id_seq'::regclass);


--
-- Name: achievements id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.achievements ALTER COLUMN id SET DEFAULT nextval('public.achievements_id_seq'::regclass);


--
-- Name: actuarial_calculations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.actuarial_calculations ALTER COLUMN id SET DEFAULT nextval('public.actuarial_calculations_id_seq'::regclass);


--
-- Name: actuarial_calculations userId; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.actuarial_calculations ALTER COLUMN "userId" SET DEFAULT nextval('public."actuarial_calculations_userId_seq"'::regclass);


--
-- Name: agent_achievements id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_achievements ALTER COLUMN id SET DEFAULT nextval('public.agent_achievements_id_seq'::regclass);


--
-- Name: agent_badges id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_badges ALTER COLUMN id SET DEFAULT nextval('public.agent_badges_id_seq'::regclass);


--
-- Name: agent_bank_accounts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_bank_accounts ALTER COLUMN id SET DEFAULT nextval('public.agent_bank_accounts_id_seq'::regclass);


--
-- Name: agent_commissions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_commissions ALTER COLUMN id SET DEFAULT nextval('public.agent_commissions_id_seq'::regclass);


--
-- Name: agent_commissions agentId; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_commissions ALTER COLUMN "agentId" SET DEFAULT nextval('public."agent_commissions_agentId_seq"'::regclass);


--
-- Name: agent_commissions policyId; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_commissions ALTER COLUMN "policyId" SET DEFAULT nextval('public."agent_commissions_policyId_seq"'::regclass);


--
-- Name: agent_geofence_zones id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_geofence_zones ALTER COLUMN id SET DEFAULT nextval('public.agent_geofence_zones_id_seq'::regclass);


--
-- Name: agent_loans id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_loans ALTER COLUMN id SET DEFAULT nextval('public.agent_loans_id_seq'::regclass);


--
-- Name: agent_onboarding_progress id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_onboarding_progress ALTER COLUMN id SET DEFAULT nextval('public.agent_onboarding_progress_id_seq'::regclass);


--
-- Name: agent_performance_scores id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_performance_scores ALTER COLUMN id SET DEFAULT nextval('public.agent_performance_scores_id_seq'::regclass);


--
-- Name: agent_push_subscriptions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_push_subscriptions ALTER COLUMN id SET DEFAULT nextval('public.agent_push_subscriptions_id_seq'::regclass);


--
-- Name: agent_suspension_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_suspension_log ALTER COLUMN id SET DEFAULT nextval('public.agent_suspension_log_id_seq'::regclass);


--
-- Name: agents id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agents ALTER COLUMN id SET DEFAULT nextval('public.agents_id_seq'::regclass);


--
-- Name: agents userId; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agents ALTER COLUMN "userId" SET DEFAULT nextval('public."agents_userId_seq"'::regclass);


--
-- Name: agricultural_schemes id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agricultural_schemes ALTER COLUMN id SET DEFAULT nextval('public.agricultural_schemes_id_seq'::regclass);


--
-- Name: agricultural_trigger_events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agricultural_trigger_events ALTER COLUMN id SET DEFAULT nextval('public.agricultural_trigger_events_id_seq'::regclass);


--
-- Name: agricultural_underwriting_rules id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agricultural_underwriting_rules ALTER COLUMN id SET DEFAULT nextval('public.agricultural_underwriting_rules_id_seq'::regclass);


--
-- Name: analytics_dashboards id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_dashboards ALTER COLUMN id SET DEFAULT nextval('public.analytics_dashboards_id_seq'::regclass);


--
-- Name: analytics_events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_events ALTER COLUMN id SET DEFAULT nextval('public.analytics_events_id_seq'::regclass);


--
-- Name: analytics_events userId; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_events ALTER COLUMN "userId" SET DEFAULT nextval('public."analytics_events_userId_seq"'::regclass);


--
-- Name: analytics_metrics id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_metrics ALTER COLUMN id SET DEFAULT nextval('public.analytics_metrics_id_seq'::regclass);


--
-- Name: api_key_usage id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.api_key_usage ALTER COLUMN id SET DEFAULT nextval('public.api_key_usage_id_seq'::regclass);


--
-- Name: api_keys id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.api_keys ALTER COLUMN id SET DEFAULT nextval('public.api_keys_id_seq'::regclass);


--
-- Name: approval_chains id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.approval_chains ALTER COLUMN id SET DEFAULT nextval('public.approval_chains_id_seq'::regclass);


--
-- Name: approval_requests id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.approval_requests ALTER COLUMN id SET DEFAULT nextval('public.approval_requests_id_seq'::regclass);


--
-- Name: audit_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_log ALTER COLUMN id SET DEFAULT nextval('public.audit_log_id_seq'::regclass);


--
-- Name: audit_trail id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_trail ALTER COLUMN id SET DEFAULT nextval('public.audit_trail_id_seq'::regclass);


--
-- Name: audit_trail userId; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_trail ALTER COLUMN "userId" SET DEFAULT nextval('public."audit_trail_userId_seq"'::regclass);


--
-- Name: backup_snapshots id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.backup_snapshots ALTER COLUMN id SET DEFAULT nextval('public.backup_snapshots_id_seq'::regclass);


--
-- Name: bancassurance_offers id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bancassurance_offers ALTER COLUMN id SET DEFAULT nextval('public.bancassurance_offers_id_seq'::regclass);


--
-- Name: bancassurance_offers userId; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bancassurance_offers ALTER COLUMN "userId" SET DEFAULT nextval('public."bancassurance_offers_userId_seq"'::regclass);


--
-- Name: bancassurance_offers partnerId; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bancassurance_offers ALTER COLUMN "partnerId" SET DEFAULT nextval('public."bancassurance_offers_partnerId_seq"'::regclass);


--
-- Name: bancassurance_partners id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bancassurance_partners ALTER COLUMN id SET DEFAULT nextval('public.bancassurance_partners_id_seq'::regclass);


--
-- Name: bi_report_definitions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_report_definitions ALTER COLUMN id SET DEFAULT nextval('public.bi_report_definitions_id_seq'::regclass);


--
-- Name: billing_audit_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.billing_audit_log ALTER COLUMN id SET DEFAULT nextval('public.billing_audit_log_id_seq'::regclass);


--
-- Name: billing_provisioning_history id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.billing_provisioning_history ALTER COLUMN id SET DEFAULT nextval('public.billing_provisioning_history_id_seq'::regclass);


--
-- Name: billing_role_assignments id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.billing_role_assignments ALTER COLUMN id SET DEFAULT nextval('public.billing_role_assignments_id_seq'::regclass);


--
-- Name: biometric_audit_events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.biometric_audit_events ALTER COLUMN id SET DEFAULT nextval('public.biometric_audit_events_id_seq'::regclass);


--
-- Name: broker_api_keys id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.broker_api_keys ALTER COLUMN id SET DEFAULT nextval('public.broker_api_keys_id_seq'::regclass);


--
-- Name: broker_api_keys userId; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.broker_api_keys ALTER COLUMN "userId" SET DEFAULT nextval('public."broker_api_keys_userId_seq"'::regclass);


--
-- Name: broker_api_usage id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.broker_api_usage ALTER COLUMN id SET DEFAULT nextval('public.broker_api_usage_id_seq'::regclass);


--
-- Name: broker_api_usage keyId; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.broker_api_usage ALTER COLUMN "keyId" SET DEFAULT nextval('public."broker_api_usage_keyId_seq"'::regclass);


--
-- Name: broker_api_usage userId; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.broker_api_usage ALTER COLUMN "userId" SET DEFAULT nextval('public."broker_api_usage_userId_seq"'::regclass);


--
-- Name: broker_api_usage statusCode; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.broker_api_usage ALTER COLUMN "statusCode" SET DEFAULT nextval('public."broker_api_usage_statusCode_seq"'::regclass);


--
-- Name: broker_api_usage responseTimeMs; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.broker_api_usage ALTER COLUMN "responseTimeMs" SET DEFAULT nextval('public."broker_api_usage_responseTimeMs_seq"'::regclass);


--
-- Name: chat_messages id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_messages ALTER COLUMN id SET DEFAULT nextval('public.chat_messages_id_seq'::regclass);


--
-- Name: chat_sessions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_sessions ALTER COLUMN id SET DEFAULT nextval('public.chat_sessions_id_seq'::regclass);


--
-- Name: chatbot_config id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chatbot_config ALTER COLUMN id SET DEFAULT nextval('public.chatbot_config_id_seq'::regclass);


--
-- Name: claim_evidence id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.claim_evidence ALTER COLUMN id SET DEFAULT nextval('public.claim_evidence_id_seq'::regclass);


--
-- Name: claim_evidence userId; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.claim_evidence ALTER COLUMN "userId" SET DEFAULT nextval('public."claim_evidence_userId_seq"'::regclass);


--
-- Name: claim_routing_rules id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.claim_routing_rules ALTER COLUMN id SET DEFAULT nextval('public.claim_routing_rules_id_seq'::regclass);


--
-- Name: claims id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.claims ALTER COLUMN id SET DEFAULT nextval('public.claims_id_seq'::regclass);


--
-- Name: claims userId; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.claims ALTER COLUMN "userId" SET DEFAULT nextval('public."claims_userId_seq"'::regclass);


--
-- Name: claims policyId; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.claims ALTER COLUMN "policyId" SET DEFAULT nextval('public."claims_policyId_seq"'::regclass);


--
-- Name: claims_payouts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.claims_payouts ALTER COLUMN id SET DEFAULT nextval('public.claims_payouts_id_seq'::regclass);


--
-- Name: commission_audit_trail id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.commission_audit_trail ALTER COLUMN id SET DEFAULT nextval('public.commission_audit_trail_id_seq'::regclass);


--
-- Name: commission_cascade_history id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.commission_cascade_history ALTER COLUMN id SET DEFAULT nextval('public.commission_cascade_history_id_seq'::regclass);


--
-- Name: commission_clawbacks id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.commission_clawbacks ALTER COLUMN id SET DEFAULT nextval('public.commission_clawbacks_id_seq'::regclass);


--
-- Name: commission_payouts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.commission_payouts ALTER COLUMN id SET DEFAULT nextval('public.commission_payouts_id_seq'::regclass);


--
-- Name: commission_rules id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.commission_rules ALTER COLUMN id SET DEFAULT nextval('public.commission_rules_id_seq'::regclass);


--
-- Name: commission_splits id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.commission_splits ALTER COLUMN id SET DEFAULT nextval('public.commission_splits_id_seq'::regclass);


--
-- Name: commission_tiers id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.commission_tiers ALTER COLUMN id SET DEFAULT nextval('public.commission_tiers_id_seq'::regclass);


--
-- Name: communication_preferences id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.communication_preferences ALTER COLUMN id SET DEFAULT nextval('public.communication_preferences_id_seq'::regclass);


--
-- Name: compliance_checks id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.compliance_checks ALTER COLUMN id SET DEFAULT nextval('public.compliance_checks_id_seq'::regclass);


--
-- Name: compliance_filings id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.compliance_filings ALTER COLUMN id SET DEFAULT nextval('public.compliance_filings_id_seq'::regclass);


--
-- Name: compliance_reports id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.compliance_reports ALTER COLUMN id SET DEFAULT nextval('public.compliance_reports_id_seq'::regclass);


--
-- Name: connectivity_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.connectivity_log ALTER COLUMN id SET DEFAULT nextval('public.connectivity_log_id_seq'::regclass);


--
-- Name: credit_applications id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.credit_applications ALTER COLUMN id SET DEFAULT nextval('public.credit_applications_id_seq'::regclass);


--
-- Name: credit_score_history id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.credit_score_history ALTER COLUMN id SET DEFAULT nextval('public.credit_score_history_id_seq'::regclass);


--
-- Name: currency_rates id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.currency_rates ALTER COLUMN id SET DEFAULT nextval('public.currency_rates_id_seq'::regclass);


--
-- Name: customer_feedback id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_feedback ALTER COLUMN id SET DEFAULT nextval('public.customer_feedback_id_seq'::regclass);


--
-- Name: customer_feedback userId; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_feedback ALTER COLUMN "userId" SET DEFAULT nextval('public."customer_feedback_userId_seq"'::regclass);


--
-- Name: customer_journey_events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_journey_events ALTER COLUMN id SET DEFAULT nextval('public.customer_journey_events_id_seq'::regclass);


--
-- Name: customer_journey_steps id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_journey_steps ALTER COLUMN id SET DEFAULT nextval('public.customer_journey_steps_id_seq'::regclass);


--
-- Name: customers id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customers ALTER COLUMN id SET DEFAULT nextval('public.customers_id_seq'::regclass);


--
-- Name: data_consent_records id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.data_consent_records ALTER COLUMN id SET DEFAULT nextval('public.data_consent_records_id_seq'::regclass);


--
-- Name: data_export_jobs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.data_export_jobs ALTER COLUMN id SET DEFAULT nextval('public.data_export_jobs_id_seq'::regclass);


--
-- Name: data_rights_requests id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.data_rights_requests ALTER COLUMN id SET DEFAULT nextval('public.data_rights_requests_id_seq'::regclass);


--
-- Name: db_scaling_metrics id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.db_scaling_metrics ALTER COLUMN id SET DEFAULT nextval('public.db_scaling_metrics_id_seq'::regclass);


--
-- Name: device_commands id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_commands ALTER COLUMN id SET DEFAULT nextval('public.device_commands_id_seq'::regclass);


--
-- Name: device_compliance_policies id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_compliance_policies ALTER COLUMN id SET DEFAULT nextval('public.device_compliance_policies_id_seq'::regclass);


--
-- Name: device_compliance_violations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_compliance_violations ALTER COLUMN id SET DEFAULT nextval('public.device_compliance_violations_id_seq'::regclass);


--
-- Name: device_locations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_locations ALTER COLUMN id SET DEFAULT nextval('public.device_locations_id_seq'::regclass);


--
-- Name: devices id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.devices ALTER COLUMN id SET DEFAULT nextval('public.devices_id_seq'::regclass);


--
-- Name: disaster_recovery_config id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.disaster_recovery_config ALTER COLUMN id SET DEFAULT nextval('public.disaster_recovery_config_id_seq'::regclass);


--
-- Name: dispute_evidence id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dispute_evidence ALTER COLUMN id SET DEFAULT nextval('public.dispute_evidence_id_seq'::regclass);


--
-- Name: dispute_messages id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dispute_messages ALTER COLUMN id SET DEFAULT nextval('public.dispute_messages_id_seq'::regclass);


--
-- Name: disputes id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.disputes ALTER COLUMN id SET DEFAULT nextval('public.disputes_id_seq'::regclass);


--
-- Name: dlq_messages id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dlq_messages ALTER COLUMN id SET DEFAULT nextval('public.dlq_messages_id_seq'::regclass);


--
-- Name: documents id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents ALTER COLUMN id SET DEFAULT nextval('public.documents_id_seq'::regclass);


--
-- Name: documents userId; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents ALTER COLUMN "userId" SET DEFAULT nextval('public."documents_userId_seq"'::regclass);


--
-- Name: dynamic_pricing_history id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dynamic_pricing_history ALTER COLUMN id SET DEFAULT nextval('public.dynamic_pricing_history_id_seq'::regclass);


--
-- Name: dynamic_pricing_history userId; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dynamic_pricing_history ALTER COLUMN "userId" SET DEFAULT nextval('public."dynamic_pricing_history_userId_seq"'::regclass);


--
-- Name: email_delivery_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_delivery_log ALTER COLUMN id SET DEFAULT nextval('public.email_delivery_log_id_seq'::regclass);


--
-- Name: email_queue id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_queue ALTER COLUMN id SET DEFAULT nextval('public.email_queue_id_seq'::regclass);


--
-- Name: embedded_distribution id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.embedded_distribution ALTER COLUMN id SET DEFAULT nextval('public.embedded_distribution_id_seq'::regclass);


--
-- Name: embedded_partners id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.embedded_partners ALTER COLUMN id SET DEFAULT nextval('public.embedded_partners_id_seq'::regclass);


--
-- Name: emergency_incidents id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.emergency_incidents ALTER COLUMN id SET DEFAULT nextval('public.emergency_incidents_id_seq'::regclass);


--
-- Name: emergency_incidents userId; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.emergency_incidents ALTER COLUMN "userId" SET DEFAULT nextval('public."emergency_incidents_userId_seq"'::regclass);


--
-- Name: encrypted_fields id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.encrypted_fields ALTER COLUMN id SET DEFAULT nextval('public.encrypted_fields_id_seq'::regclass);


--
-- Name: erp_config id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.erp_config ALTER COLUMN id SET DEFAULT nextval('public.erp_config_id_seq'::regclass);


--
-- Name: erp_sync_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.erp_sync_log ALTER COLUMN id SET DEFAULT nextval('public.erp_sync_log_id_seq'::regclass);


--
-- Name: erpnext_reconciliation id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.erpnext_reconciliation ALTER COLUMN id SET DEFAULT nextval('public.erpnext_reconciliation_id_seq'::regclass);


--
-- Name: erpnext_reconciliation userId; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.erpnext_reconciliation ALTER COLUMN "userId" SET DEFAULT nextval('public."erpnext_reconciliation_userId_seq"'::regclass);


--
-- Name: erpnext_transactions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.erpnext_transactions ALTER COLUMN id SET DEFAULT nextval('public.erpnext_transactions_id_seq'::regclass);


--
-- Name: erpnext_transactions userId; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.erpnext_transactions ALTER COLUMN "userId" SET DEFAULT nextval('public."erpnext_transactions_userId_seq"'::regclass);


--
-- Name: face_enrollments id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.face_enrollments ALTER COLUMN id SET DEFAULT nextval('public.face_enrollments_id_seq'::regclass);


--
-- Name: family_members id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.family_members ALTER COLUMN id SET DEFAULT nextval('public.family_members_id_seq'::regclass);


--
-- Name: family_members userId; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.family_members ALTER COLUMN "userId" SET DEFAULT nextval('public."family_members_userId_seq"'::regclass);


--
-- Name: fee_audit_trail id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fee_audit_trail ALTER COLUMN id SET DEFAULT nextval('public.fee_audit_trail_id_seq'::regclass);


--
-- Name: fee_rules id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fee_rules ALTER COLUMN id SET DEFAULT nextval('public.fee_rules_id_seq'::regclass);


--
-- Name: fido2_challenges id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fido2_challenges ALTER COLUMN id SET DEFAULT nextval('public.fido2_challenges_id_seq'::regclass);


--
-- Name: fido2_credentials id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fido2_credentials ALTER COLUMN id SET DEFAULT nextval('public.fido2_credentials_id_seq'::regclass);


--
-- Name: file_uploads id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.file_uploads ALTER COLUMN id SET DEFAULT nextval('public.file_uploads_id_seq'::regclass);


--
-- Name: financial_metrics id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.financial_metrics ALTER COLUMN id SET DEFAULT nextval('public.financial_metrics_id_seq'::regclass);


--
-- Name: financial_transactions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.financial_transactions ALTER COLUMN id SET DEFAULT nextval('public.financial_transactions_id_seq'::regclass);


--
-- Name: float_reconciliations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.float_reconciliations ALTER COLUMN id SET DEFAULT nextval('public.float_reconciliations_id_seq'::regclass);


--
-- Name: float_topup_requests id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.float_topup_requests ALTER COLUMN id SET DEFAULT nextval('public.float_topup_requests_id_seq'::regclass);


--
-- Name: fraud_alerts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fraud_alerts ALTER COLUMN id SET DEFAULT nextval('public.fraud_alerts_id_seq'::regclass);


--
-- Name: fraud_alerts userId; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fraud_alerts ALTER COLUMN "userId" SET DEFAULT nextval('public."fraud_alerts_userId_seq"'::regclass);


--
-- Name: fraud_ml_scores id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fraud_ml_scores ALTER COLUMN id SET DEFAULT nextval('public.fraud_ml_scores_id_seq'::regclass);


--
-- Name: fraud_rings id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fraud_rings ALTER COLUMN id SET DEFAULT nextval('public.fraud_rings_id_seq'::regclass);


--
-- Name: fraud_rings userId; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fraud_rings ALTER COLUMN "userId" SET DEFAULT nextval('public."fraud_rings_userId_seq"'::regclass);


--
-- Name: fraud_rules id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fraud_rules ALTER COLUMN id SET DEFAULT nextval('public.fraud_rules_id_seq'::regclass);


--
-- Name: fraud_scores id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fraud_scores ALTER COLUMN id SET DEFAULT nextval('public.fraud_scores_id_seq'::regclass);


--
-- Name: fraud_scores userId; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fraud_scores ALTER COLUMN "userId" SET DEFAULT nextval('public."fraud_scores_userId_seq"'::regclass);


--
-- Name: fraud_scores processingTime; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fraud_scores ALTER COLUMN "processingTime" SET DEFAULT nextval('public."fraud_scores_processingTime_seq"'::regclass);


--
-- Name: gamification_levels id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gamification_levels ALTER COLUMN id SET DEFAULT nextval('public.gamification_levels_id_seq'::regclass);


--
-- Name: geo_fences id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.geo_fences ALTER COLUMN id SET DEFAULT nextval('public.geo_fences_id_seq'::regclass);


--
-- Name: geofence_zones id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.geofence_zones ALTER COLUMN id SET DEFAULT nextval('public.geofence_zones_id_seq'::regclass);


--
-- Name: geospatial_zones id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.geospatial_zones ALTER COLUMN id SET DEFAULT nextval('public.geospatial_zones_id_seq'::regclass);


--
-- Name: gig_coverage_policies id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gig_coverage_policies ALTER COLUMN id SET DEFAULT nextval('public.gig_coverage_policies_id_seq'::regclass);


--
-- Name: gig_coverage_policies userId; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gig_coverage_policies ALTER COLUMN "userId" SET DEFAULT nextval('public."gig_coverage_policies_userId_seq"'::regclass);


--
-- Name: gl_accounts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gl_accounts ALTER COLUMN id SET DEFAULT nextval('public.gl_accounts_id_seq'::regclass);


--
-- Name: gl_entries id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gl_entries ALTER COLUMN id SET DEFAULT nextval('public.gl_entries_id_seq'::regclass);


--
-- Name: gl_journal_entries id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gl_journal_entries ALTER COLUMN id SET DEFAULT nextval('public.gl_journal_entries_id_seq'::regclass);


--
-- Name: group_life_members id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.group_life_members ALTER COLUMN id SET DEFAULT nextval('public.group_life_members_id_seq'::regclass);


--
-- Name: group_life_members schemeId; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.group_life_members ALTER COLUMN "schemeId" SET DEFAULT nextval('public."group_life_members_schemeId_seq"'::regclass);


--
-- Name: group_life_schemes id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.group_life_schemes ALTER COLUMN id SET DEFAULT nextval('public.group_life_schemes_id_seq'::regclass);


--
-- Name: group_life_schemes userId; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.group_life_schemes ALTER COLUMN "userId" SET DEFAULT nextval('public."group_life_schemes_userId_seq"'::regclass);


--
-- Name: health_programs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.health_programs ALTER COLUMN id SET DEFAULT nextval('public.health_programs_id_seq'::regclass);


--
-- Name: ifrs17_cashflow_scenarios id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ifrs17_cashflow_scenarios ALTER COLUMN id SET DEFAULT nextval('public.ifrs17_cashflow_scenarios_id_seq'::regclass);


--
-- Name: ifrs17_contract_groups id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ifrs17_contract_groups ALTER COLUMN id SET DEFAULT nextval('public.ifrs17_contract_groups_id_seq'::regclass);


--
-- Name: ifrs17_contracts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ifrs17_contracts ALTER COLUMN id SET DEFAULT nextval('public.ifrs17_contracts_id_seq'::regclass);


--
-- Name: ifrs17_csm_rollforward id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ifrs17_csm_rollforward ALTER COLUMN id SET DEFAULT nextval('public.ifrs17_csm_rollforward_id_seq'::regclass);


--
-- Name: ifrs17_discount_curves id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ifrs17_discount_curves ALTER COLUMN id SET DEFAULT nextval('public.ifrs17_discount_curves_id_seq'::regclass);


--
-- Name: ifrs17_pnl id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ifrs17_pnl ALTER COLUMN id SET DEFAULT nextval('public.ifrs17_pnl_id_seq'::regclass);


--
-- Name: ifrs17_reinsurance_held id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ifrs17_reinsurance_held ALTER COLUMN id SET DEFAULT nextval('public.ifrs17_reinsurance_held_id_seq'::regclass);


--
-- Name: ifrs17_transition id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ifrs17_transition ALTER COLUMN id SET DEFAULT nextval('public.ifrs17_transition_id_seq'::regclass);


--
-- Name: insurance_applications id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.insurance_applications ALTER COLUMN id SET DEFAULT nextval('public.insurance_applications_id_seq'::regclass);


--
-- Name: insurance_applications userId; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.insurance_applications ALTER COLUMN "userId" SET DEFAULT nextval('public."insurance_applications_userId_seq"'::regclass);


--
-- Name: insurance_products id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.insurance_products ALTER COLUMN id SET DEFAULT nextval('public.insurance_products_id_seq'::regclass);


--
-- Name: insurance_radar_alerts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.insurance_radar_alerts ALTER COLUMN id SET DEFAULT nextval('public.insurance_radar_alerts_id_seq'::regclass);


--
-- Name: insuretech_innovations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.insuretech_innovations ALTER COLUMN id SET DEFAULT nextval('public.insuretech_innovations_id_seq'::regclass);


--
-- Name: inventory_items id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_items ALTER COLUMN id SET DEFAULT nextval('public.inventory_items_id_seq'::regclass);


--
-- Name: invite_codes id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invite_codes ALTER COLUMN id SET DEFAULT nextval('public.invite_codes_id_seq'::regclass);


--
-- Name: knowledge_entities id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knowledge_entities ALTER COLUMN id SET DEFAULT nextval('public.knowledge_entities_id_seq'::regclass);


--
-- Name: knowledge_graph_edges id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knowledge_graph_edges ALTER COLUMN id SET DEFAULT nextval('public.knowledge_graph_edges_id_seq'::regclass);


--
-- Name: knowledge_graph_edges userId; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knowledge_graph_edges ALTER COLUMN "userId" SET DEFAULT nextval('public."knowledge_graph_edges_userId_seq"'::regclass);


--
-- Name: knowledge_graph_nodes id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knowledge_graph_nodes ALTER COLUMN id SET DEFAULT nextval('public.knowledge_graph_nodes_id_seq'::regclass);


--
-- Name: knowledge_graph_nodes userId; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knowledge_graph_nodes ALTER COLUMN "userId" SET DEFAULT nextval('public."knowledge_graph_nodes_userId_seq"'::regclass);


--
-- Name: kyb_profiles id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kyb_profiles ALTER COLUMN id SET DEFAULT nextval('public.kyb_profiles_id_seq'::regclass);


--
-- Name: kyc_documents id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kyc_documents ALTER COLUMN id SET DEFAULT nextval('public.kyc_documents_id_seq'::regclass);


--
-- Name: kyc_profiles id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kyc_profiles ALTER COLUMN id SET DEFAULT nextval('public.kyc_profiles_id_seq'::regclass);


--
-- Name: kyc_sessions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kyc_sessions ALTER COLUMN id SET DEFAULT nextval('public.kyc_sessions_id_seq'::regclass);


--
-- Name: kyc_verifications id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kyc_verifications ALTER COLUMN id SET DEFAULT nextval('public.kyc_verifications_id_seq'::regclass);


--
-- Name: kyc_verifications userId; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kyc_verifications ALTER COLUMN "userId" SET DEFAULT nextval('public."kyc_verifications_userId_seq"'::regclass);


--
-- Name: load_test_runs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.load_test_runs ALTER COLUMN id SET DEFAULT nextval('public.load_test_runs_id_seq'::regclass);


--
-- Name: loyalty_history id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loyalty_history ALTER COLUMN id SET DEFAULT nextval('public.loyalty_history_id_seq'::regclass);


--
-- Name: loyalty_points id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loyalty_points ALTER COLUMN id SET DEFAULT nextval('public.loyalty_points_id_seq'::regclass);


--
-- Name: loyalty_points userId; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loyalty_points ALTER COLUMN "userId" SET DEFAULT nextval('public."loyalty_points_userId_seq"'::regclass);


--
-- Name: loyalty_tiers id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loyalty_tiers ALTER COLUMN id SET DEFAULT nextval('public.loyalty_tiers_id_seq'::regclass);


--
-- Name: loyalty_transactions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loyalty_transactions ALTER COLUMN id SET DEFAULT nextval('public.loyalty_transactions_id_seq'::regclass);


--
-- Name: loyalty_transactions userId; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loyalty_transactions ALTER COLUMN "userId" SET DEFAULT nextval('public."loyalty_transactions_userId_seq"'::regclass);


--
-- Name: mcmc_results id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mcmc_results ALTER COLUMN id SET DEFAULT nextval('public.mcmc_results_id_seq'::regclass);


--
-- Name: mcmc_results userId; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mcmc_results ALTER COLUMN "userId" SET DEFAULT nextval('public."mcmc_results_userId_seq"'::regclass);


--
-- Name: mcmc_simulations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mcmc_simulations ALTER COLUMN id SET DEFAULT nextval('public.mcmc_simulations_id_seq'::regclass);


--
-- Name: mdm_geofence_violations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mdm_geofence_violations ALTER COLUMN id SET DEFAULT nextval('public.mdm_geofence_violations_id_seq'::regclass);


--
-- Name: merchant_kyc_docs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.merchant_kyc_docs ALTER COLUMN id SET DEFAULT nextval('public.merchant_kyc_docs_id_seq'::regclass);


--
-- Name: merchant_payouts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.merchant_payouts ALTER COLUMN id SET DEFAULT nextval('public.merchant_payouts_id_seq'::regclass);


--
-- Name: merchant_settlements id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.merchant_settlements ALTER COLUMN id SET DEFAULT nextval('public.merchant_settlements_id_seq'::regclass);


--
-- Name: merchants id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.merchants ALTER COLUMN id SET DEFAULT nextval('public.merchants_id_seq'::regclass);


--
-- Name: microinsurance_policies id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.microinsurance_policies ALTER COLUMN id SET DEFAULT nextval('public.microinsurance_policies_id_seq'::regclass);


--
-- Name: microinsurance_policies userId; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.microinsurance_policies ALTER COLUMN "userId" SET DEFAULT nextval('public."microinsurance_policies_userId_seq"'::regclass);


--
-- Name: model_security_audits id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.model_security_audits ALTER COLUMN id SET DEFAULT nextval('public.model_security_audits_id_seq'::regclass);


--
-- Name: mqtt_bridge_config id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mqtt_bridge_config ALTER COLUMN id SET DEFAULT nextval('public.mqtt_bridge_config_id_seq'::regclass);


--
-- Name: multi_sim_profiles id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.multi_sim_profiles ALTER COLUMN id SET DEFAULT nextval('public.multi_sim_profiles_id_seq'::regclass);


--
-- Name: naicom_automated_reports id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.naicom_automated_reports ALTER COLUMN id SET DEFAULT nextval('public.naicom_automated_reports_id_seq'::regclass);


--
-- Name: naicom_data_exchange id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.naicom_data_exchange ALTER COLUMN id SET DEFAULT nextval('public.naicom_data_exchange_id_seq'::regclass);


--
-- Name: naicom_filings id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.naicom_filings ALTER COLUMN id SET DEFAULT nextval('public.naicom_filings_id_seq'::regclass);


--
-- Name: naicom_filings userId; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.naicom_filings ALTER COLUMN "userId" SET DEFAULT nextval('public."naicom_filings_userId_seq"'::regclass);


--
-- Name: naicom_financial_reports id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.naicom_financial_reports ALTER COLUMN id SET DEFAULT nextval('public.naicom_financial_reports_id_seq'::regclass);


--
-- Name: naicom_penalties id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.naicom_penalties ALTER COLUMN id SET DEFAULT nextval('public.naicom_penalties_id_seq'::regclass);


--
-- Name: naicom_reporting_schedule id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.naicom_reporting_schedule ALTER COLUMN id SET DEFAULT nextval('public.naicom_reporting_schedule_id_seq'::regclass);


--
-- Name: naicom_returns id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.naicom_returns ALTER COLUMN id SET DEFAULT nextval('public.naicom_returns_id_seq'::regclass);


--
-- Name: ndvi_readings id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ndvi_readings ALTER COLUMN id SET DEFAULT nextval('public.ndvi_readings_id_seq'::regclass);


--
-- Name: niira_insurance_classes id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.niira_insurance_classes ALTER COLUMN id SET DEFAULT nextval('public.niira_insurance_classes_id_seq'::regclass);


--
-- Name: niira_registrations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.niira_registrations ALTER COLUMN id SET DEFAULT nextval('public.niira_registrations_id_seq'::regclass);


--
-- Name: nmid_verifications id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nmid_verifications ALTER COLUMN id SET DEFAULT nextval('public.nmid_verifications_id_seq'::regclass);


--
-- Name: nmid_verifications userId; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nmid_verifications ALTER COLUMN "userId" SET DEFAULT nextval('public."nmid_verifications_userId_seq"'::regclass);


--
-- Name: notification_channels id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_channels ALTER COLUMN id SET DEFAULT nextval('public.notification_channels_id_seq'::regclass);


--
-- Name: notification_dispatch_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_dispatch_log ALTER COLUMN id SET DEFAULT nextval('public.notification_dispatch_log_id_seq'::regclass);


--
-- Name: notification_logs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_logs ALTER COLUMN id SET DEFAULT nextval('public.notification_logs_id_seq'::regclass);


--
-- Name: notifications id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications ALTER COLUMN id SET DEFAULT nextval('public.notifications_id_seq'::regclass);


--
-- Name: notifications userId; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications ALTER COLUMN "userId" SET DEFAULT nextval('public."notifications_userId_seq"'::regclass);


--
-- Name: observability_alerts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.observability_alerts ALTER COLUMN id SET DEFAULT nextval('public.observability_alerts_id_seq'::regclass);


--
-- Name: ota_releases id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ota_releases ALTER COLUMN id SET DEFAULT nextval('public.ota_releases_id_seq'::regclass);


--
-- Name: ota_update_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ota_update_log ALTER COLUMN id SET DEFAULT nextval('public.ota_update_log_id_seq'::regclass);


--
-- Name: otp_tokens id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.otp_tokens ALTER COLUMN id SET DEFAULT nextval('public.otp_tokens_id_seq'::regclass);


--
-- Name: p2p_memberships id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.p2p_memberships ALTER COLUMN id SET DEFAULT nextval('public.p2p_memberships_id_seq'::regclass);


--
-- Name: p2p_memberships userId; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.p2p_memberships ALTER COLUMN "userId" SET DEFAULT nextval('public."p2p_memberships_userId_seq"'::regclass);


--
-- Name: p2p_memberships poolId; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.p2p_memberships ALTER COLUMN "poolId" SET DEFAULT nextval('public."p2p_memberships_poolId_seq"'::regclass);


--
-- Name: p2p_pools id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.p2p_pools ALTER COLUMN id SET DEFAULT nextval('public.p2p_pools_id_seq'::regclass);


--
-- Name: parametric_triggers id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.parametric_triggers ALTER COLUMN id SET DEFAULT nextval('public.parametric_triggers_id_seq'::regclass);


--
-- Name: payment_transactions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_transactions ALTER COLUMN id SET DEFAULT nextval('public.payment_transactions_id_seq'::regclass);


--
-- Name: payments id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments ALTER COLUMN id SET DEFAULT nextval('public.payments_id_seq'::regclass);


--
-- Name: payments userId; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments ALTER COLUMN "userId" SET DEFAULT nextval('public."payments_userId_seq"'::regclass);


--
-- Name: payments policyId; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments ALTER COLUMN "policyId" SET DEFAULT nextval('public."payments_policyId_seq"'::regclass);


--
-- Name: performance_metrics id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.performance_metrics ALTER COLUMN id SET DEFAULT nextval('public.performance_metrics_id_seq'::regclass);


--
-- Name: pfa_annuities id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pfa_annuities ALTER COLUMN id SET DEFAULT nextval('public.pfa_annuities_id_seq'::regclass);


--
-- Name: pfa_annuity_quotes id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pfa_annuity_quotes ALTER COLUMN id SET DEFAULT nextval('public.pfa_annuity_quotes_id_seq'::regclass);


--
-- Name: pfa_annuity_quotes userId; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pfa_annuity_quotes ALTER COLUMN "userId" SET DEFAULT nextval('public."pfa_annuity_quotes_userId_seq"'::regclass);


--
-- Name: pfa_annuity_quotes pfaId; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pfa_annuity_quotes ALTER COLUMN "pfaId" SET DEFAULT nextval('public."pfa_annuity_quotes_pfaId_seq"'::regclass);


--
-- Name: pfa_integration id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pfa_integration ALTER COLUMN id SET DEFAULT nextval('public.pfa_integration_id_seq'::regclass);


--
-- Name: pfa_partners id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pfa_partners ALTER COLUMN id SET DEFAULT nextval('public.pfa_partners_id_seq'::regclass);


--
-- Name: platform_health_checks id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_health_checks ALTER COLUMN id SET DEFAULT nextval('public.platform_health_checks_id_seq'::regclass);


--
-- Name: platform_incidents id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_incidents ALTER COLUMN id SET DEFAULT nextval('public.platform_incidents_id_seq'::regclass);


--
-- Name: platform_settings id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_settings ALTER COLUMN id SET DEFAULT nextval('public.platform_settings_id_seq'::regclass);


--
-- Name: pnl_reports id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pnl_reports ALTER COLUMN id SET DEFAULT nextval('public.pnl_reports_id_seq'::regclass);


--
-- Name: policies id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.policies ALTER COLUMN id SET DEFAULT nextval('public.policies_id_seq'::regclass);


--
-- Name: policies userId; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.policies ALTER COLUMN "userId" SET DEFAULT nextval('public."policies_userId_seq"'::regclass);


--
-- Name: pos_terminals id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pos_terminals ALTER COLUMN id SET DEFAULT nextval('public.pos_terminals_id_seq'::regclass);


--
-- Name: premium_collections id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.premium_collections ALTER COLUMN id SET DEFAULT nextval('public.premium_collections_id_seq'::regclass);


--
-- Name: premium_rate_audit_logs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.premium_rate_audit_logs ALTER COLUMN id SET DEFAULT nextval('public.premium_rate_audit_logs_id_seq'::regclass);


--
-- Name: premium_rate_audit_logs userId; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.premium_rate_audit_logs ALTER COLUMN "userId" SET DEFAULT nextval('public."premium_rate_audit_logs_userId_seq"'::regclass);


--
-- Name: premium_rate_audit_logs entityId; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.premium_rate_audit_logs ALTER COLUMN "entityId" SET DEFAULT nextval('public."premium_rate_audit_logs_entityId_seq"'::regclass);


--
-- Name: premium_rate_changes id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.premium_rate_changes ALTER COLUMN id SET DEFAULT nextval('public.premium_rate_changes_id_seq'::regclass);


--
-- Name: premium_rate_changes tableId; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.premium_rate_changes ALTER COLUMN "tableId" SET DEFAULT nextval('public."premium_rate_changes_tableId_seq"'::regclass);


--
-- Name: premium_rate_changes factorId; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.premium_rate_changes ALTER COLUMN "factorId" SET DEFAULT nextval('public."premium_rate_changes_factorId_seq"'::regclass);


--
-- Name: premium_rate_changes changedBy; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.premium_rate_changes ALTER COLUMN "changedBy" SET DEFAULT nextval('public."premium_rate_changes_changedBy_seq"'::regclass);


--
-- Name: premium_rate_tables id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.premium_rate_tables ALTER COLUMN id SET DEFAULT nextval('public.premium_rate_tables_id_seq'::regclass);


--
-- Name: premium_rate_tables userId; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.premium_rate_tables ALTER COLUMN "userId" SET DEFAULT nextval('public."premium_rate_tables_userId_seq"'::regclass);


--
-- Name: premium_risk_factors id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.premium_risk_factors ALTER COLUMN id SET DEFAULT nextval('public.premium_risk_factors_id_seq'::regclass);


--
-- Name: premium_risk_factors tableId; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.premium_risk_factors ALTER COLUMN "tableId" SET DEFAULT nextval('public."premium_risk_factors_tableId_seq"'::regclass);


--
-- Name: qr_codes id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qr_codes ALTER COLUMN id SET DEFAULT nextval('public.qr_codes_id_seq'::regclass);


--
-- Name: rate_alerts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rate_alerts ALTER COLUMN id SET DEFAULT nextval('public.rate_alerts_id_seq'::regclass);


--
-- Name: rate_limit_rules id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rate_limit_rules ALTER COLUMN id SET DEFAULT nextval('public.rate_limit_rules_id_seq'::regclass);


--
-- Name: realtime_tx_alerts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.realtime_tx_alerts ALTER COLUMN id SET DEFAULT nextval('public.realtime_tx_alerts_id_seq'::regclass);


--
-- Name: reconciliation_batches id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reconciliation_batches ALTER COLUMN id SET DEFAULT nextval('public.reconciliation_batches_id_seq'::regclass);


--
-- Name: reconciliation_items id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reconciliation_items ALTER COLUMN id SET DEFAULT nextval('public.reconciliation_items_id_seq'::regclass);


--
-- Name: referrals id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.referrals ALTER COLUMN id SET DEFAULT nextval('public.referrals_id_seq'::regclass);


--
-- Name: referrals referrerId; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.referrals ALTER COLUMN "referrerId" SET DEFAULT nextval('public."referrals_referrerId_seq"'::regclass);


--
-- Name: referrals referredUserId; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.referrals ALTER COLUMN "referredUserId" SET DEFAULT nextval('public."referrals_referredUserId_seq"'::regclass);


--
-- Name: refunds id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refunds ALTER COLUMN id SET DEFAULT nextval('public.refunds_id_seq'::regclass);


--
-- Name: reinsurance_bordereaux id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reinsurance_bordereaux ALTER COLUMN id SET DEFAULT nextval('public.reinsurance_bordereaux_id_seq'::regclass);


--
-- Name: reinsurance_cessions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reinsurance_cessions ALTER COLUMN id SET DEFAULT nextval('public.reinsurance_cessions_id_seq'::regclass);


--
-- Name: reinsurance_cessions treatyId; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reinsurance_cessions ALTER COLUMN "treatyId" SET DEFAULT nextval('public."reinsurance_cessions_treatyId_seq"'::regclass);


--
-- Name: reinsurance_cessions policyId; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reinsurance_cessions ALTER COLUMN "policyId" SET DEFAULT nextval('public."reinsurance_cessions_policyId_seq"'::regclass);


--
-- Name: reinsurance_claims_recovery id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reinsurance_claims_recovery ALTER COLUMN id SET DEFAULT nextval('public.reinsurance_claims_recovery_id_seq'::regclass);


--
-- Name: reinsurance_facultative id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reinsurance_facultative ALTER COLUMN id SET DEFAULT nextval('public.reinsurance_facultative_id_seq'::regclass);


--
-- Name: reinsurance_settlements id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reinsurance_settlements ALTER COLUMN id SET DEFAULT nextval('public.reinsurance_settlements_id_seq'::regclass);


--
-- Name: reinsurance_treaties id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reinsurance_treaties ALTER COLUMN id SET DEFAULT nextval('public.reinsurance_treaties_id_seq'::regclass);


--
-- Name: reinsurance_treaties userId; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reinsurance_treaties ALTER COLUMN "userId" SET DEFAULT nextval('public."reinsurance_treaties_userId_seq"'::regclass);


--
-- Name: reversal_requests id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reversal_requests ALTER COLUMN id SET DEFAULT nextval('public.reversal_requests_id_seq'::regclass);


--
-- Name: reviews id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reviews ALTER COLUMN id SET DEFAULT nextval('public.reviews_id_seq'::regclass);


--
-- Name: reviews userId; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reviews ALTER COLUMN "userId" SET DEFAULT nextval('public."reviews_userId_seq"'::regclass);


--
-- Name: reviews entityId; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reviews ALTER COLUMN "entityId" SET DEFAULT nextval('public."reviews_entityId_seq"'::regclass);


--
-- Name: reviews rating; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reviews ALTER COLUMN rating SET DEFAULT nextval('public.reviews_rating_seq'::regclass);


--
-- Name: roles id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles ALTER COLUMN id SET DEFAULT nextval('public.roles_id_seq'::regclass);


--
-- Name: savings_accounts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.savings_accounts ALTER COLUMN id SET DEFAULT nextval('public.savings_accounts_id_seq'::regclass);


--
-- Name: savings_accounts userId; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.savings_accounts ALTER COLUMN "userId" SET DEFAULT nextval('public."savings_accounts_userId_seq"'::regclass);


--
-- Name: savings_plans id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.savings_plans ALTER COLUMN id SET DEFAULT nextval('public.savings_plans_id_seq'::regclass);


--
-- Name: score_improvement_tips id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.score_improvement_tips ALTER COLUMN id SET DEFAULT nextval('public.score_improvement_tips_id_seq'::regclass);


--
-- Name: service_records id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_records ALTER COLUMN id SET DEFAULT nextval('public.service_records_id_seq'::regclass);


--
-- Name: settlement_reconciliation id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.settlement_reconciliation ALTER COLUMN id SET DEFAULT nextval('public.settlement_reconciliation_id_seq'::regclass);


--
-- Name: shareable_links id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shareable_links ALTER COLUMN id SET DEFAULT nextval('public.shareable_links_id_seq'::regclass);


--
-- Name: sim_failover_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sim_failover_log ALTER COLUMN id SET DEFAULT nextval('public.sim_failover_log_id_seq'::regclass);


--
-- Name: sim_orchestrator_config id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sim_orchestrator_config ALTER COLUMN id SET DEFAULT nextval('public.sim_orchestrator_config_id_seq'::regclass);


--
-- Name: sim_probe_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sim_probe_log ALTER COLUMN id SET DEFAULT nextval('public.sim_probe_log_id_seq'::regclass);


--
-- Name: sla_breaches id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sla_breaches ALTER COLUMN id SET DEFAULT nextval('public.sla_breaches_id_seq'::regclass);


--
-- Name: sla_definitions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sla_definitions ALTER COLUMN id SET DEFAULT nextval('public.sla_definitions_id_seq'::regclass);


--
-- Name: sme_policies id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sme_policies ALTER COLUMN id SET DEFAULT nextval('public.sme_policies_id_seq'::regclass);


--
-- Name: sme_policies userId; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sme_policies ALTER COLUMN "userId" SET DEFAULT nextval('public."sme_policies_userId_seq"'::regclass);


--
-- Name: software_updates id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.software_updates ALTER COLUMN id SET DEFAULT nextval('public.software_updates_id_seq'::regclass);


--
-- Name: storefront_ads id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.storefront_ads ALTER COLUMN id SET DEFAULT nextval('public.storefront_ads_id_seq'::regclass);


--
-- Name: supervisor_agents id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supervisor_agents ALTER COLUMN id SET DEFAULT nextval('public.supervisor_agents_id_seq'::regclass);


--
-- Name: system_config id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_config ALTER COLUMN id SET DEFAULT nextval('public.system_config_id_seq'::regclass);


--
-- Name: system_settings id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_settings ALTER COLUMN id SET DEFAULT nextval('public.system_settings_id_seq'::regclass);


--
-- Name: takaful_pools id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.takaful_pools ALTER COLUMN id SET DEFAULT nextval('public.takaful_pools_id_seq'::regclass);


--
-- Name: takaful_sharia_principles id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.takaful_sharia_principles ALTER COLUMN id SET DEFAULT nextval('public.takaful_sharia_principles_id_seq'::regclass);


--
-- Name: telco_credit_scores id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telco_credit_scores ALTER COLUMN id SET DEFAULT nextval('public.telco_credit_scores_id_seq'::regclass);


--
-- Name: telco_credit_scores userId; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telco_credit_scores ALTER COLUMN "userId" SET DEFAULT nextval('public."telco_credit_scores_userId_seq"'::regclass);


--
-- Name: telco_credit_scores score; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telco_credit_scores ALTER COLUMN score SET DEFAULT nextval('public.telco_credit_scores_score_seq'::regclass);


--
-- Name: telematics_devices id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telematics_devices ALTER COLUMN id SET DEFAULT nextval('public.telematics_devices_id_seq'::regclass);


--
-- Name: tenant_branding id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_branding ALTER COLUMN id SET DEFAULT nextval('public.tenant_branding_id_seq'::regclass);


--
-- Name: tenant_corridors id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_corridors ALTER COLUMN id SET DEFAULT nextval('public.tenant_corridors_id_seq'::regclass);


--
-- Name: tenant_feature_toggles id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_feature_toggles ALTER COLUMN id SET DEFAULT nextval('public.tenant_feature_toggles_id_seq'::regclass);


--
-- Name: tenant_fee_overrides id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_fee_overrides ALTER COLUMN id SET DEFAULT nextval('public.tenant_fee_overrides_id_seq'::regclass);


--
-- Name: tenant_users id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_users ALTER COLUMN id SET DEFAULT nextval('public.tenant_users_id_seq'::regclass);


--
-- Name: tenants id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenants ALTER COLUMN id SET DEFAULT nextval('public.tenants_id_seq'::regclass);


--
-- Name: terminal_groups id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.terminal_groups ALTER COLUMN id SET DEFAULT nextval('public.terminal_groups_id_seq'::regclass);


--
-- Name: training_courses id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.training_courses ALTER COLUMN id SET DEFAULT nextval('public.training_courses_id_seq'::regclass);


--
-- Name: training_enrollments id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.training_enrollments ALTER COLUMN id SET DEFAULT nextval('public.training_enrollments_id_seq'::regclass);


--
-- Name: transaction_limits id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transaction_limits ALTER COLUMN id SET DEFAULT nextval('public.transaction_limits_id_seq'::regclass);


--
-- Name: transactions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactions ALTER COLUMN id SET DEFAULT nextval('public.transactions_id_seq'::regclass);


--
-- Name: tx_monitoring_alerts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tx_monitoring_alerts ALTER COLUMN id SET DEFAULT nextval('public.tx_monitoring_alerts_id_seq'::regclass);


--
-- Name: underwriting_decisions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.underwriting_decisions ALTER COLUMN id SET DEFAULT nextval('public.underwriting_decisions_id_seq'::regclass);


--
-- Name: underwriting_rules id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.underwriting_rules ALTER COLUMN id SET DEFAULT nextval('public.underwriting_rules_id_seq'::regclass);


--
-- Name: user_achievements id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_achievements ALTER COLUMN id SET DEFAULT nextval('public.user_achievements_id_seq'::regclass);


--
-- Name: user_roles id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles ALTER COLUMN id SET DEFAULT nextval('public.user_roles_id_seq'::regclass);


--
-- Name: users id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users ALTER COLUMN id SET DEFAULT nextval('public.users_id_seq'::regclass);


--
-- Name: ussd_analytics id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ussd_analytics ALTER COLUMN id SET DEFAULT nextval('public.ussd_analytics_id_seq'::regclass);


--
-- Name: ussd_pins id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ussd_pins ALTER COLUMN id SET DEFAULT nextval('public.ussd_pins_id_seq'::regclass);


--
-- Name: ussd_session_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ussd_session_log ALTER COLUMN id SET DEFAULT nextval('public.ussd_session_log_id_seq'::regclass);


--
-- Name: ussd_sessions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ussd_sessions ALTER COLUMN id SET DEFAULT nextval('public.ussd_sessions_id_seq'::regclass);


--
-- Name: vat_records id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vat_records ALTER COLUMN id SET DEFAULT nextval('public.vat_records_id_seq'::regclass);


--
-- Name: velocity_limits id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.velocity_limits ALTER COLUMN id SET DEFAULT nextval('public.velocity_limits_id_seq'::regclass);


--
-- Name: voice_config id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.voice_config ALTER COLUMN id SET DEFAULT nextval('public.voice_config_id_seq'::regclass);


--
-- Name: voice_sessions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.voice_sessions ALTER COLUMN id SET DEFAULT nextval('public.voice_sessions_id_seq'::regclass);


--
-- Name: voice_sessions userId; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.voice_sessions ALTER COLUMN "userId" SET DEFAULT nextval('public."voice_sessions_userId_seq"'::regclass);


--
-- Name: wallet_transactions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wallet_transactions ALTER COLUMN id SET DEFAULT nextval('public.wallet_transactions_id_seq'::regclass);


--
-- Name: wallets id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wallets ALTER COLUMN id SET DEFAULT nextval('public.wallets_id_seq'::regclass);


--
-- Name: webhook_deliveries id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.webhook_deliveries ALTER COLUMN id SET DEFAULT nextval('public.webhook_deliveries_id_seq'::regclass);


--
-- Name: webhook_endpoints id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.webhook_endpoints ALTER COLUMN id SET DEFAULT nextval('public.webhook_endpoints_id_seq'::regclass);


--
-- Name: webhook_secrets id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.webhook_secrets ALTER COLUMN id SET DEFAULT nextval('public.webhook_secrets_id_seq'::regclass);


--
-- Name: whatsapp_messages id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whatsapp_messages ALTER COLUMN id SET DEFAULT nextval('public.whatsapp_messages_id_seq'::regclass);


--
-- Name: whatsapp_messages userId; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whatsapp_messages ALTER COLUMN "userId" SET DEFAULT nextval('public."whatsapp_messages_userId_seq"'::regclass);


--
-- Name: workflow_definitions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_definitions ALTER COLUMN id SET DEFAULT nextval('public.workflow_definitions_id_seq'::regclass);


--
-- Name: workflow_instances id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_instances ALTER COLUMN id SET DEFAULT nextval('public.workflow_instances_id_seq'::regclass);


--
-- Data for Name: _migrations; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public._migrations VALUES (1, '001_initial_schema', '2026-06-05 16:36:16.957841', 'initial');
INSERT INTO public._migrations VALUES (3, '003_add_file_uploads', '2026-06-05 16:36:16.963431', 'uploads_v1');
INSERT INTO public._migrations VALUES (5, '002_add_tenant_columns', '2026-06-05 16:36:56.928842', 'tenant_v2');


--
-- Data for Name: ab_experiments; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.ab_experiments VALUES (1, 'Premium Pricing Display', 'Testing dynamic vs flat pricing on quote page', 'active', 'Flat Rate Display', 'Dynamic Pricing Display', NULL, 0.50, '2026-05-01', '2026-06-30', 'conversion_rate', 0.0342, 0.0418, 15420, '2026-06-05 04:06:31.125857');
INSERT INTO public.ab_experiments VALUES (2, 'Claims UX Flow', 'Simplified vs wizard-based claims submission', 'completed', 'Multi-Step Wizard', 'Single Page Form', 'B', 0.50, '2026-03-01', '2026-04-30', 'completion_rate', 0.6200, 0.7800, 8900, '2026-06-05 04:06:31.125857');
INSERT INTO public.ab_experiments VALUES (3, 'Onboarding KYC Sequence', 'Testing KYC before vs after product selection', 'active', 'KYC First', 'Product First', NULL, 0.50, '2026-05-15', '2026-07-15', 'signup_completion', 0.4100, 0.4850, 4200, '2026-06-05 04:06:31.125857');
INSERT INTO public.ab_experiments VALUES (4, 'Mobile Premium Calculator', 'Step-by-step vs all-at-once premium calculator', 'active', 'Progressive Input', 'All Fields Visible', NULL, 0.50, '2026-05-20', '2026-07-20', 'quote_requests', 0.2890, 0.3150, 6800, '2026-06-05 04:06:31.125857');
INSERT INTO public.ab_experiments VALUES (5, 'Renewal Reminder Timing', 'Testing 30-day vs 14-day renewal reminders', 'completed', '30-Day Reminder', '14-Day Reminder', 'A', 0.50, '2026-02-01', '2026-03-31', 'renewal_rate', 0.7200, 0.6500, 12000, '2026-06-05 04:06:31.125857');


--
-- Data for Name: achievements; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.achievements VALUES (1, 'First Policy', 'Purchased your first insurance policy', 'milestone', 500, 'badge', 'policy_count', 1, '2026-06-05 04:06:31.160547');
INSERT INTO public.achievements VALUES (2, 'Claim-Free Year', 'No claims for 12 consecutive months', 'performance', 1000, 'star', 'claim_free_months', 12, '2026-06-05 04:06:31.160547');
INSERT INTO public.achievements VALUES (3, 'Referral Champion', 'Referred 5 friends who signed up', 'social', 2000, 'users', 'referral_count', 5, '2026-06-05 04:06:31.160547');
INSERT INTO public.achievements VALUES (4, 'Premium Pioneer', 'Paid premiums on time for 6 months', 'payment', 750, 'clock', 'on_time_payments', 6, '2026-06-05 04:06:31.160547');
INSERT INTO public.achievements VALUES (5, 'Coverage Complete', 'Have 3 or more active policies', 'coverage', 1500, 'shield', 'active_policies', 3, '2026-06-05 04:06:31.160547');
INSERT INTO public.achievements VALUES (6, 'Wellness Warrior', 'Completed 5 health program activities', 'health', 800, 'heart', 'wellness_activities', 5, '2026-06-05 04:06:31.160547');
INSERT INTO public.achievements VALUES (7, 'Digital Native', 'Used all digital channels (web, mobile, USSD)', 'engagement', 600, 'smartphone', 'channel_count', 3, '2026-06-05 04:06:31.160547');
INSERT INTO public.achievements VALUES (8, 'Loyalty Legend', 'Maintained Gold tier for 12 months', 'loyalty', 3000, 'crown', 'gold_months', 12, '2026-06-05 04:06:31.160547');


--
-- Data for Name: actuarial_calculations; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.actuarial_calculations VALUES (1, 6, 'Loss Ratio', 'All Lines', '{"period":"Q1 2026","earnedPremium":2400000000,"incurredClaims":1495200000}', 62.3000, '{"motor":58.2,"health":71.5,"property":45.8,"life":32.1,"agricultural":89.3,"parametric":15.0}', '2026-05-04 17:07:58.339102');
INSERT INTO public.actuarial_calculations VALUES (2, 6, 'Combined Ratio', 'All Lines', '{"period":"Q1 2026","lossRatio":62.3,"expenseRatio":28.5}', 90.8000, '{"underwritingProfit":9.2,"investmentIncome":4.8,"operatingRatio":86.0}', '2026-05-04 17:07:58.339102');
INSERT INTO public.actuarial_calculations VALUES (3, 6, 'Solvency Margin', 'All Lines', '{"admittedAssets":18500000000,"totalLiabilities":10000000000,"minimumCapital":3000000000}', 185.0000, '{"riskBasedCapital":8500000000,"regulatoryMinimum":3000000000,"surplus":5500000000}', '2026-05-04 17:07:58.339102');
INSERT INTO public.actuarial_calculations VALUES (4, 6, 'IBNR Reserve', 'Motor', '{"method":"Chain Ladder","developmentFactors":[1.25,1.12,1.05,1.02,1.01]}', 212500000.0000, '{"ultimateClaims":1062500000,"paidToDate":850000000,"ibnr":212500000}', '2026-05-21 17:07:58.339102');
INSERT INTO public.actuarial_calculations VALUES (5, 6, 'Technical Provisions', 'Health', '{"method":"Bornhuetter-Ferguson","expectedLossRatio":0.72}', 864000000.0000, '{"expectedClaims":864000000,"reportedClaims":720000000,"unreported":144000000}', '2026-05-21 17:07:58.339102');
INSERT INTO public.actuarial_calculations VALUES (6, 6, 'Premium Adequacy', 'Auto', '{"claimsFrequency":0.08,"averageClaimSize":350000,"expenses":0.285,"profitMargin":0.05}', 40702.0000, '{"purePremium":28000,"expenseLoading":11402,"profitLoading":2035,"recommendedPremium":41437}', '2026-05-28 17:07:58.339102');


--
-- Data for Name: agent_achievements; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.agent_achievements VALUES (1, 7, 'standard', 'agent achievements 1', 'Sample data for agent_achievements record 1', 'agent achievements 1', 1, 1, '2026-05-29 14:49:33.29427', 'agent achievements 1');
INSERT INTO public.agent_achievements VALUES (2, 8, 'standard', 'agent achievements 2', 'Sample data for agent_achievements record 2', 'agent achievements 2', 2, 2, '2026-05-22 14:49:33.29427', 'agent achievements 2');
INSERT INTO public.agent_achievements VALUES (3, 9, 'standard', 'agent achievements 3', 'Sample data for agent_achievements record 3', 'agent achievements 3', 3, 3, '2026-05-15 14:49:33.29427', 'agent achievements 3');


--
-- Data for Name: agent_badges; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.agent_badges VALUES (1, 'Sample agent_badges 1', 'Sample data for agent_badges record 1', 'agent badges 1', 'agent badges 1', 'agent badges 1', 1, true, '2026-05-29 14:49:33.298883');
INSERT INTO public.agent_badges VALUES (2, 'Sample agent_badges 2', 'Sample data for agent_badges record 2', 'agent badges 2', 'agent badges 2', 'agent badges 2', 2, false, '2026-05-22 14:49:33.298883');
INSERT INTO public.agent_badges VALUES (3, 'Sample agent_badges 3', 'Sample data for agent_badges record 3', 'agent badges 3', 'agent badges 3', 'agent badges 3', 3, false, '2026-05-15 14:49:33.298883');


--
-- Data for Name: agent_bank_accounts; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.agent_bank_accounts VALUES (1, 7, 'agent bank accounts 1', 'AGE-2026-001', 'AGE-2026-001', 'agent bank accounts 1', true, true, '2026-05-29 14:49:33.30305', '2026-05-29 14:49:33.30305');
INSERT INTO public.agent_bank_accounts VALUES (2, 8, 'agent bank accounts 2', 'AGE-2026-002', 'AGE-2026-002', 'agent bank accounts 2', false, false, '2026-05-22 14:49:33.30305', '2026-05-22 14:49:33.30305');
INSERT INTO public.agent_bank_accounts VALUES (3, 9, 'agent bank accounts 3', 'AGE-2026-003', 'AGE-2026-003', 'agent bank accounts 3', false, false, '2026-05-15 14:49:33.30305', '2026-05-15 14:49:33.30305');


--
-- Data for Name: agent_commissions; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.agent_commissions VALUES (1, 1, 1, 3750.00, 0.1500, 'paid', '2026-02-04 17:13:27.187352', '2026-01-04 17:13:27.187352');
INSERT INTO public.agent_commissions VALUES (2, 1, 2, 27750.00, 0.1500, 'paid', '2026-03-04 17:13:27.187352', '2026-02-04 17:13:27.187352');
INSERT INTO public.agent_commissions VALUES (3, 2, 5, 8500.00, 0.1000, 'paid', '2026-01-04 17:13:27.187352', '2025-12-04 17:13:27.187352');
INSERT INTO public.agent_commissions VALUES (4, 3, 3, 2700.00, 0.1500, 'paid', '2025-12-04 17:13:27.187352', '2025-11-04 17:13:27.187352');
INSERT INTO public.agent_commissions VALUES (5, 5, 15, 5625.00, 0.0750, 'pending', NULL, '2026-04-04 17:13:27.187352');
INSERT INTO public.agent_commissions VALUES (6, 1, 4, 45000.00, 0.1000, 'paid', '2026-04-04 17:13:27.187352', '2026-03-04 17:13:27.187352');
INSERT INTO public.agent_commissions VALUES (7, 4, 6, 2500.00, 0.1000, 'paid', '2026-03-04 17:13:27.187352', '2026-02-04 17:13:27.187352');
INSERT INTO public.agent_commissions VALUES (8, 6, 7, 75000.00, 0.0300, 'pending', NULL, '2026-04-04 17:13:27.187352');


--
-- Data for Name: agent_geofence_zones; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.agent_geofence_zones VALUES (1, 7, 1, 'agent geofence zones 1', '2026-05-29 14:49:33.307096');
INSERT INTO public.agent_geofence_zones VALUES (2, 8, 2, 'agent geofence zones 2', '2026-05-22 14:49:33.307096');
INSERT INTO public.agent_geofence_zones VALUES (3, 9, 3, 'agent geofence zones 3', '2026-05-15 14:49:33.307096');


--
-- Data for Name: agent_loans; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.agent_loans VALUES (1, 7, 'agent_loans 1', 50000.00, 0.05, 1, 1.50, 50000.00, 'pending', '2026-05-29 14:50:04.568974', '2026-07-05 14:50:04.568974', 1, 75, 'agent_loans 1', 6.46, '2026-05-29 14:50:04.568974', '2026-05-29 14:50:04.568974');
INSERT INTO public.agent_loans VALUES (2, 8, 'agent_loans 2', 100000.00, 0.10, 2, 3.00, 100000.00, 'approved', '2026-05-22 14:50:04.568974', '2026-08-04 14:50:04.568974', 2, 80, 'agent_loans 2', 6.47, '2026-05-22 14:50:04.568974', '2026-05-22 14:50:04.568974');
INSERT INTO public.agent_loans VALUES (3, 9, 'agent_loans 3', 150000.00, 0.15, 3, 4.50, 150000.00, 'disbursed', '2026-05-15 14:50:04.568974', '2026-09-03 14:50:04.568974', 3, 85, 'agent_loans 3', 6.48, '2026-05-15 14:50:04.568974', '2026-05-15 14:50:04.568974');


--
-- Data for Name: agent_onboarding_progress; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.agent_onboarding_progress VALUES (5, 1, 'agent_onboardin 1', 'profile', true, true, true, true, true, '2026-05-29 14:50:36.403562', 'agent_onboardin 1', '2026-05-29 14:50:36.403562', '2026-05-29 14:50:36.403562');
INSERT INTO public.agent_onboarding_progress VALUES (6, 2, 'agent_onboardin 2', 'kyc', false, false, false, false, false, '2026-05-22 14:50:36.403562', 'agent_onboardin 2', '2026-05-22 14:50:36.403562', '2026-05-22 14:50:36.403562');
INSERT INTO public.agent_onboarding_progress VALUES (7, 3, 'agent_onboardin 3', 'float', false, false, false, false, false, '2026-05-15 14:50:36.403562', 'agent_onboardin 3', '2026-05-15 14:50:36.403562', '2026-05-15 14:50:36.403562');


--
-- Data for Name: agent_performance_scores; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.agent_performance_scores VALUES (1, 7, 'agent performance scores 1', 1.50, 5, 1.50, 5, 0.0500, 1.50, 1.50, 1, '2026-05-29 14:49:33.352818');
INSERT INTO public.agent_performance_scores VALUES (2, 8, 'agent performance scores 2', 3.00, 10, 3.00, 10, 0.1000, 3.00, 3.00, 2, '2026-05-22 14:49:33.352818');
INSERT INTO public.agent_performance_scores VALUES (3, 9, 'agent performance scores 3', 4.50, 15, 4.50, 15, 0.1500, 4.50, 4.50, 3, '2026-05-15 14:49:33.352818');


--
-- Data for Name: agent_push_subscriptions; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.agent_push_subscriptions VALUES (1, 'AGE-2026-001', 'agent push subscriptions 1', 'agent_push_subscriptions_key_1_7da617abb407de24e1c31ec32ef14fb3', 'agent_push_subscriptions_key_1_70863998219ef3fcbf768611842171f3', 'agent push subscriptions 1', '2026-05-29 14:49:33.357617', '2026-05-29 14:49:33.357617', '2026-05-29 14:49:33.357617');
INSERT INTO public.agent_push_subscriptions VALUES (2, 'AGE-2026-002', 'agent push subscriptions 2', 'agent_push_subscriptions_key_2_1ecac964d82a8220ebaeb76ef85defd2', 'agent_push_subscriptions_key_2_337c240d5c4173972bf78b6e2090c060', 'agent push subscriptions 2', '2026-05-22 14:49:33.357617', '2026-05-22 14:49:33.357617', '2026-05-22 14:49:33.357617');
INSERT INTO public.agent_push_subscriptions VALUES (3, 'AGE-2026-003', 'agent push subscriptions 3', 'agent_push_subscriptions_key_3_23c5fa45d6faae50566ca96f233f7062', 'agent_push_subscriptions_key_3_f6205c1e82b8d6db7979d59fb64a315d', 'agent push subscriptions 3', '2026-05-15 14:49:33.357617', '2026-05-15 14:49:33.357617', '2026-05-15 14:49:33.357617');


--
-- Data for Name: agent_suspension_log; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.agent_suspension_log VALUES (1, 7, 'agent suspension log 1', 'Sample data for agent_suspension_log record 1', 1, 'active', 'active', '2026-05-29 14:49:33.36202');
INSERT INTO public.agent_suspension_log VALUES (2, 8, 'agent suspension log 2', 'Sample data for agent_suspension_log record 2', 2, 'active', 'active', '2026-05-22 14:49:33.36202');
INSERT INTO public.agent_suspension_log VALUES (3, 9, 'agent suspension log 3', 'Sample data for agent_suspension_log record 3', 3, 'active', 'active', '2026-05-15 14:49:33.36202');


--
-- Data for Name: agents; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.agents VALUES (1, 1, 'AGT-LAG-001', 'NAICOM/AG/2024/001', 'Kayode Adeniyi Insurance', 'Lagos', 'Gold', 0.1500, 347, 45000000.00, 'active', '2024-06-04 17:11:21.88679', '2026-06-04 17:11:21.88679', 'agent', false, true, NULL, NULL, NULL, 0, 0.00, 'N/A', NULL, 'agent', 3, NULL, 1000000.00);
INSERT INTO public.agents VALUES (2, 2, 'AGT-ABJ-001', 'NAICOM/AG/2024/002', 'Zainab Usman Associates', 'Abuja', 'Silver', 0.1200, 234, 28000000.00, 'active', '2024-12-04 17:11:21.88679', '2026-06-04 17:11:21.88679', 'agent', false, true, NULL, NULL, NULL, 0, 0.00, 'N/A', NULL, 'agent', 3, NULL, 1000000.00);
INSERT INTO public.agents VALUES (3, 3, 'AGT-KAN-001', 'NAICOM/AG/2024/003', 'Suleiman Balarabe Insurance', 'Kano', 'Gold', 0.1500, 456, 52000000.00, 'active', '2024-10-04 17:11:21.88679', '2026-06-04 17:11:21.88679', 'agent', false, true, NULL, NULL, NULL, 0, 0.00, 'N/A', NULL, 'agent', 3, NULL, 500000.00);
INSERT INTO public.agents VALUES (4, 4, 'AGT-PH-001', 'NAICOM/AG/2025/001', 'Comfort Amadi Insurance', 'Rivers', 'Bronze', 0.1000, 87, 8500000.00, 'active', '2025-10-04 17:11:21.88679', '2026-06-04 17:11:21.88679', 'agent', false, true, NULL, NULL, NULL, 0, 0.00, 'N/A', NULL, 'agent', 3, NULL, 500000.00);
INSERT INTO public.agents VALUES (5, 5, 'AGT-IBD-001', 'NAICOM/AG/2023/001', 'Adewale Ojo & Partners', 'Oyo', 'Platinum', 0.1800, 621, 78000000.00, 'active', '2023-06-04 17:11:21.88679', '2026-06-04 17:11:21.88679', 'agent', false, true, NULL, NULL, NULL, 0, 0.00, 'N/A', NULL, 'agent', 3, NULL, 200000.00);
INSERT INTO public.agents VALUES (6, 6, 'AGT-ENU-001', 'NAICOM/AG/2024/004', 'Obioma Nwachukwu Insurance', 'Enugu', 'Silver', 0.1200, 192, 19000000.00, 'active', '2025-04-04 17:11:21.88679', '2026-06-04 17:11:21.88679', 'agent', false, true, NULL, NULL, NULL, 0, 0.00, 'N/A', NULL, 'agent', 3, NULL, 200000.00);


--
-- Data for Name: agricultural_schemes; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.agricultural_schemes VALUES (1, 'NIRSAL Agri-Insurance', 'federal', 'crop', 5000000.00, 50.00, 'Nigeria Incentive-Based Risk Sharing System', '{"All States"}', 45000, 'active', '2026-06-05 04:06:31.208907');
INSERT INTO public.agricultural_schemes VALUES (2, 'NAIC Livestock Protection', 'federal', 'livestock', 2000000.00, 40.00, 'National Agricultural Insurance Corporation', '{"All States"}', 28000, 'active', '2026-06-05 04:06:31.208907');
INSERT INTO public.agricultural_schemes VALUES (3, 'Lagos State Cassava Programme', 'state', 'crop', 1000000.00, 60.00, 'Lagos State Ministry of Agriculture', '{Lagos}', 3200, 'active', '2026-06-05 04:06:31.208907');
INSERT INTO public.agricultural_schemes VALUES (4, 'CBN Anchor Borrowers Scheme', 'federal', 'crop', 3000000.00, 50.00, 'Central Bank of Nigeria', '{"All States"}', 62000, 'active', '2026-06-05 04:06:31.208907');
INSERT INTO public.agricultural_schemes VALUES (5, 'Kaduna Rice Farmers Protection', 'state', 'crop', 1500000.00, 45.00, 'Kaduna State Government', '{Kaduna}', 8500, 'active', '2026-06-05 04:06:31.208907');
INSERT INTO public.agricultural_schemes VALUES (6, 'Niger Delta Aquaculture Cover', 'state', 'aquaculture', 2500000.00, 35.00, 'NDDC', '{Rivers,Bayelsa,Delta}', 1200, 'active', '2026-06-05 04:06:31.208907');


--
-- Data for Name: agricultural_trigger_events; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.agricultural_trigger_events VALUES (1, 'drought', 'Kano', 'moderate', '2026-04-15', 450, 2250000000.00, true, 125000000.00, 'NIMET Satellite', '2026-06-05 04:06:31.216542');
INSERT INTO public.agricultural_trigger_events VALUES (2, 'flood', 'Niger Delta', 'severe', '2026-03-20', 120, 960000000.00, true, 480000000.00, 'NIHSA River Gauge', '2026-06-05 04:06:31.216542');
INSERT INTO public.agricultural_trigger_events VALUES (3, 'pest_infestation', 'Benue', 'mild', '2026-05-01', 85, 127500000.00, false, NULL, 'Extension Agent Report', '2026-06-05 04:06:31.216542');
INSERT INTO public.agricultural_trigger_events VALUES (4, 'hail', 'Plateau', 'moderate', '2026-04-28', 35, 52500000.00, true, 26250000.00, 'Weather Station', '2026-06-05 04:06:31.216542');
INSERT INTO public.agricultural_trigger_events VALUES (5, 'excess_rain', 'Lagos', 'severe', '2026-05-18', 200, 1000000000.00, true, 350000000.00, 'NIMET Radar', '2026-06-05 04:06:31.216542');


--
-- Data for Name: agricultural_underwriting_rules; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.agricultural_underwriting_rules VALUES (1, 'Crop Type Assessment', 'crop_type', 0.25, 'Risk profile varies by crop: cassava (low), rice (medium), cotton (high)', '2026-06-05 04:11:13.040271');
INSERT INTO public.agricultural_underwriting_rules VALUES (2, 'Region Risk Score', 'location', 0.30, 'Historical weather events, soil quality, and infrastructure proximity', '2026-06-05 04:11:13.040271');
INSERT INTO public.agricultural_underwriting_rules VALUES (3, 'Historical Yield', 'yield_history', 0.20, '3-year average yield vs regional benchmark', '2026-06-05 04:11:13.040271');
INSERT INTO public.agricultural_underwriting_rules VALUES (4, 'Irrigation Status', 'irrigation', 0.15, 'Irrigated farms have lower drought risk', '2026-06-05 04:11:13.040271');
INSERT INTO public.agricultural_underwriting_rules VALUES (5, 'Soil Quality', 'soil_index', 0.10, 'Based on FMARD soil classification data', '2026-06-05 04:11:13.040271');


--
-- Data for Name: analytics_dashboards; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.analytics_dashboards VALUES (1, 'Sample analytics_dashboards 1', 'Sample data for analytics_dashboards record 1', 1, true, 'analytics dashboards 1', 'analytics dashboards 1', 1, '2026-05-29 14:49:33.366042', '2026-05-29 14:49:33.366042');
INSERT INTO public.analytics_dashboards VALUES (2, 'Sample analytics_dashboards 2', 'Sample data for analytics_dashboards record 2', 2, false, 'analytics dashboards 2', 'analytics dashboards 2', 2, '2026-05-22 14:49:33.366042', '2026-05-22 14:49:33.366042');
INSERT INTO public.analytics_dashboards VALUES (3, 'Sample analytics_dashboards 3', 'Sample data for analytics_dashboards record 3', 3, false, 'analytics dashboards 3', 'analytics dashboards 3', 3, '2026-05-15 14:49:33.366042', '2026-05-15 14:49:33.366042');


--
-- Data for Name: analytics_events; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.analytics_events VALUES (1, 1, 'policy_purchase', 'policy', '1', '{"productType":"Motor","premium":25000,"channel":"web"}', 'sess-001', '197.210.45.32', '2026-01-04 17:10:58.680824');
INSERT INTO public.analytics_events VALUES (2, 2, 'policy_purchase', 'policy', '5', '{"productType":"Health","premium":85000,"channel":"web"}', 'sess-002', '197.210.45.33', '2025-12-04 17:10:58.680824');
INSERT INTO public.analytics_events VALUES (3, 1, 'claim_filed', 'claim', '1', '{"amount":450000,"channel":"web"}', 'sess-003', '197.210.45.32', '2026-05-21 17:10:58.680824');
INSERT INTO public.analytics_events VALUES (4, 2, 'claim_filed', 'claim', '2', '{"amount":180000,"channel":"mobile"}', 'sess-004', '197.210.45.33', '2026-05-04 17:10:58.680824');
INSERT INTO public.analytics_events VALUES (5, 9, 'policy_purchase', 'policy', '4', '{"productType":"Motor Fleet","premium":450000,"channel":"agent"}', 'sess-005', '197.210.45.50', '2026-03-04 17:10:58.680824');
INSERT INTO public.analytics_events VALUES (6, 9, 'policy_purchase', 'policy', '8', '{"productType":"Property","premium":350000,"channel":"web"}', 'sess-006', '197.210.45.50', '2025-12-04 17:10:58.680824');
INSERT INTO public.analytics_events VALUES (7, 12, 'claim_filed', 'claim', '7', '{"amount":50000000,"channel":"agent"}', 'sess-007', '197.210.45.60', '2026-04-04 17:10:58.680824');
INSERT INTO public.analytics_events VALUES (8, 6, 'policy_purchase', 'policy', '17', '{"productType":"Parametric","premium":8000,"channel":"ussd"}', 'sess-008', '197.210.45.70', '2026-05-04 17:10:58.680824');
INSERT INTO public.analytics_events VALUES (9, 8, 'policy_purchase', 'policy', '13', '{"productType":"Microinsurance","premium":3500,"channel":"ussd"}', 'sess-009', '197.210.45.80', '2026-05-04 17:10:58.680824');
INSERT INTO public.analytics_events VALUES (10, 5, 'naicom_filing', 'filing', '1', '{"filingType":"Quarterly Returns","period":"Q1 2026"}', 'sess-010', '197.210.45.35', '2026-04-04 17:10:58.680824');


--
-- Data for Name: analytics_metrics; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.analytics_metrics VALUES (1, 'total_premium_collected', 45000000.0000, '2026-06-04 13:10:20.999939', '{"period":"2026-Q2","currency":"NGN"}', '2026-06-04 13:10:20.999939');
INSERT INTO public.analytics_metrics VALUES (2, 'claims_paid', 12500000.0000, '2026-06-04 13:10:20.999939', '{"period":"2026-Q2","currency":"NGN"}', '2026-06-04 13:10:20.999939');
INSERT INTO public.analytics_metrics VALUES (3, 'active_policies', 23.0000, '2026-06-04 13:10:20.999939', '{"period":"2026-Q2"}', '2026-06-04 13:10:20.999939');
INSERT INTO public.analytics_metrics VALUES (4, 'loss_ratio', 0.2780, '2026-06-04 13:10:20.999939', '{"period":"2026-Q2"}', '2026-06-04 13:10:20.999939');
INSERT INTO public.analytics_metrics VALUES (5, 'customer_satisfaction', 4.6000, '2026-06-04 13:10:20.999939', '{"period":"2026-Q2","scale":"1-5"}', '2026-06-04 13:10:20.999939');
INSERT INTO public.analytics_metrics VALUES (6, 'new_customers', 8.0000, '2026-06-04 13:10:20.999939', '{"period":"2026-Q2"}', '2026-06-04 13:10:20.999939');


--
-- Data for Name: api_key_usage; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.api_key_usage VALUES (9, 1, 'api_key_usage 1', 'api_ 1', 1, 1, 'api_key_usage 1', '2026-05-29 14:50:36.40752');
INSERT INTO public.api_key_usage VALUES (10, 2, 'api_key_usage 2', 'api_ 2', 2, 2, 'api_key_usage 2', '2026-05-22 14:50:36.40752');
INSERT INTO public.api_key_usage VALUES (11, 3, 'api_key_usage 3', 'api_ 3', 3, 3, 'api_key_usage 3', '2026-05-15 14:50:36.40752');


--
-- Data for Name: api_keys; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.api_keys VALUES (1, 'k1', 'k1', 'Sample 1', '102.89.1', 1, 1, 'active', '{"data": "sample_1"}', 1, '2026-05-29 14:50:04.619161', '2026-07-05 14:50:04.619161', '2026-05-29 14:50:04.619161', '2026-05-29 14:50:04.619161');
INSERT INTO public.api_keys VALUES (2, 'k2', 'k2', 'Sample 2', '102.89.2', 2, 2, 'revoked', '{"data": "sample_2"}', 2, '2026-05-22 14:50:04.619161', '2026-08-04 14:50:04.619161', '2026-05-22 14:50:04.619161', '2026-05-22 14:50:04.619161');
INSERT INTO public.api_keys VALUES (3, 'k3', 'k3', 'Sample 3', '102.89.3', 3, 3, 'expired', '{"data": "sample_3"}', 3, '2026-05-15 14:50:04.619161', '2026-09-03 14:50:04.619161', '2026-05-15 14:50:04.619161', '2026-05-15 14:50:04.619161');


--
-- Data for Name: approval_chains; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.approval_chains VALUES (1, 'New Product Rollout', 'product_rollout', 0.00, '[{"role": "product_manager", "order": 1, "action": "initiate", "sla_hours": 24}, {"role": "actuarial_analyst", "order": 2, "action": "review_pricing", "sla_hours": 48}, {"role": "compliance_officer", "order": 3, "action": "compliance_check", "sla_hours": 24}, {"role": "chief_underwriter", "order": 4, "action": "final_approval", "sla_hours": 24}]', true, '2026-06-04 19:56:03.63756', '2026-06-04 19:56:03.63756');
INSERT INTO public.approval_chains VALUES (2, 'Standard Application Approval', 'insurance_application', 500000.00, '[{"role": "underwriter", "order": 1, "action": "risk_assessment", "sla_hours": 4}, {"role": "senior_underwriter", "order": 2, "action": "approve", "sla_hours": 8}]', true, '2026-06-04 19:56:03.63756', '2026-06-04 19:56:03.63756');
INSERT INTO public.approval_chains VALUES (3, 'High-Value Application Approval', 'insurance_application', 5000000.00, '[{"role": "underwriter", "order": 1, "action": "risk_assessment", "sla_hours": 4}, {"role": "senior_underwriter", "order": 2, "action": "review", "sla_hours": 8}, {"role": "chief_underwriter", "order": 3, "action": "approve", "sla_hours": 24}, {"role": "head_of_operations", "order": 4, "action": "final_sign_off", "sla_hours": 48}]', true, '2026-06-04 19:56:03.63756', '2026-06-04 19:56:03.63756');
INSERT INTO public.approval_chains VALUES (4, 'Standard Claim Payout', 'claim_high_value', 500000.00, '[{"role": "claims_adjudicator", "order": 1, "action": "assess", "sla_hours": 4}, {"role": "claims_manager", "order": 2, "action": "approve", "sla_hours": 8}]', true, '2026-06-04 19:56:03.63756', '2026-06-04 19:56:03.63756');
INSERT INTO public.approval_chains VALUES (5, 'High-Value Claim Payout (>₦5M)', 'claim_high_value', 5000000.00, '[{"role": "claims_adjudicator", "order": 1, "action": "assess", "sla_hours": 4}, {"role": "claims_manager", "order": 2, "action": "review", "sla_hours": 8}, {"role": "head_of_claims", "order": 3, "action": "approve", "sla_hours": 24}, {"role": "cfo", "order": 4, "action": "authorize_payment", "sla_hours": 48}]', true, '2026-06-04 19:56:03.63756', '2026-06-04 19:56:03.63756');
INSERT INTO public.approval_chains VALUES (6, 'NAICOM Filing Approval', 'naicom_filing', 0.00, '[{"role": "compliance_officer", "order": 1, "action": "prepare", "sla_hours": 48}, {"role": "head_of_compliance", "order": 2, "action": "review", "sla_hours": 24}, {"role": "ceo", "order": 3, "action": "sign_off", "sla_hours": 24}]', true, '2026-06-04 19:56:03.63756', '2026-06-04 19:56:03.63756');
INSERT INTO public.approval_chains VALUES (7, 'Compliance Review', 'compliance', 0.00, '[{"role": "compliance_analyst", "order": 1, "action": "investigate", "sla_hours": 24}, {"role": "compliance_officer", "order": 2, "action": "review", "sla_hours": 24}, {"role": "head_of_compliance", "order": 3, "action": "determine", "sla_hours": 48}]', true, '2026-06-04 19:56:03.63756', '2026-06-04 19:56:03.63756');


--
-- Data for Name: approval_requests; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.approval_requests VALUES (1, 2, 'insurance_application', 1, 1, 'in_review', 'Customer Portal', '2026-06-04 19:56:03.63756', NULL, 'Motor comprehensive application - ₦5M sum assured', '[{"at": "2026-05-25T10:00:00Z", "by": "Adebayo Okonkwo", "role": "underwriter", "step": 1, "action": "risk_assessment", "comment": "Risk assessment initiated"}]');
INSERT INTO public.approval_requests VALUES (2, 2, 'insurance_application', 2, 2, 'approved', 'Customer Portal', '2026-06-04 19:56:03.63756', NULL, 'Health individual application - standard risk', '[{"at": "2026-05-24T09:00:00Z", "by": "Adebayo Okonkwo", "role": "underwriter", "step": 1, "action": "risk_assessment", "comment": "Low risk profile"}, {"at": "2026-05-24T14:00:00Z", "by": "Fatima Bello", "role": "senior_underwriter", "step": 2, "action": "approve", "comment": "Approved - standard risk"}]');
INSERT INTO public.approval_requests VALUES (3, 3, 'insurance_application', 3, 3, 'in_review', 'Agent Portal', '2026-06-04 19:56:03.63756', NULL, 'Commercial fire - ₦50M sum assured, requires chief UW', '[{"at": "2026-05-23T08:00:00Z", "by": "Chinedu Obi", "role": "underwriter", "step": 1, "action": "risk_assessment", "comment": "High value - elevated risk"}, {"at": "2026-05-23T16:00:00Z", "by": "Fatima Bello", "role": "senior_underwriter", "step": 2, "action": "review", "comment": "Flagged for chief UW review"}]');
INSERT INTO public.approval_requests VALUES (4, 4, 'claim_high_value', 1, 2, 'approved', 'Claims System', '2026-06-04 19:56:03.63756', NULL, 'Motor accident claim - ₦250K payout', '[{"at": "2026-05-20T11:00:00Z", "by": "Emmanuel Nwachukwu", "role": "claims_adjudicator", "step": 1, "action": "assess", "comment": "Valid claim, documentation complete"}, {"at": "2026-05-20T15:00:00Z", "by": "Grace Adeyemi", "role": "claims_manager", "step": 2, "action": "approve", "comment": "Approved for payout"}]');
INSERT INTO public.approval_requests VALUES (5, 5, 'claim_high_value', 2, 2, 'in_review', 'Claims System', '2026-06-04 19:56:03.63756', NULL, 'Fire damage claim - ₦8M, requires HoC approval', '[{"at": "2026-05-22T09:00:00Z", "by": "Emmanuel Nwachukwu", "role": "claims_adjudicator", "step": 1, "action": "assess", "comment": "Surveyor report received, damage confirmed"}]');
INSERT INTO public.approval_requests VALUES (6, 1, 'product_rollout', 1, 2, 'in_review', 'Product Team', '2026-06-04 19:56:03.63756', NULL, 'New Cyber Insurance product launch', '[{"at": "2026-05-15T10:00:00Z", "by": "Product Team", "role": "product_manager", "step": 1, "action": "initiate", "comment": "Product spec finalized"}, {"at": "2026-05-18T14:00:00Z", "by": "Actuarial Dept", "role": "actuarial_analyst", "step": 2, "action": "review_pricing", "comment": "Pricing model validated"}]');
INSERT INTO public.approval_requests VALUES (7, 6, 'naicom_filing', 1, 1, 'pending', 'Compliance', '2026-06-04 19:56:03.63756', NULL, 'Q2 2026 Quarterly Returns', '[{"at": "2026-05-28T08:00:00Z", "by": "Compliance Team", "role": "compliance_officer", "step": 1, "action": "prepare", "comment": "Data compilation in progress"}]');


--
-- Data for Name: audit_log; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.audit_log VALUES (1, 1, 'AGT-001', 'LOGIN', 'auth', '1', '192.168.1.100', 'Mozilla/5.0', 'success', '{"method":"password"}', '2026-06-05 11:09:47.568136', NULL);
INSERT INTO public.audit_log VALUES (2, 1, 'AGT-001', 'VIEW_POLICY', 'policy', '5', '192.168.1.100', 'Mozilla/5.0', 'success', '{"policyNumber":"POL-2026-001"}', '2026-06-05 12:09:47.568136', NULL);
INSERT INTO public.audit_log VALUES (3, 2, 'AGT-002', 'FILE_CLAIM', 'claim', '3', '10.0.0.50', 'InsurePortal/2.0', 'success', '{"claimAmount":150000}', '2026-06-05 12:24:47.568136', NULL);
INSERT INTO public.audit_log VALUES (4, 1, 'AGT-001', 'APPROVE_CLAIM', 'claim', '3', '192.168.1.100', 'Mozilla/5.0', 'success', '{"decision":"approved"}', '2026-06-05 12:39:47.568136', NULL);
INSERT INTO public.audit_log VALUES (5, 3, 'AGT-003', 'UPDATE_KYC', 'kyc', '7', '172.16.0.1', 'Mobile/1.0', 'success', '{"level":"2->3"}', '2026-06-05 12:54:47.568136', NULL);
INSERT INTO public.audit_log VALUES (6, 1, 'AGT-001', 'GENERATE_REPORT', 'naicom', 'RPT-Q2', '192.168.1.100', 'Mozilla/5.0', 'success', '{"type":"quarterly"}', '2026-06-05 12:59:47.568136', NULL);
INSERT INTO public.audit_log VALUES (7, 2, 'AGT-002', 'PREMIUM_PAYMENT', 'payment', 'PAY-001', '10.0.0.50', 'InsurePortal/2.0', 'success', '{"amount":75000,"gateway":"paystack"}', '2026-06-05 13:04:47.568136', NULL);
INSERT INTO public.audit_log VALUES (8, 1, 'AGT-001', 'POLICY_RENEWAL', 'policy', '2', '192.168.1.100', 'Mozilla/5.0', 'success', '{"renewalPeriod":"12 months"}', '2026-06-05 13:09:47.568136', NULL);


--
-- Data for Name: audit_trail; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.audit_trail VALUES (1, 1, 'LOGIN', 'user', '1', NULL, '{"method":"email_password"}', '197.210.45.32', NULL, '2026-06-03 17:10:58.68486');
INSERT INTO public.audit_trail VALUES (2, 2, 'POLICY_APPROVED', 'policy', '1', '{"status":"Pending"}', '{"status":"Active","premium":25000}', '197.210.45.33', NULL, '2026-01-04 17:10:58.68486');
INSERT INTO public.audit_trail VALUES (3, 3, 'CLAIM_REVIEWED', 'claim', '2', '{"status":"Submitted"}', '{"status":"Approved","settlementAmount":175000}', '197.210.45.34', NULL, '2026-05-04 17:10:58.68486');
INSERT INTO public.audit_trail VALUES (4, 5, 'NAICOM_FILED', 'filing', '1', NULL, '{"filingType":"Quarterly Returns","period":"Q1 2026"}', '197.210.45.35', NULL, '2026-04-04 17:10:58.68486');
INSERT INTO public.audit_trail VALUES (5, 7, 'TREATY_CREATED', 'treaty', '1', NULL, '{"treatyName":"Property Surplus Treaty 2026","reinsurer":"Africa Re"}', '197.210.45.36', NULL, '2025-12-04 17:10:58.68486');
INSERT INTO public.audit_trail VALUES (6, 1, 'SETTINGS_CHANGED', 'system', 'config', '{"auto_renewal":false}', '{"auto_renewal":true}', '197.210.45.32', NULL, '2026-05-21 17:10:58.68486');
INSERT INTO public.audit_trail VALUES (7, 3, 'CLAIM_REJECTED', 'claim', '5', '{"status":"Under Review"}', '{"status":"Rejected","reason":"No police report within 24 hours"}', '197.210.45.34', NULL, '2026-02-04 17:10:58.68486');
INSERT INTO public.audit_trail VALUES (8, 2, 'UNDERWRITING_DECISION', 'application', '3', '{"status":"submitted"}', '{"status":"referred","reason":"Medical history requires review"}', '197.210.45.33', NULL, '2026-06-01 17:10:58.68486');
INSERT INTO public.audit_trail VALUES (9, 1, 'LOGIN', 'user', '1', NULL, '{"status":"success"}', '105.112.48.1', NULL, '2026-06-04 20:11:40.631314');
INSERT INTO public.audit_trail VALUES (10, 1, 'CREATE_POLICY', 'policy', '5', NULL, '{"policyNumber":"POL-2026-005","type":"Motor","premium":45000}', '105.112.48.1', NULL, '2026-06-04 20:11:40.631314');
INSERT INTO public.audit_trail VALUES (11, 2, 'APPROVE_CLAIM', 'claim', '3', '{"status":"Under Review"}', '{"status":"Approved","amount":250000}', '41.58.203.12', NULL, '2026-06-04 20:11:40.631314');
INSERT INTO public.audit_trail VALUES (12, 1, 'KYC_VERIFICATION', 'customer', '1', '{"kycLevel":2}', '{"kycLevel":3,"bvnVerified":true}', '105.112.48.1', NULL, '2026-06-04 20:11:40.631314');
INSERT INTO public.audit_trail VALUES (13, 3, 'UPDATE_PRODUCT', 'product', '2', '{"maxPremium":400000}', '{"maxPremium":500000}', '154.120.18.5', NULL, '2026-06-04 20:11:40.631314');
INSERT INTO public.audit_trail VALUES (14, 1, 'PREMIUM_PAYMENT', 'payment', '8', NULL, '{"amount":45000,"method":"Paystack","status":"completed"}', '105.112.48.1', NULL, '2026-06-04 20:11:40.631314');
INSERT INTO public.audit_trail VALUES (15, 2, 'NAICOM_FILING', 'compliance', '1', '{"status":"draft"}', '{"status":"submitted","ref":"NAICOM-Q1-2026"}', '41.58.203.12', NULL, '2026-06-04 20:11:40.631314');
INSERT INTO public.audit_trail VALUES (16, 1, 'ROLE_CHANGE', 'user', '5', '{"roles":["viewer"]}', '{"roles":["viewer","underwriter"]}', '105.112.48.1', NULL, '2026-06-04 20:11:40.631314');
INSERT INTO public.audit_trail VALUES (17, 1, 'claims.create', 'claims', '4', NULL, '{"claimNumber":"CLM-2026-26518","amount":250000,"policyId":1,"fraudScore":35,"routedTo":"auto_triage"}', NULL, NULL, '2026-06-05 14:53:02.065077');
INSERT INTO public.audit_trail VALUES (18, 2, 'claims.create', 'claims', NULL, NULL, '{"input":["policyId","amount","description"]}', NULL, NULL, '2026-06-05 14:53:02.075678');
INSERT INTO public.audit_trail VALUES (19, 3, 'claims.update', 'claims', NULL, NULL, '{"input":["id","status"]}', NULL, NULL, '2026-06-05 14:53:14.174684');
INSERT INTO public.audit_trail VALUES (20, 4, 'claims.delete', 'claims', NULL, NULL, '{"input":["id"]}', NULL, NULL, '2026-06-05 14:53:14.383339');
INSERT INTO public.audit_trail VALUES (21, 5, 'claims.create', 'claims', NULL, NULL, '{"input":[]}', NULL, NULL, '2026-06-05 15:02:20.25701');
INSERT INTO public.audit_trail VALUES (22, 6, 'claims.create', 'claims', '5', NULL, '{"claimNumber":"CLM-2026-83650","amount":100,"policyId":1,"fraudScore":50,"routedTo":"auto_triage"}', NULL, NULL, '2026-06-05 15:02:42.4412');
INSERT INTO public.audit_trail VALUES (23, 7, 'claims.create', 'claims', NULL, NULL, '{"input":["policyId","amount","description"]}', NULL, NULL, '2026-06-05 15:02:42.445973');
INSERT INTO public.audit_trail VALUES (24, 8, 'claims.create', 'claims', NULL, NULL, '{"input":[]}', NULL, NULL, '2026-06-05 15:04:08.415588');
INSERT INTO public.audit_trail VALUES (25, 9, 'claims.create', 'claims', NULL, NULL, '{"input":["policyId","amount","description"]}', NULL, NULL, '2026-06-05 15:04:08.423098');
INSERT INTO public.audit_trail VALUES (26, 10, 'claims.create', 'claims', NULL, NULL, '{"input":["policyId","amount","description"]}', NULL, NULL, '2026-06-05 15:04:08.431229');
INSERT INTO public.audit_trail VALUES (27, 11, 'claims.create', 'claims', NULL, NULL, '{"input":["policyId","amount","description"]}', NULL, NULL, '2026-06-05 15:04:09.200845');
INSERT INTO public.audit_trail VALUES (28, 12, 'claims.create', 'claims', NULL, NULL, '{"input":["policyId","amount","description"]}', NULL, NULL, '2026-06-05 15:04:09.208377');
INSERT INTO public.audit_trail VALUES (29, 13, 'claims.create', 'claims', '6', NULL, '{"claimNumber":"CLM-2026-66245","amount":50000,"policyId":22,"fraudScore":5,"routedTo":"auto_triage"}', NULL, NULL, '2026-06-05 15:04:09.215138');
INSERT INTO public.audit_trail VALUES (30, 14, 'claims.create', 'claims', NULL, NULL, '{"input":["policyId","amount","description"]}', NULL, NULL, '2026-06-05 15:04:09.217771');
INSERT INTO public.audit_trail VALUES (31, 15, 'claims.update', 'claims', NULL, NULL, '{"input":["id","status"]}', NULL, NULL, '2026-06-05 15:04:18.976115');
INSERT INTO public.audit_trail VALUES (32, 16, 'claims.update', 'claims', NULL, NULL, '{"input":["id","status"]}', NULL, NULL, '2026-06-05 15:04:18.985228');
INSERT INTO public.audit_trail VALUES (33, 17, 'claims.update', 'claims', NULL, NULL, '{"input":["id","status"]}', NULL, NULL, '2026-06-05 15:04:18.993117');
INSERT INTO public.audit_trail VALUES (34, 18, 'claims.update', 'claims', NULL, NULL, '{"input":["id","status"]}', NULL, NULL, '2026-06-05 15:04:19.002233');
INSERT INTO public.audit_trail VALUES (35, 19, 'claims.delete', 'claims', NULL, NULL, '{"input":["id"]}', NULL, NULL, '2026-06-05 15:04:27.982555');
INSERT INTO public.audit_trail VALUES (36, 20, 'claims.create', 'claims', '7', NULL, '{"claimNumber":"CLM-2026-31445","amount":100000,"policyId":22,"fraudScore":20,"routedTo":"auto_triage"}', NULL, NULL, '2026-06-05 15:04:28.745277');
INSERT INTO public.audit_trail VALUES (37, 21, 'claims.create', 'claims', NULL, NULL, '{"input":["policyId","amount","description"]}', NULL, NULL, '2026-06-05 15:04:28.748429');
INSERT INTO public.audit_trail VALUES (38, 22, 'claims.create', 'claims', '8', NULL, '{"claimNumber":"CLM-2026-44865","amount":750000,"policyId":22,"fraudScore":45,"routedTo":"standard_adjuster"}', NULL, NULL, '2026-06-05 15:04:28.755007');
INSERT INTO public.audit_trail VALUES (39, 23, 'claims.create', 'claims', NULL, NULL, '{"input":["policyId","amount","description"]}', NULL, NULL, '2026-06-05 15:04:28.757487');
INSERT INTO public.audit_trail VALUES (40, 24, 'claims.create', 'claims', '9', NULL, '{"claimNumber":"CLM-2026-85861","amount":1500000,"policyId":22,"fraudScore":70,"routedTo":"senior_adjuster"}', NULL, NULL, '2026-06-05 15:04:28.764738');
INSERT INTO public.audit_trail VALUES (41, 25, 'claims.create', 'claims', NULL, NULL, '{"input":["policyId","amount","description"]}', NULL, NULL, '2026-06-05 15:04:28.767218');
INSERT INTO public.audit_trail VALUES (42, 26, 'payments.process', 'payments', NULL, NULL, '{"input":[]}', NULL, NULL, '2026-06-05 15:04:42.401792');
INSERT INTO public.audit_trail VALUES (43, 27, 'payments.process', 'payments', NULL, NULL, '{"input":["amount","policyId"]}', NULL, NULL, '2026-06-05 15:04:42.410573');
INSERT INTO public.audit_trail VALUES (44, 28, 'payments.process', 'payments', NULL, NULL, '{"input":["amount","policyId"]}', NULL, NULL, '2026-06-05 15:04:42.421042');
INSERT INTO public.audit_trail VALUES (45, 29, 'claims.create', 'claims', '10', NULL, '{"claimNumber":"CLM-2026-74607","amount":50000,"policyId":22,"fraudScore":65,"routedTo":"fraud_investigation"}', NULL, NULL, '2026-06-05 15:04:59.294519');
INSERT INTO public.audit_trail VALUES (46, 30, 'claims.create', 'claims', NULL, NULL, '{"input":["policyId","amount","description"]}', NULL, NULL, '2026-06-05 15:04:59.298546');
INSERT INTO public.audit_trail VALUES (47, 31, 'auth.login', 'auth', NULL, NULL, '{"input":["email","password"]}', NULL, NULL, '2026-06-05 15:04:59.30997');
INSERT INTO public.audit_trail VALUES (48, 32, 'auth.login', 'auth', NULL, NULL, '{"input":["email","password"]}', NULL, NULL, '2026-06-05 15:05:23.449707');
INSERT INTO public.audit_trail VALUES (49, 33, 'auth.login', 'auth', NULL, NULL, '{"input":["email","password"]}', NULL, NULL, '2026-06-05 15:05:43.22695');
INSERT INTO public.audit_trail VALUES (50, 34, 'auth.login', 'auth', NULL, NULL, '{"input":["email","password"]}', NULL, NULL, '2026-06-05 15:06:58.969002');
INSERT INTO public.audit_trail VALUES (51, 35, 'auth.login', 'auth', NULL, NULL, '{"input":["email","password"]}', NULL, NULL, '2026-06-05 15:10:46.999932');
INSERT INTO public.audit_trail VALUES (52, 36, 'auth.login', 'auth', NULL, NULL, '{"input":["email","password"]}', NULL, NULL, '2026-06-05 15:16:20.439191');
INSERT INTO public.audit_trail VALUES (53, 37, 'auth.login', 'auth', NULL, NULL, '{"input":["email","password"]}', NULL, NULL, '2026-06-05 15:20:32.476752');
INSERT INTO public.audit_trail VALUES (54, 38, 'auth.login', 'auth', NULL, NULL, '{"input":["json"]}', NULL, NULL, '2026-06-05 15:37:10.4148');
INSERT INTO public.audit_trail VALUES (55, 39, 'auth.login', 'auth', NULL, NULL, '{"input":["json"]}', NULL, NULL, '2026-06-05 15:37:10.417507');
INSERT INTO public.audit_trail VALUES (56, 40, 'auth.signup', 'auth', NULL, NULL, '{"input":["json"]}', NULL, NULL, '2026-06-05 15:37:10.420448');
INSERT INTO public.audit_trail VALUES (57, 41, 'payments.initiate', 'payments', NULL, NULL, '{"input":["json"]}', NULL, NULL, '2026-06-05 15:37:10.459529');
INSERT INTO public.audit_trail VALUES (58, 42, 'claims.create', 'claims', NULL, NULL, '{"input":["json"]}', NULL, NULL, '2026-06-05 15:37:10.487326');
INSERT INTO public.audit_trail VALUES (59, 43, 'claims.create', 'claims', NULL, NULL, '{"input":["json"]}', NULL, NULL, '2026-06-05 15:37:10.488925');
INSERT INTO public.audit_trail VALUES (60, 44, 'auth.login', 'auth', NULL, NULL, '{"input":["json"]}', NULL, NULL, '2026-06-05 15:37:15.344798');
INSERT INTO public.audit_trail VALUES (61, 45, 'auth.login', 'auth', NULL, NULL, '{"input":["email","password"]}', NULL, NULL, '2026-06-05 15:37:37.675331');
INSERT INTO public.audit_trail VALUES (62, 46, 'auth.login', 'auth', NULL, NULL, '{"input":["email","password"]}', NULL, NULL, '2026-06-05 15:38:35.070994');
INSERT INTO public.audit_trail VALUES (63, 47, 'auth.login', 'auth', NULL, NULL, '{"input":["email","password"]}', NULL, NULL, '2026-06-05 15:38:35.074602');
INSERT INTO public.audit_trail VALUES (64, 48, 'auth.signup', 'auth', NULL, NULL, '{"input":["email","password","name","phone"]}', NULL, NULL, '2026-06-05 15:38:35.077215');
INSERT INTO public.audit_trail VALUES (65, 49, 'payments.initiate', 'payments', NULL, NULL, '{"input":["gateway","amount","email"]}', NULL, NULL, '2026-06-05 15:38:35.136153');
INSERT INTO public.audit_trail VALUES (66, 50, 'claims.create', 'claims', NULL, NULL, '{"input":["amount","description"]}', NULL, NULL, '2026-06-05 15:38:35.163162');
INSERT INTO public.audit_trail VALUES (68, 52, 'auth.signup', 'auth', NULL, NULL, '{"input":["email","password","name","phone"]}', NULL, NULL, '2026-06-05 15:38:40.449533');
INSERT INTO public.audit_trail VALUES (67, 51, 'claims.create', 'claims', NULL, NULL, '{"input":["policyId","amount","description"]}', NULL, NULL, '2026-06-05 15:38:35.164655');
INSERT INTO public.audit_trail VALUES (69, 53, 'auth.login', 'auth', NULL, NULL, '{"input":["email","password"]}', NULL, NULL, '2026-06-05 15:38:51.602385');
INSERT INTO public.audit_trail VALUES (70, 54, 'auth.login', 'auth', NULL, NULL, '{"input":["email","password"]}', NULL, NULL, '2026-06-05 15:38:51.606392');
INSERT INTO public.audit_trail VALUES (71, 55, 'auth.signup', 'auth', NULL, NULL, '{"input":["email","password","fullName","phone"]}', NULL, NULL, '2026-06-05 15:38:51.934223');
INSERT INTO public.audit_trail VALUES (72, 56, 'payments.initiate', 'payments', NULL, NULL, '{"input":["gateway","amount","email"]}', NULL, NULL, '2026-06-05 15:38:51.972857');
INSERT INTO public.audit_trail VALUES (73, 57, 'claims.create', 'claims', NULL, NULL, '{"input":["amount","description"]}', NULL, NULL, '2026-06-05 15:38:51.999155');
INSERT INTO public.audit_trail VALUES (74, 58, 'claims.create', 'claims', NULL, NULL, '{"input":["policyId","amount","description"]}', NULL, NULL, '2026-06-05 15:38:52.000621');
INSERT INTO public.audit_trail VALUES (75, 59, 'auth.login', 'auth', NULL, NULL, '{"input":["json"]}', NULL, NULL, '2026-06-05 15:50:38.56057');
INSERT INTO public.audit_trail VALUES (76, 60, 'claims.create', 'claims', NULL, NULL, '{"input":["json"]}', NULL, NULL, '2026-06-05 15:50:39.498441');
INSERT INTO public.audit_trail VALUES (77, 61, 'claims.create', 'claims', NULL, NULL, '{"input":["json"]}', NULL, NULL, '2026-06-05 15:50:40.450637');
INSERT INTO public.audit_trail VALUES (78, 62, 'auth.login', 'auth', NULL, NULL, '{"input":["json"]}', NULL, NULL, '2026-06-05 15:50:55.505235');
INSERT INTO public.audit_trail VALUES (79, 63, 'claims.create', 'claims', NULL, NULL, '{"input":["json"]}', NULL, NULL, '2026-06-05 15:50:57.292616');
INSERT INTO public.audit_trail VALUES (80, 64, 'claims.create', 'claims', NULL, NULL, '{"input":["json"]}', NULL, NULL, '2026-06-05 15:50:58.225887');
INSERT INTO public.audit_trail VALUES (81, 65, 'auth.login', 'auth', NULL, NULL, '{"input":["email","password"]}', NULL, NULL, '2026-06-05 15:51:38.81755');
INSERT INTO public.audit_trail VALUES (82, 66, 'claims.create', 'claims', NULL, NULL, '{"input":["amount","description"]}', NULL, NULL, '2026-06-05 15:52:05.335011');
INSERT INTO public.audit_trail VALUES (83, 67, 'claims.create', 'claims', NULL, NULL, '{"input":["policyId","amount","description"]}', NULL, NULL, '2026-06-05 15:52:06.292649');
INSERT INTO public.audit_trail VALUES (84, 68, 'claims.create', 'claims', NULL, NULL, '{"input":["policyId","amount","description"]}', NULL, NULL, '2026-06-05 15:52:07.25249');
INSERT INTO public.audit_trail VALUES (85, 69, 'auth.login', 'auth', NULL, NULL, '{"input":["email","password"]}', NULL, NULL, '2026-06-05 15:52:15.78066');
INSERT INTO public.audit_trail VALUES (86, 70, 'auth.login', 'auth', NULL, NULL, '{"input":["email","password"]}', NULL, NULL, '2026-06-05 15:52:15.783804');
INSERT INTO public.audit_trail VALUES (87, 71, 'auth.signup', 'auth', NULL, NULL, '{"input":["email","password","fullName","phone"]}', NULL, NULL, '2026-06-05 15:52:16.093244');
INSERT INTO public.audit_trail VALUES (88, 72, 'payments.initiate', 'payments', NULL, NULL, '{"input":["gateway","amount","email"]}', NULL, NULL, '2026-06-05 15:52:16.131113');
INSERT INTO public.audit_trail VALUES (89, 73, 'claims.create', 'claims', NULL, NULL, '{"input":["amount","description"]}', NULL, NULL, '2026-06-05 15:52:16.158291');
INSERT INTO public.audit_trail VALUES (90, 74, 'claims.create', 'claims', NULL, NULL, '{"input":["policyId","amount","description"]}', NULL, NULL, '2026-06-05 15:52:16.159938');
INSERT INTO public.audit_trail VALUES (91, 75, 'claims.create', 'claims', NULL, NULL, '{"input":["amount","description"]}', NULL, NULL, '2026-06-05 15:53:35.524839');
INSERT INTO public.audit_trail VALUES (92, 76, 'claims.create', 'claims', NULL, NULL, '{"input":["policyId","amount","description"]}', NULL, NULL, '2026-06-05 15:53:36.479732');
INSERT INTO public.audit_trail VALUES (93, 77, 'claims.create', 'claims', NULL, NULL, '{"input":["policyId","amount","description"]}', NULL, NULL, '2026-06-05 15:53:37.444522');
INSERT INTO public.audit_trail VALUES (94, 78, 'auth.login', 'auth', NULL, NULL, '{"input":["email","password"]}', NULL, NULL, '2026-06-05 15:54:03.504941');
INSERT INTO public.audit_trail VALUES (95, 79, 'auth.login', 'auth', NULL, NULL, '{"input":["email","password"]}', NULL, NULL, '2026-06-05 15:54:03.508474');
INSERT INTO public.audit_trail VALUES (96, 80, 'auth.signup', 'auth', NULL, NULL, '{"input":["email","password","fullName","phone"]}', NULL, NULL, '2026-06-05 15:54:03.829028');
INSERT INTO public.audit_trail VALUES (97, 81, 'payments.initiate', 'payments', NULL, NULL, '{"input":["gateway","amount","email"]}', NULL, NULL, '2026-06-05 15:54:03.866251');
INSERT INTO public.audit_trail VALUES (98, 82, 'claims.create', 'claims', NULL, NULL, '{"input":["amount","description"]}', NULL, NULL, '2026-06-05 15:54:03.894118');
INSERT INTO public.audit_trail VALUES (99, 83, 'claims.create', 'claims', NULL, NULL, '{"input":["policyId","amount","description"]}', NULL, NULL, '2026-06-05 15:54:03.895982');
INSERT INTO public.audit_trail VALUES (100, 84, 'auth.login', 'auth', NULL, NULL, '{"input":["email","password"]}', NULL, NULL, '2026-06-05 15:54:05.031117');
INSERT INTO public.audit_trail VALUES (101, 85, 'auth.login', 'auth', NULL, NULL, '{"input":["email","password"]}', NULL, NULL, '2026-06-05 15:54:48.500763');
INSERT INTO public.audit_trail VALUES (102, 86, 'auth.login', 'auth', NULL, NULL, '{"input":["email","password"]}', NULL, NULL, '2026-06-05 15:55:44.496408');
INSERT INTO public.audit_trail VALUES (103, 87, 'auth.login', 'auth', NULL, NULL, '{"input":["email","password"]}', NULL, NULL, '2026-06-05 16:00:41.584334');
INSERT INTO public.audit_trail VALUES (104, 88, 'claims.create', 'claims', NULL, NULL, '{"input":["policyId","amount","description"]}', NULL, NULL, '2026-06-05 16:02:09.154981');
INSERT INTO public.audit_trail VALUES (105, 89, 'claims.create', 'claims', NULL, NULL, '{"input":["amount","description"]}', NULL, NULL, '2026-06-05 16:02:22.634395');
INSERT INTO public.audit_trail VALUES (106, 90, 'claims.create', 'claims', NULL, NULL, '{"input":["policyId","amount","description"]}', NULL, NULL, '2026-06-05 16:02:22.641044');
INSERT INTO public.audit_trail VALUES (107, 91, 'claims.create', 'claims', NULL, NULL, '{"input":["policyId","amount","description"]}', NULL, NULL, '2026-06-05 16:02:22.647342');
INSERT INTO public.audit_trail VALUES (108, 92, 'auth.login', 'auth', NULL, NULL, '{"input":["email","password"]}', NULL, NULL, '2026-06-05 16:02:34.389371');
INSERT INTO public.audit_trail VALUES (109, 93, 'auth.login', 'auth', NULL, NULL, '{"input":["email","password"]}', NULL, NULL, '2026-06-05 16:03:00.853906');
INSERT INTO public.audit_trail VALUES (110, 94, 'auth.login', 'auth', NULL, NULL, '{"input":["email","password"]}', NULL, NULL, '2026-06-05 16:03:00.858023');
INSERT INTO public.audit_trail VALUES (111, 95, 'auth.signup', 'auth', NULL, NULL, '{"input":["email","password","fullName","phone"]}', NULL, NULL, '2026-06-05 16:03:01.176639');
INSERT INTO public.audit_trail VALUES (112, 96, 'payments.initiate', 'payments', NULL, NULL, '{"input":["gateway","amount","email"]}', NULL, NULL, '2026-06-05 16:03:01.233313');
INSERT INTO public.audit_trail VALUES (113, 97, 'claims.create', 'claims', NULL, NULL, '{"input":["amount","description"]}', NULL, NULL, '2026-06-05 16:03:01.261301');
INSERT INTO public.audit_trail VALUES (114, 98, 'claims.create', 'claims', NULL, NULL, '{"input":["policyId","amount","description"]}', NULL, NULL, '2026-06-05 16:03:01.263547');
INSERT INTO public.audit_trail VALUES (115, 99, 'auth.login', 'auth', NULL, NULL, '{"input":["email","password"]}', NULL, NULL, '2026-06-05 16:03:08.872438');
INSERT INTO public.audit_trail VALUES (116, 100, 'claims.create', 'claims', '15', NULL, '{"claimNumber":"CLM-2026-71475","amount":5000000,"policyId":5,"fraudScore":40,"routedTo":"senior_adjuster"}', NULL, NULL, '2026-06-05 16:06:17.095107');
INSERT INTO public.audit_trail VALUES (117, 101, 'claims.create', 'claims', NULL, NULL, '{"input":["policyId","amount","description"]}', NULL, NULL, '2026-06-05 16:06:17.107437');
INSERT INTO public.audit_trail VALUES (118, 102, 'claims.create', 'claims', NULL, NULL, '{"input":["amount","description"]}', NULL, NULL, '2026-06-05 16:06:26.372489');
INSERT INTO public.audit_trail VALUES (119, 103, 'claims.create', 'claims', NULL, NULL, '{"input":["policyId","amount","description"]}', NULL, NULL, '2026-06-05 16:06:26.380082');
INSERT INTO public.audit_trail VALUES (120, 104, 'claims.create', 'claims', NULL, NULL, '{"input":["policyId","amount","description"]}', NULL, NULL, '2026-06-05 16:06:26.387172');
INSERT INTO public.audit_trail VALUES (121, 105, 'auth.login', 'auth', NULL, NULL, '{"input":["email","password"]}', NULL, NULL, '2026-06-05 16:06:31.410683');
INSERT INTO public.audit_trail VALUES (122, 106, 'auth.login', 'auth', NULL, NULL, '{"input":["email","password"]}', NULL, NULL, '2026-06-05 16:06:31.414259');
INSERT INTO public.audit_trail VALUES (123, 107, 'auth.signup', 'auth', NULL, NULL, '{"input":["email","password","fullName","phone"]}', NULL, NULL, '2026-06-05 16:06:31.729772');
INSERT INTO public.audit_trail VALUES (124, 108, 'payments.initiate', 'payments', NULL, NULL, '{"input":["gateway","amount","email"]}', NULL, NULL, '2026-06-05 16:06:31.831404');
INSERT INTO public.audit_trail VALUES (125, 109, 'claims.create', 'claims', NULL, NULL, '{"input":["amount","description"]}', NULL, NULL, '2026-06-05 16:06:31.870602');
INSERT INTO public.audit_trail VALUES (126, 110, 'claims.create', 'claims', NULL, NULL, '{"input":["policyId","amount","description"]}', NULL, NULL, '2026-06-05 16:06:31.872226');
INSERT INTO public.audit_trail VALUES (127, 111, 'auth.login', 'auth', NULL, NULL, '{"input":["email","password"]}', NULL, NULL, '2026-06-05 16:09:12.266508');
INSERT INTO public.audit_trail VALUES (128, 112, 'claims.create', 'claims', NULL, NULL, '{"input":["json"]}', NULL, NULL, '2026-06-05 16:11:13.077129');
INSERT INTO public.audit_trail VALUES (129, 113, 'claims.create', 'claims', NULL, NULL, '{"input":["json"]}', NULL, NULL, '2026-06-05 16:11:13.250907');
INSERT INTO public.audit_trail VALUES (130, 114, 'claims.create', 'claims', NULL, NULL, '{"input":["json"]}', NULL, NULL, '2026-06-05 16:11:13.42738');
INSERT INTO public.audit_trail VALUES (131, 115, 'claims.create', 'claims', NULL, NULL, '{"input":["json"]}', NULL, NULL, '2026-06-05 16:11:29.766344');
INSERT INTO public.audit_trail VALUES (132, 116, 'claims.create', 'claims', NULL, NULL, '{"input":["json"]}', NULL, NULL, '2026-06-05 16:11:29.944807');
INSERT INTO public.audit_trail VALUES (133, 117, 'claims.create', 'claims', NULL, NULL, '{"input":["json"]}', NULL, NULL, '2026-06-05 16:11:30.126017');
INSERT INTO public.audit_trail VALUES (134, 118, 'claims.create', 'claims', NULL, NULL, '{"input":["json"]}', NULL, NULL, '2026-06-05 16:12:12.223321');
INSERT INTO public.audit_trail VALUES (135, 119, 'claims.create', 'claims', NULL, NULL, '{"input":["json"]}', NULL, NULL, '2026-06-05 16:12:12.403076');
INSERT INTO public.audit_trail VALUES (136, 120, 'claims.create', 'claims', NULL, NULL, '{"input":["json"]}', NULL, NULL, '2026-06-05 16:12:12.579242');
INSERT INTO public.audit_trail VALUES (137, 121, 'claims.create', 'claims', NULL, NULL, '{"input":["amount","description"]}', NULL, NULL, '2026-06-05 16:13:17.520839');
INSERT INTO public.audit_trail VALUES (138, 122, 'claims.create', 'claims', NULL, NULL, '{"input":["policyId","amount","description"]}', NULL, NULL, '2026-06-05 16:13:17.688233');
INSERT INTO public.audit_trail VALUES (139, 123, 'claims.create', 'claims', NULL, NULL, '{"input":["policyId","amount","description"]}', NULL, NULL, '2026-06-05 16:13:17.870864');
INSERT INTO public.audit_trail VALUES (140, 124, 'claims.create', 'claims', '16', NULL, '{"claimNumber":"CLM-2026-23581","amount":5000000,"policyId":1,"fraudScore":85,"routedTo":"senior_adjuster"}', NULL, NULL, '2026-06-05 16:13:24.313516');
INSERT INTO public.audit_trail VALUES (141, 125, 'claims.create', 'claims', NULL, NULL, '{"input":["policyId","amount","description"]}', NULL, NULL, '2026-06-05 16:13:24.320066');
INSERT INTO public.audit_trail VALUES (142, 126, 'auth.login', 'auth', NULL, NULL, '{"input":["email","password"]}', NULL, NULL, '2026-06-05 16:37:46.545004');
INSERT INTO public.audit_trail VALUES (143, 127, 'auth.login', 'auth', NULL, NULL, '{"input":["email","password"]}', NULL, NULL, '2026-06-05 16:37:46.548831');
INSERT INTO public.audit_trail VALUES (144, 128, 'auth.signup', 'auth', NULL, NULL, '{"input":["email","password","fullName","phone"]}', NULL, NULL, '2026-06-05 16:37:46.866162');
INSERT INTO public.audit_trail VALUES (145, 129, 'payments.initiate', 'payments', NULL, NULL, '{"input":["gateway","amount","email"]}', NULL, NULL, '2026-06-05 16:37:46.925019');
INSERT INTO public.audit_trail VALUES (146, 130, 'claims.create', 'claims', NULL, NULL, '{"input":["amount","description"]}', NULL, NULL, '2026-06-05 16:37:46.954737');
INSERT INTO public.audit_trail VALUES (147, 131, 'claims.create', 'claims', NULL, NULL, '{"input":["policyId","amount","description"]}', NULL, NULL, '2026-06-05 16:37:46.956844');
INSERT INTO public.audit_trail VALUES (148, 132, 'auth.login', 'auth', NULL, NULL, '{"input":["email","password"]}', NULL, NULL, '2026-06-05 16:38:17.967256');
INSERT INTO public.audit_trail VALUES (149, 133, 'auth.login', 'auth', NULL, NULL, '{"input":["email","password"]}', NULL, NULL, '2026-06-05 16:38:17.971055');
INSERT INTO public.audit_trail VALUES (150, 134, 'auth.signup', 'auth', NULL, NULL, '{"input":["email","password","fullName","phone"]}', NULL, NULL, '2026-06-05 16:38:18.292995');
INSERT INTO public.audit_trail VALUES (151, 135, 'payments.initiate', 'payments', NULL, NULL, '{"input":["gateway","amount","email"]}', NULL, NULL, '2026-06-05 16:38:18.328186');
INSERT INTO public.audit_trail VALUES (152, 136, 'claims.create', 'claims', NULL, NULL, '{"input":["amount","description"]}', NULL, NULL, '2026-06-05 16:38:18.354667');
INSERT INTO public.audit_trail VALUES (153, 137, 'claims.create', 'claims', NULL, NULL, '{"input":["policyId","amount","description"]}', NULL, NULL, '2026-06-05 16:38:18.35662');
INSERT INTO public.audit_trail VALUES (154, 138, 'claims.create', 'claims', '17', NULL, '{"claimNumber":"CLM-2026-67246","amount":1000,"policyId":1,"fraudScore":80,"routedTo":"fraud_investigation"}', NULL, NULL, '2026-06-05 16:38:18.383845');
INSERT INTO public.audit_trail VALUES (155, 139, 'claims.create', 'claims', NULL, NULL, '{"input":["policyId","amount","description"]}', NULL, NULL, '2026-06-05 16:38:18.387808');
INSERT INTO public.audit_trail VALUES (156, 140, 'auth.login', 'auth', NULL, NULL, '{"input":["email","password"]}', NULL, NULL, '2026-06-05 16:47:45.091947');
INSERT INTO public.audit_trail VALUES (157, 141, 'auth.login', 'auth', NULL, NULL, '{"input":["email","password"]}', NULL, NULL, '2026-06-05 16:54:33.654328');
INSERT INTO public.audit_trail VALUES (158, 142, 'auth.login', 'auth', NULL, NULL, '{"input":["email","password"]}', NULL, NULL, '2026-06-05 16:59:35.178452');
INSERT INTO public.audit_trail VALUES (159, 143, 'auth.login', 'auth', NULL, NULL, '{"input":["email","password"]}', NULL, NULL, '2026-06-05 16:59:35.182229');
INSERT INTO public.audit_trail VALUES (160, 144, 'auth.signup', 'auth', NULL, NULL, '{"input":["email","password","fullName","phone"]}', NULL, NULL, '2026-06-05 16:59:35.485526');
INSERT INTO public.audit_trail VALUES (161, 145, 'payments.initiate', 'payments', NULL, NULL, '{"input":["gateway","amount","email"]}', NULL, NULL, '2026-06-05 16:59:35.520045');
INSERT INTO public.audit_trail VALUES (162, 146, 'claims.create', 'claims', NULL, NULL, '{"input":["amount","description"]}', NULL, NULL, '2026-06-05 16:59:35.546173');
INSERT INTO public.audit_trail VALUES (163, 147, 'claims.create', 'claims', NULL, NULL, '{"input":["policyId","amount","description"]}', NULL, NULL, '2026-06-05 16:59:35.54778');
INSERT INTO public.audit_trail VALUES (164, 148, 'claims.create', 'claims', '18', NULL, '{"claimNumber":"CLM-2026-41958","amount":1000,"policyId":1,"fraudScore":95,"routedTo":"fraud_investigation"}', NULL, NULL, '2026-06-05 16:59:35.572076');
INSERT INTO public.audit_trail VALUES (165, 149, 'claims.create', 'claims', NULL, NULL, '{"input":["policyId","amount","description"]}', NULL, NULL, '2026-06-05 16:59:35.575166');
INSERT INTO public.audit_trail VALUES (166, 150, 'auth.login', 'auth', NULL, NULL, '{"input":["email","password"]}', NULL, NULL, '2026-06-05 17:04:32.611436');
INSERT INTO public.audit_trail VALUES (167, 151, 'auth.login', 'auth', NULL, NULL, '{"input":["email","password"]}', NULL, NULL, '2026-06-05 17:04:32.615422');
INSERT INTO public.audit_trail VALUES (168, 152, 'auth.signup', 'auth', NULL, NULL, '{"input":["email","password","fullName","phone"]}', NULL, NULL, '2026-06-05 17:04:32.935971');
INSERT INTO public.audit_trail VALUES (169, 153, 'payments.initiate', 'payments', NULL, NULL, '{"input":["gateway","amount","email"]}', NULL, NULL, '2026-06-05 17:04:32.990452');
INSERT INTO public.audit_trail VALUES (170, 154, 'claims.create', 'claims', NULL, NULL, '{"input":["amount","description"]}', NULL, NULL, '2026-06-05 17:04:33.021103');
INSERT INTO public.audit_trail VALUES (171, 155, 'claims.create', 'claims', NULL, NULL, '{"input":["policyId","amount","description"]}', NULL, NULL, '2026-06-05 17:04:33.023269');
INSERT INTO public.audit_trail VALUES (172, 156, 'claims.create', 'claims', '19', NULL, '{"claimNumber":"CLM-2026-22696","amount":1000,"policyId":1,"fraudScore":100,"routedTo":"fraud_investigation"}', NULL, NULL, '2026-06-05 17:04:33.058685');
INSERT INTO public.audit_trail VALUES (173, 157, 'claims.create', 'claims', NULL, NULL, '{"input":["policyId","amount","description"]}', NULL, NULL, '2026-06-05 17:04:33.062749');
INSERT INTO public.audit_trail VALUES (174, 158, 'auth.login', 'auth', NULL, NULL, '{"input":["email","password"]}', NULL, NULL, '2026-06-05 17:20:04.60081');
INSERT INTO public.audit_trail VALUES (175, 159, 'auth.login', 'auth', NULL, NULL, '{"input":["email","password"]}', NULL, NULL, '2026-06-05 17:30:51.594865');
INSERT INTO public.audit_trail VALUES (176, 160, 'auth.login', 'auth', NULL, NULL, '{"input":["email","password"]}', NULL, NULL, '2026-06-05 17:30:56.490434');
INSERT INTO public.audit_trail VALUES (177, 161, 'auth.login', 'auth', NULL, NULL, '{"input":["email","password"]}', NULL, NULL, '2026-06-05 17:31:06.510545');
INSERT INTO public.audit_trail VALUES (178, 162, 'auth.login', 'auth', NULL, NULL, '{"input":["email","password"]}', NULL, NULL, '2026-06-05 17:31:25.302978');
INSERT INTO public.audit_trail VALUES (179, 163, 'auth.login', 'auth', NULL, NULL, '{"input":["email","password"]}', NULL, NULL, '2026-06-05 17:31:25.306623');
INSERT INTO public.audit_trail VALUES (180, 164, 'auth.signup', 'auth', NULL, NULL, '{"input":["email","password","fullName","phone"]}', NULL, NULL, '2026-06-05 17:31:25.617293');
INSERT INTO public.audit_trail VALUES (181, 165, 'payments.initiate', 'payments', NULL, NULL, '{"input":["gateway","amount","email"]}', NULL, NULL, '2026-06-05 17:31:25.655203');
INSERT INTO public.audit_trail VALUES (182, 166, 'claims.create', 'claims', NULL, NULL, '{"input":["amount","description"]}', NULL, NULL, '2026-06-05 17:31:25.681701');
INSERT INTO public.audit_trail VALUES (183, 167, 'claims.create', 'claims', NULL, NULL, '{"input":["policyId","amount","description"]}', NULL, NULL, '2026-06-05 17:31:25.683433');
INSERT INTO public.audit_trail VALUES (184, 168, 'claims.create', 'claims', '20', NULL, '{"claimNumber":"CLM-2026-58766","amount":1000,"policyId":1,"fraudScore":100,"routedTo":"fraud_investigation"}', NULL, NULL, '2026-06-05 17:31:25.712429');
INSERT INTO public.audit_trail VALUES (185, 169, 'claims.create', 'claims', NULL, NULL, '{"input":["policyId","amount","description"]}', NULL, NULL, '2026-06-05 17:31:25.715718');


--
-- Data for Name: backup_snapshots; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.backup_snapshots VALUES (1, 'full', 'completed', NULL, 's3://insureportal-backups/full/2026-06-01.tar.gz', 264, 15000, 900000, 30, 15, 'scheduled', '2026-05-31 13:11:23.940928', NULL, '2026-05-31 13:11:23.940928');
INSERT INTO public.backup_snapshots VALUES (2, 'incremental', 'completed', NULL, 's3://insureportal-backups/incr/2026-06-03.tar.gz', 264, 500, 120000, 30, 5, 'scheduled', '2026-06-02 13:11:23.940928', NULL, '2026-06-02 13:11:23.940928');
INSERT INTO public.backup_snapshots VALUES (3, 'full', 'completed', NULL, 's3://insureportal-backups/full/2026-06-05.tar.gz', 264, 16500, 1080000, 30, 15, 'scheduled', '2026-06-04 13:11:23.940928', NULL, '2026-06-04 13:11:23.940928');


--
-- Data for Name: bancassurance_offers; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.bancassurance_offers VALUES (1, 1, 1, 'Motor Shield', 15000.00, 5000000.00, 'active', '2027-12-31 00:00:00', '2025-06-04 17:10:58.683015');
INSERT INTO public.bancassurance_offers VALUES (2, 9, 1, 'Life Secure', 10000.00, 20000000.00, 'active', '2027-12-31 00:00:00', '2025-06-04 17:10:58.683015');
INSERT INTO public.bancassurance_offers VALUES (3, 2, 2, 'Health Plus', 20000.00, 2000000.00, 'active', '2027-05-31 00:00:00', '2025-08-04 17:10:58.683015');
INSERT INTO public.bancassurance_offers VALUES (4, 14, 5, 'Property Guard', 25000.00, 50000000.00, 'active', '2027-02-28 00:00:00', '2025-03-04 17:10:58.683015');
INSERT INTO public.bancassurance_offers VALUES (5, 5, 2, 'Agri Shield', 3000.00, 500000.00, 'active', '2027-05-31 00:00:00', '2025-10-04 17:10:58.683015');


--
-- Data for Name: bancassurance_partners; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.bancassurance_partners VALUES (1, 'First Bank of Nigeria', 'FBN', 0.1250, '{Motor,Life,Health}', 'active', 'https://api.firstbanknigeria.com/insurance', '2024-12-04 17:11:28.464404', '2026-06-04 17:11:28.464404');
INSERT INTO public.bancassurance_partners VALUES (2, 'Access Bank Plc', 'ACCESS', 0.1100, '{Health,Agricultural}', 'active', 'https://api.accessbankplc.com/insurance', '2025-06-04 17:11:28.464404', '2026-06-04 17:11:28.464404');
INSERT INTO public.bancassurance_partners VALUES (3, 'United Bank for Africa', 'UBA', 0.1200, '{Motor,Property}', 'active', 'https://api.ubagroup.com/insurance', '2025-12-04 17:11:28.464404', '2026-06-04 17:11:28.464404');
INSERT INTO public.bancassurance_partners VALUES (4, 'Zenith Bank Plc', 'ZENITH', 0.1300, '{Life,Group_Life}', 'pending', 'https://api.zenithbank.com/insurance', '2026-05-04 17:11:28.464404', '2026-06-04 17:11:28.464404');
INSERT INTO public.bancassurance_partners VALUES (5, 'GTBank (Guaranty Trust)', 'GTB', 0.1150, '{Property,Motor}', 'active', 'https://api.gtbank.com/insurance', '2025-03-04 17:11:28.464404', '2026-06-04 17:11:28.464404');


--
-- Data for Name: bi_report_definitions; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.bi_report_definitions VALUES (1, 'Sample bi_report_definitions 1', 'Sample data for bi_report_definitions record 1', 'standard', 'bi report definitions 1', 'bi report definitions 1', 'bi report definitions 1', '102.89.23.41', '2026-05-29 14:49:33.409664', true, 1, '2026-05-29 14:49:33.409664');
INSERT INTO public.bi_report_definitions VALUES (2, 'Sample bi_report_definitions 2', 'Sample data for bi_report_definitions record 2', 'standard', 'bi report definitions 2', 'bi report definitions 2', 'bi report definitions 2', '102.89.23.42', '2026-05-22 14:49:33.409664', false, 2, '2026-05-22 14:49:33.409664');
INSERT INTO public.bi_report_definitions VALUES (3, 'Sample bi_report_definitions 3', 'Sample data for bi_report_definitions record 3', 'standard', 'bi report definitions 3', 'bi report definitions 3', 'bi report definitions 3', '102.89.23.43', '2026-05-15 14:49:33.409664', false, 3, '2026-05-15 14:49:33.409664');


--
-- Data for Name: billing_audit_log; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.billing_audit_log VALUES (1, 1, 1, 'billing_audit_log 1', 'config_created', 'billing_audit_log 1', '1', '{"data": "sample_1"}', '{"data": "sample_1"}', '{"data": "sample_1"}', '102.89.1', 'billing_audit_log 1', '1', 'billing_audit_log 1', true, '2026-05-29 14:50:04.625036');
INSERT INTO public.billing_audit_log VALUES (2, 2, 2, 'billing_audit_log 2', 'config_updated', 'billing_audit_log 2', '2', '{"data": "sample_2"}', '{"data": "sample_2"}', '{"data": "sample_2"}', '102.89.2', 'billing_audit_log 2', '2', 'billing_audit_log 2', false, '2026-05-22 14:50:04.625036');
INSERT INTO public.billing_audit_log VALUES (3, 3, 3, 'billing_audit_log 3', 'config_deleted', 'billing_audit_log 3', '3', '{"data": "sample_3"}', '{"data": "sample_3"}', '{"data": "sample_3"}', '102.89.3', 'billing_audit_log 3', '3', 'billing_audit_log 3', false, '2026-05-15 14:50:04.625036');


--
-- Data for Name: billing_provisioning_history; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.billing_provisioning_history VALUES (1, 1, 'billing provisioning history 1', 'active', '{"index": 1, "sample": true}', '1', '2026-05-29 14:49:33.433568', '2026-05-29 14:49:33.433568', 'billing provisioning history 1');
INSERT INTO public.billing_provisioning_history VALUES (2, 2, 'billing provisioning history 2', 'active', '{"index": 2, "sample": true}', '2', '2026-05-22 14:49:33.433568', '2026-05-22 14:49:33.433568', 'billing provisioning history 2');
INSERT INTO public.billing_provisioning_history VALUES (3, 3, 'billing provisioning history 3', 'active', '{"index": 3, "sample": true}', '3', '2026-05-15 14:49:33.433568', '2026-05-15 14:49:33.433568', 'billing provisioning history 3');


--
-- Data for Name: billing_role_assignments; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.billing_role_assignments VALUES (1, 1, 1, 'platform_admin', '{"data": "sample_1"}', 1, '2026-05-29 14:50:04.630034', '2026-07-05 14:50:04.630034', true);
INSERT INTO public.billing_role_assignments VALUES (2, 2, 2, 'billing_admin', '{"data": "sample_2"}', 2, '2026-05-22 14:50:04.630034', '2026-08-04 14:50:04.630034', false);
INSERT INTO public.billing_role_assignments VALUES (3, 3, 3, 'billing_analyst', '{"data": "sample_3"}', 3, '2026-05-15 14:50:04.630034', '2026-09-03 14:50:04.630034', false);


--
-- Data for Name: biometric_audit_events; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.biometric_audit_events VALUES (1, '1', 1, 'standard', 'biometric audit events 1', 1.5000, 'standard', 1.5000, 'web', 1.5000, 1, '{"index": 1, "sample": true}', '1 Insurance Road, Lagos', '{"index": 1, "sample": true}', 'biometric audit events 1', 1, '2026-05-29 14:49:33.457');
INSERT INTO public.biometric_audit_events VALUES (2, '2', 2, 'standard', 'biometric audit events 2', 3.0000, 'standard', 3.0000, 'web', 3.0000, 2, '{"index": 2, "sample": true}', '2 Insurance Road, Lagos', '{"index": 2, "sample": true}', 'biometric audit events 2', 2, '2026-05-22 14:49:33.457');
INSERT INTO public.biometric_audit_events VALUES (3, '3', 3, 'standard', 'biometric audit events 3', 4.5000, 'standard', 4.5000, 'web', 4.5000, 3, '{"index": 3, "sample": true}', '3 Insurance Road, Lagos', '{"index": 3, "sample": true}', 'biometric audit events 3', 3, '2026-05-15 14:49:33.457');


--
-- Data for Name: broker_api_keys; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.broker_api_keys VALUES (1, 1, 'AXA Mansard Integration', 'brk_live_K7x9mP2nQ4w8rT1u', '{policies.read,quotes.create,claims.submit}', 1000, 'Active', NULL, '2027-06-30 00:00:00', '2026-06-04 20:59:32.598467', '2026-06-04 20:59:32.598467');
INSERT INTO public.broker_api_keys VALUES (2, 1, 'Leadway Assurance API', 'brk_live_L3y5vN8bR6j2hF4e', '{policies.read,policies.create,premiums.collect}', 500, 'Active', NULL, '2027-03-31 00:00:00', '2026-06-04 20:59:32.598467', '2026-06-04 20:59:32.598467');
INSERT INTO public.broker_api_keys VALUES (3, 1, 'Coronation Insurance Portal', 'brk_live_M9z1xW6cS5k4gD7a', '{policies.read,quotes.create,claims.read}', 2000, 'Active', NULL, '2027-12-31 00:00:00', '2026-06-04 20:59:32.598467', '2026-06-04 20:59:32.598467');
INSERT INTO public.broker_api_keys VALUES (4, 1, 'Test Sandbox Key', 'brk_test_T2a8pJ5qE3n7mK6b', '{*}', 100, 'Active', NULL, '2026-12-31 00:00:00', '2026-06-04 20:59:32.598467', '2026-06-04 20:59:32.598467');


--
-- Data for Name: broker_api_usage; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.broker_api_usage VALUES (1, 1, 1, 'broker api usage 1', 'web', 1, 1, '2026-05-29 14:49:33.465032');
INSERT INTO public.broker_api_usage VALUES (2, 2, 2, 'broker api usage 2', 'web', 2, 2, '2026-05-22 14:49:33.465032');
INSERT INTO public.broker_api_usage VALUES (3, 3, 3, 'broker api usage 3', 'web', 3, 3, '2026-05-15 14:49:33.465032');


--
-- Data for Name: chat_messages; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.chat_messages VALUES (1, 1, 'agent', 'chat_messages 1', 'chat_messages 1', true, '2026-05-29 14:50:04.633878');
INSERT INTO public.chat_messages VALUES (2, 2, 'support', 'chat_messages 2', 'chat_messages 2', false, '2026-05-22 14:50:04.633878');
INSERT INTO public.chat_messages VALUES (3, 3, 'system', 'chat_messages 3', 'chat_messages 3', false, '2026-05-15 14:50:04.633878');


--
-- Data for Name: chat_sessions; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.chat_sessions VALUES (1, 'chat_sessions 1', 7, 'chat_sessions 1', 'chat_sessions 1', 'open', 'chat_sessions 1', 1, '2026-05-29 14:50:04.637616', '2026-05-29 14:50:04.637616', '2026-05-29 14:50:04.637616');
INSERT INTO public.chat_sessions VALUES (2, 'chat_sessions 2', 8, 'chat_sessions 2', 'chat_sessions 2', 'assigned', 'chat_sessions 2', 2, '2026-05-22 14:50:04.637616', '2026-05-22 14:50:04.637616', '2026-05-22 14:50:04.637616');
INSERT INTO public.chat_sessions VALUES (3, 'chat_sessions 3', 9, 'chat_sessions 3', 'chat_sessions 3', 'resolved', 'chat_sessions 3', 3, '2026-05-15 14:50:04.637616', '2026-05-15 14:50:04.637616', '2026-05-15 14:50:04.637616');


--
-- Data for Name: chatbot_config; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.chatbot_config VALUES (1, 'general', '{"enabled": true, "greeting": "Hello! How can I help you with your insurance needs?", "fallbackMessage": "I''m not sure about that. Let me connect you to an agent.", "maxSessionMinutes": 30}', '2026-06-05 04:06:31.203847');
INSERT INTO public.chatbot_config VALUES (2, 'languages', '["en", "yo", "ha", "ig", "pcm"]', '2026-06-05 04:06:31.203847');
INSERT INTO public.chatbot_config VALUES (3, 'capabilities', '["policy_inquiry", "claims_status", "premium_calculator", "agent_connect", "quote_request", "document_upload", "complaint_filing"]', '2026-06-05 04:06:31.203847');
INSERT INTO public.chatbot_config VALUES (4, 'ai_config', '{"model": "gpt-4", "maxTokens": 500, "temperature": 0.3, "systemPrompt": "You are InsurePortal assistant specializing in Nigerian insurance products."}', '2026-06-05 04:06:31.203847');


--
-- Data for Name: claim_evidence; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.claim_evidence VALUES (1, 1, 1, 'police_report', 'police_report.pdf', '/documents/claims/1/police_report.pdf', 'Police report AR/2026/LAG/1234', 'verified', '2026-05-21 17:10:58.67465');
INSERT INTO public.claim_evidence VALUES (2, 1, 1, 'photo', 'accident_photo.jpg', '/documents/claims/1/photo_front.jpg', 'Accident scene photograph', 'verified', '2026-05-21 17:10:58.67465');
INSERT INTO public.claim_evidence VALUES (3, 2, 2, 'invoice', 'hospital_invoice.pdf', '/documents/claims/2/hospital_invoice.pdf', 'Reddington Hospital invoice', 'verified', '2026-05-04 17:10:58.67465');
INSERT INTO public.claim_evidence VALUES (5, 12, 7, 'certificate', 'death_certificate.pdf', '/documents/claims/7/death_certificate.pdf', 'Death certificate from Lagos State', 'verified', '2026-04-04 17:10:58.67465');
INSERT INTO public.claim_evidence VALUES (6, 5, 9, 'weather_data', 'nimet_flood_alert.pdf', '/documents/claims/9/nimet_alert.pdf', 'NiMet flood alert NM/FL/2026/0234', 'verified', '2026-06-02 17:10:58.67465');


--
-- Data for Name: claim_routing_rules; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.claim_routing_rules VALUES (1, 'High Value Claims', 'amount', '>', '1000000', 'route_to_senior_adjuster', 'Senior Claims Team', 1, true, '2026-06-05 04:06:31.129691');
INSERT INTO public.claim_routing_rules VALUES (2, 'Motor Claims', 'type', '==', 'Motor', 'route_to_motor_team', 'Motor Claims Unit', 2, true, '2026-06-05 04:06:31.129691');
INSERT INTO public.claim_routing_rules VALUES (3, 'Fraud Alert', 'fraudScore', '>', '70', 'route_to_siu', 'Special Investigations Unit', 1, true, '2026-06-05 04:06:31.129691');
INSERT INTO public.claim_routing_rules VALUES (4, 'Health Emergency', 'type', '==', 'Health', 'fast_track', 'Health Claims Team', 1, true, '2026-06-05 04:06:31.129691');
INSERT INTO public.claim_routing_rules VALUES (5, 'Agricultural Claims', 'type', '==', 'Agricultural', 'route_to_agri_team', 'Agricultural Assessment', 2, true, '2026-06-05 04:06:31.129691');
INSERT INTO public.claim_routing_rules VALUES (6, 'VIP Customer', 'customerTier', '==', 'Platinum', 'priority_handling', 'VIP Services', 1, true, '2026-06-05 04:06:31.129691');
INSERT INTO public.claim_routing_rules VALUES (7, 'Group Life Death', 'subType', '==', 'death_benefit', 'immediate_review', 'Life Claims Senior', 1, true, '2026-06-05 04:06:31.129691');
INSERT INTO public.claim_routing_rules VALUES (8, 'Cyber Insurance', 'type', '==', 'Cyber', 'route_to_cyber_team', 'Cyber Risk Unit', 2, true, '2026-06-05 04:06:31.129691');


--
-- Data for Name: claims; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.claims VALUES (1, 1, 1, 'CLM-2024-001', 5000.00, 'Approved', '2026-04-16 18:23:26.146', 'Medical treatment for minor surgery', NULL, NULL, NULL, '2026-05-16 18:23:26.150568', '2026-05-16 18:23:26.150568', 'default');
INSERT INTO public.claims VALUES (2, 1, 2, 'CLM-2024-002', 12000.00, 'Under Review', '2026-05-09 18:23:26.146', 'Vehicle accident repair - front bumper and headlight damage', NULL, NULL, NULL, '2026-05-16 18:23:26.150568', '2026-05-16 18:23:26.150568', 'default');
INSERT INTO public.claims VALUES (100, 1, 1, 'CLM-2026-00001', 450000.00, 'Under Review', '2026-05-15 00:00:00', 'Rear-end collision Lekki-Epe Expressway. Police report AR/2026/LAG/1234.', 0.13, 3, NULL, '2026-05-21 17:13:13.61079', '2026-06-04 17:13:13.61079', 'default');
INSERT INTO public.claims VALUES (101, 2, 5, 'CLM-2026-00002', 180000.00, 'Approved', '2026-04-20 00:00:00', 'Emergency appendectomy Reddington Hospital. 3-day admission.', 0.05, 3, 175000.00, '2026-05-04 17:13:13.61079', '2026-06-04 17:13:13.61079', 'default');
INSERT INTO public.claims VALUES (103, 4, 6, 'CLM-2026-00004', 95000.00, 'Paid', '2026-03-10 00:00:00', 'Fracture right arm at EKO Hospital.', 0.03, 3, 92000.00, '2026-03-04 17:13:13.61079', '2026-06-04 17:13:13.61079', 'default');
INSERT INTO public.claims VALUES (104, 1, 2, 'CLM-2026-00005', 1200000.00, 'Rejected', '2026-02-14 00:00:00', 'Vehicle accessories theft rejected no police report within 24hrs.', 0.79, 3, 0.00, '2026-02-04 17:13:13.61079', '2026-06-04 17:13:13.61079', 'default');
INSERT INTO public.claims VALUES (107, 3, 9, 'CLM-2026-00008', 850000.00, 'Under Review', '2026-05-20 00:00:00', 'Fire damage kitchen and living room. Electrical fault.', 0.22, 3, NULL, '2026-05-28 17:13:13.61079', '2026-06-04 17:13:13.61079', 'default');
INSERT INTO public.claims VALUES (108, 5, 15, 'CLM-2026-00009', 3200000.00, 'Submitted', '2026-06-01 00:00:00', 'Rice crop loss 6 of 10 hectares destroyed by flooding.', 0.06, NULL, NULL, '2026-06-02 17:13:13.61079', '2026-06-04 17:13:13.61079', 'default');
INSERT INTO public.claims VALUES (110, 7, 16, 'CLM-2026-00011', 2400000.00, 'Under Review', '2026-05-10 00:00:00', 'Livestock loss 8 cattle during drought. NDVI confirms stress.', 0.08, NULL, NULL, '2026-05-14 17:13:13.61079', '2026-06-04 17:13:13.61079', 'default');
INSERT INTO public.claims VALUES (111, 6, 17, 'CLM-2026-00012', 100000.00, 'Paid', '2026-05-22 00:00:00', 'Parametric trigger: rainfall exceeded 380mm Sokoto. Auto 72hrs.', 0.00, NULL, 100000.00, '2026-05-28 17:13:13.61079', '2026-06-04 17:13:13.61079', 'default');
INSERT INTO public.claims VALUES (4, 4, 1, 'CLM-2026-26518', 250000.00, 'Submitted', '2026-06-05 14:53:02.068', 'Vehicle damage from accident on Third Mainland Bridge', 35.00, NULL, NULL, '2026-06-05 14:53:02.065077', '2026-06-05 14:53:02.065077', 'default');
INSERT INTO public.claims VALUES (5, 5, 1, 'CLM-2026-83650', 100.00, 'Submitted', '2026-06-05 15:02:42.442', 'test description for claim', 50.00, NULL, NULL, '2026-06-05 15:02:42.4412', '2026-06-05 15:02:42.4412', 'default');
INSERT INTO public.claims VALUES (6, 6, 22, 'CLM-2026-66245', 50000.00, 'Approved', '2026-06-05 15:04:09.215', 'Vehicle windshield cracked during hailstorm event', 5.00, NULL, NULL, '2026-06-05 15:04:09.215138', '2026-06-05 15:04:19.000173', 'default');
INSERT INTO public.claims VALUES (7, 7, 22, 'CLM-2026-31445', 100000.00, 'Submitted', '2026-06-05 15:04:28.746', 'Minor fender bender in parking lot during heavy rain', 20.00, NULL, NULL, '2026-06-05 15:04:28.745277', '2026-06-05 15:04:28.745277', 'default');
INSERT INTO public.claims VALUES (102, 108, 8, 'CLM-2026-00003', 2500000.00, 'Submitted', '2026-05-28 00:00:00', 'Water damage burst pipe - server room and reception flooded.', 0.08, NULL, NULL, '2026-06-01 17:13:13.61079', '2026-06-04 17:13:13.61079', 'default');
INSERT INTO public.claims VALUES (105, 108, 7, 'CLM-2026-00006', 3500000.00, 'Approved', '2026-05-01 00:00:00', 'Employee cardiac event 5 day ICU at LUTH.', 0.02, 3, 3450000.00, '2026-05-04 17:13:13.61079', '2026-06-04 17:13:13.61079', 'default');
INSERT INTO public.claims VALUES (106, 108, 11, 'CLM-2026-00007', 5000000.00, 'Escalated', '2026-04-15 00:00:00', 'Life claim deceased natural causes. High value senior review.', 0.15, NULL, NULL, '2026-04-04 17:13:13.61079', '2026-06-04 17:13:13.61079', 'default');
INSERT INTO public.claims VALUES (109, 108, 4, 'CLM-2026-00010', 750000.00, 'Approved', '2026-04-28 00:00:00', 'Fleet vehicle #7 total loss Lagos-Ibadan Expressway.', 0.10, 3, 720000.00, '2026-05-04 17:13:13.61079', '2026-06-04 17:13:13.61079', 'default');
INSERT INTO public.claims VALUES (8, 108, 22, 'CLM-2026-44865', 750000.00, 'Submitted', '2026-06-05 15:04:28.755', 'Significant property damage from flooding in Lagos Island area', 45.00, NULL, NULL, '2026-06-05 15:04:28.755007', '2026-06-05 15:04:28.755007', 'default');
INSERT INTO public.claims VALUES (9, 108, 22, 'CLM-2026-85861', 1500000.00, 'Submitted', '2026-06-05 15:04:28.765', 'Major structural damage to commercial building from fire incident', 70.00, NULL, NULL, '2026-06-05 15:04:28.764738', '2026-06-05 15:04:28.764738', 'default');
INSERT INTO public.claims VALUES (10, 108, 22, 'CLM-2026-74607', 50000.00, 'Submitted', '2026-06-05 15:04:59.295', 'Testing auth strict mode enforcement', 65.00, NULL, NULL, '2026-06-05 15:04:59.294519', '2026-06-05 15:04:59.294519', 'default');
INSERT INTO public.claims VALUES (15, 2, 5, 'CLM-2026-71475', 5000000.00, 'Submitted', '2026-06-05 16:06:17.1', 'Major fire damage to commercial warehouse requiring complete rebuild', 40.00, NULL, NULL, '2026-06-05 16:06:17.095107', '2026-06-05 16:06:17.095107', 'default');
INSERT INTO public.claims VALUES (16, 1, 1, 'CLM-2026-23581', 5000000.00, 'Submitted', '2026-06-05 16:13:24.316', 'Major vehicle collision requiring extensive repair work on multiple panels', 85.00, NULL, NULL, '2026-06-05 16:13:24.313516', '2026-06-05 16:13:24.313516', 'default');
INSERT INTO public.claims VALUES (17, 1, 1, 'CLM-2026-67246', 1000.00, 'Submitted', '2026-06-05 16:38:18.384', 'Rate limit test claim description', 80.00, NULL, NULL, '2026-06-05 16:38:18.383845', '2026-06-05 16:38:18.383845', 'default');
INSERT INTO public.claims VALUES (18, 1, 1, 'CLM-2026-41958', 1000.00, 'Submitted', '2026-06-05 16:59:35.572', 'Rate limit test claim description', 95.00, NULL, NULL, '2026-06-05 16:59:35.572076', '2026-06-05 16:59:35.572076', 'default');
INSERT INTO public.claims VALUES (19, 1, 1, 'CLM-2026-22696', 1000.00, 'Submitted', '2026-06-05 17:04:33.059', 'Rate limit test claim description', 100.00, NULL, NULL, '2026-06-05 17:04:33.058685', '2026-06-05 17:04:33.058685', 'default');
INSERT INTO public.claims VALUES (20, 1, 1, 'CLM-2026-58766', 1000.00, 'Submitted', '2026-06-05 17:31:25.713', 'Rate limit test claim description', 100.00, NULL, NULL, '2026-06-05 17:31:25.712429', '2026-06-05 17:31:25.712429', 'default');


--
-- Data for Name: claims_payouts; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.claims_payouts VALUES (1, 1, 'Patrick Munis', 'First Bank Nigeria', '3012345678', 750000.00, 'paid', 'Claims Manager', '2026-05-20 19:07:31.377371', '2026-05-23 19:07:31.377371', 'CLM-PAY-001', '2026-06-04 19:07:31.377371');
INSERT INTO public.claims_payouts VALUES (2, 2, 'Amina Yusuf', 'GTBank', '0012345678', 1200000.00, 'paid', 'Claims Manager', '2026-05-25 19:07:31.377371', '2026-05-27 19:07:31.377371', 'CLM-PAY-002', '2026-06-04 19:07:31.377371');
INSERT INTO public.claims_payouts VALUES (3, 3, 'Chukwuemeka Obi', 'Zenith Bank', '2012345678', 450000.00, 'approved', 'Senior Adjudicator', '2026-06-01 19:07:31.377371', NULL, NULL, '2026-06-04 19:07:31.377371');
INSERT INTO public.claims_payouts VALUES (4, 4, 'Fatima Abdullahi', 'UBA', '1012345678', 2500000.00, 'pending', NULL, NULL, NULL, NULL, '2026-06-04 19:07:31.377371');
INSERT INTO public.claims_payouts VALUES (5, 5, 'Olusegun Bakare', 'Access Bank', '0112345678', 185000.00, 'paid', 'Auto-adjudication', '2026-05-10 19:07:31.377371', '2026-05-12 19:07:31.377371', 'CLM-PAY-003', '2026-06-04 19:07:31.377371');


--
-- Data for Name: commission_audit_trail; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.commission_audit_trail VALUES (1, 'standard', '1', 'commission audit trail 1', '{"index": 1, "sample": true}', '{"index": 1, "sample": true}', 'commission audit trail 1', 'Sample data for commission_audit_trail record 1', '1 Insurance Road, Lagos', '2026-05-29 14:49:33.505378');
INSERT INTO public.commission_audit_trail VALUES (2, 'standard', '2', 'commission audit trail 2', '{"index": 2, "sample": true}', '{"index": 2, "sample": true}', 'commission audit trail 2', 'Sample data for commission_audit_trail record 2', '2 Insurance Road, Lagos', '2026-05-22 14:49:33.505378');
INSERT INTO public.commission_audit_trail VALUES (3, 'standard', '3', 'commission audit trail 3', '{"index": 3, "sample": true}', '{"index": 3, "sample": true}', 'commission audit trail 3', 'Sample data for commission_audit_trail record 3', '3 Insurance Road, Lagos', '2026-05-15 14:49:33.505378');


--
-- Data for Name: commission_cascade_history; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.commission_cascade_history VALUES (1, 1, 'COM-2026-001', 'standard', 50000.00, 1.50, 7, 'COM-2026-001', 7, 'COM-2026-001', '102.89.23.41', 1, 1.50, 50000.00, 'active', '2026-05-29 14:49:33.511231', 1, '2026-05-29 14:49:33.511231');
INSERT INTO public.commission_cascade_history VALUES (2, 2, 'COM-2026-002', 'standard', 100000.00, 3.00, 8, 'COM-2026-002', 8, 'COM-2026-002', '102.89.23.42', 2, 3.00, 100000.00, 'active', '2026-05-22 14:49:33.511231', 2, '2026-05-22 14:49:33.511231');
INSERT INTO public.commission_cascade_history VALUES (3, 3, 'COM-2026-003', 'standard', 150000.00, 4.50, 9, 'COM-2026-003', 9, 'COM-2026-003', '102.89.23.43', 3, 4.50, 150000.00, 'active', '2026-05-15 14:49:33.511231', 3, '2026-05-15 14:49:33.511231');


--
-- Data for Name: commission_clawbacks; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.commission_clawbacks VALUES (1, 1, 7, 1.50, 50000.00, 'commission clawbacks 1', 'active', '2026-05-29 14:49:33.515665', '2026-05-29 14:49:33.515665');
INSERT INTO public.commission_clawbacks VALUES (2, 2, 8, 3.00, 100000.00, 'commission clawbacks 2', 'active', '2026-05-22 14:49:33.515665', '2026-05-22 14:49:33.515665');
INSERT INTO public.commission_clawbacks VALUES (3, 3, 9, 4.50, 150000.00, 'commission clawbacks 3', 'active', '2026-05-15 14:49:33.515665', '2026-05-15 14:49:33.515665');


--
-- Data for Name: commission_payouts; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.commission_payouts VALUES (5, 1, 'commission_payo 1', 1.50, 'com', 'pending', 1, 1, 1, 'commission_payo 1', 'commis 1', 'commission_payo 1', 'commission_payo 1', 'commission_payo 1', '2026-05-29 14:50:36.411862', '2026-05-29 14:50:36.411862', '2026-05-29 14:50:36.411862');
INSERT INTO public.commission_payouts VALUES (6, 2, 'commission_payo 2', 3.00, 'com', 'approved', 2, 2, 2, 'commission_payo 2', 'commis 2', 'commission_payo 2', 'commission_payo 2', 'commission_payo 2', '2026-05-22 14:50:36.411862', '2026-05-22 14:50:36.411862', '2026-05-22 14:50:36.411862');
INSERT INTO public.commission_payouts VALUES (7, 3, 'commission_payo 3', 4.50, 'com', 'processing', 3, 3, 3, 'commission_payo 3', 'commis 3', 'commission_payo 3', 'commission_payo 3', 'commission_payo 3', '2026-05-15 14:50:36.411862', '2026-05-15 14:50:36.411862', '2026-05-15 14:50:36.411862');


--
-- Data for Name: commission_rules; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.commission_rules VALUES (1, 'Sample 1', 'Cash In', 'percentage', 1.5000, 50000.00, 50000.00, '{"data": "sample_1"}', 'Bronze', true, '2026-05-29 14:50:04.667079', '2026-05-29 14:50:04.667079', '2026-05-29 14:50:04.667079', '2026-05-29 14:50:04.667079');
INSERT INTO public.commission_rules VALUES (2, 'Sample 2', 'Cash Out', 'flat', 3.0000, 100000.00, 100000.00, '{"data": "sample_2"}', 'Silver', false, '2026-05-22 14:50:04.667079', '2026-05-22 14:50:04.667079', '2026-05-22 14:50:04.667079', '2026-05-22 14:50:04.667079');
INSERT INTO public.commission_rules VALUES (3, 'Sample 3', 'Transfer', 'tiered', 4.5000, 150000.00, 150000.00, '{"data": "sample_3"}', 'Gold', false, '2026-05-15 14:50:04.667079', '2026-05-15 14:50:04.667079', '2026-05-15 14:50:04.667079', '2026-05-15 14:50:04.667079');


--
-- Data for Name: commission_splits; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.commission_splits VALUES (1, 'CS-001', 'cash_in', 10.00, 15.00, 60.00, 10.00, 5.00, true, '2026-06-04 00:02:46.621741', NULL, '2026-06-04 00:02:46.621741', '2026-06-04 00:02:46.621741');
INSERT INTO public.commission_splits VALUES (2, 'CS-002', 'cash_out', 10.00, 15.00, 60.00, 10.00, 5.00, true, '2026-06-04 00:02:46.623391', NULL, '2026-06-04 00:02:46.623391', '2026-06-04 00:02:46.623391');
INSERT INTO public.commission_splits VALUES (3, 'CS-003', 'transfer', 8.00, 12.00, 65.00, 10.00, 5.00, true, '2026-06-04 00:02:46.624491', NULL, '2026-06-04 00:02:46.624491', '2026-06-04 00:02:46.624491');
INSERT INTO public.commission_splits VALUES (4, 'CS-004', 'bill_payment', 10.00, 15.00, 55.00, 15.00, 5.00, true, '2026-06-04 00:02:46.625657', NULL, '2026-06-04 00:02:46.625657', '2026-06-04 00:02:46.625657');
INSERT INTO public.commission_splits VALUES (5, 'CS-005', 'airtime', 5.00, 10.00, 70.00, 10.00, 5.00, true, '2026-06-04 00:02:46.627563', NULL, '2026-06-04 00:02:46.627563', '2026-06-04 00:02:46.627563');


--
-- Data for Name: commission_tiers; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.commission_tiers VALUES (1, 'CT-001', 'Cash-In Basic', 'cash_in', 0.00, 100000.00, 0.5000, 0.00, 0.0000, 'agent', true, '2026-06-04 00:02:46.608174', NULL, '2026-06-04 00:02:46.608174', '2026-06-04 00:02:46.608174');
INSERT INTO public.commission_tiers VALUES (2, 'CT-002', 'Cash-In Silver', 'cash_in', 100001.00, 500000.00, 0.6000, 0.00, 0.0500, 'agent', true, '2026-06-04 00:02:46.610704', NULL, '2026-06-04 00:02:46.610704', '2026-06-04 00:02:46.610704');
INSERT INTO public.commission_tiers VALUES (3, 'CT-003', 'Cash-In Gold', 'cash_in', 500001.00, 2000000.00, 0.7500, 0.00, 0.1000, 'agent', true, '2026-06-04 00:02:46.612045', NULL, '2026-06-04 00:02:46.612045', '2026-06-04 00:02:46.612045');
INSERT INTO public.commission_tiers VALUES (4, 'CT-004', 'Cash-In Platinum', 'cash_in', 2000001.00, 999999999.00, 0.9000, 0.00, 0.1500, 'agent', true, '2026-06-04 00:02:46.61361', NULL, '2026-06-04 00:02:46.61361', '2026-06-04 00:02:46.61361');
INSERT INTO public.commission_tiers VALUES (5, 'CT-005', 'Cash-Out Basic', 'cash_out', 0.00, 100000.00, 0.8000, 50.00, 0.0000, 'agent', true, '2026-06-04 00:02:46.614712', NULL, '2026-06-04 00:02:46.614712', '2026-06-04 00:02:46.614712');
INSERT INTO public.commission_tiers VALUES (6, 'CT-006', 'Cash-Out Premium', 'cash_out', 100001.00, 999999999.00, 1.0000, 50.00, 0.1000, 'agent', true, '2026-06-04 00:02:46.615852', NULL, '2026-06-04 00:02:46.615852', '2026-06-04 00:02:46.615852');
INSERT INTO public.commission_tiers VALUES (7, 'CT-007', 'Transfer Basic', 'transfer', 0.00, 500000.00, 0.3000, 25.00, 0.0000, 'agent', true, '2026-06-04 00:02:46.617047', NULL, '2026-06-04 00:02:46.617047', '2026-06-04 00:02:46.617047');
INSERT INTO public.commission_tiers VALUES (8, 'CT-008', 'Bill Payment', 'bill_payment', 0.00, 999999999.00, 0.2000, 50.00, 0.0500, 'agent', true, '2026-06-04 00:02:46.618279', NULL, '2026-06-04 00:02:46.618279', '2026-06-04 00:02:46.618279');
INSERT INTO public.commission_tiers VALUES (9, 'CT-009', 'Airtime', 'airtime', 0.00, 999999999.00, 3.0000, 0.00, 0.0000, 'agent', true, '2026-06-04 00:02:46.619657', NULL, '2026-06-04 00:02:46.619657', '2026-06-04 00:02:46.619657');


--
-- Data for Name: communication_preferences; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.communication_preferences VALUES (1, 2, true, true, true, false, false, 'immediate', 'en', NULL, NULL, '2026-06-05 04:06:31.170322');
INSERT INTO public.communication_preferences VALUES (2, 3, true, true, true, false, false, 'immediate', 'en', NULL, NULL, '2026-06-05 04:06:31.170322');
INSERT INTO public.communication_preferences VALUES (3, 4, true, true, true, false, false, 'immediate', 'en', NULL, NULL, '2026-06-05 04:06:31.170322');
INSERT INTO public.communication_preferences VALUES (4, 5, true, true, true, false, false, 'immediate', 'en', NULL, NULL, '2026-06-05 04:06:31.170322');
INSERT INTO public.communication_preferences VALUES (5, 1, true, true, true, false, false, 'immediate', 'en', NULL, NULL, '2026-06-05 04:06:31.170322');


--
-- Data for Name: compliance_checks; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.compliance_checks VALUES (1, 7, 1, 'standard', 'COM-2026-001', 'compliance checks 1', 'compliance checks 1', 50000.00, true, '2026-05-29 14:49:33.555474', '2026-05-29 14:49:33.555474');
INSERT INTO public.compliance_checks VALUES (2, 8, 2, 'standard', 'COM-2026-002', 'compliance checks 2', 'compliance checks 2', 100000.00, false, '2026-05-22 14:49:33.555474', '2026-05-22 14:49:33.555474');
INSERT INTO public.compliance_checks VALUES (3, 9, 3, 'standard', 'COM-2026-003', 'compliance checks 3', 'compliance checks 3', 150000.00, false, '2026-05-15 14:49:33.555474', '2026-05-15 14:49:33.555474');


--
-- Data for Name: compliance_filings; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.compliance_filings VALUES (1, 'Annual Return', 'AR/NAICOM/2025/IP001', 'approved', '2025', 'NAICOM', '2026-03-15 00:00:00', NULL, 45000, 2400000000.00, 12, NULL, 5, NULL, '2026-03-04 17:07:58.355871');
INSERT INTO public.compliance_filings VALUES (2, 'AML/CFT Report', 'AML/CBN/Q1/2026', 'submitted', 'Q1 2026', 'CBN/NFIU', '2026-04-28 00:00:00', NULL, 12500, 850000000.00, 47, NULL, 5, NULL, '2026-04-04 17:07:58.355871');
INSERT INTO public.compliance_filings VALUES (3, 'NDPR Compliance', 'DPC/NITDA/2026', 'approved', '2025', 'NITDA', '2026-02-20 00:00:00', NULL, 0, 0.00, 23, NULL, 5, NULL, '2026-02-04 17:07:58.355871');
INSERT INTO public.compliance_filings VALUES (4, 'Industry Report', 'IIR/NIA/Q1/2026', 'submitted', 'Q1 2026', 'NIA', '2026-04-25 00:00:00', NULL, 20000, 1200000000.00, 0, NULL, 5, NULL, '2026-04-04 17:07:58.355871');
INSERT INTO public.compliance_filings VALUES (5, 'Complaint Report', 'CCR/NAICOM/Q1/2026', 'approved', 'Q1 2026', 'NAICOM', '2026-04-20 00:00:00', NULL, 156, 0.00, 8, NULL, 5, NULL, '2026-04-04 17:07:58.355871');


--
-- Data for Name: compliance_reports; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.compliance_reports VALUES (1, '2026-01-01 00:00:00', '2026-03-31 00:00:00', 47, 3, 12, 32, 2, 45, NULL, NULL, NULL, 'compliance_engine', '2026-04-04 17:07:58.336926', 'AML/CFT Compliance', 'Q1 2026', 'Published', NULL, NULL, NULL, '2026-06-04 17:07:58.336926');
INSERT INTO public.compliance_reports VALUES (2, '2026-05-01 00:00:00', '2026-05-31 00:00:00', 156, 8, 34, 114, 5, 148, NULL, NULL, NULL, 'kyc_system', '2026-05-04 17:07:58.336926', 'KYC Verification', 'May 2026', 'Published', NULL, NULL, NULL, '2026-06-04 17:07:58.336926');
INSERT INTO public.compliance_reports VALUES (3, '2026-01-01 00:00:00', '2026-03-31 00:00:00', 12, 0, 4, 8, 0, 12, NULL, NULL, NULL, 'naicom_module', '2026-04-04 17:07:58.336926', 'NAICOM Score', 'Q1 2026', 'Published', NULL, NULL, NULL, '2026-06-04 17:07:58.336926');
INSERT INTO public.compliance_reports VALUES (4, '2026-01-01 00:00:00', '2026-03-31 00:00:00', 8, 1, 2, 5, 1, 7, NULL, NULL, NULL, 'sanctions_engine', '2026-04-04 17:07:58.336926', 'Sanctions Screening', 'Q1 2026', 'Published', NULL, NULL, NULL, '2026-06-04 17:07:58.336926');
INSERT INTO public.compliance_reports VALUES (5, '2026-01-01 00:00:00', '2026-03-31 00:00:00', 23, 2, 7, 14, 1, 22, NULL, NULL, NULL, 'ndpr_module', '2026-04-04 17:07:58.336926', 'NDPR Data Privacy', 'Q1 2026', 'Published', NULL, NULL, NULL, '2026-06-04 17:07:58.336926');
INSERT INTO public.compliance_reports VALUES (6, '2026-01-01 00:00:00', '2026-03-31 00:00:00', 34, 5, 11, 18, 3, 28, NULL, NULL, NULL, 'claims_audit', '2026-05-04 17:07:58.336926', 'Claims Audit', 'Q1 2026', 'Draft', NULL, NULL, NULL, '2026-06-04 17:07:58.336926');
INSERT INTO public.compliance_reports VALUES (7, '2026-01-01 00:00:00', '2026-03-31 00:00:00', 19, 1, 6, 12, 1, 18, NULL, NULL, NULL, 'agent_compliance', '2026-04-04 17:07:58.336926', 'Agent Conduct', 'Q1 2026', 'Published', NULL, NULL, NULL, '2026-06-04 17:07:58.336926');


--
-- Data for Name: connectivity_log; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.connectivity_log VALUES (1, 'connectivity_log 1', 'Excellent', 1, '2026-05-29 14:50:04.671785');
INSERT INTO public.connectivity_log VALUES (2, 'connectivity_log 2', 'Good', 2, '2026-05-22 14:50:04.671785');
INSERT INTO public.connectivity_log VALUES (3, 'connectivity_log 3', 'Poor', 3, '2026-05-15 14:50:04.671785');


--
-- Data for Name: credit_applications; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.credit_applications VALUES (5, 1, 1.50, 1.50, 1.5000, 1, 'pending', 1, 'credit_applicat 1', 'credit_applicat 1', '2026-05-29 14:50:36.415608', '2026-05-29 14:50:36.415608', '2026-05-29 14:50:36.415608', '2026-05-29 14:50:36.415608', '2026-05-29 14:50:36.415608', '2026-05-29 14:50:36.415608');
INSERT INTO public.credit_applications VALUES (6, 2, 3.00, 3.00, 3.0000, 2, 'approved', 2, 'credit_applicat 2', 'credit_applicat 2', '2026-05-22 14:50:36.415608', '2026-05-22 14:50:36.415608', '2026-05-22 14:50:36.415608', '2026-05-22 14:50:36.415608', '2026-05-22 14:50:36.415608', '2026-05-22 14:50:36.415608');
INSERT INTO public.credit_applications VALUES (7, 3, 4.50, 4.50, 4.5000, 3, 'rejected', 3, 'credit_applicat 3', 'credit_applicat 3', '2026-05-15 14:50:36.415608', '2026-05-15 14:50:36.415608', '2026-05-15 14:50:36.415608', '2026-05-15 14:50:36.415608', '2026-05-15 14:50:36.415608', '2026-05-15 14:50:36.415608');


--
-- Data for Name: credit_score_history; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.credit_score_history VALUES (5, 1, 1, 'AAA', '{"i":1}', '2026-05-29 14:50:36.418937');
INSERT INTO public.credit_score_history VALUES (6, 2, 2, 'AA', '{"i":2}', '2026-05-22 14:50:36.418937');
INSERT INTO public.credit_score_history VALUES (7, 3, 3, 'A', '{"i":3}', '2026-05-15 14:50:36.418937');


--
-- Data for Name: currency_rates; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.currency_rates VALUES (1, 'NGN', 'USD', 0.00062500, 'CBN', '2026-06-05 04:06:31.120042');
INSERT INTO public.currency_rates VALUES (2, 'NGN', 'GBP', 0.00049500, 'CBN', '2026-06-05 04:06:31.120042');
INSERT INTO public.currency_rates VALUES (3, 'NGN', 'EUR', 0.00057500, 'CBN', '2026-06-05 04:06:31.120042');
INSERT INTO public.currency_rates VALUES (4, 'NGN', 'GHS', 0.00940000, 'CBN', '2026-06-05 04:06:31.120042');
INSERT INTO public.currency_rates VALUES (5, 'NGN', 'KES', 0.08060000, 'CBN', '2026-06-05 04:06:31.120042');
INSERT INTO public.currency_rates VALUES (6, 'NGN', 'ZAR', 0.01130000, 'CBN', '2026-06-05 04:06:31.120042');
INSERT INTO public.currency_rates VALUES (7, 'USD', 'NGN', 1600.00000000, 'CBN', '2026-06-05 04:06:31.120042');
INSERT INTO public.currency_rates VALUES (8, 'GBP', 'NGN', 2020.00000000, 'CBN', '2026-06-05 04:06:31.120042');
INSERT INTO public.currency_rates VALUES (9, 'EUR', 'NGN', 1739.13000000, 'CBN', '2026-06-05 04:06:31.120042');


--
-- Data for Name: customer_feedback; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.customer_feedback VALUES (1, 1, 'claims_process', 'Quick Claim Processing', 'Claim processed quickly. Adjuster was professional.', 4, 'resolved', NULL, '2026-03-04 17:10:58.68402', '2026-06-04 17:10:58.68402');
INSERT INTO public.customer_feedback VALUES (2, 4, 'customer_service', 'WhatsApp Bot', 'WhatsApp bot helped check policy instantly.', 5, 'resolved', NULL, '2026-04-04 17:10:58.68402', '2026-06-04 17:10:58.68402');
INSERT INTO public.customer_feedback VALUES (3, 2, 'policy_purchase', 'Premium Calculator', 'Good coverage but calculator was confusing.', 3, 'open', NULL, '2026-02-04 17:10:58.68402', '2026-06-04 17:10:58.68402');
INSERT INTO public.customer_feedback VALUES (4, 9, 'agent_service', 'Excellent Agent', 'Agent Kayode was extremely helpful with fleet policy.', 5, 'resolved', NULL, '2026-03-04 17:10:58.68402', '2026-06-04 17:10:58.68402');
INSERT INTO public.customer_feedback VALUES (5, 6, 'claims_process', 'Fast Parametric Payout', 'Parametric payout arrived within 72 hours as promised.', 4, 'resolved', NULL, '2026-05-28 17:10:58.68402', '2026-06-04 17:10:58.68402');
INSERT INTO public.customer_feedback VALUES (6, 8, 'product', 'Crop Shield Review', 'Crop Shield is exactly what small farmers need.', 5, 'resolved', NULL, '2026-05-04 17:10:58.68402', '2026-06-04 17:10:58.68402');
INSERT INTO public.customer_feedback VALUES (7, 3, 'claims_process', 'Slow Property Claim', 'Property claim taking too long. 2 weeks no update.', 2, 'escalated', NULL, '2026-05-30 17:10:58.68402', '2026-06-04 17:10:58.68402');
INSERT INTO public.customer_feedback VALUES (8, 12, 'customer_service', 'USSD Works Well', 'USSD channel works well without internet.', 4, 'resolved', NULL, '2026-04-04 17:10:58.68402', '2026-06-04 17:10:58.68402');
INSERT INTO public.customer_feedback VALUES (9, 1, 'coverage_recommendation', 'Motor + Breakdown', 'Based on your motor policy, you should consider adding breakdown assistance coverage', 5, 'Open', NULL, '2026-06-04 20:58:18.990166', '2026-06-04 20:58:18.990166');
INSERT INTO public.customer_feedback VALUES (10, 1, 'coverage_recommendation', 'Health + Critical Illness', 'Your health coverage could benefit from adding critical illness rider for enhanced protection', 4, 'Open', NULL, '2026-06-04 20:58:18.990166', '2026-06-04 20:58:18.990166');
INSERT INTO public.customer_feedback VALUES (11, 1, 'coverage_recommendation', 'Business + Cyber', 'Consider cyber insurance to protect your business digital assets and customer data', 4, 'Open', NULL, '2026-06-04 20:58:18.990166', '2026-06-04 20:58:18.990166');


--
-- Data for Name: customer_journey_events; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.customer_journey_events VALUES (1, '1', 'standard', 'customer journey events 1', 'customer journey events 1', '1', 'standard', 'web', '2026-05-29 14:49:33.612145');
INSERT INTO public.customer_journey_events VALUES (2, '2', 'standard', 'customer journey events 2', 'customer journey events 2', '2', 'standard', 'web', '2026-05-22 14:49:33.612145');
INSERT INTO public.customer_journey_events VALUES (3, '3', 'standard', 'customer journey events 3', 'customer journey events 3', '3', 'standard', 'web', '2026-05-15 14:49:33.612145');


--
-- Data for Name: customer_journey_steps; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.customer_journey_steps VALUES (1, 1, 'standard', 'active', '2026-05-29 14:49:33.617047', 'customer journey steps 1', '2026-05-29 14:49:33.617047');
INSERT INTO public.customer_journey_steps VALUES (2, 2, 'standard', 'active', '2026-05-22 14:49:33.617047', 'customer journey steps 2', '2026-05-22 14:49:33.617047');
INSERT INTO public.customer_journey_steps VALUES (3, 3, 'standard', 'active', '2026-05-15 14:49:33.617047', 'customer journey steps 3', '2026-05-15 14:49:33.617047');


--
-- Data for Name: customers; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.customers VALUES (1, 'CUST-NG-001', 'Adebayo', 'Ogundimu', 'adebayo.ogundimu@gmail.com', '+2348012345678', '22345678901', '12345678901', '1985-03-15', '24 Admiralty Way, Lekki Phase 1, Lagos', 'active', 3, 150000.00, 500000.00, 5000000.00, NULL, NULL, NULL, NULL, NULL, '2024-12-04 17:07:58.321505', '2026-06-04 17:07:58.321505', NULL, NULL);
INSERT INTO public.customers VALUES (2, 'CUST-NG-002', 'Chioma', 'Nnamdi', 'chioma.nnamdi@yahoo.com', '+2348023456789', '33456789012', '23456789012', '1990-07-22', '15 Gana Street, Maitama, Abuja', 'active', 3, 250000.00, 500000.00, 5000000.00, NULL, NULL, NULL, NULL, NULL, '2025-04-04 17:07:58.321505', '2026-06-04 17:07:58.321505', NULL, NULL);
INSERT INTO public.customers VALUES (3, 'CUST-NG-003', 'Abdullahi', 'Ibrahim', 'abdullahi.ibrahim@outlook.com', '+2348034567890', '44567890123', '34567890123', '1978-11-03', '8 Ahmadu Bello Way, Kaduna', 'active', 2, 80000.00, 300000.00, 3000000.00, NULL, NULL, NULL, NULL, NULL, '2025-06-04 17:07:58.321505', '2026-06-04 17:07:58.321505', NULL, NULL);
INSERT INTO public.customers VALUES (4, 'CUST-NG-004', 'Blessing', 'Uchenna', 'blessing.uchenna@gmail.com', '+2348045678901', '55678901234', '45678901234', '1992-01-18', '42 Trans Amadi Road, Port Harcourt', 'active', 3, 320000.00, 500000.00, 5000000.00, NULL, NULL, NULL, NULL, NULL, '2025-08-04 17:07:58.321505', '2026-06-04 17:07:58.321505', NULL, NULL);
INSERT INTO public.customers VALUES (5, 'CUST-NG-005', 'Olumide', 'Fashola', 'olumide.fashola@hotmail.com', '+2348056789012', '66789012345', '56789012345', '1988-09-07', '7 Ring Road, Ibadan', 'active', 2, 45000.00, 200000.00, 2000000.00, NULL, NULL, NULL, NULL, NULL, '2025-10-04 17:07:58.321505', '2026-06-04 17:07:58.321505', NULL, NULL);
INSERT INTO public.customers VALUES (6, 'CUST-NG-006', 'Hadiza', 'Sani', 'hadiza.sani@gmail.com', '+2348067890123', '77890123456', '67890123456', '1995-04-25', '3 Sultan Abubakar Road, Sokoto', 'active', 3, 190000.00, 500000.00, 5000000.00, NULL, NULL, NULL, NULL, NULL, '2025-11-04 17:07:58.321505', '2026-06-04 17:07:58.321505', NULL, NULL);
INSERT INTO public.customers VALUES (7, 'CUST-NG-007', 'Tochukwu', 'Obi', 'tochukwu.obi@gmail.com', '+2348078901234', '88901234567', '78901234567', '1982-12-10', '19 New Market Road, Onitsha', 'active', 2, 110000.00, 300000.00, 3000000.00, NULL, NULL, NULL, NULL, NULL, '2025-12-04 17:07:58.321505', '2026-06-04 17:07:58.321505', NULL, NULL);
INSERT INTO public.customers VALUES (8, 'CUST-NG-008', 'Aisha', 'Mohammed', 'aisha.mohammed@yahoo.com', '+2348089012345', '99012345678', '89012345678', '1997-06-30', '5 Murtala Mohammed Way, Kano', 'active', 1, 25000.00, 100000.00, 1000000.00, NULL, NULL, NULL, NULL, NULL, '2026-03-04 17:07:58.321505', '2026-06-04 17:07:58.321505', NULL, NULL);
INSERT INTO public.customers VALUES (9, 'CUST-NG-009', 'Segun', 'Obasanjo', 'segun.obasanjo@gmail.com', '+2348090123456', '10123456789', '90123456789', '1975-08-14', '33 Akin Adesola Street, Victoria Island, Lagos', 'active', 3, 500000.00, 1000000.00, 10000000.00, NULL, NULL, NULL, NULL, NULL, '2024-10-04 17:07:58.321505', '2026-06-04 17:07:58.321505', NULL, NULL);
INSERT INTO public.customers VALUES (10, 'CUST-NG-010', 'Ngozi', 'Eze', 'ngozi.eze@outlook.com', '+2348011234567', '21234567890', '01234567890', '1993-02-28', '12 Independence Layout, Enugu', 'active', 3, 175000.00, 500000.00, 5000000.00, NULL, NULL, NULL, NULL, NULL, '2025-03-04 17:07:58.321505', '2026-06-04 17:07:58.321505', NULL, NULL);
INSERT INTO public.customers VALUES (11, 'CUST-NG-011', 'Yakubu', 'Gowon', 'yakubu.gowon@gmail.com', '+2348022345678', '32345678901', '12345098765', '1980-05-20', '27 Sabon Gari, Zaria', 'pending_kyc', 0, 0.00, 50000.00, 500000.00, NULL, NULL, NULL, NULL, NULL, '2026-05-28 17:07:58.321505', '2026-06-04 17:07:58.321505', NULL, NULL);
INSERT INTO public.customers VALUES (12, 'CUST-NG-012', 'Funmi', 'Adesanya', 'funmi.adesanya@yahoo.com', '+2348033456789', '43456789012', '23456098765', '1991-10-12', '88 Allen Avenue, Ikeja, Lagos', 'active', 3, 420000.00, 500000.00, 5000000.00, NULL, NULL, NULL, NULL, NULL, '2024-08-04 17:07:58.321505', '2026-06-04 17:07:58.321505', NULL, NULL);
INSERT INTO public.customers VALUES (13, 'CUST-NG-013', 'Musa', 'Danladi', 'musa.danladi@gmail.com', '+2348044567890', '54567890123', '34567098765', '1970-03-01', '14 Lamido Crescent, Yola', 'active', 2, 60000.00, 200000.00, 2000000.00, NULL, NULL, NULL, NULL, NULL, '2025-09-04 17:07:58.321505', '2026-06-04 17:07:58.321505', NULL, NULL);
INSERT INTO public.customers VALUES (14, 'CUST-NG-014', 'Adeola', 'Williams', 'adeola.williams@gmail.com', '+2348055678901', '65678901234', '45678098765', '1986-07-19', '50 Broad Street, Lagos Island', 'active', 3, 680000.00, 1000000.00, 10000000.00, NULL, NULL, NULL, NULL, NULL, '2024-06-04 17:07:58.321505', '2026-06-04 17:07:58.321505', NULL, NULL);
INSERT INTO public.customers VALUES (15, 'CUST-NG-015', 'Ifeanyi', 'Okechukwu', 'ifeanyi.okechukwu@outlook.com', '+2348066789012', '76789012345', '56789098765', '1994-11-05', '6 Ogui Road, Enugu', 'active', 2, 95000.00, 300000.00, 3000000.00, NULL, NULL, NULL, NULL, NULL, '2026-01-04 17:07:58.321505', '2026-06-04 17:07:58.321505', NULL, NULL);


--
-- Data for Name: data_consent_records; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.data_consent_records VALUES (1, 'standard', 1, 'standard', true, '2026-05-29 14:49:33.621183', '2026-05-29 14:49:33.621183', '1 Insurance Road, Lagos', 'data consent records 1', 1, '2026-05-29 14:49:33.621183');
INSERT INTO public.data_consent_records VALUES (2, 'standard', 2, 'standard', false, '2026-05-22 14:49:33.621183', '2026-05-22 14:49:33.621183', '2 Insurance Road, Lagos', 'data consent records 2', 2, '2026-05-22 14:49:33.621183');
INSERT INTO public.data_consent_records VALUES (3, 'standard', 3, 'standard', false, '2026-05-15 14:49:33.621183', '2026-05-15 14:49:33.621183', '3 Insurance Road, Lagos', 'data consent records 3', 3, '2026-05-15 14:49:33.621183');


--
-- Data for Name: data_export_jobs; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.data_export_jobs VALUES (1, 'Sample data_export_jobs 1', 'standard', 'data export jobs 1', 'data export jobs 1', 'active', '/uploads/data_export_jobs/1.pdf', 1, 5, 'data export jobs 1', '2026-05-29 14:49:33.62609', '2026-05-29 14:49:33.62609', '2026-07-05 14:49:33.62609', '2026-05-29 14:49:33.62609');
INSERT INTO public.data_export_jobs VALUES (2, 'Sample data_export_jobs 2', 'standard', 'data export jobs 2', 'data export jobs 2', 'active', '/uploads/data_export_jobs/2.pdf', 2, 10, 'data export jobs 2', '2026-05-22 14:49:33.62609', '2026-05-22 14:49:33.62609', '2026-08-04 14:49:33.62609', '2026-05-22 14:49:33.62609');
INSERT INTO public.data_export_jobs VALUES (3, 'Sample data_export_jobs 3', 'standard', 'data export jobs 3', 'data export jobs 3', 'active', '/uploads/data_export_jobs/3.pdf', 3, 15, 'data export jobs 3', '2026-05-15 14:49:33.62609', '2026-05-15 14:49:33.62609', '2026-09-03 14:49:33.62609', '2026-05-15 14:49:33.62609');


--
-- Data for Name: data_rights_requests; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.data_rights_requests VALUES (1, 'standard', 1, 'standard', 'sample1@insureportal.ng', 'active', '/uploads/data_rights_requests/1.pdf', 'data rights requests 1', '2026-05-29 14:49:33.630269', 'Sample data for data_rights_requests record 1', 1, '2026-05-29 14:49:33.630269', '2026-05-29 14:49:33.630269');
INSERT INTO public.data_rights_requests VALUES (2, 'standard', 2, 'standard', 'sample2@insureportal.ng', 'active', '/uploads/data_rights_requests/2.pdf', 'data rights requests 2', '2026-05-22 14:49:33.630269', 'Sample data for data_rights_requests record 2', 2, '2026-05-22 14:49:33.630269', '2026-05-22 14:49:33.630269');
INSERT INTO public.data_rights_requests VALUES (3, 'standard', 3, 'standard', 'sample3@insureportal.ng', 'active', '/uploads/data_rights_requests/3.pdf', 'data rights requests 3', '2026-05-15 14:49:33.630269', 'Sample data for data_rights_requests record 3', 3, '2026-05-15 14:49:33.630269', '2026-05-15 14:49:33.630269');


--
-- Data for Name: db_scaling_metrics; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.db_scaling_metrics VALUES (1, 'Active Connections', 45.00, 100.00, 'Consider connection pooling with PgBouncer', 'medium', 'connections', '2026-06-05 04:06:31.279782');
INSERT INTO public.db_scaling_metrics VALUES (2, 'Query Latency p99 (ms)', 125.00, 200.00, 'Add indexes on frequently queried columns', 'low', 'performance', '2026-06-05 04:06:31.279782');
INSERT INTO public.db_scaling_metrics VALUES (3, 'Table Bloat %', 12.50, 20.00, 'Schedule regular VACUUM ANALYZE', 'low', 'maintenance', '2026-06-05 04:06:31.279782');
INSERT INTO public.db_scaling_metrics VALUES (4, 'WAL Generation (GB/h)', 2.30, 5.00, 'Current rate is healthy', 'info', 'replication', '2026-06-05 04:06:31.279782');
INSERT INTO public.db_scaling_metrics VALUES (5, 'Cache Hit Ratio %', 98.70, 95.00, 'Excellent cache utilization', 'info', 'performance', '2026-06-05 04:06:31.279782');
INSERT INTO public.db_scaling_metrics VALUES (6, 'Disk Usage %', 42.00, 80.00, 'Sufficient disk space available', 'info', 'storage', '2026-06-05 04:06:31.279782');
INSERT INTO public.db_scaling_metrics VALUES (7, 'Replication Lag (s)', 2.30, 10.00, 'Streaming replication is healthy', 'info', 'replication', '2026-06-05 04:06:31.279782');
INSERT INTO public.db_scaling_metrics VALUES (8, 'Long Running Queries', 2.00, 5.00, 'Monitor queries > 30s', 'low', 'performance', '2026-06-05 04:06:31.279782');


--
-- Data for Name: device_commands; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.device_commands VALUES (1, 1, 'device commands 1', '{"index": 1, "sample": true}', 'active', 'device commands 1', '2026-05-29 14:49:33.634932', '2026-05-29 14:49:33.634932', '2026-05-29 14:49:33.634932', 'Sample data for device_commands record 1', '2026-05-29 14:49:33.634932', '{"index": 1, "sample": true}', '2026-05-29 14:49:33.634932');
INSERT INTO public.device_commands VALUES (2, 2, 'device commands 2', '{"index": 2, "sample": true}', 'active', 'device commands 2', '2026-05-22 14:49:33.634932', '2026-05-22 14:49:33.634932', '2026-05-22 14:49:33.634932', 'Sample data for device_commands record 2', '2026-05-22 14:49:33.634932', '{"index": 2, "sample": true}', '2026-05-22 14:49:33.634932');
INSERT INTO public.device_commands VALUES (3, 3, 'device commands 3', '{"index": 3, "sample": true}', 'active', 'device commands 3', '2026-05-15 14:49:33.634932', '2026-05-15 14:49:33.634932', '2026-05-15 14:49:33.634932', 'Sample data for device_commands record 3', '2026-05-15 14:49:33.634932', '{"index": 3, "sample": true}', '2026-05-15 14:49:33.634932');


--
-- Data for Name: device_compliance_policies; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.device_compliance_policies VALUES (1, 'Sample 1', '102.89.1', 1, '{"data": "sample_1"}', 'device_compl 1', true, 'device_compliance_po 1', 'device_compliance_po 1', '2026-05-29 14:50:04.716843', '2026-05-29 14:50:04.716843');
INSERT INTO public.device_compliance_policies VALUES (2, 'Sample 2', '102.89.2', 2, '{"data": "sample_2"}', 'device_compl 2', false, 'device_compliance_po 2', 'device_compliance_po 2', '2026-05-22 14:50:04.716843', '2026-05-22 14:50:04.716843');
INSERT INTO public.device_compliance_policies VALUES (3, 'Sample 3', '102.89.3', 3, '{"data": "sample_3"}', 'device_compl 3', false, 'device_compliance_po 3', 'device_compliance_po 3', '2026-05-15 14:50:04.716843', '2026-05-15 14:50:04.716843');


--
-- Data for Name: device_compliance_violations; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.device_compliance_violations VALUES (1, 1, 1, 'device_compliance_vi 1', 'device_compliance_vi 1', 'device_compliance_vi 1', 'device_compl 1', '{"data": "sample_1"}', 'device_compliance_vi 1', 'device_compliance_vi 1', '2026-05-29 14:50:04.7219', 'device_compliance_vi 1', '2026-05-29 14:50:04.7219', '2026-05-29 14:50:04.7219');
INSERT INTO public.device_compliance_violations VALUES (2, 2, 2, 'device_compliance_vi 2', 'device_compliance_vi 2', 'device_compliance_vi 2', 'device_compl 2', '{"data": "sample_2"}', 'device_compliance_vi 2', 'device_compliance_vi 2', '2026-05-22 14:50:04.7219', 'device_compliance_vi 2', '2026-05-22 14:50:04.7219', '2026-05-22 14:50:04.7219');
INSERT INTO public.device_compliance_violations VALUES (3, 3, 3, 'device_compliance_vi 3', 'device_compliance_vi 3', 'device_compliance_vi 3', 'device_compl 3', '{"data": "sample_3"}', 'device_compliance_vi 3', 'device_compliance_vi 3', '2026-05-15 14:50:04.7219', 'device_compliance_vi 3', '2026-05-15 14:50:04.7219', '2026-05-15 14:50:04.7219');


--
-- Data for Name: device_locations; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.device_locations VALUES (1, 1, 7, 6.4600000, 3.4100000, 1.50, true, '2026-05-29 14:49:33.674966', 6.4600000, 3.4100000, 1.50, 1.50, 1.50, 'device locations 1', '2026-05-29 14:49:33.674966');
INSERT INTO public.device_locations VALUES (2, 2, 8, 6.4700000, 3.4200000, 3.00, false, '2026-05-22 14:49:33.674966', 6.4700000, 3.4200000, 3.00, 3.00, 3.00, 'device locations 2', '2026-05-22 14:49:33.674966');
INSERT INTO public.device_locations VALUES (3, 3, 9, 6.4800000, 3.4300000, 4.50, false, '2026-05-15 14:49:33.674966', 6.4800000, 3.4300000, 4.50, 4.50, 4.50, 'device locations 3', '2026-05-15 14:49:33.674966');


--
-- Data for Name: devices; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.devices VALUES (1, 7, 'DEV-2026-001', 'devices 1', 'devices 1', 'devices 1', 'devices 1', '1 Insurance Road, Lagos', 'devices 1', 'active', '{"index": 1, "sample": true}', '2026-05-29 14:49:33.68061', '2026-05-29 14:49:33.68061', '2026-05-29 14:49:33.68061', 'devices_key_1_982f9d48f0b5323de66cb010ef245b79', '2026-07-05 14:49:33.68061', 'devices_key_1_60952d4b28015383b8e5c4f95467993c', 'devices 1', 'devices 1', '{"index": 1, "sample": true}', '2026-05-29 14:49:33.68061', 1, '2026-05-29 14:49:33.68061', 1, true, 'devices 1', 1, '1 Insurance Road, Lagos', 'standard', '/uploads/devices/1.pdf', '2026-05-29 14:49:33.68061', 'active', '2026-05-29 14:49:33.68061');
INSERT INTO public.devices VALUES (2, 8, 'DEV-2026-002', 'devices 2', 'devices 2', 'devices 2', 'devices 2', '2 Insurance Road, Lagos', 'devices 2', 'active', '{"index": 2, "sample": true}', '2026-05-22 14:49:33.68061', '2026-05-22 14:49:33.68061', '2026-05-22 14:49:33.68061', 'devices_key_2_c098549702b47729df17e738b4cfe1bd', '2026-08-04 14:49:33.68061', 'devices_key_2_0e38689df3b4442b0f314f4269c5442b', 'devices 2', 'devices 2', '{"index": 2, "sample": true}', '2026-05-22 14:49:33.68061', 2, '2026-05-22 14:49:33.68061', 2, false, 'devices 2', 2, '2 Insurance Road, Lagos', 'standard', '/uploads/devices/2.pdf', '2026-05-22 14:49:33.68061', 'active', '2026-05-22 14:49:33.68061');
INSERT INTO public.devices VALUES (3, 9, 'DEV-2026-003', 'devices 3', 'devices 3', 'devices 3', 'devices 3', '3 Insurance Road, Lagos', 'devices 3', 'active', '{"index": 3, "sample": true}', '2026-05-15 14:49:33.68061', '2026-05-15 14:49:33.68061', '2026-05-15 14:49:33.68061', 'devices_key_3_54e082f4293bbd067b6619c881d521bc', '2026-09-03 14:49:33.68061', 'devices_key_3_20d5c61415e317bd4e4919d431870aa5', 'devices 3', 'devices 3', '{"index": 3, "sample": true}', '2026-05-15 14:49:33.68061', 3, '2026-05-15 14:49:33.68061', 3, false, 'devices 3', 3, '3 Insurance Road, Lagos', 'standard', '/uploads/devices/3.pdf', '2026-05-15 14:49:33.68061', 'active', '2026-05-15 14:49:33.68061');


--
-- Data for Name: disaster_recovery_config; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.disaster_recovery_config VALUES (1, 'PostgreSQL Primary', 4.0, 1.0, 2.30, '2026-05-01', 'passed', 's3://insureportal-backups/pg/', 'streaming_replication', 'healthy', '2026-06-05 04:06:31.183755');
INSERT INTO public.disaster_recovery_config VALUES (2, 'Redis Cache', 0.5, 0.0, 0.10, '2026-05-15', 'passed', 's3://insureportal-backups/redis/', 'sentinel_failover', 'healthy', '2026-06-05 04:06:31.183755');
INSERT INTO public.disaster_recovery_config VALUES (3, 'Application Servers', 2.0, 0.0, NULL, '2026-05-10', 'passed', NULL, 'blue_green', 'healthy', '2026-06-05 04:06:31.183755');
INSERT INTO public.disaster_recovery_config VALUES (4, 'File Storage', 8.0, 4.0, 45.00, '2026-04-20', 'passed', 's3://insureportal-backups/files/', 'cross_region', 'healthy', '2026-06-05 04:06:31.183755');
INSERT INTO public.disaster_recovery_config VALUES (5, 'Kafka Cluster', 1.0, 0.5, 1.50, '2026-05-18', 'passed', NULL, 'multi_az', 'healthy', '2026-06-05 04:06:31.183755');
INSERT INTO public.disaster_recovery_config VALUES (6, 'ML Model Registry', 12.0, 8.0, NULL, '2026-04-01', 'passed', 's3://insureportal-backups/models/', 'cold_standby', 'healthy', '2026-06-05 04:06:31.183755');


--
-- Data for Name: dispute_evidence; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.dispute_evidence VALUES (1, 1, 'dispute evidence 1', '/uploads/dispute_evidence/1.pdf', 'dispute_evidence_key_1_045af7325c381f548a4db64b7f3258fd', 'standard', 1, 'dispute evidence 1', '2026-05-29 14:49:33.685528');
INSERT INTO public.dispute_evidence VALUES (2, 2, 'dispute evidence 2', '/uploads/dispute_evidence/2.pdf', 'dispute_evidence_key_2_c0a8d9ce450b201774a0bc2268dbf641', 'standard', 2, 'dispute evidence 2', '2026-05-22 14:49:33.685528');
INSERT INTO public.dispute_evidence VALUES (3, 3, 'dispute evidence 3', '/uploads/dispute_evidence/3.pdf', 'dispute_evidence_key_3_fd506accc9cbfa6ef336944d8cdaa362', 'standard', 3, 'dispute evidence 3', '2026-05-15 14:49:33.685528');


--
-- Data for Name: dispute_messages; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.dispute_messages VALUES (1, 1, 1, 'dispute messages 1', 'dispute messages 1', 'Sample data for dispute_messages record 1', '2026-05-29 14:49:33.68979', 'standard', 'dispute messages 1', 'Sample data for dispute_messages record 1', '/uploads/dispute_messages/1.pdf');
INSERT INTO public.dispute_messages VALUES (2, 2, 2, 'dispute messages 2', 'dispute messages 2', 'Sample data for dispute_messages record 2', '2026-05-22 14:49:33.68979', 'standard', 'dispute messages 2', 'Sample data for dispute_messages record 2', '/uploads/dispute_messages/2.pdf');
INSERT INTO public.dispute_messages VALUES (3, 3, 3, 'dispute messages 3', 'dispute messages 3', 'Sample data for dispute_messages record 3', '2026-05-15 14:49:33.68979', 'standard', 'dispute messages 3', 'Sample data for dispute_messages record 3', '/uploads/dispute_messages/3.pdf');


--
-- Data for Name: disputes; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.disputes VALUES (1, 'DIS-2026-001', 1, 'DIS-2026-001', 7, 'Sample data for disputes record 1', 'disputes 1', 'active', 'disputes 1', 'disputes 1', '2026-05-29 14:49:33.694161', '2026-05-29 14:49:33.694161', '2026-05-29 14:49:33.694161', '2026-05-29 14:49:33.694161', 'standard', 'disputes 1', 'Sample data for disputes record 1', 'disputes 1', '2026-05-29 14:49:33.694161', 1, 50000.00, 'disputes 1');
INSERT INTO public.disputes VALUES (2, 'DIS-2026-002', 2, 'DIS-2026-002', 8, 'Sample data for disputes record 2', 'disputes 2', 'active', 'disputes 2', 'disputes 2', '2026-05-22 14:49:33.694161', '2026-05-22 14:49:33.694161', '2026-05-22 14:49:33.694161', '2026-05-22 14:49:33.694161', 'standard', 'disputes 2', 'Sample data for disputes record 2', 'disputes 2', '2026-05-22 14:49:33.694161', 2, 100000.00, 'disputes 2');
INSERT INTO public.disputes VALUES (3, 'DIS-2026-003', 3, 'DIS-2026-003', 9, 'Sample data for disputes record 3', 'disputes 3', 'active', 'disputes 3', 'disputes 3', '2026-05-15 14:49:33.694161', '2026-05-15 14:49:33.694161', '2026-05-15 14:49:33.694161', '2026-05-15 14:49:33.694161', 'standard', 'disputes 3', 'Sample data for disputes record 3', 'disputes 3', '2026-05-15 14:49:33.694161', 3, 150000.00, 'disputes 3');


--
-- Data for Name: dlq_messages; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.dlq_messages VALUES (1, 'dlq messages 1', 1, 'dlq messages 1', 'Sample data for dlq_messages record 1', 5, 'dlq messages 1', 'active', '2026-05-29 14:49:33.699453', '2026-05-29 14:49:33.699453');
INSERT INTO public.dlq_messages VALUES (2, 'dlq messages 2', 2, 'dlq messages 2', 'Sample data for dlq_messages record 2', 10, 'dlq messages 2', 'active', '2026-05-22 14:49:33.699453', '2026-05-22 14:49:33.699453');
INSERT INTO public.dlq_messages VALUES (3, 'dlq messages 3', 3, 'dlq messages 3', 'Sample data for dlq_messages record 3', 15, 'dlq messages 3', 'active', '2026-05-15 14:49:33.699453', '2026-05-15 14:49:33.699453');


--
-- Data for Name: documents; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.documents VALUES (1, 1, 'policy', 1, 'certificate', 'motor_certificate.pdf', '/documents/certificates/POL-2026-MTR-00001.pdf', 245000, 'application/pdf', 'active', '2026-01-04 17:10:58.679709', '2026-06-04 17:10:58.679709');
INSERT INTO public.documents VALUES (2, 2, 'policy', 5, 'id_card', 'health_insurance_card.pdf', '/documents/cards/POL-2026-HLT-00001.pdf', 180000, 'application/pdf', 'active', '2025-12-04 17:10:58.679709', '2026-06-04 17:10:58.679709');
INSERT INTO public.documents VALUES (3, 9, 'policy', 8, 'schedule', 'property_schedule.pdf', '/documents/schedules/POL-2026-PRP-00001.pdf', 350000, 'application/pdf', 'active', '2025-12-04 17:10:58.679709', '2026-06-04 17:10:58.679709');
INSERT INTO public.documents VALUES (4, 1, 'policy', 10, 'policy_document', 'life_policy.pdf', '/documents/policies/POL-2026-LIF-00001.pdf', 520000, 'application/pdf', 'active', '2025-06-04 17:10:58.679709', '2026-06-04 17:10:58.679709');
INSERT INTO public.documents VALUES (5, 14, 'policy', 12, 'policy_document', 'group_life_master.pdf', '/documents/policies/POL-2026-GRP-00001.pdf', 780000, 'application/pdf', 'active', '2025-12-04 17:10:58.679709', '2026-06-04 17:10:58.679709');
INSERT INTO public.documents VALUES (6, 5, 'filing', 1, 'regulatory', 'naicom_q1_2026.pdf', '/documents/naicom/QR_Q1_2026.pdf', 1200000, 'application/pdf', 'submitted', '2026-04-04 17:10:58.679709', '2026-06-04 17:10:58.679709');
INSERT INTO public.documents VALUES (7, 7, 'treaty', 1, 'treaty_document', 'africa_re_treaty.pdf', '/documents/reinsurance/TREATY_2026_001.pdf', 450000, 'application/pdf', 'active', '2025-12-04 17:10:58.679709', '2026-06-04 17:10:58.679709');
INSERT INTO public.documents VALUES (8, 6, 'report', 1, 'actuarial_report', 'valuation_2025.pdf', '/documents/actuarial/VALUATION_2025.pdf', 2100000, 'application/pdf', 'active', '2026-03-04 17:10:58.679709', '2026-06-04 17:10:58.679709');


--
-- Data for Name: dynamic_pricing_history; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.dynamic_pricing_history VALUES (1, 1, 'Motor Third Party', 20000.00, 25000.00, 65, 'QT-2026-00001', '2026-01-04 17:10:58.685757');
INSERT INTO public.dynamic_pricing_history VALUES (2, 2, 'Health Individual', 70000.00, 85000.00, 72, 'QT-2026-00002', '2025-12-04 17:10:58.685757');
INSERT INTO public.dynamic_pricing_history VALUES (3, 9, 'Motor Fleet', 380000.00, 450000.00, 55, 'QT-2026-00003', '2026-03-04 17:10:58.685757');
INSERT INTO public.dynamic_pricing_history VALUES (4, 9, 'Property Commercial', 280000.00, 350000.00, 48, 'QT-2026-00004', '2025-12-04 17:10:58.685757');
INSERT INTO public.dynamic_pricing_history VALUES (5, 5, 'Agricultural Multi-Peril', 60000.00, 75000.00, 78, 'QT-2026-00005', '2026-04-04 17:10:58.685757');
INSERT INTO public.dynamic_pricing_history VALUES (6, 6, 'Parametric Weather', 6000.00, 8000.00, 42, 'QT-2026-00006', '2026-05-04 17:10:58.685757');
INSERT INTO public.dynamic_pricing_history VALUES (7, 14, 'Group Life', 12000000.00, 15000000.00, 35, 'QT-2026-00007', '2025-12-04 17:10:58.685757');
INSERT INTO public.dynamic_pricing_history VALUES (8, 12, 'Life Whole', 200000.00, 250000.00, 58, 'QT-2026-00008', '2023-12-04 17:10:58.685757');


--
-- Data for Name: email_delivery_log; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.email_delivery_log VALUES (1, 1, 'sendgrid', '1', 'email_delivery_log 1', 'email_delivery_log 1', 'email_delivery_log 1', '2026-05-29 14:50:04.726489', '2026-05-29 14:50:04.726489', '2026-05-29 14:50:04.726489', 'email_delivery_log 1', '{"data": "sample_1"}', '2026-05-29 14:50:04.726489');
INSERT INTO public.email_delivery_log VALUES (2, 2, 'ses', '2', 'email_delivery_log 2', 'email_delivery_log 2', 'email_delivery_log 2', '2026-05-22 14:50:04.726489', '2026-05-22 14:50:04.726489', '2026-05-22 14:50:04.726489', 'email_delivery_log 2', '{"data": "sample_2"}', '2026-05-22 14:50:04.726489');
INSERT INTO public.email_delivery_log VALUES (3, 3, 'smtp', '3', 'email_delivery_log 3', 'email_delivery_log 3', 'email_delivery_log 3', '2026-05-15 14:50:04.726489', '2026-05-15 14:50:04.726489', '2026-05-15 14:50:04.726489', 'email_delivery_log 3', '{"data": "sample_3"}', '2026-05-15 14:50:04.726489');


--
-- Data for Name: email_queue; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.email_queue VALUES (1, 'email_queue 1', 'email_queue 1', 'email_queue 1', 'email_queue 1', '{"data": "sample_1"}', 'queued', '2026-05-29 14:50:04.730562', 'email_queue 1', 2, 1, '2026-05-29 14:50:04.730562');
INSERT INTO public.email_queue VALUES (2, 'email_queue 2', 'email_queue 2', 'email_queue 2', 'email_queue 2', '{"data": "sample_2"}', 'sent', '2026-05-22 14:50:04.730562', 'email_queue 2', 4, 2, '2026-05-22 14:50:04.730562');
INSERT INTO public.email_queue VALUES (3, 'email_queue 3', 'email_queue 3', 'email_queue 3', 'email_queue 3', '{"data": "sample_3"}', 'failed', '2026-05-15 14:50:04.730562', 'email_queue 3', 6, 3, '2026-05-15 14:50:04.730562');


--
-- Data for Name: embedded_distribution; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.embedded_distribution VALUES (1, 'E-commerce Checkout', 'Jumia Nigeria', 'API', '{gadget,shipping}', 2500, 12500000.00, 15.00, 'active', 'v2', '2026-06-05 04:06:31.26298');
INSERT INTO public.embedded_distribution VALUES (2, 'Ride-Hailing', 'Bolt Nigeria', 'SDK', '{motor_tpl,personal_accident}', 8000, 40000000.00, 12.00, 'active', 'v2', '2026-06-05 04:06:31.26298');
INSERT INTO public.embedded_distribution VALUES (3, 'Banking App', 'GTBank', 'API', '{health,life,savings}', 3200, 64000000.00, 8.00, 'active', 'v3', '2026-06-05 04:06:31.26298');
INSERT INTO public.embedded_distribution VALUES (4, 'Telecom Bundle', 'MTN Nigeria', 'USSD', '{micro_health,device_protection}', 15000, 37500000.00, 20.00, 'active', 'v1', '2026-06-05 04:06:31.26298');
INSERT INTO public.embedded_distribution VALUES (5, 'Travel Booking', 'Wakanow', 'API', '{travel,flight_delay}', 1800, 27000000.00, 18.00, 'active', 'v2', '2026-06-05 04:06:31.26298');
INSERT INTO public.embedded_distribution VALUES (6, 'Salary Advance', 'Piggyvest', 'SDK', '{credit_life,income_protection}', 950, 14250000.00, 10.00, 'pilot', 'v1', '2026-06-05 04:06:31.26298');


--
-- Data for Name: embedded_partners; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.embedded_partners VALUES (6, 'Jumia Nigeria', 'e-commerce', 'API', 'https://api.jumia.com.ng/insurance', 'active', 2500000.00, 1500, '2026-06-05 00:27:58.242055');
INSERT INTO public.embedded_partners VALUES (7, 'Kuda Bank', 'neobank', 'SDK', 'https://api.kudabank.com/insurance', 'active', 5000000.00, 3200, '2026-06-05 00:27:58.242055');
INSERT INTO public.embedded_partners VALUES (8, 'Bolt Nigeria', 'ride-hailing', 'webhook', 'https://api.bolt.eu/ng/insurance', 'active', 1800000.00, 8500, '2026-06-05 00:27:58.242055');
INSERT INTO public.embedded_partners VALUES (9, 'Flutterwave', 'fintech', 'API', 'https://api.flutterwave.com/insurance', 'pending', 0.00, 0, '2026-06-05 00:27:58.242055');
INSERT INTO public.embedded_partners VALUES (10, 'PiggyVest', 'savings', 'SDK', 'https://api.piggyvest.com/insurance', 'active', 1200000.00, 2100, '2026-06-05 00:27:58.242055');


--
-- Data for Name: emergency_incidents; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.emergency_incidents VALUES (1, 1, 'Motor Accident', 6.4281000, 3.5023000, 'Collision on Lekki-Epe Expressway near Chevron', 'resolved', NULL, NULL, '2026-05-21 17:10:58.687039');
INSERT INTO public.emergency_incidents VALUES (2, 4, 'Medical Emergency', 4.8156000, 7.0498000, 'Severe allergic reaction requiring ambulance dispatch', 'resolved', NULL, NULL, '2026-05-04 17:10:58.687039');
INSERT INTO public.emergency_incidents VALUES (3, 9, 'Property Fire', 6.4311000, 3.4197000, 'Office fire on 3rd floor. Fire service dispatched.', 'active', NULL, NULL, '2026-06-01 17:10:58.687039');


--
-- Data for Name: encrypted_fields; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.encrypted_fields VALUES (1, 'encrypted fields 1', 'encrypted fields 1', '1', 'encrypted fields 1', '2026-05-29 14:49:33.743182', true, '2026-05-29 14:49:33.743182');
INSERT INTO public.encrypted_fields VALUES (2, 'encrypted fields 2', 'encrypted fields 2', '2', 'encrypted fields 2', '2026-05-22 14:49:33.743182', false, '2026-05-22 14:49:33.743182');
INSERT INTO public.encrypted_fields VALUES (3, 'encrypted fields 3', 'encrypted fields 3', '3', 'encrypted fields 3', '2026-05-15 14:49:33.743182', false, '2026-05-15 14:49:33.743182');


--
-- Data for Name: erp_config; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.erp_config VALUES (1, 'erpnext', 'ERPNext Production', 'https://erp.insureportal.ng', 'erp_api_key_placeholder', '', '', '{}', true, 60, true, true, false, '2026-06-04 18:35:04.991', 'success', NULL, 26, '2025-06-04 17:07:58.341819', '2026-06-04 18:35:04.992069');


--
-- Data for Name: erp_sync_log; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.erp_sync_log VALUES (1, 'erp_sync_log 1', '1', 'erp_sync_log 1', 'erp_sync_log 1', 'pending', 'erp_sync_log 1', '{"data": "sample_1"}', '2026-05-29 14:50:04.734307', '2026-05-29 14:50:04.734307', 2, 1, '2026-05-29 14:50:04.734307');
INSERT INTO public.erp_sync_log VALUES (2, 'erp_sync_log 2', '2', 'erp_sync_log 2', 'erp_sync_log 2', 'synced', 'erp_sync_log 2', '{"data": "sample_2"}', '2026-05-22 14:50:04.734307', '2026-05-22 14:50:04.734307', 4, 2, '2026-05-22 14:50:04.734307');
INSERT INTO public.erp_sync_log VALUES (3, 'erp_sync_log 3', '3', 'erp_sync_log 3', 'erp_sync_log 3', 'failed', 'erp_sync_log 3', '{"data": "sample_3"}', '2026-05-15 14:50:04.734307', '2026-05-15 14:50:04.734307', 6, 3, '2026-05-15 14:50:04.734307');


--
-- Data for Name: erpnext_reconciliation; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.erpnext_reconciliation VALUES (1, 1, 'erp 1', 50000.00, 50000.00, 1.50, 'erpnext_reconciliati 1', '2026-05-29 14:50:04.737991', '2026-05-29 14:50:04.737991');
INSERT INTO public.erpnext_reconciliation VALUES (2, 2, 'erp 2', 100000.00, 100000.00, 3.00, 'erpnext_reconciliati 2', '2026-05-22 14:50:04.737991', '2026-05-22 14:50:04.737991');
INSERT INTO public.erpnext_reconciliation VALUES (3, 3, 'erp 3', 150000.00, 150000.00, 4.50, 'erpnext_reconciliati 3', '2026-05-15 14:50:04.737991', '2026-05-15 14:50:04.737991');


--
-- Data for Name: erpnext_transactions; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.erpnext_transactions VALUES (1, 1, 'Sales Invoice', 'SI-2026-00001', 'policy', '1', 'Synced', 25000.00, 'NGN', '2026-01-04 17:10:58.678627', NULL, '2026-01-04 17:10:58.678627', '2026-06-04 17:10:58.678627');
INSERT INTO public.erpnext_transactions VALUES (2, 1, 'Sales Invoice', 'SI-2026-00002', 'policy', '2', 'Synced', 185000.00, 'NGN', '2026-02-04 17:10:58.678627', NULL, '2026-02-04 17:10:58.678627', '2026-06-04 17:10:58.678627');
INSERT INTO public.erpnext_transactions VALUES (3, 2, 'Sales Invoice', 'SI-2026-00003', 'policy', '5', 'Synced', 85000.00, 'NGN', '2025-12-04 17:10:58.678627', NULL, '2025-12-04 17:10:58.678627', '2026-06-04 17:10:58.678627');
INSERT INTO public.erpnext_transactions VALUES (4, 3, 'Payment Entry', 'PE-2026-00001', 'claim', '2', 'Synced', 175000.00, 'NGN', '2026-05-04 17:10:58.678627', NULL, '2026-05-04 17:10:58.678627', '2026-06-04 17:10:58.678627');
INSERT INTO public.erpnext_transactions VALUES (5, 3, 'Payment Entry', 'PE-2026-00002', 'claim', '4', 'Synced', 92000.00, 'NGN', '2026-03-04 17:10:58.678627', NULL, '2026-03-04 17:10:58.678627', '2026-06-04 17:10:58.678627');
INSERT INTO public.erpnext_transactions VALUES (6, 7, 'Journal Entry', 'JE-2026-00001', 'treaty', '1', 'Synced', 245000000.00, 'NGN', '2025-12-04 17:10:58.678627', NULL, '2025-12-04 17:10:58.678627', '2026-06-04 17:10:58.678627');
INSERT INTO public.erpnext_transactions VALUES (7, 14, 'Sales Invoice', 'SI-2026-00004', 'policy', '12', 'Pending', 15000000.00, 'NGN', NULL, NULL, '2025-12-04 17:10:58.678627', '2026-06-04 17:10:58.678627');
INSERT INTO public.erpnext_transactions VALUES (8, 6, 'Payment Entry', 'PE-2026-00005', 'claim', '12', 'Synced', 100000.00, 'NGN', '2026-05-28 17:10:58.678627', NULL, '2026-05-28 17:10:58.678627', '2026-06-04 17:10:58.678627');
INSERT INTO public.erpnext_transactions VALUES (9, 1, 'Sales Invoice', 'SI-2026-00003', 'policy', '3', 'Synced', 25000.00, 'NGN', '2026-06-04 18:35:04.960644', NULL, '2026-06-04 18:35:04.960644', '2026-06-04 18:35:04.960644');
INSERT INTO public.erpnext_transactions VALUES (10, 1, 'Sales Invoice', 'SI-2026-00004', 'policy', '4', 'Synced', 450000.00, 'NGN', '2026-06-04 18:35:04.963939', NULL, '2026-06-04 18:35:04.963939', '2026-06-04 18:35:04.963939');
INSERT INTO public.erpnext_transactions VALUES (11, 1, 'Sales Invoice', 'SI-2026-00006', 'policy', '6', 'Synced', 25000.00, 'NGN', '2026-06-04 18:35:04.965911', NULL, '2026-06-04 18:35:04.965911', '2026-06-04 18:35:04.965911');
INSERT INTO public.erpnext_transactions VALUES (12, 1, 'Sales Invoice', 'SI-2026-00007', 'policy', '7', 'Synced', 2500000.00, 'NGN', '2026-06-04 18:35:04.967143', NULL, '2026-06-04 18:35:04.967143', '2026-06-04 18:35:04.967143');
INSERT INTO public.erpnext_transactions VALUES (13, 1, 'Sales Invoice', 'SI-2026-00008', 'policy', '8', 'Synced', 350000.00, 'NGN', '2026-06-04 18:35:04.968279', NULL, '2026-06-04 18:35:04.968279', '2026-06-04 18:35:04.968279');
INSERT INTO public.erpnext_transactions VALUES (14, 1, 'Sales Invoice', 'SI-2026-00009', 'policy', '9', 'Synced', 45000.00, 'NGN', '2026-06-04 18:35:04.969496', NULL, '2026-06-04 18:35:04.969496', '2026-06-04 18:35:04.969496');
INSERT INTO public.erpnext_transactions VALUES (15, 1, 'Sales Invoice', 'SI-2026-00010', 'policy', '10', 'Synced', 120000.00, 'NGN', '2026-06-04 18:35:04.970574', NULL, '2026-06-04 18:35:04.970574', '2026-06-04 18:35:04.970574');
INSERT INTO public.erpnext_transactions VALUES (16, 1, 'Sales Invoice', 'SI-2026-00011', 'policy', '11', 'Synced', 250000.00, 'NGN', '2026-06-04 18:35:04.971761', NULL, '2026-06-04 18:35:04.971761', '2026-06-04 18:35:04.971761');
INSERT INTO public.erpnext_transactions VALUES (17, 1, 'Sales Invoice', 'SI-2026-00013', 'policy', '13', 'Synced', 3500.00, 'NGN', '2026-06-04 18:35:04.972849', NULL, '2026-06-04 18:35:04.972849', '2026-06-04 18:35:04.972849');
INSERT INTO public.erpnext_transactions VALUES (18, 1, 'Sales Invoice', 'SI-2026-00014', 'policy', '14', 'Synced', 2000.00, 'NGN', '2026-06-04 18:35:04.973867', NULL, '2026-06-04 18:35:04.973867', '2026-06-04 18:35:04.973867');
INSERT INTO public.erpnext_transactions VALUES (19, 1, 'Sales Invoice', 'SI-2026-00015', 'policy', '15', 'Synced', 75000.00, 'NGN', '2026-06-04 18:35:04.974959', NULL, '2026-06-04 18:35:04.974959', '2026-06-04 18:35:04.974959');
INSERT INTO public.erpnext_transactions VALUES (20, 1, 'Sales Invoice', 'SI-2026-00016', 'policy', '16', 'Synced', 120000.00, 'NGN', '2026-06-04 18:35:04.975908', NULL, '2026-06-04 18:35:04.975908', '2026-06-04 18:35:04.975908');
INSERT INTO public.erpnext_transactions VALUES (21, 1, 'Sales Invoice', 'SI-2026-00017', 'policy', '17', 'Synced', 8000.00, 'NGN', '2026-06-04 18:35:04.976895', NULL, '2026-06-04 18:35:04.976895', '2026-06-04 18:35:04.976895');
INSERT INTO public.erpnext_transactions VALUES (22, 1, 'Sales Invoice', 'SI-2026-00020', 'policy', '20', 'Synced', 95000.00, 'NGN', '2026-06-04 18:35:04.977801', NULL, '2026-06-04 18:35:04.977801', '2026-06-04 18:35:04.977801');
INSERT INTO public.erpnext_transactions VALUES (23, 1, 'Payment Entry', 'PE-2026-00001', 'claim', '1', 'Synced', 5000.00, 'NGN', '2026-06-04 18:35:04.979509', NULL, '2026-06-04 18:35:04.979509', '2026-06-04 18:35:04.979509');
INSERT INTO public.erpnext_transactions VALUES (24, 1, 'Payment Entry', 'PE-2026-00101', 'claim', '101', 'Synced', 180000.00, 'NGN', '2026-06-04 18:35:04.980489', NULL, '2026-06-04 18:35:04.980489', '2026-06-04 18:35:04.980489');
INSERT INTO public.erpnext_transactions VALUES (25, 1, 'Payment Entry', 'PE-2026-00103', 'claim', '103', 'Synced', 95000.00, 'NGN', '2026-06-04 18:35:04.981479', NULL, '2026-06-04 18:35:04.981479', '2026-06-04 18:35:04.981479');
INSERT INTO public.erpnext_transactions VALUES (26, 1, 'Payment Entry', 'PE-2026-00105', 'claim', '105', 'Synced', 3500000.00, 'NGN', '2026-06-04 18:35:04.982534', NULL, '2026-06-04 18:35:04.982534', '2026-06-04 18:35:04.982534');
INSERT INTO public.erpnext_transactions VALUES (27, 1, 'Payment Entry', 'PE-2026-00109', 'claim', '109', 'Synced', 750000.00, 'NGN', '2026-06-04 18:35:04.983514', NULL, '2026-06-04 18:35:04.983514', '2026-06-04 18:35:04.983514');
INSERT INTO public.erpnext_transactions VALUES (28, 1, 'Payment Entry', 'PE-2026-00111', 'claim', '111', 'Synced', 100000.00, 'NGN', '2026-06-04 18:35:04.984374', NULL, '2026-06-04 18:35:04.984374', '2026-06-04 18:35:04.984374');
INSERT INTO public.erpnext_transactions VALUES (29, 1, 'Sales Partner', 'SP-00001', 'agent', '1', 'Synced', 0.00, 'NGN', '2026-06-04 18:35:04.985811', NULL, '2026-06-04 18:35:04.985811', '2026-06-04 18:35:04.985811');
INSERT INTO public.erpnext_transactions VALUES (30, 1, 'Sales Partner', 'SP-00002', 'agent', '2', 'Synced', 0.00, 'NGN', '2026-06-04 18:35:04.987172', NULL, '2026-06-04 18:35:04.987172', '2026-06-04 18:35:04.987172');
INSERT INTO public.erpnext_transactions VALUES (31, 1, 'Sales Partner', 'SP-00003', 'agent', '3', 'Synced', 0.00, 'NGN', '2026-06-04 18:35:04.988147', NULL, '2026-06-04 18:35:04.988147', '2026-06-04 18:35:04.988147');
INSERT INTO public.erpnext_transactions VALUES (32, 1, 'Sales Partner', 'SP-00004', 'agent', '4', 'Synced', 0.00, 'NGN', '2026-06-04 18:35:04.989077', NULL, '2026-06-04 18:35:04.989077', '2026-06-04 18:35:04.989077');
INSERT INTO public.erpnext_transactions VALUES (33, 1, 'Sales Partner', 'SP-00005', 'agent', '5', 'Synced', 0.00, 'NGN', '2026-06-04 18:35:04.9902', NULL, '2026-06-04 18:35:04.9902', '2026-06-04 18:35:04.9902');
INSERT INTO public.erpnext_transactions VALUES (34, 1, 'Sales Partner', 'SP-00006', 'agent', '6', 'Synced', 0.00, 'NGN', '2026-06-04 18:35:04.991252', NULL, '2026-06-04 18:35:04.991252', '2026-06-04 18:35:04.991252');


--
-- Data for Name: face_enrollments; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.face_enrollments VALUES (1, 1, 'standard', 'face enrollments 1', 'face enrollments 1', 1.5000, 1.5000, 1.5000, 'face_enrollments_key_1_916d428ad718a01b0c3e7af689001759', 'face enrollments 1', '1 Insurance Road, Lagos', true, '2026-05-29 14:49:33.78289', 'Sample data for face_enrollments record 1', '2026-07-05 14:49:33.78289', 1, '2026-05-29 14:49:33.78289', '2026-05-29 14:49:33.78289');
INSERT INTO public.face_enrollments VALUES (2, 2, 'standard', 'face enrollments 2', 'face enrollments 2', 3.0000, 3.0000, 3.0000, 'face_enrollments_key_2_21cee8c5e47d4e1d96c40dffb8b1f40b', 'face enrollments 2', '2 Insurance Road, Lagos', false, '2026-05-22 14:49:33.78289', 'Sample data for face_enrollments record 2', '2026-08-04 14:49:33.78289', 2, '2026-05-22 14:49:33.78289', '2026-05-22 14:49:33.78289');
INSERT INTO public.face_enrollments VALUES (3, 3, 'standard', 'face enrollments 3', 'face enrollments 3', 4.5000, 4.5000, 4.5000, 'face_enrollments_key_3_d41acba23a14f014d2fdd6a0eb3ce67a', 'face enrollments 3', '3 Insurance Road, Lagos', false, '2026-05-15 14:49:33.78289', 'Sample data for face_enrollments record 3', '2026-09-03 14:49:33.78289', 3, '2026-05-15 14:49:33.78289', '2026-05-15 14:49:33.78289');


--
-- Data for Name: family_members; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.family_members VALUES (1, 2, 'Emeka Nnamdi', 'Spouse', '1988-03-10 00:00:00', 'male', 5, 'active', '2025-12-04 17:10:58.690366');
INSERT INTO public.family_members VALUES (2, 2, 'Ada Nnamdi', 'Child', '2015-09-22 00:00:00', 'female', 5, 'active', '2025-12-04 17:10:58.690366');
INSERT INTO public.family_members VALUES (3, 2, 'Chukwuemeka Nnamdi', 'Child', '2018-12-05 00:00:00', 'male', 5, 'active', '2025-12-04 17:10:58.690366');
INSERT INTO public.family_members VALUES (4, 2, 'Obiageli Nnamdi', 'Child', '2021-04-18 00:00:00', 'female', 5, 'active', '2025-12-04 17:10:58.690366');
INSERT INTO public.family_members VALUES (5, 1, 'Kemi Ogundimu', 'Spouse', '1987-08-20 00:00:00', 'female', 10, 'active', '2025-06-04 17:10:58.690366');
INSERT INTO public.family_members VALUES (6, 1, 'Tunde Ogundimu', 'Child', '2012-01-15 00:00:00', 'male', 10, 'active', '2025-06-04 17:10:58.690366');


--
-- Data for Name: fee_audit_trail; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.fee_audit_trail VALUES (1, 1, 1, 50000.00, 6.46, 1.50, true, 'Sample data for fee_audit_trail record 1', '2026-05-29 14:49:33.78902');
INSERT INTO public.fee_audit_trail VALUES (2, 2, 2, 100000.00, 6.47, 3.00, false, 'Sample data for fee_audit_trail record 2', '2026-05-22 14:49:33.78902');
INSERT INTO public.fee_audit_trail VALUES (3, 3, 3, 150000.00, 6.48, 4.50, false, 'Sample data for fee_audit_trail record 3', '2026-05-15 14:49:33.78902');


--
-- Data for Name: fee_rules; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.fee_rules VALUES (1, 'NAICOM Levy', 'premium', 'all', 0.00, 999999999.00, 'percentage', 1.0000, 100.00, 50000.00, false, NULL, NULL, true, 1, NULL, '2025-06-05 13:10:21.00315', '2026-06-05 13:10:21.00315');
INSERT INTO public.fee_rules VALUES (2, 'Stamp Duty', 'policy', 'all', 0.00, 999999999.00, 'flat', 50.0000, 50.00, 50.00, false, NULL, NULL, true, 2, NULL, '2025-06-05 13:10:21.00315', '2026-06-05 13:10:21.00315');
INSERT INTO public.fee_rules VALUES (3, 'Processing Fee', 'claim_payout', 'all', 0.00, 999999999.00, 'percentage', 0.5000, 50.00, 5000.00, false, NULL, NULL, true, 3, NULL, '2025-12-07 13:10:21.00315', '2026-06-05 13:10:21.00315');
INSERT INTO public.fee_rules VALUES (4, 'Late Payment Penalty', 'overdue_premium', 'all', 0.00, 999999999.00, 'percentage', 2.5000, 1000.00, 100000.00, false, NULL, NULL, true, 4, NULL, '2025-12-07 13:10:21.00315', '2026-06-05 13:10:21.00315');


--
-- Data for Name: fido2_challenges; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.fido2_challenges VALUES (9, 'fido2_challenge 1', 1, 1, 'fido2_challenge 1', '2026-05-29 14:50:36.422179', '2026-05-29 14:50:36.422179', '2026-05-29 14:50:36.422179');
INSERT INTO public.fido2_challenges VALUES (10, 'fido2_challenge 2', 2, 2, 'fido2_challenge 2', '2026-05-22 14:50:36.422179', '2026-05-22 14:50:36.422179', '2026-05-22 14:50:36.422179');
INSERT INTO public.fido2_challenges VALUES (11, 'fido2_challenge 3', 3, 3, 'fido2_challenge 3', '2026-05-15 14:50:36.422179', '2026-05-15 14:50:36.422179', '2026-05-15 14:50:36.422179');


--
-- Data for Name: fido2_credentials; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.fido2_credentials VALUES (5, 1, 1, '1', 'fido2_credentia 1', 1, 'fido2_credentia 1', '{"i":1}', 'active', '2026-05-29 14:50:36.42549', '2026-05-29 14:50:36.42549');
INSERT INTO public.fido2_credentials VALUES (6, 2, 2, '2', 'fido2_credentia 2', 2, 'fido2_credentia 2', '{"i":2}', 'revoked', '2026-05-22 14:50:36.42549', '2026-05-22 14:50:36.42549');
INSERT INTO public.fido2_credentials VALUES (7, 3, 3, '3', 'fido2_credentia 3', 3, 'fido2_credentia 3', '{"i":3}', 'active', '2026-05-15 14:50:36.42549', '2026-05-15 14:50:36.42549');


--
-- Data for Name: file_uploads; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.file_uploads VALUES (1, NULL, 'default', '1780677439015-e61ab49f4d89a4e3.txt', 'test-upload.txt', 'text/plain', 18, 'uploads/1780677439015-e61ab49f4d89a4e3.txt', 'local', 'test', NULL, '/uploads/1780677439015-e61ab49f4d89a4e3.txt', '2026-06-05 16:37:19.01876');
INSERT INTO public.file_uploads VALUES (2, NULL, 'default', '1780677498374-51b8e6da3d5d92a8.txt', 'test.txt', 'text/plain', 12, 'uploads/1780677498374-51b8e6da3d5d92a8.txt', 'local', NULL, NULL, '/uploads/1780677498374-51b8e6da3d5d92a8.txt', '2026-06-05 16:38:18.375679');
INSERT INTO public.file_uploads VALUES (3, NULL, 'default', '1780678089952-31dc33c84ecc4efb.txt', 'test-upload.txt', 'text/plain', 49, 'uploads/1780678089952-31dc33c84ecc4efb.txt', 'local', NULL, NULL, '/uploads/1780678089952-31dc33c84ecc4efb.txt', '2026-06-05 16:48:09.95373');
INSERT INTO public.file_uploads VALUES (4, NULL, 'default', '1780678131463-ca3993441ce78b48.txt', 'test-upload.txt', 'text/plain', 49, 'uploads/1780678131463-ca3993441ce78b48.txt', 'local', NULL, NULL, '/uploads/1780678131463-ca3993441ce78b48.txt', '2026-06-05 16:48:51.464938');
INSERT INTO public.file_uploads VALUES (5, NULL, 'default', '1780678775563-88a19221afcc4eb8.txt', 'test.txt', 'text/plain', 12, 'uploads/1780678775563-88a19221afcc4eb8.txt', 'local', NULL, NULL, '/uploads/1780678775563-88a19221afcc4eb8.txt', '2026-06-05 16:59:35.564541');
INSERT INTO public.file_uploads VALUES (6, NULL, 'default', '1780679073046-8ef5ef7674ab348e.txt', 'test.txt', 'text/plain', 12, 'uploads/1780679073046-8ef5ef7674ab348e.txt', 'local', NULL, NULL, '/uploads/1780679073046-8ef5ef7674ab348e.txt', '2026-06-05 17:04:33.048953');
INSERT INTO public.file_uploads VALUES (7, NULL, 'default', '1780680685702-87216cc63fd3213a.txt', 'test.txt', 'text/plain', 12, 'uploads/1780680685702-87216cc63fd3213a.txt', 'local', NULL, NULL, '/uploads/1780680685702-87216cc63fd3213a.txt', '2026-06-05 17:31:25.703784');


--
-- Data for Name: financial_metrics; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.financial_metrics VALUES (1, 'Gross Written Premium', 'kpi', '2026-Q2', 665000000.00, 580000000.00, 700000000.00, 14.65, 'premium', '2026-06-05 04:06:31.274299');
INSERT INTO public.financial_metrics VALUES (2, 'Net Earned Premium', 'kpi', '2026-Q2', 545000000.00, 470000000.00, 560000000.00, 15.96, 'premium', '2026-06-05 04:06:31.274299');
INSERT INTO public.financial_metrics VALUES (3, 'Combined Ratio', 'kpi', '2026-Q2', 92.50, 98.20, 95.00, -5.80, 'ratio', '2026-06-05 04:06:31.274299');
INSERT INTO public.financial_metrics VALUES (4, 'Loss Ratio', 'kpi', '2026-Q2', 62.20, 68.50, 65.00, -9.20, 'ratio', '2026-06-05 04:06:31.274299');
INSERT INTO public.financial_metrics VALUES (5, 'Expense Ratio', 'kpi', '2026-Q2', 30.30, 29.70, 30.00, 2.02, 'ratio', '2026-06-05 04:06:31.274299');
INSERT INTO public.financial_metrics VALUES (6, 'Solvency Margin', 'kpi', '2026-Q2', 185.00, 172.00, 150.00, 7.56, 'capital', '2026-06-05 04:06:31.274299');
INSERT INTO public.financial_metrics VALUES (7, 'Insurance Revenue', 'pnl', '2026-Q2', 545000000.00, NULL, NULL, NULL, 'revenue', '2026-06-05 04:06:31.274299');
INSERT INTO public.financial_metrics VALUES (8, 'Claims Incurred', 'pnl', '2026-Q2', -339000000.00, NULL, NULL, NULL, 'expense', '2026-06-05 04:06:31.274299');
INSERT INTO public.financial_metrics VALUES (9, 'Operating Expenses', 'pnl', '2026-Q2', -165000000.00, NULL, NULL, NULL, 'expense', '2026-06-05 04:06:31.274299');
INSERT INTO public.financial_metrics VALUES (10, 'Investment Income', 'pnl', '2026-Q2', 42000000.00, NULL, NULL, NULL, 'revenue', '2026-06-05 04:06:31.274299');
INSERT INTO public.financial_metrics VALUES (11, 'Net Profit', 'pnl', '2026-Q2', 83000000.00, 52000000.00, 75000000.00, 59.62, 'bottom_line', '2026-06-05 04:06:31.274299');
INSERT INTO public.financial_metrics VALUES (12, 'Premium Collections', 'cashflow', '2026-05', 125000000.00, 118000000.00, 120000000.00, 5.93, 'inflow', '2026-06-05 04:06:31.274299');
INSERT INTO public.financial_metrics VALUES (13, 'Claims Payouts', 'cashflow', '2026-05', -68000000.00, -72000000.00, -70000000.00, -5.56, 'outflow', '2026-06-05 04:06:31.274299');
INSERT INTO public.financial_metrics VALUES (14, 'Operating Costs', 'cashflow', '2026-05', -35000000.00, -33000000.00, -34000000.00, 6.06, 'outflow', '2026-06-05 04:06:31.274299');
INSERT INTO public.financial_metrics VALUES (15, 'Net Cash Position', 'cashflow', '2026-05', 22000000.00, 13000000.00, 16000000.00, 69.23, 'net', '2026-06-05 04:06:31.274299');
INSERT INTO public.financial_metrics VALUES (16, 'IBNR Reserve', 'reserve', '2026-Q2', 212500000.00, 195000000.00, NULL, 8.97, 'technical', '2026-06-05 04:06:31.274299');
INSERT INTO public.financial_metrics VALUES (17, 'Outstanding Claims Reserve', 'reserve', '2026-Q2', 864000000.00, 820000000.00, NULL, 5.37, 'technical', '2026-06-05 04:06:31.274299');
INSERT INTO public.financial_metrics VALUES (18, 'Unexpired Risk Reserve', 'reserve', '2026-Q2', 325000000.00, 310000000.00, NULL, 4.84, 'technical', '2026-06-05 04:06:31.274299');


--
-- Data for Name: financial_transactions; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.financial_transactions VALUES (1, 'premium_received', 'policy', 1, 'Bank - First Bank', 'Premium Revenue - Motor', 185000.00, 'NGN', 'Motor Comprehensive premium received', '2026-01-15', '2026-06-04 19:07:31.378717');
INSERT INTO public.financial_transactions VALUES (2, 'premium_received', 'policy', 2, 'Bank - Flutterwave', 'Premium Revenue - Health', 250000.00, 'NGN', 'Individual Health premium received', '2026-02-01', '2026-06-04 19:07:31.378717');
INSERT INTO public.financial_transactions VALUES (3, 'premium_received', 'policy', 3, 'Bank - Paystack', 'Premium Revenue - Motor', 45000.00, 'NGN', 'Motor TP premium received', '2026-01-20', '2026-06-04 19:07:31.378717');
INSERT INTO public.financial_transactions VALUES (4, 'premium_received', 'policy', 4, 'Bank - mPesa', 'Premium Revenue - Health', 65000.00, 'NGN', 'Health quarterly premium', '2026-03-01', '2026-06-04 19:07:31.378717');
INSERT INTO public.financial_transactions VALUES (5, 'premium_received', 'policy', 5, 'Bank - Paystack', 'Premium Revenue - Property', 120000.00, 'NGN', 'Fire insurance premium', '2026-03-15', '2026-06-04 19:07:31.378717');
INSERT INTO public.financial_transactions VALUES (6, 'claim_paid', 'claim', 1, 'Claims Expense - Motor', 'Bank - First Bank', 750000.00, 'NGN', 'Motor claim payment — accident repair', '2026-05-16', '2026-06-04 19:07:31.378717');
INSERT INTO public.financial_transactions VALUES (7, 'claim_paid', 'claim', 2, 'Claims Expense - Health', 'Bank - GTBank', 1200000.00, 'NGN', 'Health claim — hospitalization', '2026-05-20', '2026-06-04 19:07:31.378717');
INSERT INTO public.financial_transactions VALUES (8, 'claim_reserved', 'claim', 3, 'Claims Expense - Motor', 'Outstanding Claims Reserve', 450000.00, 'NGN', 'Reserve for pending motor claim', '2026-05-25', '2026-06-04 19:07:31.378717');
INSERT INTO public.financial_transactions VALUES (9, 'claim_reserved', 'claim', 4, 'Claims Expense - Property', 'Outstanding Claims Reserve', 2500000.00, 'NGN', 'Reserve for property claim', '2026-05-26', '2026-06-04 19:07:31.378717');
INSERT INTO public.financial_transactions VALUES (10, 'commission_paid', 'agent', 1, 'Commission Expense', 'Bank - Agency', 37000.00, 'NGN', 'Agent commission 20% on Motor Comp', '2026-01-20', '2026-06-04 19:07:31.378717');
INSERT INTO public.financial_transactions VALUES (11, 'commission_paid', 'agent', 2, 'Commission Expense', 'Bank - Agency', 25000.00, 'NGN', 'Agent commission 10% on Health', '2026-02-05', '2026-06-04 19:07:31.378717');
INSERT INTO public.financial_transactions VALUES (12, 'reinsurance_premium', 'treaty', 1, 'Reinsurance Premium Ceded', 'Bank - Reinsurer', 8500000.00, 'NGN', 'Quota share reinsurance premium Q1', '2026-03-31', '2026-06-04 19:07:31.378717');
INSERT INTO public.financial_transactions VALUES (13, 'reinsurance_recovery', 'claim', 1, 'Bank - Reinsurer', 'Reinsurance Recovery', 375000.00, 'NGN', 'Recovery on motor claim 50% QS', '2026-05-20', '2026-06-04 19:07:31.378717');
INSERT INTO public.financial_transactions VALUES (14, 'investment_income', NULL, NULL, 'Bank - Investment', 'Investment Income', 2500000.00, 'NGN', 'Q1 investment income on reserves', '2026-03-31', '2026-06-04 19:07:31.378717');
INSERT INTO public.financial_transactions VALUES (15, 'management_expense', NULL, NULL, 'Management Expense', 'Bank - Operations', 4500000.00, 'NGN', 'Q1 operating expenses', '2026-03-31', '2026-06-04 19:07:31.378717');
INSERT INTO public.financial_transactions VALUES (16, 'premium_received', 'policy', 22, 'Bank - Online', 'Premium Revenue', 25000.00, 'NGN', 'Premium payment via card', '2026-06-05', '2026-06-05 15:04:42.417465');


--
-- Data for Name: float_reconciliations; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.float_reconciliations VALUES (1, 7, '2026-05-29 14:49:33.82961', 1.50, 1.50, 1.50, 'active', 1, '2026-05-29 14:49:33.82961', 'Sample data for float_reconciliations record 1', '2026-05-29 14:49:33.82961');
INSERT INTO public.float_reconciliations VALUES (2, 8, '2026-05-22 14:49:33.82961', 3.00, 3.00, 3.00, 'active', 2, '2026-05-22 14:49:33.82961', 'Sample data for float_reconciliations record 2', '2026-05-22 14:49:33.82961');
INSERT INTO public.float_reconciliations VALUES (3, 9, '2026-05-15 14:49:33.82961', 4.50, 4.50, 4.50, 'active', 3, '2026-05-15 14:49:33.82961', 'Sample data for float_reconciliations record 3', '2026-05-15 14:49:33.82961');


--
-- Data for Name: float_topup_requests; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.float_topup_requests VALUES (1, 7, 50000.00, 'pending', 'float_topup_requests 1', 'float_topup_requests 1', '2026-05-29 14:50:04.78283', '2026-05-29 14:50:04.78283', true, 'float_topup_requests 1', '2026-05-29 14:50:04.78283', 1);
INSERT INTO public.float_topup_requests VALUES (2, 8, 100000.00, 'approved', 'float_topup_requests 2', 'float_topup_requests 2', '2026-05-22 14:50:04.78283', '2026-05-22 14:50:04.78283', false, 'float_topup_requests 2', '2026-05-22 14:50:04.78283', 2);
INSERT INTO public.float_topup_requests VALUES (3, 9, 150000.00, 'rejected', 'float_topup_requests 3', 'float_topup_requests 3', '2026-05-15 14:50:04.78283', '2026-05-15 14:50:04.78283', false, 'float_topup_requests 3', '2026-05-15 14:50:04.78283', 3);


--
-- Data for Name: fraud_alerts; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.fraud_alerts VALUES (1, 1, 'FRD-2026-001', 'high', 'claim', '1', '2 claims in 60 days on same policy. Staged accident pattern suspected.', false, '2026-02-04 17:10:58.681768', NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO public.fraud_alerts VALUES (2, 9, 'FRD-2026-002', 'medium', 'claim', '10', 'Fleet claim filed 3 weeks after policy inception. Short seasoning.', true, '2026-05-04 17:10:58.681768', '2026-05-21 17:10:58.681768', NULL, NULL, NULL, NULL, NULL);
INSERT INTO public.fraud_alerts VALUES (3, 7, 'FRD-2026-003', 'high', 'claim', '11', 'Veterinary certificates same signature across different clinics.', false, '2026-05-14 17:10:58.681768', NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO public.fraud_alerts VALUES (4, 12, 'FRD-2026-004', 'critical', 'claim', '7', 'Beneficiary changed 30 days before death claim filed.', false, '2026-04-04 17:10:58.681768', NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO public.fraud_alerts VALUES (5, 3, 'FRD-2026-005', 'medium', 'claim', '8', 'Hospital invoice in 2 claims from different policyholders.', true, '2026-03-04 17:10:58.681768', '2026-04-04 17:10:58.681768', NULL, NULL, NULL, NULL, NULL);
INSERT INTO public.fraud_alerts VALUES (6, 1, 'FRD-2026-006', 'high', 'claim', 'CLM-2026-014', 'Cluster of 4 claims from same postal code within 7 days', false, '2026-05-30 20:59:32.594751', NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO public.fraud_alerts VALUES (7, 1, 'FRD-2026-007', 'medium', 'policy', 'POL-2026-023', 'Policy upgraded 3 days before claim submission', false, '2026-06-01 20:59:32.594751', NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO public.fraud_alerts VALUES (8, 1, 'FRD-2026-008', 'critical', 'claim', 'CLM-2026-015', 'Same bank account linked to 6 different policyholders', false, '2026-06-03 20:59:32.594751', NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO public.fraud_alerts VALUES (9, 1, 'FRD-2026-009', 'low', 'agent', 'AGT-003', 'Agent submitted 12 policies with near-identical KYC documents', true, '2026-05-25 20:59:32.594751', NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO public.fraud_alerts VALUES (10, 1, 'FRD-2026-010', 'high', 'claim', 'CLM-2026-016', 'Vehicle VIN matches previously written-off vehicle', false, '2026-06-02 20:59:32.594751', NULL, NULL, NULL, NULL, NULL, NULL);


--
-- Data for Name: fraud_ml_scores; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.fraud_ml_scores VALUES (1, 1, 7, 1.50, 'fraud ml scores 1', 'fraud ml scores 1', 'fraud ml scores 1', 1.5000, true, 1, '2026-05-29 14:49:33.855305', '2026-05-29 14:49:33.855305');
INSERT INTO public.fraud_ml_scores VALUES (2, 2, 8, 3.00, 'fraud ml scores 2', 'fraud ml scores 2', 'fraud ml scores 2', 3.0000, false, 2, '2026-05-22 14:49:33.855305', '2026-05-22 14:49:33.855305');
INSERT INTO public.fraud_ml_scores VALUES (3, 3, 9, 4.50, 'fraud ml scores 3', 'fraud ml scores 3', 'fraud ml scores 3', 4.5000, false, 3, '2026-05-15 14:49:33.855305', '2026-05-15 14:49:33.855305');


--
-- Data for Name: fraud_rings; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.fraud_rings VALUES (1, 1, '1', 'Sample fraud_rings 1', 'active', 5, 1.50, '2026-05-29 14:49:33.859576', '2026-05-29 14:49:33.859576');
INSERT INTO public.fraud_rings VALUES (2, 2, '2', 'Sample fraud_rings 2', 'active', 10, 3.00, '2026-05-22 14:49:33.859576', '2026-05-22 14:49:33.859576');
INSERT INTO public.fraud_rings VALUES (3, 3, '3', 'Sample fraud_rings 3', 'active', 15, 4.50, '2026-05-15 14:49:33.859576', '2026-05-15 14:49:33.859576');


--
-- Data for Name: fraud_rules; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.fraud_rules VALUES (1, 'Sample 1', 'velocity', '102.89.1', 1.5000, 1, 2, true, 2, '2026-05-29 14:50:04.788068', 'fraud_rules 1', '2026-05-29 14:50:04.788068', '2026-05-29 14:50:04.788068');
INSERT INTO public.fraud_rules VALUES (2, 'Sample 2', 'geofence', '102.89.2', 3.0000, 2, 4, false, 4, '2026-05-22 14:50:04.788068', 'fraud_rules 2', '2026-05-22 14:50:04.788068', '2026-05-22 14:50:04.788068');
INSERT INTO public.fraud_rules VALUES (3, 'Sample 3', 'device_fingerprint', '102.89.3', 4.5000, 3, 6, false, 6, '2026-05-15 14:50:04.788068', 'fraud_rules 3', '2026-05-15 14:50:04.788068', '2026-05-15 14:50:04.788068');


--
-- Data for Name: fraud_scores; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.fraud_scores VALUES (1, 1, '1', 'fraud_scores 1', '1', 1.5000, 'low', 'allow', 1.5000, 1, '{item1}', '{item1}', '2026-05-29 14:50:04.792425');
INSERT INTO public.fraud_scores VALUES (2, 2, '2', 'fraud_scores 2', '2', 3.0000, 'medium', 'flag', 3.0000, 2, '{item2}', '{item2}', '2026-05-22 14:50:04.792425');
INSERT INTO public.fraud_scores VALUES (3, 3, '3', 'fraud_scores 3', '3', 4.5000, 'high', 'review', 4.5000, 3, '{item3}', '{item3}', '2026-05-15 14:50:04.792425');


--
-- Data for Name: gamification_levels; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.gamification_levels VALUES (1, 'Insurance Newbie', 1, 0, 'seedling', '{"Basic dashboard access"}', 'Just getting started with insurance');
INSERT INTO public.gamification_levels VALUES (2, 'Policy Holder', 2, 1000, 'shield', '{"5% renewal discount","Claims tracking"}', 'Active policy holder');
INSERT INTO public.gamification_levels VALUES (3, 'Smart Buyer', 3, 3000, 'lightbulb', '{"10% discount","Priority support"}', 'Multiple policies, smart decisions');
INSERT INTO public.gamification_levels VALUES (4, 'Insurance Pro', 4, 8000, 'star', '{"15% discount","Dedicated agent","Free add-ons"}', 'Experienced insurance customer');
INSERT INTO public.gamification_levels VALUES (5, 'Insurance Master', 5, 20000, 'crown', '{"20% discount","VIP lounge","Annual retreat","Family bonus"}', 'Elite customer with comprehensive coverage');


--
-- Data for Name: geo_fences; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.geo_fences VALUES (1, 'Sample geo_fences 1', 'GEO-2026-001', 6.4600000, 3.4100000, 1.50, true, '2026-05-29 14:49:33.897849');
INSERT INTO public.geo_fences VALUES (2, 'Sample geo_fences 2', 'GEO-2026-002', 6.4700000, 3.4200000, 3.00, false, '2026-05-22 14:49:33.897849');
INSERT INTO public.geo_fences VALUES (3, 'Sample geo_fences 3', 'GEO-2026-003', 6.4800000, 3.4300000, 4.50, false, '2026-05-15 14:49:33.897849');


--
-- Data for Name: geofence_zones; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.geofence_zones VALUES (1, 'Sample geofence_zones 1', 'Sample data for geofence_zones record 1', 6.4600000, 3.4100000, 1, true, 'geofence zones 1', '2026-05-29 14:49:33.901937', '2026-05-29 14:49:33.901937', 'standard', 1.5000000, 1.5000000, 1, '{"index": 1, "sample": true}');
INSERT INTO public.geofence_zones VALUES (2, 'Sample geofence_zones 2', 'Sample data for geofence_zones record 2', 6.4700000, 3.4200000, 2, false, 'geofence zones 2', '2026-05-22 14:49:33.901937', '2026-05-22 14:49:33.901937', 'standard', 3.0000000, 3.0000000, 2, '{"index": 2, "sample": true}');
INSERT INTO public.geofence_zones VALUES (3, 'Sample geofence_zones 3', 'Sample data for geofence_zones record 3', 6.4800000, 3.4300000, 3, false, 'geofence zones 3', '2026-05-15 14:49:33.901937', '2026-05-15 14:49:33.901937', 'standard', 4.5000000, 4.5000000, 3, '{"index": 3, "sample": true}');


--
-- Data for Name: geospatial_zones; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.geospatial_zones VALUES (1, 'Lagos', 'region', 'medium', 8500, 1200, 42.00, 6.524400, 3.379200, '[[6.45, 3.35], [6.55, 3.35], [6.55, 3.45], [6.45, 3.45]]', '2026-06-05 04:06:31.178518');
INSERT INTO public.geospatial_zones VALUES (2, 'Abuja', 'region', 'low', 4200, 580, 38.00, 9.057900, 7.495100, '[[9.0, 7.4], [9.1, 7.4], [9.1, 7.6], [9.0, 7.6]]', '2026-06-05 04:06:31.178518');
INSERT INTO public.geospatial_zones VALUES (3, 'Kano', 'region', 'medium', 2800, 420, 45.00, 12.002200, 8.592000, '[[11.9, 8.5], [12.1, 8.5], [12.1, 8.7], [11.9, 8.7]]', '2026-06-05 04:06:31.178518');
INSERT INTO public.geospatial_zones VALUES (4, 'Port Harcourt', 'region', 'high', 3100, 680, 52.00, 4.815600, 7.049800, '[[4.7, 6.9], [4.9, 6.9], [4.9, 7.1], [4.7, 7.1]]', '2026-06-05 04:06:31.178518');
INSERT INTO public.geospatial_zones VALUES (5, 'Ibadan', 'region', 'low', 1950, 250, 35.00, 7.377500, 3.947000, '[[7.3, 3.8], [7.5, 3.8], [7.5, 4.1], [7.3, 4.1]]', '2026-06-05 04:06:31.178518');
INSERT INTO public.geospatial_zones VALUES (6, 'Lagos Flood Zone A', 'flood_zone', 'high', 350, 120, 85.00, 6.453100, 3.395800, '[[6.45, 3.35], [6.50, 3.35], [6.50, 3.45], [6.45, 3.45]]', '2026-06-05 04:06:31.178518');
INSERT INTO public.geospatial_zones VALUES (7, 'Niger Delta Erosion Zone', 'risk_zone', 'high', 120, 45, 92.00, 5.052700, 6.856100, '[[4.9, 6.7], [5.2, 6.7], [5.2, 7.0], [4.9, 7.0]]', '2026-06-05 04:06:31.178518');
INSERT INTO public.geospatial_zones VALUES (8, 'North Drought Belt', 'risk_zone', 'medium', 890, 210, 58.00, 12.500000, 7.500000, '[[12.0, 7.0], [13.0, 7.0], [13.0, 8.0], [12.0, 8.0]]', '2026-06-05 04:06:31.178518');


--
-- Data for Name: gig_coverage_policies; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.gig_coverage_policies VALUES (1, 1, 'GIG-RIDE-01', 'Ride Shield Basic', 'Bolt', 1500.00, 500000.00, 'active', '2026-03-04 17:07:58.35936', '2027-03-04 17:07:58.35936', '2026-03-04 17:07:58.35936');
INSERT INTO public.gig_coverage_policies VALUES (2, 4, 'GIG-RIDE-02', 'Ride Shield Premium', 'Uber', 3000.00, 1500000.00, 'active', '2026-04-04 17:07:58.35936', '2027-04-04 17:07:58.35936', '2026-04-04 17:07:58.35936');
INSERT INTO public.gig_coverage_policies VALUES (3, 15, 'GIG-DELIVER-01', 'Delivery Cover', 'Jumia Food', 2000.00, 800000.00, 'active', '2026-05-04 17:07:58.35936', '2027-05-04 17:07:58.35936', '2026-05-04 17:07:58.35936');
INSERT INTO public.gig_coverage_policies VALUES (4, 8, 'GIG-ARTISAN-01', 'Artisan Cover', 'Fixr', 1200.00, 300000.00, 'expired', '2025-04-04 17:07:58.35936', '2026-04-04 17:07:58.35936', '2025-04-04 17:07:58.35936');
INSERT INTO public.gig_coverage_policies VALUES (5, 7, 'GIG-FREELANCE-01', 'Freelance Professional', 'Upwork', 2500.00, 1000000.00, 'active', '2026-02-04 17:07:58.35936', '2027-02-04 17:07:58.35936', '2026-02-04 17:07:58.35936');


--
-- Data for Name: gl_accounts; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.gl_accounts VALUES (1, 'GL_-2026-001', 'gl accounts 1', 'standard', 1, 'gl accounts 1', 50000, true, 'Sample data for gl_accounts record 1', '2026-05-29 14:49:33.905902', '2026-05-29 14:49:33.905902');
INSERT INTO public.gl_accounts VALUES (2, 'GL_-2026-002', 'gl accounts 2', 'standard', 2, 'gl accounts 2', 100000, false, 'Sample data for gl_accounts record 2', '2026-05-22 14:49:33.905902', '2026-05-22 14:49:33.905902');
INSERT INTO public.gl_accounts VALUES (3, 'GL_-2026-003', 'gl accounts 3', 'standard', 3, 'gl accounts 3', 150000, false, 'Sample data for gl_accounts record 3', '2026-05-15 14:49:33.905902', '2026-05-15 14:49:33.905902');


--
-- Data for Name: gl_entries; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.gl_entries VALUES (1, 'GL_-2026-001', 'gl entries 1', 'standard', 50000.00, 'gl entries 1', 'GL_-2026-001', 'Sample data for gl_entries record 1', '2026-05-29 14:49:33.909399', 1, true, 'GL_-2026-001', '2026-05-29 14:49:33.909399');
INSERT INTO public.gl_entries VALUES (2, 'GL_-2026-002', 'gl entries 2', 'standard', 100000.00, 'gl entries 2', 'GL_-2026-002', 'Sample data for gl_entries record 2', '2026-05-22 14:49:33.909399', 2, false, 'GL_-2026-002', '2026-05-22 14:49:33.909399');
INSERT INTO public.gl_entries VALUES (3, 'GL_-2026-003', 'gl entries 3', 'standard', 150000.00, 'gl entries 3', 'GL_-2026-003', 'Sample data for gl_entries record 3', '2026-05-15 14:49:33.909399', 3, false, 'GL_-2026-003', '2026-05-15 14:49:33.909399');


--
-- Data for Name: gl_journal_entries; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.gl_journal_entries VALUES (1, 'GL_-2026-001', 'Sample data for gl_journal_entries record 1', 1, 1, 50000, 'gl journal entries 1', 'standard', '1', 'gl journal entries 1', 1, 'active', '2026-05-29 14:49:33.912742', '2026-05-29 14:49:33.912742');
INSERT INTO public.gl_journal_entries VALUES (2, 'GL_-2026-002', 'Sample data for gl_journal_entries record 2', 2, 2, 100000, 'gl journal entries 2', 'standard', '2', 'gl journal entries 2', 2, 'active', '2026-05-22 14:49:33.912742', '2026-05-22 14:49:33.912742');
INSERT INTO public.gl_journal_entries VALUES (3, 'GL_-2026-003', 'Sample data for gl_journal_entries record 3', 3, 3, 150000, 'gl journal entries 3', 'standard', '3', 'gl journal entries 3', 3, 'active', '2026-05-15 14:49:33.912742', '2026-05-15 14:49:33.912742');


--
-- Data for Name: group_life_members; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.group_life_members VALUES (1, 1, 'group life members 1', '1', '2026-05-29 14:49:33.916267', 1.50, 1.50, 'active', '2026-05-29 14:49:33.916267');
INSERT INTO public.group_life_members VALUES (2, 2, 'group life members 2', '2', '2026-05-22 14:49:33.916267', 3.00, 3.00, 'active', '2026-05-22 14:49:33.916267');
INSERT INTO public.group_life_members VALUES (3, 3, 'group life members 3', '3', '2026-05-15 14:49:33.916267', 4.50, 4.50, 'active', '2026-05-15 14:49:33.916267');


--
-- Data for Name: group_life_schemes; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.group_life_schemes VALUES (1, 1, 'group life schemes 1', 'group life schemes 1', '1', 'standard', 1, 1.50, 1.50, 'active', '2026-05-29 14:49:33.920163', '2026-05-29 14:49:33.920163', '2026-05-29 14:49:33.920163');
INSERT INTO public.group_life_schemes VALUES (2, 2, 'group life schemes 2', 'group life schemes 2', '2', 'standard', 2, 3.00, 3.00, 'active', '2026-05-22 14:49:33.920163', '2026-05-22 14:49:33.920163', '2026-05-22 14:49:33.920163');
INSERT INTO public.group_life_schemes VALUES (3, 3, 'group life schemes 3', 'group life schemes 3', '3', 'standard', 3, 4.50, 4.50, 'active', '2026-05-15 14:49:33.920163', '2026-05-15 14:49:33.920163', '2026-05-15 14:49:33.920163');


--
-- Data for Name: health_programs; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.health_programs VALUES (1, 'Annual Wellness Check', 'Comprehensive annual health screening with partner hospitals', 'yearly', 'preventive', 500, 3420, true, '2026-06-05 04:06:31.114315');
INSERT INTO public.health_programs VALUES (2, 'Fitness Rewards', 'Earn points for physical activity tracked via wearables', 'daily', 'fitness', 50, 8750, true, '2026-06-05 04:06:31.114315');
INSERT INTO public.health_programs VALUES (3, 'Mental Health Support', 'Counseling and therapy sessions with licensed professionals', 'on-demand', 'mental_health', 200, 1890, true, '2026-06-05 04:06:31.114315');
INSERT INTO public.health_programs VALUES (4, 'Chronic Disease Management', 'Ongoing monitoring and medication adherence for chronic conditions', 'monthly', 'chronic_care', 300, 2100, true, '2026-06-05 04:06:31.114315');
INSERT INTO public.health_programs VALUES (5, 'Prenatal Care Program', 'Regular checkups and nutritional guidance for expecting mothers', 'bi-weekly', 'maternal', 400, 680, true, '2026-06-05 04:06:31.114315');
INSERT INTO public.health_programs VALUES (6, 'Vision & Dental Checkup', 'Annual eye and dental examinations', 'yearly', 'preventive', 250, 4200, true, '2026-06-05 04:06:31.114315');
INSERT INTO public.health_programs VALUES (7, 'Nutrition Counseling', 'Personalized dietary plans from registered dietitians', 'weekly', 'nutrition', 150, 1560, true, '2026-06-05 04:06:31.114315');
INSERT INTO public.health_programs VALUES (8, 'Smoking Cessation Program', '12-week program with nicotine replacement therapy', 'weekly', 'behavioral', 1000, 340, true, '2026-06-05 04:06:31.114315');


--
-- Data for Name: ifrs17_cashflow_scenarios; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.ifrs17_cashflow_scenarios VALUES (1, 'MOT-IND-2025', 'Base Case', 0.5000, 2800000000.00, 1680000000.00, 336000000.00, 126000000.00, 0.158000, 2365000000.00, '2026-Q2', '2026-06-05 03:08:54.770081');
INSERT INTO public.ifrs17_cashflow_scenarios VALUES (2, 'MOT-IND-2025', 'Adverse (High Claims)', 0.2500, 2800000000.00, 2240000000.00, 392000000.00, 126000000.00, 0.158000, 1825000000.00, '2026-Q2', '2026-06-05 03:08:54.770081');
INSERT INTO public.ifrs17_cashflow_scenarios VALUES (3, 'MOT-IND-2025', 'Favourable (Low Claims)', 0.2000, 2800000000.00, 1260000000.00, 280000000.00, 126000000.00, 0.158000, 2750000000.00, '2026-Q2', '2026-06-05 03:08:54.770081');
INSERT INTO public.ifrs17_cashflow_scenarios VALUES (4, 'MOT-IND-2025', 'Catastrophe', 0.0500, 2800000000.00, 3500000000.00, 504000000.00, 126000000.00, 0.158000, 980000000.00, '2026-Q2', '2026-06-05 03:08:54.770081');
INSERT INTO public.ifrs17_cashflow_scenarios VALUES (5, 'HLT-GRP-2025', 'Base Case', 0.5000, 1800000000.00, 1350000000.00, 270000000.00, 81000000.00, 0.162000, 1520000000.00, '2026-Q2', '2026-06-05 03:08:54.770081');
INSERT INTO public.ifrs17_cashflow_scenarios VALUES (6, 'HLT-GRP-2025', 'Pandemic Stress', 0.1500, 1800000000.00, 2700000000.00, 450000000.00, 81000000.00, 0.162000, 650000000.00, '2026-Q2', '2026-06-05 03:08:54.770081');
INSERT INTO public.ifrs17_cashflow_scenarios VALUES (7, 'HLT-GRP-2025', 'Favourable', 0.2500, 1800000000.00, 1080000000.00, 216000000.00, 81000000.00, 0.162000, 1890000000.00, '2026-Q2', '2026-06-05 03:08:54.770081');
INSERT INTO public.ifrs17_cashflow_scenarios VALUES (8, 'HLT-GRP-2025', 'Medical Inflation', 0.1000, 1800000000.00, 1800000000.00, 360000000.00, 81000000.00, 0.162000, 1150000000.00, '2026-Q2', '2026-06-05 03:08:54.770081');
INSERT INTO public.ifrs17_cashflow_scenarios VALUES (9, 'LIF-TRM-2025', 'Base Case', 0.5500, 5500000000.00, 825000000.00, 550000000.00, 742500000.00, 0.170000, 6200000000.00, '2026-Q2', '2026-06-05 03:08:54.770081');
INSERT INTO public.ifrs17_cashflow_scenarios VALUES (10, 'LIF-TRM-2025', 'Mortality Shock', 0.1500, 5500000000.00, 1650000000.00, 660000000.00, 742500000.00, 0.170000, 5100000000.00, '2026-Q2', '2026-06-05 03:08:54.770081');
INSERT INTO public.ifrs17_cashflow_scenarios VALUES (11, 'LIF-TRM-2025', 'Lapse Stress', 0.2000, 3850000000.00, 577500000.00, 385000000.00, 519750000.00, 0.170000, 4500000000.00, '2026-Q2', '2026-06-05 03:08:54.770081');
INSERT INTO public.ifrs17_cashflow_scenarios VALUES (12, 'LIF-TRM-2025', 'Interest Rate Rise', 0.1000, 5500000000.00, 825000000.00, 550000000.00, 990000000.00, 0.190000, 6800000000.00, '2026-Q2', '2026-06-05 03:08:54.770081');


--
-- Data for Name: ifrs17_contract_groups; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.ifrs17_contract_groups VALUES (1, 'MOT-IND-2025', 'Motor Individual 2025', 'PAA', 'Motor', 2025, false, 'full_retrospective', '2025-01-01', 12, '2026-06-05 03:08:54.765433');
INSERT INTO public.ifrs17_contract_groups VALUES (2, 'MOT-COM-2025', 'Motor Commercial 2025', 'PAA', 'Motor', 2025, false, 'full_retrospective', '2025-01-01', 12, '2026-06-05 03:08:54.765433');
INSERT INTO public.ifrs17_contract_groups VALUES (3, 'HLT-GRP-2025', 'Health Group 2025', 'GMM', 'Health', 2025, false, 'modified_retrospective', '2025-01-01', 36, '2026-06-05 03:08:54.765433');
INSERT INTO public.ifrs17_contract_groups VALUES (4, 'LIF-TRM-2025', 'Life Term 2025', 'VFA', 'Life', 2025, false, 'fair_value', '2025-01-01', 240, '2026-06-05 03:08:54.765433');
INSERT INTO public.ifrs17_contract_groups VALUES (5, 'LIF-END-2025', 'Life Endowment 2025', 'VFA', 'Life', 2025, false, 'fair_value', '2025-01-01', 180, '2026-06-05 03:08:54.765433');
INSERT INTO public.ifrs17_contract_groups VALUES (6, 'PRP-COM-2025', 'Property Commercial 2025', 'PAA', 'Property', 2025, false, 'full_retrospective', '2025-01-01', 12, '2026-06-05 03:08:54.765433');
INSERT INTO public.ifrs17_contract_groups VALUES (7, 'MAR-CRG-2025', 'Marine Cargo 2025', 'GMM', 'Marine', 2025, true, 'modified_retrospective', '2025-01-01', 6, '2026-06-05 03:08:54.765433');
INSERT INTO public.ifrs17_contract_groups VALUES (8, 'CYB-ENT-2026', 'Cyber Enterprise 2026', 'PAA', 'Cyber', 2026, false, 'full_retrospective', '2026-01-01', 12, '2026-06-05 03:08:54.765433');


--
-- Data for Name: ifrs17_contracts; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.ifrs17_contracts VALUES (6, 'Motor - Individual', 'PAA', 45000000.00, 28000000.00, 12000000.00, 3500000.00, '2026-Q2', 'active', '2026-06-05 00:27:58.242055');
INSERT INTO public.ifrs17_contracts VALUES (7, 'Health - Group', 'GMM', 120000000.00, 85000000.00, 25000000.00, 8000000.00, '2026-Q2', 'active', '2026-06-05 00:27:58.242055');
INSERT INTO public.ifrs17_contracts VALUES (8, 'Life - Term', 'VFA', 80000000.00, 15000000.00, 55000000.00, 6000000.00, '2026-Q2', 'active', '2026-06-05 00:27:58.242055');
INSERT INTO public.ifrs17_contracts VALUES (9, 'Property - Commercial', 'PAA', 200000000.00, 65000000.00, 95000000.00, 15000000.00, '2026-Q2', 'active', '2026-06-05 00:27:58.242055');
INSERT INTO public.ifrs17_contracts VALUES (10, 'Marine - Cargo', 'GMM', 150000000.00, 90000000.00, 40000000.00, 12000000.00, '2026-Q2', 'active', '2026-06-05 00:27:58.242055');
INSERT INTO public.ifrs17_contracts VALUES (11, 'Motor - Individual', 'PAA', 45000000.00, 28000000.00, 6650000.00, 3600000.00, '2026-Q2', 'active', '2026-06-05 00:52:40.300398');
INSERT INTO public.ifrs17_contracts VALUES (12, 'Motor Individual 2025', 'PAA', 45000000.00, 28000000.00, 1204460.00, 3600000.00, '2026-Q2', 'active', '2026-06-05 03:11:41.748361');
INSERT INTO public.ifrs17_contracts VALUES (13, 'Life Term 2025', 'VFA', 120000000.00, 18000000.00, 0.00, 7200000.00, '2026-Q2', 'active', '2026-06-05 03:11:41.957757');
INSERT INTO public.ifrs17_contracts VALUES (14, 'Marine Cargo 2025', 'GMM', 200000000.00, 280000000.00, 0.00, 20000000.00, '2026-Q2', 'active', '2026-06-05 03:16:11.540148');
INSERT INTO public.ifrs17_contracts VALUES (15, 'Motor Individual 2025', 'PAA', 45000000.00, 28000000.00, 1204460.00, 3600000.00, '2026-Q2', 'active', '2026-06-05 15:37:10.441366');
INSERT INTO public.ifrs17_contracts VALUES (16, 'Motor Individual 2025', 'PAA', 45000000.00, 28000000.00, 1204460.00, 3600000.00, '2026-Q2', 'active', '2026-06-05 15:38:35.119341');
INSERT INTO public.ifrs17_contracts VALUES (17, 'Motor Individual 2025', 'PAA', 45000000.00, 28000000.00, 1204460.00, 3600000.00, '2026-Q2', 'active', '2026-06-05 15:38:51.957111');
INSERT INTO public.ifrs17_contracts VALUES (18, 'Motor Individual 2025', 'PAA', 45000000.00, 28000000.00, 1204460.00, 3600000.00, '2026-Q2', 'active', '2026-06-05 15:52:16.11608');
INSERT INTO public.ifrs17_contracts VALUES (19, 'Motor Individual 2025', 'PAA', 45000000.00, 28000000.00, 1204460.00, 3600000.00, '2026-Q2', 'active', '2026-06-05 15:54:03.851308');
INSERT INTO public.ifrs17_contracts VALUES (20, 'Motor Individual 2025', 'PAA', 45000000.00, 28000000.00, 1204460.00, 3600000.00, '2026-Q2', 'active', '2026-06-05 16:03:01.215228');
INSERT INTO public.ifrs17_contracts VALUES (21, 'Motor Individual 2025', 'PAA', 45000000.00, 28000000.00, 1204460.00, 3600000.00, '2026-Q2', 'active', '2026-06-05 16:06:31.800836');
INSERT INTO public.ifrs17_contracts VALUES (22, 'Motor Individual 2025', 'PAA', 45000000.00, 28000000.00, 1204460.00, 3600000.00, '2026-Q2', 'active', '2026-06-05 16:37:46.904728');
INSERT INTO public.ifrs17_contracts VALUES (23, 'Motor Individual 2025', 'PAA', 45000000.00, 28000000.00, 1204460.00, 3600000.00, '2026-Q2', 'active', '2026-06-05 16:38:18.313608');
INSERT INTO public.ifrs17_contracts VALUES (24, 'Motor Individual 2025', 'PAA', 45000000.00, 28000000.00, 1204460.00, 3600000.00, '2026-Q2', 'active', '2026-06-05 16:59:35.504648');
INSERT INTO public.ifrs17_contracts VALUES (25, 'Motor Individual 2025', 'PAA', 45000000.00, 28000000.00, 1204460.00, 3600000.00, '2026-Q2', 'active', '2026-06-05 17:04:32.971772');
INSERT INTO public.ifrs17_contracts VALUES (26, 'Motor Individual 2025', 'PAA', 45000000.00, 28000000.00, 1204460.00, 3600000.00, '2026-Q2', 'active', '2026-06-05 17:31:25.639556');


--
-- Data for Name: ifrs17_csm_rollforward; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.ifrs17_csm_rollforward VALUES (1, 'MOT-IND-2025', '2025-Q3', 0.00, 850000000.00, 12750000.00, 0.00, -25000000.00, 0.00, -85000000.00, 752750000.00, 0.00, 18000, 4500, '2026-06-05 03:08:54.766724');
INSERT INTO public.ifrs17_csm_rollforward VALUES (2, 'MOT-IND-2025', '2025-Q4', 752750000.00, 120000000.00, 12294250.00, -45000000.00, -18000000.00, 0.00, -95000000.00, 727044250.00, 0.00, 18000, 4500, '2026-06-05 03:08:54.766724');
INSERT INTO public.ifrs17_csm_rollforward VALUES (3, 'MOT-IND-2025', '2026-Q1', 727044250.00, 95000000.00, 11877722.00, -28000000.00, 15000000.00, 0.00, -92000000.00, 728921972.00, 0.00, 18000, 4500, '2026-06-05 03:08:54.766724');
INSERT INTO public.ifrs17_csm_rollforward VALUES (4, 'MOT-IND-2025', '2026-Q2', 728921972.00, 110000000.00, 11902458.00, -32000000.00, -22000000.00, 0.00, -98000000.00, 698824430.00, 0.00, 18000, 4500, '2026-06-05 03:08:54.766724');
INSERT INTO public.ifrs17_csm_rollforward VALUES (5, 'HLT-GRP-2025', '2025-Q3', 0.00, 420000000.00, 6300000.00, 0.00, -35000000.00, 0.00, -14000000.00, 377300000.00, 0.00, 5000, 417, '2026-06-05 03:08:54.766724');
INSERT INTO public.ifrs17_csm_rollforward VALUES (6, 'HLT-GRP-2025', '2025-Q4', 377300000.00, 55000000.00, 6107400.00, -62000000.00, -28000000.00, 0.00, -14500000.00, 333907400.00, 0.00, 5000, 417, '2026-06-05 03:08:54.766724');
INSERT INTO public.ifrs17_csm_rollforward VALUES (7, 'HLT-GRP-2025', '2026-Q1', 333907400.00, 40000000.00, 5406300.00, -18000000.00, 12000000.00, 0.00, -15000000.00, 358313700.00, 0.00, 5000, 417, '2026-06-05 03:08:54.766724');
INSERT INTO public.ifrs17_csm_rollforward VALUES (8, 'HLT-GRP-2025', '2026-Q2', 358313700.00, 48000000.00, 5804742.00, -25000000.00, -8000000.00, 0.00, -15500000.00, 363618442.00, 0.00, 5000, 417, '2026-06-05 03:08:54.766724');
INSERT INTO public.ifrs17_csm_rollforward VALUES (9, 'LIF-TRM-2025', '2025-Q3', 0.00, 1200000000.00, 18000000.00, 0.00, -15000000.00, 0.00, -5000000.00, 1198000000.00, 0.00, 3000, 38, '2026-06-05 03:08:54.766724');
INSERT INTO public.ifrs17_csm_rollforward VALUES (10, 'LIF-TRM-2025', '2025-Q4', 1198000000.00, 180000000.00, 19468000.00, -85000000.00, -42000000.00, 0.00, -5500000.00, 1264968000.00, 0.00, 3000, 38, '2026-06-05 03:08:54.766724');
INSERT INTO public.ifrs17_csm_rollforward VALUES (11, 'LIF-TRM-2025', '2026-Q1', 1264968000.00, 150000000.00, 20572980.00, -45000000.00, 28000000.00, 0.00, -6000000.00, 1412540980.00, 0.00, 3000, 38, '2026-06-05 03:08:54.766724');
INSERT INTO public.ifrs17_csm_rollforward VALUES (12, 'LIF-TRM-2025', '2026-Q2', 1412540980.00, 165000000.00, 22984167.00, -52000000.00, -18000000.00, 0.00, -6500000.00, 1524025147.00, 0.00, 3000, 38, '2026-06-05 03:08:54.766724');
INSERT INTO public.ifrs17_csm_rollforward VALUES (13, 'MAR-CRG-2025', '2025-Q3', 0.00, -45000000.00, 0.00, 0.00, -12000000.00, 0.00, 0.00, -57000000.00, 57000000.00, 8000, 4000, '2026-06-05 03:08:54.766724');
INSERT INTO public.ifrs17_csm_rollforward VALUES (14, 'MAR-CRG-2025', '2025-Q4', -57000000.00, -15000000.00, 0.00, -28000000.00, -8000000.00, 0.00, 12000000.00, -96000000.00, 96000000.00, 8000, 4000, '2026-06-05 03:08:54.766724');
INSERT INTO public.ifrs17_csm_rollforward VALUES (15, 'MAR-CRG-2025', '2026-Q1', -96000000.00, 0.00, 0.00, 35000000.00, 18000000.00, 0.00, 8000000.00, -35000000.00, 35000000.00, 8000, 4000, '2026-06-05 03:08:54.766724');
INSERT INTO public.ifrs17_csm_rollforward VALUES (16, 'MAR-CRG-2025', '2026-Q2', -35000000.00, -8000000.00, 0.00, 15000000.00, 5000000.00, 0.00, 6000000.00, -17000000.00, 17000000.00, 8000, 4000, '2026-06-05 03:08:54.766724');
INSERT INTO public.ifrs17_csm_rollforward VALUES (17, 'PRP-COM-2025', '2026-Q1', 0.00, 680000000.00, 10200000.00, 0.00, -22000000.00, 0.00, -68000000.00, 600200000.00, 0.00, 12000, 3000, '2026-06-05 03:08:54.766724');
INSERT INTO public.ifrs17_csm_rollforward VALUES (18, 'PRP-COM-2025', '2026-Q2', 600200000.00, 95000000.00, 9783260.00, -18000000.00, -12000000.00, 0.00, -72000000.00, 602983260.00, 0.00, 12000, 3000, '2026-06-05 03:08:54.766724');


--
-- Data for Name: ifrs17_discount_curves; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.ifrs17_discount_curves VALUES (1, 'NGN Risk-Free', 'NGN', '2026-01-01', 3, 0.145000, 0.148000, 'CBN', '2026-06-05 03:08:54.760211');
INSERT INTO public.ifrs17_discount_curves VALUES (2, 'NGN Risk-Free', 'NGN', '2026-01-01', 6, 0.152000, 0.159000, 'CBN', '2026-06-05 03:08:54.760211');
INSERT INTO public.ifrs17_discount_curves VALUES (3, 'NGN Risk-Free', 'NGN', '2026-01-01', 12, 0.158000, 0.164000, 'CBN', '2026-06-05 03:08:54.760211');
INSERT INTO public.ifrs17_discount_curves VALUES (4, 'NGN Risk-Free', 'NGN', '2026-01-01', 24, 0.162000, 0.168000, 'CBN', '2026-06-05 03:08:54.760211');
INSERT INTO public.ifrs17_discount_curves VALUES (5, 'NGN Risk-Free', 'NGN', '2026-01-01', 36, 0.165000, 0.171000, 'CBN', '2026-06-05 03:08:54.760211');
INSERT INTO public.ifrs17_discount_curves VALUES (6, 'NGN Risk-Free', 'NGN', '2026-01-01', 60, 0.168000, 0.174000, 'CBN', '2026-06-05 03:08:54.760211');
INSERT INTO public.ifrs17_discount_curves VALUES (7, 'NGN Risk-Free', 'NGN', '2026-01-01', 120, 0.172000, 0.178000, 'CBN', '2026-06-05 03:08:54.760211');
INSERT INTO public.ifrs17_discount_curves VALUES (8, 'NGN Risk-Free', 'NGN', '2026-04-01', 3, 0.142000, 0.145000, 'CBN', '2026-06-05 03:08:54.760211');
INSERT INTO public.ifrs17_discount_curves VALUES (9, 'NGN Risk-Free', 'NGN', '2026-04-01', 6, 0.149000, 0.156000, 'CBN', '2026-06-05 03:08:54.760211');
INSERT INTO public.ifrs17_discount_curves VALUES (10, 'NGN Risk-Free', 'NGN', '2026-04-01', 12, 0.155000, 0.161000, 'CBN', '2026-06-05 03:08:54.760211');
INSERT INTO public.ifrs17_discount_curves VALUES (11, 'NGN Risk-Free', 'NGN', '2026-04-01', 24, 0.159000, 0.165000, 'CBN', '2026-06-05 03:08:54.760211');
INSERT INTO public.ifrs17_discount_curves VALUES (12, 'NGN Risk-Free', 'NGN', '2026-04-01', 36, 0.162000, 0.168000, 'CBN', '2026-06-05 03:08:54.760211');
INSERT INTO public.ifrs17_discount_curves VALUES (13, 'NGN Risk-Free', 'NGN', '2026-04-01', 60, 0.166000, 0.172000, 'CBN', '2026-06-05 03:08:54.760211');
INSERT INTO public.ifrs17_discount_curves VALUES (14, 'NGN Risk-Free', 'NGN', '2026-04-01', 120, 0.170000, 0.176000, 'CBN', '2026-06-05 03:08:54.760211');
INSERT INTO public.ifrs17_discount_curves VALUES (15, 'NGN Illiquidity', 'NGN', '2026-04-01', 12, 0.008000, NULL, 'Internal', '2026-06-05 03:08:54.760211');
INSERT INTO public.ifrs17_discount_curves VALUES (16, 'NGN Illiquidity', 'NGN', '2026-04-01', 24, 0.010000, NULL, 'Internal', '2026-06-05 03:08:54.760211');
INSERT INTO public.ifrs17_discount_curves VALUES (17, 'NGN Illiquidity', 'NGN', '2026-04-01', 36, 0.012000, NULL, 'Internal', '2026-06-05 03:08:54.760211');
INSERT INTO public.ifrs17_discount_curves VALUES (18, 'NGN Illiquidity', 'NGN', '2026-04-01', 60, 0.014000, NULL, 'Internal', '2026-06-05 03:08:54.760211');
INSERT INTO public.ifrs17_discount_curves VALUES (19, 'NGN Illiquidity', 'NGN', '2026-04-01', 120, 0.016000, NULL, 'Internal', '2026-06-05 03:08:54.760211');


--
-- Data for Name: ifrs17_pnl; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.ifrs17_pnl VALUES (1, 'MOT-IND-2025', '2025-Q3', 700000000.00, 504000000.00, 196000000.00, 31500000.00, 28000000.00, 3500000.00, 0.00, '2026-06-05 03:08:54.774532');
INSERT INTO public.ifrs17_pnl VALUES (2, 'MOT-IND-2025', '2025-Q4', 720000000.00, 540000000.00, 180000000.00, 32400000.00, 29000000.00, 3400000.00, 0.00, '2026-06-05 03:08:54.774532');
INSERT INTO public.ifrs17_pnl VALUES (3, 'MOT-IND-2025', '2026-Q1', 690000000.00, 483000000.00, 207000000.00, 31050000.00, 27000000.00, 4050000.00, 0.00, '2026-06-05 03:08:54.774532');
INSERT INTO public.ifrs17_pnl VALUES (4, 'MOT-IND-2025', '2026-Q2', 710000000.00, 497000000.00, 213000000.00, 31950000.00, 28500000.00, 3450000.00, 0.00, '2026-06-05 03:08:54.774532');
INSERT INTO public.ifrs17_pnl VALUES (5, 'HLT-GRP-2025', '2025-Q3', 450000000.00, 378000000.00, 72000000.00, 20250000.00, 18000000.00, 2250000.00, 0.00, '2026-06-05 03:08:54.774532');
INSERT INTO public.ifrs17_pnl VALUES (6, 'HLT-GRP-2025', '2025-Q4', 480000000.00, 432000000.00, 48000000.00, 21600000.00, 19500000.00, 2100000.00, 0.00, '2026-06-05 03:08:54.774532');
INSERT INTO public.ifrs17_pnl VALUES (7, 'HLT-GRP-2025', '2026-Q1', 460000000.00, 391000000.00, 69000000.00, 20700000.00, 18500000.00, 2200000.00, 0.00, '2026-06-05 03:08:54.774532');
INSERT INTO public.ifrs17_pnl VALUES (8, 'HLT-GRP-2025', '2026-Q2', 470000000.00, 399500000.00, 70500000.00, 21150000.00, 19000000.00, 2150000.00, 0.00, '2026-06-05 03:08:54.774532');
INSERT INTO public.ifrs17_pnl VALUES (9, 'LIF-TRM-2025', '2025-Q3', 280000000.00, 168000000.00, 112000000.00, 67500000.00, 54000000.00, 13500000.00, 0.00, '2026-06-05 03:08:54.774532');
INSERT INTO public.ifrs17_pnl VALUES (10, 'LIF-TRM-2025', '2025-Q4', 295000000.00, 177000000.00, 118000000.00, 71250000.00, 57000000.00, 14250000.00, 0.00, '2026-06-05 03:08:54.774532');
INSERT INTO public.ifrs17_pnl VALUES (11, 'LIF-TRM-2025', '2026-Q1', 290000000.00, 174000000.00, 116000000.00, 70000000.00, 56000000.00, 14000000.00, 0.00, '2026-06-05 03:08:54.774532');
INSERT INTO public.ifrs17_pnl VALUES (12, 'LIF-TRM-2025', '2026-Q2', 300000000.00, 180000000.00, 120000000.00, 72500000.00, 58000000.00, 14500000.00, 0.00, '2026-06-05 03:08:54.774532');
INSERT INTO public.ifrs17_pnl VALUES (13, 'MAR-CRG-2025', '2025-Q3', 200000000.00, 280000000.00, -80000000.00, 9000000.00, 8000000.00, 1000000.00, 12000000.00, '2026-06-05 03:08:54.774532');
INSERT INTO public.ifrs17_pnl VALUES (14, 'MAR-CRG-2025', '2025-Q4', 180000000.00, 252000000.00, -72000000.00, 8100000.00, 7200000.00, 900000.00, 8000000.00, '2026-06-05 03:08:54.774532');
INSERT INTO public.ifrs17_pnl VALUES (15, 'MAR-CRG-2025', '2026-Q1', 190000000.00, 209000000.00, -19000000.00, 8550000.00, 7600000.00, 950000.00, 6000000.00, '2026-06-05 03:08:54.774532');
INSERT INTO public.ifrs17_pnl VALUES (16, 'MAR-CRG-2025', '2026-Q2', 195000000.00, 214500000.00, -19500000.00, 8775000.00, 7800000.00, 975000.00, 6000000.00, '2026-06-05 03:08:54.774532');
INSERT INTO public.ifrs17_pnl VALUES (17, 'PRP-COM-2025', '2026-Q1', 520000000.00, 364000000.00, 156000000.00, 23400000.00, 20800000.00, 2600000.00, 0.00, '2026-06-05 03:08:54.774532');
INSERT INTO public.ifrs17_pnl VALUES (18, 'PRP-COM-2025', '2026-Q2', 540000000.00, 378000000.00, 162000000.00, 24300000.00, 21600000.00, 2700000.00, 0.00, '2026-06-05 03:08:54.774532');


--
-- Data for Name: ifrs17_reinsurance_held; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.ifrs17_reinsurance_held VALUES (1, 'MOT-IND-2025', 'Africa Re', 'Quota Share', 25.00, 174706108.00, 0.00, 700000000.00, 420000000.00, '2026-Q2', '2026-06-05 03:08:54.771732');
INSERT INTO public.ifrs17_reinsurance_held VALUES (2, 'MOT-IND-2025', 'Continental Re', 'Excess of Loss', NULL, 45000000.00, 0.00, 85000000.00, 120000000.00, '2026-Q2', '2026-06-05 03:08:54.771732');
INSERT INTO public.ifrs17_reinsurance_held VALUES (3, 'HLT-GRP-2025', 'Swiss Re', 'Quota Share', 30.00, 109085533.00, 0.00, 540000000.00, 405000000.00, '2026-Q2', '2026-06-05 03:08:54.771732');
INSERT INTO public.ifrs17_reinsurance_held VALUES (4, 'LIF-TRM-2025', 'Munich Re', 'Surplus Share', 20.00, 304805029.00, 0.00, 1100000000.00, 165000000.00, '2026-Q2', '2026-06-05 03:08:54.771732');
INSERT INTO public.ifrs17_reinsurance_held VALUES (5, 'MAR-CRG-2025', 'Lloyds Syndicate', 'Facultative', 40.00, 0.00, 22800000.00, 320000000.00, 480000000.00, '2026-Q2', '2026-06-05 03:08:54.771732');
INSERT INTO public.ifrs17_reinsurance_held VALUES (6, 'PRP-COM-2025', 'Africa Re', 'Quota Share', 20.00, 120596652.00, 0.00, 380000000.00, 180000000.00, '2026-Q2', '2026-06-05 03:08:54.771732');


--
-- Data for Name: ifrs17_transition; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.ifrs17_transition VALUES (1, 'MOT-IND-2025', 'full_retrospective', 1850000000.00, 2150000000.00, 300000000.00, -225000000.00, '2025-01-01', '2026-06-05 03:08:54.773316');
INSERT INTO public.ifrs17_transition VALUES (2, 'HLT-GRP-2025', 'modified_retrospective', 980000000.00, 1250000000.00, 270000000.00, -202500000.00, '2025-01-01', '2026-06-05 03:08:54.773316');
INSERT INTO public.ifrs17_transition VALUES (3, 'LIF-TRM-2025', 'fair_value', 3200000000.00, 4100000000.00, 900000000.00, -675000000.00, '2025-01-01', '2026-06-05 03:08:54.773316');
INSERT INTO public.ifrs17_transition VALUES (4, 'LIF-END-2025', 'fair_value', 2800000000.00, 3500000000.00, 700000000.00, -525000000.00, '2025-01-01', '2026-06-05 03:08:54.773316');
INSERT INTO public.ifrs17_transition VALUES (5, 'PRP-COM-2025', 'full_retrospective', 1200000000.00, 1450000000.00, 250000000.00, -187500000.00, '2025-01-01', '2026-06-05 03:08:54.773316');
INSERT INTO public.ifrs17_transition VALUES (6, 'MAR-CRG-2025', 'modified_retrospective', 450000000.00, 620000000.00, 170000000.00, -127500000.00, '2025-01-01', '2026-06-05 03:08:54.773316');


--
-- Data for Name: insurance_applications; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.insurance_applications VALUES (1, 11, 'APP-2026-00001', 'Life', 'pending_documents', 'medical_exam', 5, NULL, '2026-05-28 17:07:58.340405', '2026-06-04 17:07:58.340405');
INSERT INTO public.insurance_applications VALUES (2, 8, 'APP-2026-00002', 'Microinsurance', 'approved', 'complete', 3, '2026-04-04 17:07:58.340405', '2026-04-04 17:07:58.340405', '2026-06-04 17:07:58.340405');
INSERT INTO public.insurance_applications VALUES (3, 15, 'APP-2026-00003', 'Health', 'underwriting', 'risk_assessment', 4, '2026-06-01 17:07:58.340405', '2026-06-01 17:07:58.340405', '2026-06-04 17:07:58.340405');
INSERT INTO public.insurance_applications VALUES (4, 13, 'APP-2026-00004', 'Agricultural', 'approved', 'complete', 4, '2026-03-04 17:07:58.340405', '2026-03-04 17:07:58.340405', '2026-06-04 17:07:58.340405');
INSERT INTO public.insurance_applications VALUES (5, 3, 'APP-2026-00005', 'Auto', 'pending_payment', 'payment', 3, '2026-06-03 17:07:58.340405', '2026-06-03 17:07:58.340405', '2026-06-04 17:07:58.340405');
INSERT INTO public.insurance_applications VALUES (6, 14, 'APP-2026-00006', 'Group_Life', 'underwriting', 'group_census', 6, '2026-05-30 17:07:58.340405', '2026-05-30 17:07:58.340405', '2026-06-04 17:07:58.340405');
INSERT INTO public.insurance_applications VALUES (7, 9, 'APP-2026-00007', 'Property', 'approved', 'complete', 4, '2026-05-04 17:07:58.340405', '2026-05-04 17:07:58.340405', '2026-06-04 17:07:58.340405');
INSERT INTO public.insurance_applications VALUES (8, 6, 'APP-2026-00008', 'Parametric', 'approved', 'complete', 3, '2026-04-04 17:07:58.340405', '2026-04-04 17:07:58.340405', '2026-06-04 17:07:58.340405');


--
-- Data for Name: insurance_products; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.insurance_products VALUES (1, 'MOT-TP', 'Motor Third Party', 'Motor', 'Third Party Only', 'Compulsory motor vehicle insurance as mandated by Insurance Act 2003 Section 68', 'indemnity', 15000.00, 50000.00, 1000000.00, 5000000.00, 18, 70, 1, 30, 'years', '[]', 1, 'Motor Vehicle Third Party', NULL, '["Third party bodily injury", "Third party property damage up to ₦1M", "Legal costs"]', '["Driver under influence", "Racing", "Unlicensed driver"]', '["vehicle_type", "engine_capacity", "usage", "location", "driver_age"]', true, 'active', '2026-06-04', NULL, '2026-06-04 19:07:31.368931', '2026-06-04 19:07:31.368931');
INSERT INTO public.insurance_products VALUES (2, 'MOT-CP', 'Motor Comprehensive', 'Motor', 'Comprehensive', 'Full motor vehicle cover including own damage, third party, theft and fire', 'indemnity', 45000.00, 500000.00, 2000000.00, 100000000.00, 18, 70, 1, 30, 'years', '[]', 2, 'Motor Vehicle Comprehensive', NULL, '["Own damage", "Third party", "Theft", "Fire", "Flood", "Towing", "Windscreen"]', '["Mechanical breakdown", "Wear and tear", "Consequential loss"]', '["vehicle_value", "vehicle_age", "driver_age", "claims_history", "location", "anti_theft"]', false, 'active', '2026-06-04', NULL, '2026-06-04 19:07:31.368931', '2026-06-04 19:07:31.368931');
INSERT INTO public.insurance_products VALUES (3, 'HLT-IND', 'Individual Health', 'Health', 'Individual', 'Comprehensive health insurance with HMO and indemnity options', 'indemnity', 50000.00, 2000000.00, 5000000.00, 50000000.00, 0, 65, 1, 30, 'years', '[]', 2, 'Health/Medical', NULL, '["Hospitalization", "Surgery", "Outpatient", "Maternity", "Dental", "Optical", "Mental health"]', '["Pre-existing conditions (first 12 months)", "Cosmetic surgery", "Experimental treatment"]', '["age", "gender", "pre_existing", "smoking", "bmi", "occupation"]', false, 'active', '2026-06-04', NULL, '2026-06-04 19:07:31.368931', '2026-06-04 19:07:31.368931');
INSERT INTO public.insurance_products VALUES (4, 'HLT-FAM', 'Family Health Plan', 'Health', 'Family', 'Covers spouse and up to 4 children under family plan with shared annual limit', 'indemnity', 120000.00, 5000000.00, 10000000.00, 100000000.00, 18, 65, 1, 30, 'years', '[]', 2, 'Health/Medical', NULL, '["All individual benefits", "Family deductible sharing", "Child wellness", "Immunization"]', '["Pre-existing conditions (first 12 months)"]', '["members_count", "ages", "pre_existing_family"]', false, 'active', '2026-06-04', NULL, '2026-06-04 19:07:31.368931', '2026-06-04 19:07:31.368931');
INSERT INTO public.insurance_products VALUES (5, 'LIF-TRM', 'Term Life Assurance', 'Life', 'Term', 'Pure life protection for a specified term with guaranteed sum assured', 'benefit', 20000.00, 5000000.00, 5000000.00, 500000000.00, 18, 60, 1, 30, 'years', '[]', 2, 'Life Assurance', NULL, '["Death benefit", "Terminal illness", "Funeral expenses", "Total permanent disability"]', '["Suicide (first 2 years)", "War", "Aviation (non-passenger)", "Criminal activity"]', '["age", "gender", "smoking", "occupation_class", "health_history", "sum_assured"]', false, 'active', '2026-06-04', NULL, '2026-06-04 19:07:31.368931', '2026-06-04 19:07:31.368931');
INSERT INTO public.insurance_products VALUES (6, 'LIF-END', 'Endowment Plan', 'Life', 'Endowment', 'Life protection with savings — maturity benefit if policyholder survives the term', 'benefit', 50000.00, 10000000.00, 10000000.00, 1000000000.00, 18, 55, 1, 30, 'years', '[]', 2, 'Life Assurance', NULL, '["Death benefit", "Maturity benefit", "Reversionary bonus", "Loan facility"]', '["Suicide (first 2 years)", "War"]', '["age", "gender", "smoking", "term", "sum_assured"]', false, 'active', '2026-06-04', NULL, '2026-06-04 19:07:31.368931', '2026-06-04 19:07:31.368931');
INSERT INTO public.insurance_products VALUES (7, 'PRP-FIR', 'Fire & Special Perils', 'Property', 'Fire', 'Property insurance against fire, lightning, explosion and special perils', 'indemnity', 25000.00, 1000000.00, 5000000.00, 500000000.00, 0, 0, 1, 30, 'years', '[]', 1, 'Fire and Special Perils', NULL, '["Fire damage", "Lightning", "Explosion", "Aircraft impact", "Flood", "Storm", "Riot"]', '["War", "Nuclear", "Gradual deterioration", "Electrical/mechanical breakdown"]', '["property_value", "construction_type", "location", "fire_protection", "occupancy"]', false, 'active', '2026-06-04', NULL, '2026-06-04 19:07:31.368931', '2026-06-04 19:07:31.368931');
INSERT INTO public.insurance_products VALUES (8, 'PRP-BUR', 'Burglary Insurance', 'Property', 'Burglary', 'Cover against theft from premises following forcible entry/exit', 'indemnity', 15000.00, 500000.00, 1000000.00, 100000000.00, 0, 0, 1, 30, 'years', '[]', 1, 'Burglary', NULL, '["Contents", "Cash in safe", "Cash in transit", "Damage to premises"]', '["Unforced entry", "Employee theft", "Government confiscation"]', '["property_value", "location", "security_measures", "claims_history"]', false, 'active', '2026-06-04', NULL, '2026-06-04 19:07:31.368931', '2026-06-04 19:07:31.368931');
INSERT INTO public.insurance_products VALUES (9, 'AGR-CRP', 'Crop Insurance', 'Agricultural', 'Crop', 'NAICOM-approved agricultural insurance covering crop failure from weather, pest, disease', 'indemnity', 5000.00, 500000.00, 500000.00, 50000000.00, 18, 70, 1, 30, 'years', '[]', 1, 'Agricultural Insurance', NULL, '["Drought", "Flood", "Pest/disease", "Windstorm", "Fire", "Hail"]', '["Nuclear", "War", "Deliberate destruction", "Failure to follow best practices"]', '["crop_type", "farm_size", "location", "irrigation", "historical_yield"]', false, 'active', '2026-06-04', NULL, '2026-06-04 19:07:31.368931', '2026-06-04 19:07:31.368931');
INSERT INTO public.insurance_products VALUES (10, 'AGR-LVS', 'Livestock Insurance', 'Agricultural', 'Livestock', 'Cover for death or injury of farm animals from disease, accident or natural disaster', 'indemnity', 3000.00, 200000.00, 100000.00, 10000000.00, 18, 70, 1, 30, 'years', '[]', 1, 'Agricultural Insurance', NULL, '["Accidental death", "Disease", "Fire", "Lightning", "Flood", "Theft"]', '["Deliberate slaughter", "Neglect", "Government cull order"]', '["animal_type", "herd_size", "location", "veterinary_care"]', false, 'active', '2026-06-04', NULL, '2026-06-04 19:07:31.368931', '2026-06-04 19:07:31.368931');
INSERT INTO public.insurance_products VALUES (11, 'MAR-CRG', 'Marine Cargo', 'Marine', 'Cargo', 'Insurance for goods in transit by sea, air, or land', 'indemnity', 30000.00, 5000000.00, 5000000.00, 500000000.00, 0, 0, 1, 30, 'years', '[]', 2, 'Marine Insurance', NULL, '["Total loss", "Partial loss", "General average", "Salvage charges"]', '["Delay", "Loss of market", "War (unless extended)", "Strike (unless extended)"]', '["cargo_value", "route", "vessel_type", "packaging", "commodity"]', false, 'active', '2026-06-04', NULL, '2026-06-04 19:07:31.368931', '2026-06-04 19:07:31.368931');
INSERT INTO public.insurance_products VALUES (12, 'ENR-OIL', 'Oil & Gas', 'Energy', 'Upstream', 'Comprehensive energy insurance for oil and gas operations in Nigeria', 'indemnity', 5000000.00, 500000000.00, 100000000.00, 50000000000.00, 0, 0, 1, 30, 'years', '[]', 3, 'Oil and Gas', NULL, '["Physical damage", "Control of well", "Pollution liability", "Business interruption"]', '["War", "Government expropriation", "Fines and penalties"]', '["operation_type", "location", "capacity", "safety_record", "equipment_age"]', false, 'active', '2026-06-04', NULL, '2026-06-04 19:07:31.368931', '2026-06-04 19:07:31.368931');
INSERT INTO public.insurance_products VALUES (13, 'SME-PKG', 'SME Business Package', 'Commercial', 'Package', 'All-in-one policy for small businesses: property, liability, business interruption', 'indemnity', 75000.00, 2000000.00, 10000000.00, 200000000.00, 0, 0, 1, 30, 'years', '[]', 2, 'Commercial Package', NULL, '["Property damage", "Public liability", "Employer liability", "Business interruption", "Money", "Fidelity guarantee"]', '["Professional negligence", "Deliberate acts", "Product recall"]', '["business_type", "turnover", "employees", "location", "claims_history"]', false, 'active', '2026-06-04', NULL, '2026-06-04 19:07:31.368931', '2026-06-04 19:07:31.368931');
INSERT INTO public.insurance_products VALUES (14, 'GRP-LIF', 'Group Life Insurance', 'Life', 'Group', 'Compulsory per Pension Reform Act 2014 — minimum 3x annual emolument', 'benefit', 100000.00, 50000000.00, 3.00, 3.00, 0, 0, 1, 30, 'years', '[]', 2, 'Group Life Assurance', NULL, '["Death benefit (min 3x salary)", "Burial expenses", "Terminal illness"]', '["Suicide", "Pre-existing terminal illness at inception"]', '["group_size", "industry", "avg_age", "hazard_class"]', true, 'active', '2026-06-04', NULL, '2026-06-04 19:07:31.368931', '2026-06-04 19:07:31.368931');
INSERT INTO public.insurance_products VALUES (15, 'PRF-IND', 'Professional Indemnity', 'Liability', 'Professional', 'Coverage for professionals against claims of negligence in service delivery', 'indemnity', 50000.00, 5000000.00, 5000000.00, 500000000.00, 0, 0, 1, 30, 'years', '[]', 2, 'Professional Indemnity', NULL, '["Legal defense costs", "Damages awarded", "Settlement costs"]', '["Criminal acts", "Deliberate breach", "Prior known claims"]', '["profession", "years_experience", "revenue", "claims_history"]', true, 'active', '2026-06-04', NULL, '2026-06-04 19:07:31.368931', '2026-06-04 19:07:31.368931');
INSERT INTO public.insurance_products VALUES (16, 'CYB-001', 'Cyber Liability Insurance', 'Cyber', 'Data Breach', 'Comprehensive cyber risk coverage including data breach response, business interruption, network security liability, and regulatory defense costs', 'indemnity', 150000.00, 5000000.00, 10000000.00, 500000000.00, 18, 99, 1, 30, 'years', '[]', 2, 'Miscellaneous', NULL, '["Data breach notification costs", "Forensic investigation", "Business interruption", "Network security liability", "Regulatory defense", "Ransomware negotiation", "Credit monitoring for affected parties", "Media liability", "Technology E&O"]', '["War or terrorism", "Criminal fines", "Prior known breaches", "Intentional non-compliance", "Unencrypted portable devices"]', '["industry_sector", "annual_revenue", "data_records_count", "security_maturity", "prior_breaches"]', false, 'active', '2026-01-01', NULL, '2026-06-04 20:58:18.975549', '2026-06-04 20:58:18.975549');
INSERT INTO public.insurance_products VALUES (17, 'CYB-002', 'Cyber Crime Protection', 'Cyber', 'Fraud', 'Protection against financial losses from social engineering, phishing, and electronic theft', 'indemnity', 75000.00, 2000000.00, 5000000.00, 100000000.00, 18, 99, 1, 30, 'years', '[]', 1, 'Miscellaneous', NULL, '["Social engineering fraud", "Phishing attack coverage", "Electronic funds transfer fraud", "Invoice manipulation", "CEO impersonation"]', '["Employee collusion", "Voluntary wire transfers to known fraudsters", "Cryptocurrency losses"]', '["employee_count", "annual_transactions", "security_training"]', false, 'active', '2026-01-01', NULL, '2026-06-04 20:58:18.981767', '2026-06-04 20:58:18.981767');
INSERT INTO public.insurance_products VALUES (18, 'TAK-HLT-001', 'Health Takaful Pool', 'Takaful', NULL, 'Sharia-compliant health coverage with shared risk pool. 65% surplus allocation.', NULL, 25000.00, NULL, NULL, 10000000.00, 18, 65, 1, 30, 'years', '[]', 1, NULL, NULL, '[]', '[]', '[]', false, 'active', '2026-06-05', NULL, '2026-06-05 17:02:09.824648', '2026-06-05 17:02:09.824648');
INSERT INTO public.insurance_products VALUES (19, 'TAK-EDU-001', 'Education Takaful', 'Takaful', NULL, 'Education savings with takaful protection. Guaranteed maturity benefit plus surplus sharing.', NULL, 10000.00, NULL, NULL, 20000000.00, 18, 65, 1, 30, 'years', '[]', 1, NULL, NULL, '[]', '[]', '[]', false, 'active', '2026-06-05', NULL, '2026-06-05 17:02:09.824648', '2026-06-05 17:02:09.824648');
INSERT INTO public.insurance_products VALUES (20, 'TAK-MSM-001', 'MSME Takaful', 'Takaful', NULL, 'Micro and small enterprise coverage compliant with Islamic finance principles.', NULL, 30000.00, NULL, NULL, 100000000.00, 18, 65, 1, 30, 'years', '[]', 1, NULL, NULL, '[]', '[]', '[]', false, 'active', '2026-06-05', NULL, '2026-06-05 17:02:09.824648', '2026-06-05 17:02:09.824648');
INSERT INTO public.insurance_products VALUES (21, 'TAK-AGR-001', 'Agricultural Takaful', 'Takaful', NULL, 'Crop and livestock takaful with weather-index triggers and surplus sharing.', NULL, 8000.00, NULL, NULL, 15000000.00, 18, 65, 1, 30, 'years', '[]', 1, NULL, NULL, '[]', '[]', '[]', false, 'active', '2026-06-05', NULL, '2026-06-05 17:02:09.824648', '2026-06-05 17:02:09.824648');
INSERT INTO public.insurance_products VALUES (22, 'TAK-FAM-002', 'Family Takaful Pool', 'Takaful', NULL, 'Sharia-compliant family protection with surplus sharing. 70% participant surplus allocation.', NULL, 20000.00, NULL, NULL, 50000000.00, 18, 65, 1, 30, 'years', '[]', 1, NULL, NULL, '[]', '[]', '[]', false, 'active', '2026-06-05', NULL, '2026-06-05 17:04:56.601644', '2026-06-05 17:04:56.601644');
INSERT INTO public.insurance_products VALUES (23, 'TAK-GEN-002', 'General Takaful Pool', 'Takaful', NULL, 'Sharia-compliant general coverage for motor, property and liability. 60% surplus sharing.', NULL, 15000.00, NULL, NULL, 25000000.00, 18, 65, 1, 30, 'years', '[]', 1, NULL, NULL, '[]', '[]', '[]', false, 'active', '2026-06-05', NULL, '2026-06-05 17:04:56.601644', '2026-06-05 17:04:56.601644');


--
-- Data for Name: insurance_radar_alerts; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.insurance_radar_alerts VALUES (1, 'Motor premium rates increasing 8% YoY', 'Industry-wide motor insurance rates up due to inflation and parts cost increases', 'market', 'warning', 'NAICOM Market Report', '2026-05-20', true, '2026-06-05 04:06:31.289979');
INSERT INTO public.insurance_radar_alerts VALUES (2, 'NAICOM circular on digital policy issuance', 'New requirements for electronic policy documents effective Q3 2026', 'regulatory', 'info', 'NAICOM Circular 2026/05', '2026-05-15', true, '2026-06-05 04:06:31.289979');
INSERT INTO public.insurance_radar_alerts VALUES (3, 'New microinsurance regulations', 'NAICOM introduces simplified licensing for microinsurance providers', 'regulatory', 'info', 'Insurance Act Amendment', '2026-05-10', false, '2026-06-05 04:06:31.289979');
INSERT INTO public.insurance_radar_alerts VALUES (4, 'Competitor launches embedded insurance API', 'AXA Mansard partners with Flutterwave for embedded insurance at checkout', 'competitor', 'warning', 'Industry News', '2026-05-18', true, '2026-06-05 04:06:31.289979');
INSERT INTO public.insurance_radar_alerts VALUES (5, 'Flood risk model update required', 'NIMET releases new flood probability maps for 2026 rainy season', 'market', 'critical', 'NIMET Advisory', '2026-05-22', true, '2026-06-05 04:06:31.289979');
INSERT INTO public.insurance_radar_alerts VALUES (6, 'Pension-linked insurance demand rising', 'Growing demand for annuity-linked products as RSA holders retire', 'market', 'info', 'PenCom Report', '2026-05-12', false, '2026-06-05 04:06:31.289979');


--
-- Data for Name: insuretech_innovations; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.insuretech_innovations VALUES (1, 'Usage-Based Insurance', 'Pay only for what you use with IoT telematics tracking', 'pricing', 'active', 35.00, '2025-06-01', '{IoT,Telematics,ML}', '2026-06-05 04:06:31.252767');
INSERT INTO public.insuretech_innovations VALUES (2, 'Parametric Insurance', 'Automatic payouts triggered by verifiable events (rainfall, earthquake)', 'product', 'active', 15.00, '2025-09-01', '{Satellite,"Smart Contracts",IoT}', '2026-06-05 04:06:31.252767');
INSERT INTO public.insuretech_innovations VALUES (3, 'Peer-to-Peer Insurance', 'Group-based risk sharing with surplus returns', 'distribution', 'pilot', 5.00, '2026-01-15', '{Blockchain,"Smart Contracts"}', '2026-06-05 04:06:31.252767');
INSERT INTO public.insuretech_innovations VALUES (4, 'AI Underwriting', 'Instant decisions with ML risk scoring in < 3 seconds', 'underwriting', 'active', 60.00, '2025-03-01', '{PyTorch,FastAPI,Ray}', '2026-06-05 04:06:31.252767');
INSERT INTO public.insuretech_innovations VALUES (5, 'Embedded Insurance', 'Insurance bundled at point of sale in partner platforms', 'distribution', 'active', 25.00, '2025-08-01', '{API,SDK,Webhooks}', '2026-06-05 04:06:31.252767');
INSERT INTO public.insuretech_innovations VALUES (6, 'Micro-Insurance via USSD', 'Affordable coverage accessible via feature phones', 'distribution', 'active', 40.00, '2025-04-01', '{USSD,SMS,"Mobile Money"}', '2026-06-05 04:06:31.252767');
INSERT INTO public.insuretech_innovations VALUES (7, 'Blockchain Claims Transparency', 'Immutable audit trail for claims processing', 'claims', 'pilot', 8.00, '2026-02-01', '{Hyperledger,IPFS}', '2026-06-05 04:06:31.252767');
INSERT INTO public.insuretech_innovations VALUES (8, 'Voice-First Insurance', 'Policy management via voice commands in local languages', 'engagement', 'beta', 3.00, '2026-04-01', '{NLP,Speech-to-Text,TTS}', '2026-06-05 04:06:31.252767');


--
-- Data for Name: inventory_items; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.inventory_items VALUES (1, 'inventory_items 1', 'Sample 1', 'inventory_items 1', '102.89.1', 1, 1, 1, 1.50, 'in_stock', 'inventory_items 1', '1', '2026-05-29 14:50:04.798415', '2026-05-29 14:50:04.798415', '2026-05-29 14:50:04.798415');
INSERT INTO public.inventory_items VALUES (2, 'inventory_items 2', 'Sample 2', 'inventory_items 2', '102.89.2', 2, 2, 2, 3.00, 'low_stock', 'inventory_items 2', '2', '2026-05-22 14:50:04.798415', '2026-05-22 14:50:04.798415', '2026-05-22 14:50:04.798415');
INSERT INTO public.inventory_items VALUES (3, 'inventory_items 3', 'Sample 3', 'inventory_items 3', '102.89.3', 3, 3, 3, 4.50, 'out_of_stock', 'inventory_items 3', '3', '2026-05-15 14:50:04.798415', '2026-05-15 14:50:04.798415', '2026-05-15 14:50:04.798415');


--
-- Data for Name: invite_codes; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.invite_codes VALUES (1, 'invite_codes 1', 'one_time', 'active', 1, 2, 1, 1, 'invite_codes 1', 's1@ip.ng', 'invite_codes 1', '2026-07-05 14:50:04.802527', '2026-05-29 14:50:04.802527', '2026-05-29 14:50:04.802527');
INSERT INTO public.invite_codes VALUES (2, 'invite_codes 2', 'multi_use', 'used', 2, 4, 2, 2, 'invite_codes 2', 's2@ip.ng', 'invite_codes 2', '2026-08-04 14:50:04.802527', '2026-05-22 14:50:04.802527', '2026-05-22 14:50:04.802527');
INSERT INTO public.invite_codes VALUES (3, 'invite_codes 3', 'multi_use', 'expired', 3, 6, 3, 3, 'invite_codes 3', 's3@ip.ng', 'invite_codes 3', '2026-09-03 14:50:04.802527', '2026-05-15 14:50:04.802527', '2026-05-15 14:50:04.802527');


--
-- Data for Name: knowledge_entities; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.knowledge_entities VALUES (1, 'Motor Insurance', 'product_category', '{"policies": 8500, "lossRatio": 0.42, "avgPremium": 45000}', NULL, '2026-06-05 04:06:31.284722');
INSERT INTO public.knowledge_entities VALUES (2, 'Health Insurance', 'product_category', '{"policies": 6200, "lossRatio": 0.55, "avgPremium": 85000}', NULL, '2026-06-05 04:06:31.284722');
INSERT INTO public.knowledge_entities VALUES (3, 'Life Insurance', 'product_category', '{"policies": 4800, "lossRatio": 0.35, "avgPremium": 120000}', NULL, '2026-06-05 04:06:31.284722');
INSERT INTO public.knowledge_entities VALUES (4, 'Property Insurance', 'product_category', '{"policies": 2100, "lossRatio": 0.38, "avgPremium": 65000}', NULL, '2026-06-05 04:06:31.284722');
INSERT INTO public.knowledge_entities VALUES (5, 'NAICOM', 'regulator', '{"filings": 10, "complianceScore": 98.2}', NULL, '2026-06-05 04:06:31.284722');
INSERT INTO public.knowledge_entities VALUES (6, 'Underwriting Engine', 'system', '{"avgLatency": "2.3s", "decisionsPerDay": 450}', NULL, '2026-06-05 04:06:31.284722');
INSERT INTO public.knowledge_entities VALUES (7, 'Fraud Detection', 'system', '{"accuracy": 0.9599, "alertsPerDay": 12}', NULL, '2026-06-05 04:06:31.284722');
INSERT INTO public.knowledge_entities VALUES (8, 'Claims Adjudication', 'system', '{"autoApprovalRate": 0.68, "avgProcessingHours": 4.2}', NULL, '2026-06-05 04:06:31.284722');


--
-- Data for Name: knowledge_graph_edges; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.knowledge_graph_edges VALUES (1, 1, 'prod-motor', 'reg-naicom', 'regulated_by', 1.0000, '2025-12-07 13:10:21.005185');
INSERT INTO public.knowledge_graph_edges VALUES (2, 1, 'prod-health', 'reg-naicom', 'regulated_by', 1.0000, '2025-12-07 13:10:21.005185');
INSERT INTO public.knowledge_graph_edges VALUES (3, 1, 'prod-motor', 'risk-flood', 'covers_risk', 0.7000, '2026-02-05 13:10:21.005185');
INSERT INTO public.knowledge_graph_edges VALUES (4, 1, 'prod-motor', 'ent-leadway', 'reinsured_by', 0.8000, '2026-03-07 13:10:21.005185');


--
-- Data for Name: knowledge_graph_nodes; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.knowledge_graph_nodes VALUES (1, 1, 'prod-motor', 'product', 'Motor Comprehensive', '{"category":"Motor","premium_range":"50K-500K"}', '2025-12-07 13:10:21.00426', '2026-06-05 13:10:21.00426');
INSERT INTO public.knowledge_graph_nodes VALUES (2, 1, 'prod-health', 'product', 'Health Family', '{"category":"Health","premium_range":"100K-1M"}', '2025-12-07 13:10:21.00426', '2026-06-05 13:10:21.00426');
INSERT INTO public.knowledge_graph_nodes VALUES (3, 1, 'reg-naicom', 'regulation', 'NAICOM Act 2003', '{"jurisdiction":"Nigeria","sector":"insurance"}', '2025-12-07 13:10:21.00426', '2026-06-05 13:10:21.00426');
INSERT INTO public.knowledge_graph_nodes VALUES (4, 1, 'risk-flood', 'risk', 'Lagos Flood Risk', '{"type":"parametric","trigger":"rainfall>200mm"}', '2026-02-05 13:10:21.00426', '2026-06-05 13:10:21.00426');
INSERT INTO public.knowledge_graph_nodes VALUES (5, 1, 'ent-leadway', 'entity', 'Leadway Assurance', '{"type":"reinsurer","rating":"A-"}', '2026-03-07 13:10:21.00426', '2026-06-05 13:10:21.00426');


--
-- Data for Name: kyb_profiles; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.kyb_profiles VALUES (1, 2, 'Munis Enterprises Ltd', 'RC-1234567', '12345678-0001', 'Limited Liability', '2018-06-15', '12 Marina Road, Lagos Island', true, true, true, true, 'verified', 3, '2026-06-04 19:07:31.375132');
INSERT INTO public.kyb_profiles VALUES (2, 6, 'AgroFarms Nigeria', 'RC-7654321', '76543210-0001', 'Partnership', '2020-03-01', '45 Zaria Road, Kaduna', true, true, false, false, 'in_progress', 1, '2026-06-04 19:07:31.375132');


--
-- Data for Name: kyc_documents; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.kyc_documents VALUES (1, 7, 'standard', 'KYC-2026-001', '/uploads/kyc_documents/1.pdf', 'active', 1, '2026-05-29 14:49:33.959348', 'Sample data for kyc_documents record 1', '2026-05-29 14:49:33.959348', '2026-05-29 14:49:33.959348');
INSERT INTO public.kyc_documents VALUES (2, 8, 'standard', 'KYC-2026-002', '/uploads/kyc_documents/2.pdf', 'active', 2, '2026-05-22 14:49:33.959348', 'Sample data for kyc_documents record 2', '2026-05-22 14:49:33.959348', '2026-05-22 14:49:33.959348');
INSERT INTO public.kyc_documents VALUES (3, 9, 'standard', 'KYC-2026-003', '/uploads/kyc_documents/3.pdf', 'active', 3, '2026-05-15 14:49:33.959348', 'Sample data for kyc_documents record 3', '2026-05-15 14:49:33.959348', '2026-05-15 14:49:33.959348');


--
-- Data for Name: kyc_profiles; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.kyc_profiles VALUES (1, 1, 3, 'verified', true, true, true, true, true, 98.50, 'low', false, false, '22200000001', '10000000001', '1985-03-15', 'Software Engineer', 25000000.00, 'Employment', '2026-06-04 19:07:31.3736', '2027-06-04 19:07:31.3736', '2026-06-04 19:07:31.3736', '2026-06-04 19:07:31.3736');
INSERT INTO public.kyc_profiles VALUES (2, 2, 2, 'verified', true, true, true, false, true, 95.20, 'standard', false, false, '22200000002', '10000000002', '1990-07-22', 'Business Owner', 15000000.00, 'Business', '2026-06-04 19:07:31.3736', '2027-06-04 19:07:31.3736', '2026-06-04 19:07:31.3736', '2026-06-04 19:07:31.3736');
INSERT INTO public.kyc_profiles VALUES (3, 3, 1, 'in_progress', true, false, true, false, false, NULL, 'standard', false, false, '22200000003', NULL, '1978-11-08', 'Civil Servant', 8000000.00, 'Employment', NULL, NULL, '2026-06-04 19:07:31.3736', '2026-06-04 19:07:31.3736');
INSERT INTO public.kyc_profiles VALUES (4, 4, 0, 'pending', false, false, false, false, false, NULL, 'unknown', false, false, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-06-04 19:07:31.3736', '2026-06-04 19:07:31.3736');
INSERT INTO public.kyc_profiles VALUES (5, 5, 3, 'verified', true, true, true, true, true, 97.80, 'low', false, false, '22200000005', '10000000005', '1982-05-19', 'Doctor', 35000000.00, 'Professional', '2026-06-04 19:07:31.3736', '2027-06-04 19:07:31.3736', '2026-06-04 19:07:31.3736', '2026-06-04 19:07:31.3736');
INSERT INTO public.kyc_profiles VALUES (6, 6, 2, 'verified', true, true, true, true, false, 92.10, 'medium', false, false, '22200000006', '10000000006', '1995-01-30', 'Trader', 6000000.00, 'Trading', '2026-06-04 19:07:31.3736', '2026-12-04 19:07:31.3736', '2026-06-04 19:07:31.3736', '2026-06-04 19:07:31.3736');
INSERT INTO public.kyc_profiles VALUES (8, 101, 1, 'verified', true, true, true, false, false, NULL, 'low', false, false, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-06-04 22:06:07.495281', '2026-06-04 22:06:07.495281');
INSERT INTO public.kyc_profiles VALUES (9, 102, 2, 'verified', true, true, true, true, false, NULL, 'low', false, false, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-06-04 22:06:07.495281', '2026-06-04 22:06:07.495281');
INSERT INTO public.kyc_profiles VALUES (10, 103, 3, 'verified', true, true, true, true, false, NULL, 'low', false, false, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-06-04 22:06:07.495281', '2026-06-04 22:06:07.495281');
INSERT INTO public.kyc_profiles VALUES (11, 101, 1, 'verified', true, true, true, false, false, NULL, 'low', false, false, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-06-04 22:06:22.732208', '2026-06-04 22:06:22.732208');
INSERT INTO public.kyc_profiles VALUES (12, 102, 2, 'verified', true, true, true, true, false, NULL, 'low', false, false, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-06-04 22:06:22.732208', '2026-06-04 22:06:22.732208');
INSERT INTO public.kyc_profiles VALUES (13, 103, 3, 'verified', true, true, true, true, false, NULL, 'low', false, false, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-06-04 22:06:22.732208', '2026-06-04 22:06:22.732208');
INSERT INTO public.kyc_profiles VALUES (14, 104, 0, 'pending', false, false, false, false, false, NULL, 'unknown', false, false, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-06-04 22:36:43.370209', '2026-06-04 22:36:43.370209');
INSERT INTO public.kyc_profiles VALUES (15, 105, 0, 'pending', false, false, false, false, false, NULL, 'unknown', false, false, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-06-04 22:36:45.398072', '2026-06-04 22:36:45.398072');
INSERT INTO public.kyc_profiles VALUES (16, 106, 0, 'pending', false, false, false, false, false, NULL, 'unknown', false, false, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-06-05 00:10:43.084335', '2026-06-05 00:10:43.084335');
INSERT INTO public.kyc_profiles VALUES (17, 107, 0, 'pending', false, false, false, false, false, NULL, 'unknown', false, false, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-06-05 00:10:55.948204', '2026-06-05 00:10:55.948204');
INSERT INTO public.kyc_profiles VALUES (18, 108, 3, 'verified', false, false, false, false, false, NULL, 'low', false, false, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-06-05 00:28:09.312647', '2026-06-05 00:28:09.312647');
INSERT INTO public.kyc_profiles VALUES (19, 109, 0, 'pending', false, false, false, false, false, NULL, 'unknown', false, false, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-06-05 13:32:41.297351', '2026-06-05 13:32:41.297351');
INSERT INTO public.kyc_profiles VALUES (20, 110, 0, 'pending', false, false, false, false, false, NULL, 'unknown', false, false, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-06-05 15:38:51.930732', '2026-06-05 15:38:51.930732');
INSERT INTO public.kyc_profiles VALUES (21, 111, 0, 'pending', false, false, false, false, false, NULL, 'unknown', false, false, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-06-05 15:52:16.090183', '2026-06-05 15:52:16.090183');
INSERT INTO public.kyc_profiles VALUES (22, 112, 0, 'pending', false, false, false, false, false, NULL, 'unknown', false, false, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-06-05 15:54:03.825918', '2026-06-05 15:54:03.825918');
INSERT INTO public.kyc_profiles VALUES (23, 113, 0, 'pending', false, false, false, false, false, NULL, 'unknown', false, false, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-06-05 16:03:01.173112', '2026-06-05 16:03:01.173112');
INSERT INTO public.kyc_profiles VALUES (24, 114, 0, 'pending', false, false, false, false, false, NULL, 'unknown', false, false, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-06-05 16:06:31.72569', '2026-06-05 16:06:31.72569');
INSERT INTO public.kyc_profiles VALUES (25, 115, 0, 'pending', false, false, false, false, false, NULL, 'unknown', false, false, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-06-05 16:37:46.86255', '2026-06-05 16:37:46.86255');
INSERT INTO public.kyc_profiles VALUES (26, 116, 0, 'pending', false, false, false, false, false, NULL, 'unknown', false, false, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-06-05 16:38:18.289808', '2026-06-05 16:38:18.289808');
INSERT INTO public.kyc_profiles VALUES (27, 117, 0, 'pending', false, false, false, false, false, NULL, 'unknown', false, false, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-06-05 16:59:35.482834', '2026-06-05 16:59:35.482834');
INSERT INTO public.kyc_profiles VALUES (28, 118, 0, 'pending', false, false, false, false, false, NULL, 'unknown', false, false, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-06-05 17:04:32.932539', '2026-06-05 17:04:32.932539');
INSERT INTO public.kyc_profiles VALUES (29, 119, 0, 'pending', false, false, false, false, false, NULL, 'unknown', false, false, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-06-05 17:31:25.613848', '2026-06-05 17:31:25.613848');


--
-- Data for Name: kyc_sessions; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.kyc_sessions VALUES (1, 7, 'kyc_sessions 1', 1.50, 'kyc_sessions 1', 'kyc_sessions 1', true, 'kyc_sessions 1', 'kyc_sessions 1', 'kyc_sessions 1', 'kyc_sessions 1', 1.5000, '{"data": "sample_1"}', '{"data": "sample_1"}', '{"data": "sample_1"}', '1', 'kyc_sessions 1', '2026-05-29 14:50:04.808181', '2026-05-29 14:50:04.808181', 1, 'kyc_sessions 1', 'kyc_sessions 1', 'kyc_ses 1', 'kyc_ses 1', '/api/1', '/api/1', 'kyc_sessions 1', 'kyc_sessions 1', 1.50, 'kyc_sessions 1', 'kyc_sessions 1', '2026-05-29 14:50:04.808181', '2026-07-05 14:50:04.808181', '2026-05-29 14:50:04.808181', 1);
INSERT INTO public.kyc_sessions VALUES (2, 8, 'kyc_sessions 2', 3.00, 'kyc_sessions 2', 'kyc_sessions 2', false, 'kyc_sessions 2', 'kyc_sessions 2', 'kyc_sessions 2', 'kyc_sessions 2', 3.0000, '{"data": "sample_2"}', '{"data": "sample_2"}', '{"data": "sample_2"}', '2', 'kyc_sessions 2', '2026-05-22 14:50:04.808181', '2026-05-22 14:50:04.808181', 2, 'kyc_sessions 2', 'kyc_sessions 2', 'kyc_ses 2', 'kyc_ses 2', '/api/2', '/api/2', 'kyc_sessions 2', 'kyc_sessions 2', 3.00, 'kyc_sessions 2', 'kyc_sessions 2', '2026-05-22 14:50:04.808181', '2026-08-04 14:50:04.808181', '2026-05-22 14:50:04.808181', 2);
INSERT INTO public.kyc_sessions VALUES (3, 9, 'kyc_sessions 3', 4.50, 'kyc_sessions 3', 'kyc_sessions 3', false, 'kyc_sessions 3', 'kyc_sessions 3', 'kyc_sessions 3', 'kyc_sessions 3', 4.5000, '{"data": "sample_3"}', '{"data": "sample_3"}', '{"data": "sample_3"}', '3', 'kyc_sessions 3', '2026-05-15 14:50:04.808181', '2026-05-15 14:50:04.808181', 3, 'kyc_sessions 3', 'kyc_sessions 3', 'kyc_ses 3', 'kyc_ses 3', '/api/3', '/api/3', 'kyc_sessions 3', 'kyc_sessions 3', 4.50, 'kyc_sessions 3', 'kyc_sessions 3', '2026-05-15 14:50:04.808181', '2026-09-03 14:50:04.808181', '2026-05-15 14:50:04.808181', 3);


--
-- Data for Name: kyc_verifications; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.kyc_verifications VALUES (1, 1, 'standard', 'standard', 'KYC-2026-001', 'active', '2026-05-29 14:49:33.981178', '2026-07-05 14:49:33.981178', 1.5000, '2026-05-29 14:49:33.981178', '2026-05-29 14:49:33.981178');
INSERT INTO public.kyc_verifications VALUES (2, 2, 'standard', 'standard', 'KYC-2026-002', 'active', '2026-05-22 14:49:33.981178', '2026-08-04 14:49:33.981178', 3.0000, '2026-05-22 14:49:33.981178', '2026-05-22 14:49:33.981178');
INSERT INTO public.kyc_verifications VALUES (3, 3, 'standard', 'standard', 'KYC-2026-003', 'active', '2026-05-15 14:49:33.981178', '2026-09-03 14:49:33.981178', 4.5000, '2026-05-15 14:49:33.981178', '2026-05-15 14:49:33.981178');


--
-- Data for Name: load_test_runs; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.load_test_runs VALUES (1, '1', 'running', '2026-05-29 14:50:04.813628', '2026-05-29 14:50:04.813628', 'load_test_runs 1', 1, 30, 1, 1.50, 2, '{"data": "sample_1"}', 'load_test_runs 1');
INSERT INTO public.load_test_runs VALUES (2, '2', 'completed', '2026-05-22 14:50:04.813628', '2026-05-22 14:50:04.813628', 'load_test_runs 2', 2, 60, 2, 3.00, 4, '{"data": "sample_2"}', 'load_test_runs 2');
INSERT INTO public.load_test_runs VALUES (3, '3', 'failed', '2026-05-15 14:50:04.813628', '2026-05-15 14:50:04.813628', 'load_test_runs 3', 3, 90, 3, 4.50, 6, '{"data": "sample_3"}', 'load_test_runs 3');


--
-- Data for Name: loyalty_history; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.loyalty_history VALUES (1, 7, 1, 'earned', 1, '102.89.1', 50000, '2026-05-29 14:50:04.817625');
INSERT INTO public.loyalty_history VALUES (2, 8, 2, 'redeemed', 2, '102.89.2', 100000, '2026-05-22 14:50:04.817625');
INSERT INTO public.loyalty_history VALUES (3, 9, 3, 'bonus', 3, '102.89.3', 150000, '2026-05-15 14:50:04.817625');


--
-- Data for Name: loyalty_points; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.loyalty_points VALUES (1, 1, 1, 'loyalty points 1', 1, 1, '2026-05-29 14:49:34.018531');
INSERT INTO public.loyalty_points VALUES (2, 2, 2, 'loyalty points 2', 2, 2, '2026-05-22 14:49:34.018531');
INSERT INTO public.loyalty_points VALUES (3, 3, 3, 'loyalty points 3', 3, 3, '2026-05-15 14:49:34.018531');


--
-- Data for Name: loyalty_tiers; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.loyalty_tiers VALUES (1, 'Bronze', 0, 5.00, '{"Basic support","5% renewal discount","Birthday bonus points"}', '#CD7F32', 'shield');
INSERT INTO public.loyalty_tiers VALUES (2, 'Silver', 5000, 10.00, '{"Priority support","10% renewal discount","Free roadside assistance","Quarterly bonus points"}', '#C0C0C0', 'star');
INSERT INTO public.loyalty_tiers VALUES (3, 'Gold', 15000, 15.00, '{"Dedicated agent","15% discount","Free roadside","Annual health check","Priority claims"}', '#FFD700', 'crown');
INSERT INTO public.loyalty_tiers VALUES (4, 'Platinum', 30000, 20.00, '{"VIP support","20% discount","All Gold benefits","Travel insurance","Family coverage add-on","Annual retreat"}', '#E5E4E2', 'diamond');


--
-- Data for Name: loyalty_transactions; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.loyalty_transactions VALUES (1, 1, 1, 'standard', 'Sample data for loyalty_transactions record 1', '1', '2026-05-29 14:49:34.023');
INSERT INTO public.loyalty_transactions VALUES (2, 2, 2, 'standard', 'Sample data for loyalty_transactions record 2', '2', '2026-05-22 14:49:34.023');
INSERT INTO public.loyalty_transactions VALUES (3, 3, 3, 'standard', 'Sample data for loyalty_transactions record 3', '3', '2026-05-15 14:49:34.023');


--
-- Data for Name: mcmc_results; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.mcmc_results VALUES (1, 1, '1', 1, 1.50, 1.50, 1.50, 1.50, 1.50, 'active', '2026-05-29 14:49:34.027809');
INSERT INTO public.mcmc_results VALUES (2, 2, '2', 2, 3.00, 3.00, 3.00, 3.00, 3.00, 'active', '2026-05-22 14:49:34.027809');
INSERT INTO public.mcmc_results VALUES (3, 3, '3', 3, 4.50, 4.50, 4.50, 4.50, 4.50, 'active', '2026-05-15 14:49:34.027809');


--
-- Data for Name: mcmc_simulations; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.mcmc_simulations VALUES (1, 'MCMC-2026-Q2-001', 'loss_ratio_prediction', 50000, 10000, true, 1.010, 4200, '{"severity": 250000, "frequency": 0.08, "lossRatio": 0.62, "tailParameter": 1.45}', '{"severity": [180000, 320000], "frequency": [0.05, 0.11], "lossRatio": [0.55, 0.69]}', '2026-06-05 04:06:31.270359');
INSERT INTO public.mcmc_simulations VALUES (2, 'MCMC-2026-Q2-002', 'reserve_adequacy', 100000, 20000, true, 1.003, 8500, '{"caseReserve": 864000000, "ibnrReserve": 212500000, "developmentFactor": 1.35}', '{"caseReserve": [780000000, 950000000], "ibnrReserve": [185000000, 240000000]}', '2026-06-05 04:06:31.270359');
INSERT INTO public.mcmc_simulations VALUES (3, 'MCMC-2026-Q2-003', 'catastrophe_model', 200000, 50000, true, 1.005, 12000, '{"annualLoss": 1500000000, "peakExposure": 8500000000, "returnPeriod": 25}', '{"annualLoss": [800000000, 2200000000], "returnPeriod": [15, 40]}', '2026-06-05 04:06:31.270359');


--
-- Data for Name: mdm_geofence_violations; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.mdm_geofence_violations VALUES (1, 1, 'MDM-2026-001', 'MDM-2026-001', 1, 'mdm geofence violations 1', 'standard', 1, 1, 1, 'active', '2026-05-29 14:49:34.032584', '2026-05-29 14:49:34.032584', '2026-05-29 14:49:34.032584', '2026-05-29 14:49:34.032584');
INSERT INTO public.mdm_geofence_violations VALUES (2, 2, 'MDM-2026-002', 'MDM-2026-002', 2, 'mdm geofence violations 2', 'standard', 2, 2, 2, 'active', '2026-05-22 14:49:34.032584', '2026-05-22 14:49:34.032584', '2026-05-22 14:49:34.032584', '2026-05-22 14:49:34.032584');
INSERT INTO public.mdm_geofence_violations VALUES (3, 3, 'MDM-2026-003', 'MDM-2026-003', 3, 'mdm geofence violations 3', 'standard', 3, 3, 3, 'active', '2026-05-15 14:49:34.032584', '2026-05-15 14:49:34.032584', '2026-05-15 14:49:34.032584', '2026-05-15 14:49:34.032584');


--
-- Data for Name: merchant_kyc_docs; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.merchant_kyc_docs VALUES (1, 1, 'standard', '/uploads/merchant_kyc_docs/1.pdf', 'active', 1, '2026-05-29 14:49:34.037417', 'Sample data for merchant_kyc_docs record 1', '2026-07-05 14:49:34.037417', '2026-05-29 14:49:34.037417');
INSERT INTO public.merchant_kyc_docs VALUES (2, 2, 'standard', '/uploads/merchant_kyc_docs/2.pdf', 'active', 2, '2026-05-22 14:49:34.037417', 'Sample data for merchant_kyc_docs record 2', '2026-08-04 14:49:34.037417', '2026-05-22 14:49:34.037417');
INSERT INTO public.merchant_kyc_docs VALUES (3, 3, 'standard', '/uploads/merchant_kyc_docs/3.pdf', 'active', 3, '2026-05-15 14:49:34.037417', 'Sample data for merchant_kyc_docs record 3', '2026-09-03 14:49:34.037417', '2026-05-15 14:49:34.037417');


--
-- Data for Name: merchant_payouts; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.merchant_payouts VALUES (1, 1, 50000.00, 'merchant payouts 1', 'MER-2026-001', 'MER-2026-001', 'merchant payouts 1', 'MER-2026-001', 'active', '2026-05-29 14:49:34.041616', 'Sample data for merchant_payouts record 1', '2026-05-29 14:49:34.041616', '2026-07-05 14:49:34.041616', 5, '2026-05-29 14:49:34.041616');
INSERT INTO public.merchant_payouts VALUES (2, 2, 100000.00, 'merchant payouts 2', 'MER-2026-002', 'MER-2026-002', 'merchant payouts 2', 'MER-2026-002', 'active', '2026-05-22 14:49:34.041616', 'Sample data for merchant_payouts record 2', '2026-05-22 14:49:34.041616', '2026-08-04 14:49:34.041616', 10, '2026-05-22 14:49:34.041616');
INSERT INTO public.merchant_payouts VALUES (3, 3, 150000.00, 'merchant payouts 3', 'MER-2026-003', 'MER-2026-003', 'merchant payouts 3', 'MER-2026-003', 'active', '2026-05-15 14:49:34.041616', 'Sample data for merchant_payouts record 3', '2026-05-15 14:49:34.041616', '2026-09-03 14:49:34.041616', 15, '2026-05-15 14:49:34.041616');


--
-- Data for Name: merchant_settlements; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.merchant_settlements VALUES (1, 5, '2026-05', 2500000.00, 37500.00, 2462500.00, 'NGN', 'settled', '2026-05-29 14:50:52.593474', 'BNK-001', '2026-05-29 14:50:52.593474');
INSERT INTO public.merchant_settlements VALUES (2, 6, '2026-05', 1200000.00, 18000.00, 1182000.00, 'NGN', 'pending', NULL, NULL, '2026-06-02 14:50:52.593474');


--
-- Data for Name: merchants; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.merchants VALUES (5, 'merchants 1', 'merchants 1', 'merchants 1', 'merchants 1', 'merchants 1', 'merchants 1', 'retail', 'pending', 'merchants 1', 'merchants 1', 'merchants 1', 'mercha 1', 'merchants 1', 1.50, 1.50, 1, 1, 'merchants 1', 'merchants 1', '2026-05-29 14:50:36.452911', 1, '2026-05-29 14:50:36.452911', '2026-05-29 14:50:36.452911');
INSERT INTO public.merchants VALUES (6, 'merchants 2', 'merchants 2', 'merchants 2', 'merchants 2', 'merchants 2', 'merchants 2', 'food_beverage', 'active', 'merchants 2', 'merchants 2', 'merchants 2', 'mercha 2', 'merchants 2', 3.00, 3.00, 2, 2, 'merchants 2', 'merchants 2', '2026-05-22 14:50:36.452911', 2, '2026-05-22 14:50:36.452911', '2026-05-22 14:50:36.452911');
INSERT INTO public.merchants VALUES (7, 'merchants 3', 'merchants 3', 'merchants 3', 'merchants 3', 'merchants 3', 'merchants 3', 'health', 'suspended', 'merchants 3', 'merchants 3', 'merchants 3', 'mercha 3', 'merchants 3', 4.50, 4.50, 3, 3, 'merchants 3', 'merchants 3', '2026-05-15 14:50:36.452911', 3, '2026-05-15 14:50:36.452911', '2026-05-15 14:50:36.452911');


--
-- Data for Name: microinsurance_policies; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.microinsurance_policies VALUES (1, 8, 'MIC-CROP-001', 'Crop Shield - Maize', 3500.00, 150000.00, 180, 'active', '2026-11-04 17:10:58.688028', '2026-05-04 17:10:58.688028');
INSERT INTO public.microinsurance_policies VALUES (2, 13, 'MIC-MARKET-001', 'Market Women Shield', 2000.00, 500000.00, 365, 'active', '2027-04-04 17:10:58.688028', '2026-04-04 17:10:58.688028');
INSERT INTO public.microinsurance_policies VALUES (3, 15, 'MIC-OKADA-001', 'Okada Rider Cover', 1500.00, 300000.00, 365, 'active', '2027-03-04 17:10:58.688028', '2026-03-04 17:10:58.688028');
INSERT INTO public.microinsurance_policies VALUES (4, 11, 'MIC-ARTISAN-001', 'Artisan Shield', 2500.00, 400000.00, 365, 'pending', NULL, '2026-05-28 17:10:58.688028');
INSERT INTO public.microinsurance_policies VALUES (5, 7, 'MIC-LIVE-001', 'Livestock Basic - Goats', 1800.00, 200000.00, 365, 'active', '2027-04-04 17:10:58.688028', '2026-04-04 17:10:58.688028');


--
-- Data for Name: model_security_audits; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.model_security_audits VALUES (1, 'fraud_detection_v2', '2026-05-25', 92, 1, 1, '{"Rotate encryption keys quarterly"}', 48, 50, 'low', 'AES-256', true, '2026-06-05 04:06:31.190673');
INSERT INTO public.model_security_audits VALUES (2, 'claims_adjudication_v2', '2026-05-25', 88, 2, 1, '{"Update model weights encryption","Add differential privacy"}', 45, 50, 'medium', 'AES-256', true, '2026-06-05 04:06:31.190673');
INSERT INTO public.model_security_audits VALUES (3, 'churn_prediction_v2', '2026-05-25', 95, 0, 0, '{}', 50, 50, 'low', 'AES-256', true, '2026-06-05 04:06:31.190673');
INSERT INTO public.model_security_audits VALUES (4, 'anomaly_detection_v2', '2026-05-25', 85, 2, 2, '{"Add inference rate limiting","Implement model watermarking"}', 42, 50, 'low', 'AES-256', false, '2026-06-05 04:06:31.190673');


--
-- Data for Name: mqtt_bridge_config; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.mqtt_bridge_config VALUES (1, 'Sample 1', '/api/1', 1, true, 'mqtt_bridge_config 1', 'mqtt_bridge_config 1', '1', '{"data": "sample_1"}', '0', 1, 1, true, '2026-05-29 14:50:04.861932', 'mqtt_bridge_config 1', 'mqtt_bridge_config 1', '2026-05-29 14:50:04.861932', '2026-05-29 14:50:04.861932');
INSERT INTO public.mqtt_bridge_config VALUES (2, 'Sample 2', '/api/2', 2, false, 'mqtt_bridge_config 2', 'mqtt_bridge_config 2', '2', '{"data": "sample_2"}', '1', 2, 2, false, '2026-05-22 14:50:04.861932', 'mqtt_bridge_config 2', 'mqtt_bridge_config 2', '2026-05-22 14:50:04.861932', '2026-05-22 14:50:04.861932');
INSERT INTO public.mqtt_bridge_config VALUES (3, 'Sample 3', '/api/3', 3, false, 'mqtt_bridge_config 3', 'mqtt_bridge_config 3', '3', '{"data": "sample_3"}', '2', 3, 3, false, '2026-05-15 14:50:04.861932', 'mqtt_bridge_config 3', 'mqtt_bridge_config 3', '2026-05-15 14:50:04.861932', '2026-05-15 14:50:04.861932');


--
-- Data for Name: multi_sim_profiles; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.multi_sim_profiles VALUES (1, 1, 1, 'MTN', 'multi_sim_profiles 1', '+234801', 'active', 1, 1.50, 1, '2026-05-29 14:50:04.866955', '2026-05-29 14:50:04.866955', '2026-05-29 14:50:04.866955');
INSERT INTO public.multi_sim_profiles VALUES (2, 2, 2, 'Airtel', 'multi_sim_profiles 2', '+234802', 'inactive', 2, 3.00, 2, '2026-05-22 14:50:04.866955', '2026-05-22 14:50:04.866955', '2026-05-22 14:50:04.866955');
INSERT INTO public.multi_sim_profiles VALUES (3, 3, 3, 'Airtel', 'multi_sim_profiles 3', '+234803', 'suspended', 3, 4.50, 3, '2026-05-15 14:50:04.866955', '2026-05-15 14:50:04.866955', '2026-05-15 14:50:04.866955');


--
-- Data for Name: naicom_automated_reports; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.naicom_automated_reports VALUES (7, 'Quarterly Returns', 'NAICOM-QR-2026-Q2', '2026-Q2', '{"claimsPaid": 380000000, "netPremium": 720000000, "grossPremium": 850000000}', 'submitted', NULL, '2026-07-31', '2026-06-05 00:27:58.242055');
INSERT INTO public.naicom_automated_reports VALUES (8, 'Solvency Report', 'NAICOM-SOL-2026-Q2', '2026-Q2', '{"admittedAssets": 5200000000, "solvencyMargin": 1400000000, "totalLiabilities": 3800000000}', 'draft', NULL, '2026-07-31', '2026-06-05 00:27:58.242055');
INSERT INTO public.naicom_automated_reports VALUES (9, 'Risk-Based Capital', 'NAICOM-RBC-2026-Q2', '2026-Q2', '{"tier1Capital": 2500000000, "tier2Capital": 800000000}', 'pending_review', NULL, '2026-07-31', '2026-06-05 00:27:58.242055');
INSERT INTO public.naicom_automated_reports VALUES (10, 'Investment Returns', 'NAICOM-INV-2026-Q2', '2026-Q2', '{"totalInvestments": 3500000000, "yieldsOnInvestment": 0.045}', 'submitted', NULL, '2026-07-31', '2026-06-05 00:27:58.242055');
INSERT INTO public.naicom_automated_reports VALUES (11, 'Claims Statistics', 'NAICOM-CLM-2026-Q2', '2026-Q2', '{"totalClaims": 1250, "settledClaims": 980, "outstandingClaims": 270}', 'draft', NULL, '2026-07-31', '2026-06-05 00:27:58.242055');
INSERT INTO public.naicom_automated_reports VALUES (12, 'Motor Third Party', 'NAICOM-MTP-2026-Q2', '2026-Q2', '{"thirdPartyPolicies": 18000, "totalMotorPolicies": 25000}', 'submitted', NULL, '2026-07-31', '2026-06-05 00:27:58.242055');


--
-- Data for Name: naicom_data_exchange; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.naicom_data_exchange VALUES (1, 'outbound', 'quarterly_returns', '{"period": "2026-Q1", "netPremium": 2380000000, "grossPremium": 2800000000}', 'acknowledged', 'NAICOM-ACK-2026-Q1-001', NULL, '2026-04-28 00:00:00', '2026-04-29 00:00:00', '2026-06-05 03:20:53.678685');
INSERT INTO public.naicom_data_exchange VALUES (2, 'outbound', 'solvency_report', '{"solvencyRatio": 1.85, "capitalAdequacy": 0.80}', 'acknowledged', 'NAICOM-ACK-2026-Q1-002', NULL, '2026-04-28 00:00:00', '2026-04-30 00:00:00', '2026-06-05 03:20:53.678685');
INSERT INTO public.naicom_data_exchange VALUES (3, 'inbound', 'compliance_notice', '{"type": "reminder", "report": "Investment Report", "deadline": "2026-06-15"}', 'received', 'NAICOM-IN-2026-001', NULL, NULL, '2026-06-01 00:00:00', '2026-06-05 03:20:53.678685');
INSERT INTO public.naicom_data_exchange VALUES (4, 'inbound', 'penalty_notice', '{"type": "penalty", "amount": 500000, "reason": "Late submission of Investment Report"}', 'received', 'NAICOM-IN-2026-002', NULL, NULL, '2026-06-16 00:00:00', '2026-06-05 03:20:53.678685');
INSERT INTO public.naicom_data_exchange VALUES (5, 'outbound', 'claims_report', '{"totalAmount": 485000000, "totalClaims": 142, "avgSettlement": 28}', 'sent', NULL, NULL, '2026-06-01 00:00:00', NULL, '2026-06-05 03:20:53.678685');
INSERT INTO public.naicom_data_exchange VALUES (6, 'inbound', 'circular', '{"ref": "NIC/DIR/CIR/25/009", "subject": "Updated IFRS 17 Disclosure Requirements", "effectiveDate": "2026-07-01"}', 'received', 'NAICOM-CIR-2026-009', NULL, NULL, '2026-05-15 00:00:00', '2026-06-05 03:20:53.678685');
INSERT INTO public.naicom_data_exchange VALUES (7, 'outbound', 'reinsurance_arrangement', '{"treaties": 5, "totalCeded": 3125000000, "retentionRatio": 0.35}', 'acknowledged', 'NAICOM-ACK-2026-RI-001', NULL, '2026-03-31 00:00:00', '2026-04-02 00:00:00', '2026-06-05 03:20:53.678685');
INSERT INTO public.naicom_data_exchange VALUES (8, 'inbound', 'market_conduct_inquiry', '{"caseRef": "MCE/2026/012", "subject": "Customer complaint escalation", "deadline": "2026-06-30"}', 'received', 'NAICOM-MCE-2026-012', NULL, NULL, '2026-06-10 00:00:00', '2026-06-05 03:20:53.678685');
INSERT INTO public.naicom_data_exchange VALUES (9, 'outbound', 'quarterly_returns', '{"period": "2026-Q2", "ifrs17CSM": 3172451279, "claimsPaid": 20242000, "netPremium": 166882000, "reportType": "quarterly_returns", "claimsCount": 14, "submittedAt": "2026-06-05T03:24:49.924Z", "grossPremium": 169082000, "reinsuranceCeded": 2200000}', 'sent', NULL, NULL, '2026-06-05 03:24:49.924427', NULL, '2026-06-05 03:24:49.924427');
INSERT INTO public.naicom_data_exchange VALUES (10, 'outbound', 'quarterly_returns', '{"period": "2026-Q2", "ifrs17CSM": 3172451279, "claimsPaid": 20242000, "netPremium": 166882000, "reportType": "quarterly_returns", "claimsCount": 14, "submittedAt": "2026-06-05T03:31:45.976Z", "grossPremium": 169082000, "reinsuranceCeded": 2200000}', 'sent', NULL, NULL, '2026-06-05 03:31:45.976193', NULL, '2026-06-05 03:31:45.976193');


--
-- Data for Name: naicom_filings; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.naicom_filings VALUES (1, 5, 'Quarterly Returns', 'Q1 2026', 'Submitted', '2026-04-10 00:00:00', '2026-04-30 00:00:00', 'NAICOM/QR/2026/Q1/IP-001', '2026-04-04 17:07:58.335494', '2026-06-04 17:07:58.335494');
INSERT INTO public.naicom_filings VALUES (2, 5, 'Annual Financial Statement', '2025', 'Approved', '2026-03-15 00:00:00', '2026-03-31 00:00:00', 'NAICOM/AFS/2025/IP-001', '2026-03-04 17:07:58.335494', '2026-06-04 17:07:58.335494');
INSERT INTO public.naicom_filings VALUES (3, 5, 'Solvency Margin Report', 'Q1 2026', 'Submitted', '2026-04-12 00:00:00', '2026-04-30 00:00:00', 'NAICOM/SMR/2026/Q1/IP-001', '2026-04-04 17:07:58.335494', '2026-06-04 17:07:58.335494');
INSERT INTO public.naicom_filings VALUES (4, 5, 'Risk-Based Capital Report', 'Q1 2026', 'Under Review', '2026-04-15 00:00:00', '2026-04-30 00:00:00', 'NAICOM/RBCR/2026/Q1/IP-001', '2026-04-04 17:07:58.335494', '2026-06-04 17:07:58.335494');
INSERT INTO public.naicom_filings VALUES (5, 5, 'Claims Experience Report', '2025', 'Approved', '2026-02-28 00:00:00', '2026-03-31 00:00:00', 'NAICOM/CER/2025/IP-001', '2026-02-04 17:07:58.335494', '2026-06-04 17:07:58.335494');
INSERT INTO public.naicom_filings VALUES (6, 5, 'Reinsurance Arrangement', '2026', 'Submitted', '2026-01-31 00:00:00', '2026-02-28 00:00:00', 'NAICOM/RAR/2026/IP-001', '2026-01-04 17:07:58.335494', '2026-06-04 17:07:58.335494');
INSERT INTO public.naicom_filings VALUES (7, 5, 'Investment Report', 'Q2 2026', 'Pending', NULL, '2026-07-31 00:00:00', 'NAICOM/IR/2026/Q2/IP-001', '2026-05-28 17:07:58.335494', '2026-06-04 17:07:58.335494');
INSERT INTO public.naicom_filings VALUES (8, 5, 'AML Report', 'Q1 2026', 'Submitted', '2026-04-28 00:00:00', '2026-04-30 00:00:00', 'NAICOM/AML/2026/Q1/IP-001', '2026-04-04 17:07:58.335494', '2026-06-04 17:07:58.335494');
INSERT INTO public.naicom_filings VALUES (9, 5, 'Market Conduct Report', '2025', 'Approved', '2026-02-15 00:00:00', '2026-03-31 00:00:00', 'NAICOM/MCR/2025/IP-001', '2026-02-04 17:07:58.335494', '2026-06-04 17:07:58.335494');
INSERT INTO public.naicom_filings VALUES (10, 5, 'Quarterly Returns', 'Q2 2026', 'Draft', NULL, '2026-07-31 00:00:00', NULL, '2026-06-03 17:07:58.335494', '2026-06-04 17:07:58.335494');
INSERT INTO public.naicom_filings VALUES (11, 1, 'NDVI Satellite Report', 'Q1-2026', 'processed', '2026-04-05 20:58:18.99283', '2026-05-05 20:58:18.99283', 'NDVI-2026-Q1-BENUE', '2026-06-04 20:58:18.99283', '2026-06-04 20:58:18.99283');
INSERT INTO public.naicom_filings VALUES (12, 2, 'NDVI Satellite Report', 'Q2-2026', 'pending', NULL, '2026-07-04 20:58:18.99283', 'NDVI-2026-Q2-SOKOTO', '2026-06-04 20:58:18.99283', '2026-06-04 20:58:18.99283');


--
-- Data for Name: naicom_financial_reports; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.naicom_financial_reports VALUES (1, 'Quarterly Returns', 'Q1-2026', 'submitted', '{"claimsPaid": 94500000, "netPremium": 598500000, "commissions": 66500000, "grossPremium": 665000000, "solvencyMargin": 185.4, "profitBeforeTax": 287000000, "investmentIncome": 28000000, "outstandingClaims": 45000000, "managementExpenses": 133000000, "capitalAdequacyRatio": 168.2}', '[]', '2026-04-30 00:00:00', '2026-06-04 19:56:03.63756', '2026-06-04 19:56:03.63756');
INSERT INTO public.naicom_financial_reports VALUES (2, 'Quarterly Returns', 'Q2-2026', 'draft', '{"claimsPaid": 108000000, "netPremium": 648000000, "commissions": 72000000, "grossPremium": 720000000, "solvencyMargin": 192.1, "profitBeforeTax": 303000000, "investmentIncome": 31000000, "outstandingClaims": 52000000, "managementExpenses": 144000000, "capitalAdequacyRatio": 175.5}', '[]', NULL, '2026-06-04 19:56:03.63756', '2026-06-04 19:56:03.63756');
INSERT INTO public.naicom_financial_reports VALUES (3, 'Annual Returns', 'FY-2025', 'submitted', '{"claimsPaid": 360000000, "netPremium": 2160000000, "commissions": 240000000, "grossPremium": 2400000000, "solvencyMargin": 175.8, "profitBeforeTax": 1008000000, "investmentIncome": 108000000, "outstandingClaims": 180000000, "managementExpenses": 480000000, "capitalAdequacyRatio": 162.3}', '[]', '2026-03-31 00:00:00', '2026-06-04 19:56:03.63756', '2026-06-04 19:56:03.63756');
INSERT INTO public.naicom_financial_reports VALUES (4, 'Statutory Deposit Certificate', 'FY-2025', 'approved', '{"bankName": "Central Bank of Nigeria", "expiryDate": "2026-12-31", "depositAmount": 1000000000, "certificateNumber": "NAICOM/SD/2025/0842"}', '[]', '2026-01-15 00:00:00', '2026-06-04 19:56:03.63756', '2026-06-04 19:56:03.63756');
INSERT INTO public.naicom_financial_reports VALUES (5, 'Risk-Based Capital Report', 'Q1-2026', 'submitted', '{"creditRisk": 1380000000, "marketRisk": 460000000, "tier1Capital": 6800000000, "tier2Capital": 1700000000, "insuranceRisk": 1840000000, "operationalRisk": 920000000, "requiredCapital": 4600000000, "availableCapital": 8500000000, "capitalAdequacyRatio": 184.8}', '[]', '2026-04-30 00:00:00', '2026-06-04 19:56:03.63756', '2026-06-04 19:56:03.63756');
INSERT INTO public.naicom_financial_reports VALUES (6, 'AML/CFT Report', 'Q1-2026', 'submitted', '{"strs Filed": 5, "pepsIdentified": 12, "sanctionsScreened": 45000, "totalTransactions": 45000, "flaggedTransactions": 23, "enhancedDueDiligence": 8}', '[]', '2026-04-15 00:00:00', '2026-06-04 19:56:03.63756', '2026-06-04 19:56:03.63756');


--
-- Data for Name: naicom_penalties; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.naicom_penalties VALUES (1, 'Investment Report', '2026-May', 'Late Submission', 500000.00, 'Report not submitted by 15 June 2026 deadline', 'outstanding', '2026-07-15', NULL, '2026-06-05 03:20:53.680624');
INSERT INTO public.naicom_penalties VALUES (2, 'Motor Third Party Report', '2026-May', 'Late Submission', 250000.00, 'Report not submitted by 15 June 2026 deadline', 'outstanding', '2026-07-15', NULL, '2026-06-05 03:20:53.680624');
INSERT INTO public.naicom_penalties VALUES (3, 'Reinsurance Arrangement', '2026-H1', 'Late Submission', 750000.00, 'Semi-annual report not submitted by 30 June 2026', 'outstanding', '2026-07-30', NULL, '2026-06-05 03:20:53.680624');


--
-- Data for Name: naicom_reporting_schedule; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.naicom_reporting_schedule VALUES (1, 'Quarterly Returns (Q1)', 'Quarterly', '2026-04-30', 'submitted', 0.00, NULL, 'NIC/DIR/CIR/25/001', '2026-06-05 03:20:53.676323');
INSERT INTO public.naicom_reporting_schedule VALUES (2, 'Quarterly Returns (Q2)', 'Quarterly', '2026-07-31', 'upcoming', 0.00, NULL, 'NIC/DIR/CIR/25/001', '2026-06-05 03:20:53.676323');
INSERT INTO public.naicom_reporting_schedule VALUES (3, 'Quarterly Returns (Q3)', 'Quarterly', '2026-10-31', 'upcoming', 0.00, NULL, 'NIC/DIR/CIR/25/001', '2026-06-05 03:20:53.676323');
INSERT INTO public.naicom_reporting_schedule VALUES (4, 'Annual Statement 2025', 'Annual', '2027-03-31', 'upcoming', 0.00, NULL, 'NIC/DIR/CIR/25/002', '2026-06-05 03:20:53.676323');
INSERT INTO public.naicom_reporting_schedule VALUES (5, 'Solvency Report (Q2)', 'Quarterly', '2026-07-31', 'upcoming', 0.00, NULL, 'NIC/DIR/CIR/25/003', '2026-06-05 03:20:53.676323');
INSERT INTO public.naicom_reporting_schedule VALUES (6, 'Risk-Based Capital (Q2)', 'Quarterly', '2026-07-31', 'upcoming', 0.00, NULL, 'NIC/DIR/CIR/25/004', '2026-06-05 03:20:53.676323');
INSERT INTO public.naicom_reporting_schedule VALUES (7, 'Investment Report (May)', 'Monthly', '2026-06-15', 'overdue', 500000.00, NULL, 'NIC/DIR/CIR/25/005', '2026-06-05 03:20:53.676323');
INSERT INTO public.naicom_reporting_schedule VALUES (8, 'Investment Report (Jun)', 'Monthly', '2026-07-15', 'upcoming', 0.00, NULL, 'NIC/DIR/CIR/25/005', '2026-06-05 03:20:53.676323');
INSERT INTO public.naicom_reporting_schedule VALUES (9, 'Motor Third Party Report (May)', 'Monthly', '2026-06-15', 'overdue', 250000.00, NULL, 'NIC/DIR/CIR/25/006', '2026-06-05 03:20:53.676323');
INSERT INTO public.naicom_reporting_schedule VALUES (10, 'Motor Third Party Report (Jun)', 'Monthly', '2026-07-15', 'upcoming', 0.00, NULL, 'NIC/DIR/CIR/25/006', '2026-06-05 03:20:53.676323');
INSERT INTO public.naicom_reporting_schedule VALUES (11, 'IFRS 17 Transition Report', 'Annual', '2026-12-31', 'upcoming', 0.00, NULL, 'NIC/DIR/CIR/25/007', '2026-06-05 03:20:53.676323');
INSERT INTO public.naicom_reporting_schedule VALUES (12, 'Reinsurance Arrangement Report', 'Semi-Annual', '2026-06-30', 'overdue', 750000.00, NULL, 'NIC/DIR/CIR/25/008', '2026-06-05 03:20:53.676323');


--
-- Data for Name: naicom_returns; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.naicom_returns VALUES (1, 'Quarterly Returns', 'Q1 2026', '2026-04-30', '2026-04-28 00:00:00', 'accepted', '{"claimsPaid": 12000000, "netPremium": 38000000, "grossPremium": 45000000, "investmentIncome": 2500000, "outstandingClaims": 5500000, "managementExpenses": 4500000}', '[]', 'NAICOM-QR-2026-Q1-001', NULL, '2026-06-04 19:07:31.383003');
INSERT INTO public.naicom_returns VALUES (2, 'Risk-Based Capital', 'Q1 2026', '2026-04-30', '2026-04-29 00:00:00', 'accepted', '{"riskCharges": {"credit": 50000000, "market": 120000000, "insurance": 250000000, "operational": 30000000}, "solvencyRatio": 188.9, "requiredCapital": 450000000, "availableCapital": 850000000}', '[]', 'NAICOM-RBC-2026-Q1-001', NULL, '2026-06-04 19:07:31.383003');
INSERT INTO public.naicom_returns VALUES (3, 'Investment Report', 'Q1 2026', '2026-04-30', '2026-04-30 00:00:00', 'accepted', '{"equities": 400000000, "realEstate": 300000000, "corporateBonds": 500000000, "cashAndDeposits": 100000000, "governmentBonds": 1200000000, "totalInvestments": 2500000000}', '[]', 'NAICOM-INV-2026-Q1-001', NULL, '2026-06-04 19:07:31.383003');
INSERT INTO public.naicom_returns VALUES (4, 'Annual Returns', '2025', '2026-03-31', '2026-03-28 00:00:00', 'accepted', '{"lossRatio": 31.5, "expenseRatio": 28.0, "grossPremium": 165000000, "combinedRatio": 59.5, "profitBeforeTax": 45000000, "netClaimsIncurred": 52000000}', '[]', 'NAICOM-AR-2025-001', NULL, '2026-06-04 19:07:31.383003');
INSERT INTO public.naicom_returns VALUES (5, 'Quarterly Returns', 'Q2 2026', '2026-07-31', NULL, 'draft', '{"netPremium": 0, "grossPremium": 0}', '[]', NULL, NULL, '2026-06-04 19:07:31.383003');
INSERT INTO public.naicom_returns VALUES (6, 'Anti-Money Laundering', 'H1 2026', '2026-07-31', NULL, 'in_progress', '{"ctrsFiles": 12, "threshold": 5000000, "suspiciousTransactions": 3}', '[]', NULL, NULL, '2026-06-04 19:07:31.383003');


--
-- Data for Name: ndvi_readings; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.ndvi_readings VALUES (1, 'Kano - Zone A', '2026-05-01', 0.720, 'healthy', 'Sentinel-2', 10, '2026-06-05 04:06:31.212539');
INSERT INTO public.ndvi_readings VALUES (2, 'Kano - Zone A', '2026-05-08', 0.680, 'moderate', 'Sentinel-2', 10, '2026-06-05 04:06:31.212539');
INSERT INTO public.ndvi_readings VALUES (3, 'Kano - Zone A', '2026-05-15', 0.650, 'watch', 'Sentinel-2', 10, '2026-06-05 04:06:31.212539');
INSERT INTO public.ndvi_readings VALUES (4, 'Kano - Zone A', '2026-05-22', 0.710, 'healthy', 'Sentinel-2', 10, '2026-06-05 04:06:31.212539');
INSERT INTO public.ndvi_readings VALUES (5, 'Kaduna - Rice Belt', '2026-05-01', 0.750, 'healthy', 'Sentinel-2', 10, '2026-06-05 04:06:31.212539');
INSERT INTO public.ndvi_readings VALUES (6, 'Kaduna - Rice Belt', '2026-05-08', 0.740, 'healthy', 'Sentinel-2', 10, '2026-06-05 04:06:31.212539');
INSERT INTO public.ndvi_readings VALUES (7, 'Kaduna - Rice Belt', '2026-05-15', 0.620, 'watch', 'Sentinel-2', 10, '2026-06-05 04:06:31.212539');
INSERT INTO public.ndvi_readings VALUES (8, 'Kaduna - Rice Belt', '2026-05-22', 0.580, 'critical', 'Sentinel-2', 10, '2026-06-05 04:06:31.212539');
INSERT INTO public.ndvi_readings VALUES (9, 'Benue - Valley', '2026-05-01', 0.690, 'moderate', 'Sentinel-2', 10, '2026-06-05 04:06:31.212539');
INSERT INTO public.ndvi_readings VALUES (10, 'Benue - Valley', '2026-05-08', 0.700, 'healthy', 'Sentinel-2', 10, '2026-06-05 04:06:31.212539');
INSERT INTO public.ndvi_readings VALUES (11, 'Benue - Valley', '2026-05-15', 0.710, 'healthy', 'Sentinel-2', 10, '2026-06-05 04:06:31.212539');
INSERT INTO public.ndvi_readings VALUES (12, 'Benue - Valley', '2026-05-22', 0.730, 'healthy', 'Sentinel-2', 10, '2026-06-05 04:06:31.212539');


--
-- Data for Name: niira_insurance_classes; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.niira_insurance_classes VALUES (1, 'Motor Third Party Liability', 'Motor', true, 'NAICOM-MTP-01', 5000.00, 'Compulsory insurance for all motor vehicles on Nigerian roads', '{vehicle_owners,fleet_operators}', '2026-06-05 04:06:31.232196');
INSERT INTO public.niira_insurance_classes VALUES (2, 'Employers Liability', 'Liability', true, 'NAICOM-EL-01', 50000.00, 'Covers employer obligations for workplace injuries', '{employers_10plus}', '2026-06-05 04:06:31.232196');
INSERT INTO public.niira_insurance_classes VALUES (3, 'Builders Liability', 'Liability', true, 'NAICOM-BL-01', 100000.00, 'Required for all construction projects above ₦10M', '{construction_companies}', '2026-06-05 04:06:31.232196');
INSERT INTO public.niira_insurance_classes VALUES (4, 'Occupiers Liability', 'Liability', true, 'NAICOM-OL-01', 25000.00, 'Required for commercial premises open to public', '{commercial_premises}', '2026-06-05 04:06:31.232196');
INSERT INTO public.niira_insurance_classes VALUES (5, 'Healthcare Professional Indemnity', 'Professional', true, 'NAICOM-HPI-01', 75000.00, 'Required for all healthcare practitioners', '{doctors,nurses,hospitals}', '2026-06-05 04:06:31.232196');
INSERT INTO public.niira_insurance_classes VALUES (6, 'Marine Cargo Insurance', 'Marine', true, 'NAICOM-MC-01', 15000.00, 'Required for all imported goods', '{importers,shipping_companies}', '2026-06-05 04:06:31.232196');
INSERT INTO public.niira_insurance_classes VALUES (7, 'Group Life Assurance', 'Life', true, 'NAICOM-GL-01', 100000.00, 'Required for employers with 3+ employees under Pension Reform Act', '{employers_3plus}', '2026-06-05 04:06:31.232196');
INSERT INTO public.niira_insurance_classes VALUES (8, 'Motor Comprehensive', 'Motor', false, 'NAICOM-MC-02', 25000.00, 'Full motor coverage including own damage and third party', '{vehicle_owners}', '2026-06-05 04:06:31.232196');


--
-- Data for Name: niira_registrations; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.niira_registrations VALUES (1, 'NIIRA-2026-001', 'InsurePortal Limited', 6, '2026-01-15', '2027-01-15', 'active', 98.50, '{"Motor Third Party","Employers Liability","Builders Liability","Occupiers Liability","Healthcare Professional Indemnity","Marine Cargo"}');


--
-- Data for Name: nmid_verifications; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.nmid_verifications VALUES (1, 1, 'nmid verifications 1', 'NMI-2026-001', 'NMI-2026-001', 'nmid verifications 1', 'nmid verifications 1', 1, 'nmid verifications 1', 'active', 'NMI-2026-001', '2026-05-29 14:49:34.117348', '2026-05-29 14:49:34.117348');
INSERT INTO public.nmid_verifications VALUES (2, 2, 'nmid verifications 2', 'NMI-2026-002', 'NMI-2026-002', 'nmid verifications 2', 'nmid verifications 2', 2, 'nmid verifications 2', 'active', 'NMI-2026-002', '2026-05-22 14:49:34.117348', '2026-05-22 14:49:34.117348');
INSERT INTO public.nmid_verifications VALUES (3, 3, 'nmid verifications 3', 'NMI-2026-003', 'NMI-2026-003', 'nmid verifications 3', 'nmid verifications 3', 3, 'nmid verifications 3', 'active', 'NMI-2026-003', '2026-05-15 14:49:34.117348', '2026-05-15 14:49:34.117348');


--
-- Data for Name: notification_channels; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.notification_channels VALUES (1, 'Email', 'email', '{"provider":"mailgun","domain":"insureportal.ng"}', true, 0, '2025-06-05 13:09:47.578997', NULL);
INSERT INTO public.notification_channels VALUES (2, 'SMS', 'sms', '{"provider":"termii","sender":"InsurePtl"}', true, 0, '2025-06-05 13:09:47.578997', NULL);
INSERT INTO public.notification_channels VALUES (3, 'WhatsApp', 'whatsapp', '{"provider":"twilio","template":"approved"}', true, 0, '2025-12-07 13:09:47.578997', NULL);
INSERT INTO public.notification_channels VALUES (4, 'Push', 'push', '{"provider":"firebase","project":"insureportal"}', true, 0, '2025-06-05 13:09:47.578997', NULL);
INSERT INTO public.notification_channels VALUES (5, 'In-App', 'in_app', '{"storage":"postgresql"}', true, 0, '2025-06-05 13:09:47.578997', NULL);


--
-- Data for Name: notification_dispatch_log; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.notification_dispatch_log VALUES (1, 1, 'standard', 'web', '1', 'notification dispatch log 1', 'notification dispatch log 1', 'active', '1', 5, 1, '2026-05-29 14:49:34.122613', '2026-05-29 14:49:34.122613', 'Sample data for notification_dispatch_log record 1', 'notification dispatch log 1', '2026-05-29 14:49:34.122613');
INSERT INTO public.notification_dispatch_log VALUES (2, 2, 'standard', 'web', '2', 'notification dispatch log 2', 'notification dispatch log 2', 'active', '2', 10, 2, '2026-05-22 14:49:34.122613', '2026-05-22 14:49:34.122613', 'Sample data for notification_dispatch_log record 2', 'notification dispatch log 2', '2026-05-22 14:49:34.122613');
INSERT INTO public.notification_dispatch_log VALUES (3, 3, 'standard', 'web', '3', 'notification dispatch log 3', 'notification dispatch log 3', 'active', '3', 15, 3, '2026-05-15 14:49:34.122613', '2026-05-15 14:49:34.122613', 'Sample data for notification_dispatch_log record 3', 'notification dispatch log 3', '2026-05-15 14:49:34.122613');


--
-- Data for Name: notification_logs; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.notification_logs VALUES (1, 1, '1', 'standard', 'notification logs 1', 'notification logs 1', 'active', '2026-05-29 14:49:34.126234', '2026-05-29 14:49:34.126234', 'Sample data for notification_logs record 1', 5, '2026-05-29 14:49:34.126234');
INSERT INTO public.notification_logs VALUES (2, 2, '2', 'standard', 'notification logs 2', 'notification logs 2', 'active', '2026-05-22 14:49:34.126234', '2026-05-22 14:49:34.126234', 'Sample data for notification_logs record 2', 10, '2026-05-22 14:49:34.126234');
INSERT INTO public.notification_logs VALUES (3, 3, '3', 'standard', 'notification logs 3', 'notification logs 3', 'active', '2026-05-15 14:49:34.126234', '2026-05-15 14:49:34.126234', 'Sample data for notification_logs record 3', 15, '2026-05-15 14:49:34.126234');


--
-- Data for Name: notifications; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.notifications VALUES (1, 1, 'Policy Renewed', 'Your motor insurance policy POL-2026-001 has been renewed for another year', 'policy', 'in_app', false, NULL, '2026-06-04 20:11:24.463611');
INSERT INTO public.notifications VALUES (2, 1, 'Claim Approved', 'Claim CLM-2026-003 has been approved for ₦250,000', 'claim', 'in_app', false, NULL, '2026-06-04 20:11:24.463611');
INSERT INTO public.notifications VALUES (3, 1, 'KYC Verified', 'Your identity verification is now complete. You now have Tier 3 access', 'kyc', 'in_app', true, NULL, '2026-06-04 20:11:24.463611');
INSERT INTO public.notifications VALUES (4, 1, 'Payment Received', 'Premium payment of ₦45,000 received for policy POL-2026-005', 'payment', 'in_app', true, NULL, '2026-06-04 20:11:24.463611');
INSERT INTO public.notifications VALUES (5, 1, 'NAICOM Filing Due', 'Q2 2026 quarterly returns are due by June 30', 'compliance', 'in_app', false, NULL, '2026-06-04 20:11:24.463611');
INSERT INTO public.notifications VALUES (6, 1, 'System Update', 'Platform updated to version 3.2 with enhanced fraud detection', 'system', 'in_app', true, NULL, '2026-06-04 20:11:24.463611');
INSERT INTO public.notifications VALUES (7, 1, 'Approval Required', 'High-value claim CLM-2026-007 requires your review and approval', 'approval', 'in_app', false, NULL, '2026-06-04 20:11:24.463611');
INSERT INTO public.notifications VALUES (8, 1, 'New Product Available', 'Cyber Insurance is now available in the product catalog', 'product', 'in_app', true, NULL, '2026-06-04 20:11:24.463611');
INSERT INTO public.notifications VALUES (9, 1, 'Policy Renewal Reminder', 'Your Motor Comprehensive policy MOT-2026-001 expires on 31 Jul 2026. Renew now to maintain continuous coverage.', 'renewal', 'in_app', false, NULL, '2026-06-02 20:58:18.986835');
INSERT INTO public.notifications VALUES (10, 1, 'Claim Status Update', 'Your claim CLM-2026-003 for ₦250,000 has been approved. Payout will be processed within 48 hours.', 'claim', 'in_app', false, NULL, '2026-06-03 20:58:18.986835');
INSERT INTO public.notifications VALUES (11, 1, 'Premium Payment Received', 'We received your premium payment of ₦45,000 for policy HLT-2026-001. Receipt: RCT-2026-0089', 'premium', 'in_app', true, NULL, '2026-05-30 20:58:18.986835');
INSERT INTO public.notifications VALUES (12, 1, 'KYC Update Required', 'Your KYC profile requires an updated address verification. Please upload a recent utility bill to maintain Tier 2 access.', 'compliance', 'in_app', false, NULL, '2026-06-01 20:58:18.986835');
INSERT INTO public.notifications VALUES (13, 1, 'New Product Available', 'Cyber Liability Insurance is now available! Protect your business from data breaches and cyber attacks. Starting from ₦150,000/year.', 'product', 'in_app', false, NULL, '2026-06-04 20:58:18.986835');


--
-- Data for Name: observability_alerts; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.observability_alerts VALUES (1, 'observability alerts 1', 'observability alerts 1', 'observability alerts 1', 'observability alerts 1', 1.50, 1.50, 'active', 1, '2026-05-29 14:49:34.129594', '2026-05-29 14:49:34.129594', '2026-05-29 14:49:34.129594');
INSERT INTO public.observability_alerts VALUES (2, 'observability alerts 2', 'observability alerts 2', 'observability alerts 2', 'observability alerts 2', 3.00, 3.00, 'active', 2, '2026-05-22 14:49:34.129594', '2026-05-22 14:49:34.129594', '2026-05-22 14:49:34.129594');
INSERT INTO public.observability_alerts VALUES (3, 'observability alerts 3', 'observability alerts 3', 'observability alerts 3', 'observability alerts 3', 4.50, 4.50, 'active', 3, '2026-05-15 14:49:34.129594', '2026-05-15 14:49:34.129594', '2026-05-15 14:49:34.129594');


--
-- Data for Name: ota_releases; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.ota_releases VALUES (1, 'ota releases 1', 'Sample data for ota_releases record 1', 'ota_releases_key_1_681ca4caf554b94cdce5766b81f87535', '/uploads/ota_releases/1.pdf', 'ota releases 1', 1, true, 1, '{"index": 1, "sample": true}', 'ota releases 1', 'active', '2026-05-29 14:49:34.133317', '2026-05-29 14:49:34.133317', '2026-05-29 14:49:34.133317');
INSERT INTO public.ota_releases VALUES (2, 'ota releases 2', 'Sample data for ota_releases record 2', 'ota_releases_key_2_148645d8ca7f308a12bc9443076b4a6e', '/uploads/ota_releases/2.pdf', 'ota releases 2', 2, false, 2, '{"index": 2, "sample": true}', 'ota releases 2', 'active', '2026-05-22 14:49:34.133317', '2026-05-22 14:49:34.133317', '2026-05-22 14:49:34.133317');
INSERT INTO public.ota_releases VALUES (3, 'ota releases 3', 'Sample data for ota_releases record 3', 'ota_releases_key_3_31a510bec11eb96776be43de4de84465', '/uploads/ota_releases/3.pdf', 'ota releases 3', 3, false, 3, '{"index": 3, "sample": true}', 'ota releases 3', 'active', '2026-05-15 14:49:34.133317', '2026-05-15 14:49:34.133317', '2026-05-15 14:49:34.133317');


--
-- Data for Name: ota_update_log; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.ota_update_log VALUES (1, 1, 1, 'ota update log 1', 'ota update log 1', 'active', '2026-05-29 14:49:34.137602', '2026-05-29 14:49:34.137602', 'Sample data for ota_update_log record 1', '2026-05-29 14:49:34.137602');
INSERT INTO public.ota_update_log VALUES (2, 2, 2, 'ota update log 2', 'ota update log 2', 'active', '2026-05-22 14:49:34.137602', '2026-05-22 14:49:34.137602', 'Sample data for ota_update_log record 2', '2026-05-22 14:49:34.137602');
INSERT INTO public.ota_update_log VALUES (3, 3, 3, 'ota update log 3', 'ota update log 3', 'active', '2026-05-15 14:49:34.137602', '2026-05-15 14:49:34.137602', 'Sample data for ota_update_log record 3', '2026-05-15 14:49:34.137602');


--
-- Data for Name: otp_tokens; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.otp_tokens VALUES (1, 7, 'otp_tokens_key_1_5f3c794948315248fdb325f9034c818c', '2026-07-05 14:49:34.142437', true, '2026-05-29 14:49:34.142437', 'otp tokens 1', '2026-05-29 14:49:34.142437');
INSERT INTO public.otp_tokens VALUES (2, 8, 'otp_tokens_key_2_79ff5ea4c46ecd304fd17ab7811af4e0', '2026-08-04 14:49:34.142437', false, '2026-05-22 14:49:34.142437', 'otp tokens 2', '2026-05-22 14:49:34.142437');
INSERT INTO public.otp_tokens VALUES (3, 9, 'otp_tokens_key_3_708c98dad9b40a068bad70ee5f0d543a', '2026-09-03 14:49:34.142437', false, '2026-05-15 14:49:34.142437', 'otp tokens 3', '2026-05-15 14:49:34.142437');


--
-- Data for Name: p2p_memberships; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.p2p_memberships VALUES (1, 1, 1, 1.50, 'active', '2026-05-29 14:49:34.146791');
INSERT INTO public.p2p_memberships VALUES (2, 2, 2, 3.00, 'active', '2026-05-22 14:49:34.146791');
INSERT INTO public.p2p_memberships VALUES (3, 3, 3, 4.50, 'active', '2026-05-15 14:49:34.146791');


--
-- Data for Name: p2p_pools; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.p2p_pools VALUES (1, 'Lagos Motor Club', 1200000.00, 500000.00, 25000.00, 24, 'Active', '2026-06-04 20:59:32.602941', '2026-06-04 20:59:32.602941');
INSERT INTO public.p2p_pools VALUES (2, 'Tech Professionals Health', 900000.00, 750000.00, 35000.00, 18, 'Active', '2026-06-04 20:59:32.602941', '2026-06-04 20:59:32.602941');
INSERT INTO public.p2p_pools VALUES (3, 'Farmers Collective Crop', 875000.00, 300000.00, 15000.00, 35, 'Active', '2026-06-04 20:59:32.602941', '2026-06-04 20:59:32.602941');
INSERT INTO public.p2p_pools VALUES (4, 'Market Traders Shield', 630000.00, 200000.00, 10000.00, 42, 'Active', '2026-06-04 20:59:32.602941', '2026-06-04 20:59:32.602941');


--
-- Data for Name: parametric_triggers; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.parametric_triggers VALUES (1, 'Lagos Flood Index', 'rainfall', 150.00, 'mm/24h', 'Lagos', 5000000.00, 450, '2026-04-15 08:30:00', 'active', '2026-06-05 04:06:31.108349');
INSERT INTO public.parametric_triggers VALUES (2, 'Kano Drought Index', 'drought', 45.00, 'days', 'Kano', 3000000.00, 280, '2026-03-01 00:00:00', 'active', '2026-06-05 04:06:31.108349');
INSERT INTO public.parametric_triggers VALUES (3, 'Niger Delta Flood', 'flood', 2.50, 'meters', 'Rivers', 8000000.00, 120, NULL, 'active', '2026-06-05 04:06:31.108349');
INSERT INTO public.parametric_triggers VALUES (4, 'Abuja Earthquake Monitor', 'earthquake', 4.50, 'richter', 'Abuja', 15000000.00, 35, NULL, 'monitoring', '2026-06-05 04:06:31.108349');
INSERT INTO public.parametric_triggers VALUES (5, 'Benue Valley Rainfall', 'rainfall', 200.00, 'mm/24h', 'Benue', 4000000.00, 195, '2026-05-20 14:00:00', 'triggered', '2026-06-05 04:06:31.108349');
INSERT INTO public.parametric_triggers VALUES (6, 'Sokoto Heat Index', 'drought', 30.00, 'days_above_40C', 'Sokoto', 2500000.00, 340, '2026-04-28 00:00:00', 'active', '2026-06-05 04:06:31.108349');


--
-- Data for Name: password_resets; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.password_resets VALUES (1, '123456', '2026-06-05 15:48:16.509985', '2026-06-05 14:48:16.509985');


--
-- Data for Name: payment_transactions; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.payment_transactions VALUES (1, 'paystack', 'PSK-TXN-001', 45000.00, 'NGN', 'premium_payment', 'success', '{"last4": "4081", "channel": "card", "card_type": "visa"}', 'demo@insureportal.ng', '2026-06-05 00:27:58.242055');
INSERT INTO public.payment_transactions VALUES (2, 'flutterwave', 'FLW-TXN-001', 150000.00, 'NGN', 'claims_payout', 'success', '{"bank": "First Bank", "account": "****7890"}', 'customer1@email.com', '2026-06-05 00:27:58.242055');
INSERT INTO public.payment_transactions VALUES (3, 'paystack', 'PSK-TXN-002', 35000.00, 'NGN', 'premium_payment', 'success', '{"bank": "GTBank", "channel": "bank_transfer"}', 'customer2@email.com', '2026-06-05 00:27:58.242055');
INSERT INTO public.payment_transactions VALUES (4, 'insureportal_pay', 'IPP-TXN-001', 5000.00, 'NGN', 'wallet_topup', 'success', '{"phone": "08012345678", "source": "ussd"}', 'demo@insureportal.ng', '2026-06-05 00:27:58.242055');
INSERT INTO public.payment_transactions VALUES (5, 'paystack', 'PSK-TXN-003', 75000.00, 'NGN', 'premium_payment', 'pending', '{"last4": "5234", "channel": "card", "card_type": "mastercard"}', 'customer3@email.com', '2026-06-05 00:27:58.242055');
INSERT INTO public.payment_transactions VALUES (6, 'paystack', 'PAY-1780620801583', 50000.00, 'NGN', 'premium_payment', 'pending', '{}', 'test@email.com', '2026-06-05 00:53:21.588673');
INSERT INTO public.payment_transactions VALUES (7, 'paystack', 'PAY-1780673830457', 0.00, 'NGN', 'premium_payment', 'pending', '{}', 'customer@email.com', '2026-06-05 15:37:10.457857');
INSERT INTO public.payment_transactions VALUES (8, 'paystack', 'PAY-1780673915134', 50000.00, 'NGN', 'premium_payment', 'pending', '{}', 'test@test.com', '2026-06-05 15:38:35.134982');
INSERT INTO public.payment_transactions VALUES (9, 'paystack', 'PAY-1780673931971', 50000.00, 'NGN', 'premium_payment', 'pending', '{}', 'test@test.com', '2026-06-05 15:38:51.971785');
INSERT INTO public.payment_transactions VALUES (10, 'paystack', 'PAY-1780674736129', 50000.00, 'NGN', 'premium_payment', 'pending', '{}', 'test@test.com', '2026-06-05 15:52:16.130058');
INSERT INTO public.payment_transactions VALUES (11, 'paystack', 'PAY-1780674843864', 50000.00, 'NGN', 'premium_payment', 'pending', '{}', 'test@test.com', '2026-06-05 15:54:03.865208');
INSERT INTO public.payment_transactions VALUES (12, 'paystack', 'PAY-1780675381231', 50000.00, 'NGN', 'premium_payment', 'pending', '{}', 'test@test.com', '2026-06-05 16:03:01.231605');
INSERT INTO public.payment_transactions VALUES (13, 'paystack', 'PAY-1780675591828', 50000.00, 'NGN', 'premium_payment', 'pending', '{}', 'test@test.com', '2026-06-05 16:06:31.828545');
INSERT INTO public.payment_transactions VALUES (14, 'paystack', 'PAY-1780677466923', 50000.00, 'NGN', 'premium_payment', 'pending', '{}', 'test@test.com', '2026-06-05 16:37:46.923297');
INSERT INTO public.payment_transactions VALUES (15, 'paystack', 'PAY-1780677498326', 50000.00, 'NGN', 'premium_payment', 'pending', '{}', 'test@test.com', '2026-06-05 16:38:18.326969');
INSERT INTO public.payment_transactions VALUES (16, 'paystack', 'PAY-1780678775518', 50000.00, 'NGN', 'premium_payment', 'pending', '{}', 'test@test.com', '2026-06-05 16:59:35.518771');
INSERT INTO public.payment_transactions VALUES (17, 'paystack', 'PAY-1780679072988', 50000.00, 'NGN', 'premium_payment', 'pending', '{}', 'test@test.com', '2026-06-05 17:04:32.989117');
INSERT INTO public.payment_transactions VALUES (18, 'paystack', 'PAY-1780680685653', 50000.00, 'NGN', 'premium_payment', 'pending', '{}', 'test@test.com', '2026-06-05 17:31:25.653969');


--
-- Data for Name: payments; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.payments VALUES (1, 1, 1, 15000.00, 'Completed', '2026-03-17 18:23:26.146', '2026-03-19 18:23:26.146', 'Credit Card', NULL, 'NGN', '2026-05-16 18:23:26.152839', '2026-05-16 18:23:26.152839', 'default');
INSERT INTO public.payments VALUES (2, 1, 2, 8500.00, 'Pending', '2026-05-31 18:23:26.146', NULL, NULL, NULL, 'NGN', '2026-05-16 18:23:26.152839', '2026-05-16 18:23:26.152839', 'default');
INSERT INTO public.payments VALUES (3, 1, 3, 25000.00, 'Completed', '2026-04-01 18:23:26.146', '2026-04-03 18:23:26.146', 'Bank Transfer', NULL, 'NGN', '2026-05-16 18:23:26.152839', '2026-05-16 18:23:26.152839', 'default');


--
-- Data for Name: performance_metrics; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.performance_metrics VALUES (1, 'api-gateway', 'response_time_p95', 45.200, 'ms', 100.000, 500.000, '2026-06-05 04:06:31.300282');
INSERT INTO public.performance_metrics VALUES (2, 'api-gateway', 'error_rate', 0.120, '%', 1.000, 5.000, '2026-06-05 04:06:31.300282');
INSERT INTO public.performance_metrics VALUES (3, 'api-gateway', 'requests_per_minute', 2850.000, 'rpm', NULL, NULL, '2026-06-05 04:06:31.300282');
INSERT INTO public.performance_metrics VALUES (4, 'database', 'query_latency_p95', 18.500, 'ms', 50.000, 200.000, '2026-06-05 04:06:31.300282');
INSERT INTO public.performance_metrics VALUES (5, 'database', 'connections_active', 45.000, 'count', 80.000, 95.000, '2026-06-05 04:06:31.300282');
INSERT INTO public.performance_metrics VALUES (6, 'cache', 'hit_ratio', 98.700, '%', 90.000, 80.000, '2026-06-05 04:06:31.300282');
INSERT INTO public.performance_metrics VALUES (7, 'cache', 'memory_usage', 256.000, 'MB', 400.000, 480.000, '2026-06-05 04:06:31.300282');
INSERT INTO public.performance_metrics VALUES (8, 'ml-inference', 'prediction_latency', 125.000, 'ms', 500.000, 2000.000, '2026-06-05 04:06:31.300282');
INSERT INTO public.performance_metrics VALUES (9, 'ml-inference', 'throughput', 45.000, 'req/s', NULL, NULL, '2026-06-05 04:06:31.300282');
INSERT INTO public.performance_metrics VALUES (10, 'payment-gateway', 'success_rate', 99.200, '%', 98.000, 95.000, '2026-06-05 04:06:31.300282');
INSERT INTO public.performance_metrics VALUES (11, 'payment-gateway', 'avg_settlement_time', 3.500, 'seconds', 10.000, 30.000, '2026-06-05 04:06:31.300282');


--
-- Data for Name: pfa_annuities; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.pfa_annuities VALUES (1, 1, 'ARM Pension Managers', 'life', 150000.00, '2040-01-01', 18000000.00, 'active');
INSERT INTO public.pfa_annuities VALUES (2, 1, 'Stanbic IBTC Pension', 'deferred', 200000.00, '2045-01-01', 24000000.00, 'active');


--
-- Data for Name: pfa_annuity_quotes; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.pfa_annuity_quotes VALUES (1, 1, 1, 'pfa annuity quotes 1', 1, 6.46, 1.50, 'standard', 'PFA-2026-001', '2026-05-29 14:49:34.151483', '2026-05-29 14:49:34.151483');
INSERT INTO public.pfa_annuity_quotes VALUES (2, 2, 2, 'pfa annuity quotes 2', 2, 6.47, 3.00, 'standard', 'PFA-2026-002', '2026-05-22 14:49:34.151483', '2026-05-22 14:49:34.151483');
INSERT INTO public.pfa_annuity_quotes VALUES (3, 3, 3, 'pfa annuity quotes 3', 3, 6.48, 4.50, 'standard', 'PFA-2026-003', '2026-05-15 14:49:34.151483', '2026-05-15 14:49:34.151483');


--
-- Data for Name: pfa_integration; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.pfa_integration VALUES (1, 1, 'ARM Pension Managers', 'PEN100234567890', 2500000.00, 3200000.00, 1500000.00, 1000000.00, '2026-06-05', 'active');


--
-- Data for Name: pfa_partners; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.pfa_partners VALUES (1, 'pfa_partners 1', 'pfa_partners 1', 'pfa_partners 1', 0.0500, '{item1}', 'pfa_partners 1', '/api/1', '2026-05-29 14:50:04.871245', '2026-05-29 14:50:04.871245');
INSERT INTO public.pfa_partners VALUES (2, 'pfa_partners 2', 'pfa_partners 2', 'pfa_partners 2', 0.1000, '{item2}', 'pfa_partners 2', '/api/2', '2026-05-22 14:50:04.871245', '2026-05-22 14:50:04.871245');
INSERT INTO public.pfa_partners VALUES (3, 'pfa_partners 3', 'pfa_partners 3', 'pfa_partners 3', 0.1500, '{item3}', 'pfa_partners 3', '/api/3', '2026-05-15 14:50:04.871245', '2026-05-15 14:50:04.871245');


--
-- Data for Name: platform_health_checks; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.platform_health_checks VALUES (1, 'platform health checks 1', 'standard', 'active', 1, 1, 'Sample data for platform_health_checks record 1', 'platform health checks 1', '2026-05-29 14:49:34.174067');
INSERT INTO public.platform_health_checks VALUES (2, 'platform health checks 2', 'standard', 'active', 2, 2, 'Sample data for platform_health_checks record 2', 'platform health checks 2', '2026-05-22 14:49:34.174067');
INSERT INTO public.platform_health_checks VALUES (3, 'platform health checks 3', 'standard', 'active', 3, 3, 'Sample data for platform_health_checks record 3', 'platform health checks 3', '2026-05-15 14:49:34.174067');


--
-- Data for Name: platform_incidents; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.platform_incidents VALUES (1, 'Elevated API Latency', 'Database connection pool exhaustion caused elevated latency on policy queries', 'medium', 'resolved', '["api","postgresql"]', NULL, NULL, NULL, NULL, '2026-05-22 13:09:47.580493', '2026-05-22 13:54:47.580493', '2026-06-05 13:09:47.580493', NULL);
INSERT INTO public.platform_incidents VALUES (2, 'Payment Gateway Timeout', 'Paystack API timeout during peak hours affecting premium collection', 'high', 'resolved', '["payments","paystack"]', NULL, NULL, NULL, NULL, '2026-05-29 13:09:47.580493', '2026-05-29 15:09:47.580493', '2026-06-05 13:09:47.580493', NULL);
INSERT INTO public.platform_incidents VALUES (3, 'Scheduled Maintenance', 'Database migration and index optimization', 'low', 'resolved', '["postgresql"]', NULL, NULL, NULL, NULL, '2026-06-02 13:09:47.580493', '2026-06-02 13:39:47.580493', '2026-06-05 13:09:47.580493', NULL);


--
-- Data for Name: platform_settings; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.platform_settings VALUES (1, 'platform_settings_key_1_ace94562418b703fee0d91fb9a84f93b', 'platform settings 1', 'Sample data for platform_settings record 1', 'platform settings 1', '2026-05-29 14:49:34.178321');
INSERT INTO public.platform_settings VALUES (2, 'platform_settings_key_2_d0837a8ed790ec12a5a5a44d6970fac0', 'platform settings 2', 'Sample data for platform_settings record 2', 'platform settings 2', '2026-05-22 14:49:34.178321');
INSERT INTO public.platform_settings VALUES (3, 'platform_settings_key_3_ead41aaa2476d7813eef875f3d3f4848', 'platform settings 3', 'Sample data for platform_settings record 3', 'platform settings 3', '2026-05-15 14:49:34.178321');


--
-- Data for Name: pnl_reports; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.pnl_reports VALUES (1, 'pnl reports 1', 'standard', 7, 'PNL-2026-001', 1.50, 1.50, 1.50, 1.50, 1.50, 5, 1.50, '2026-05-29 14:49:34.182278');
INSERT INTO public.pnl_reports VALUES (2, 'pnl reports 2', 'standard', 8, 'PNL-2026-002', 3.00, 3.00, 3.00, 3.00, 3.00, 10, 3.00, '2026-05-22 14:49:34.182278');
INSERT INTO public.pnl_reports VALUES (3, 'pnl reports 3', 'standard', 9, 'PNL-2026-003', 4.50, 4.50, 4.50, 4.50, 4.50, 15, 4.50, '2026-05-15 14:49:34.182278');


--
-- Data for Name: policies; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.policies VALUES (1, 1, 'POL-2024-001', 'Comprehensive Health Insurance', 'Health', 15000.00, 'Active', '2026-05-16 18:23:26.146', '2027-05-16 18:23:26.146', NULL, NULL, '2026-05-16 18:23:26.147772', '2026-05-16 18:23:26.147772', 'default');
INSERT INTO public.policies VALUES (2, 1, 'POL-2024-002', 'Auto Insurance - Toyota Camry', 'Auto', 8500.00, 'Active', '2026-05-16 18:23:26.146', '2027-05-16 18:23:26.146', NULL, NULL, '2026-05-16 18:23:26.147772', '2026-05-16 18:23:26.147772', 'default');
INSERT INTO public.policies VALUES (3, 1, 'POL-2024-003', 'Home Insurance - Lagos Property', 'Property', 25000.00, 'Active', '2026-05-16 18:23:26.146', '2027-05-16 18:23:26.146', NULL, NULL, '2026-05-16 18:23:26.147772', '2026-05-16 18:23:26.147772', 'default');
INSERT INTO public.policies VALUES (5, 2, 'POL-2026-HLT-00001', 'Health Premier Plan - Family', 'Health', 85000.00, 'Active', '2026-01-01 00:00:00', '2026-12-31 00:00:00', 10000000.00, '{"planLevel":"Premier","dependents":3,"inPatient":true,"outPatient":true,"dental":true,"optical":true}', '2025-12-04 17:07:58.329412', '2026-06-04 17:07:58.329412', 'default');
INSERT INTO public.policies VALUES (6, 4, 'POL-2026-HLT-00002', 'Health Basic Plan - Individual', 'Health', 25000.00, 'Active', '2026-02-15 00:00:00', '2027-02-14 00:00:00', 2000000.00, '{"planLevel":"Basic","dependents":0,"inPatient":true,"outPatient":true}', '2026-02-04 17:07:58.329412', '2026-06-04 17:07:58.329412', 'default');
INSERT INTO public.policies VALUES (9, 3, 'POL-2026-PRP-00002', 'Residential Property - Kaduna Home', 'Property', 45000.00, 'Active', '2025-12-01 00:00:00', '2026-11-30 00:00:00', 35000000.00, '{"propertyType":"Residential","address":"8 Ahmadu Bello Way, Kaduna","perils":["Fire","Flood","Burglary"]}', '2025-11-04 17:07:58.329412', '2026-06-04 17:07:58.329412', 'default');
INSERT INTO public.policies VALUES (10, 1, 'POL-2026-LIF-00001', 'Term Life 20-Year', 'Life', 120000.00, 'Active', '2025-06-01 00:00:00', '2045-05-31 00:00:00', 50000000.00, '{"policyTerm":20,"beneficiaries":[{"name":"Kemi Ogundimu","relationship":"Spouse","pct":60},{"name":"Tunde Ogundimu","relationship":"Child","pct":40}]}', '2025-06-04 17:07:58.329412', '2026-06-04 17:07:58.329412', 'default');
INSERT INTO public.policies VALUES (15, 5, 'POL-2026-AGR-00001', 'Agricultural Multi-Peril - Rice 10ha', 'Agricultural', 75000.00, 'Active', '2026-04-01 00:00:00', '2026-12-31 00:00:00', 5000000.00, '{"cropType":"Rice","area":10,"unit":"hectares","perils":["Drought","Flood","Pest","Disease"],"yieldGuarantee":"70%"}', '2026-04-04 17:07:58.329412', '2026-06-04 17:07:58.329412', 'default');
INSERT INTO public.policies VALUES (16, 7, 'POL-2026-AGR-00002', 'IBLI Livestock Index - 50 Cattle', 'Agricultural', 120000.00, 'Active', '2026-03-01 00:00:00', '2027-02-28 00:00:00', 15000000.00, '{"livestockType":"Cattle","headCount":50,"indexType":"NDVI Satellite","triggerThreshold":"NDVI < 0.25"}', '2026-03-04 17:07:58.329412', '2026-06-04 17:07:58.329412', 'default');
INSERT INTO public.policies VALUES (17, 6, 'POL-2026-PAR-00001', 'ClimaCash FloodCash - Sokoto', 'Parametric', 8000.00, 'Active', '2026-05-01 00:00:00', '2027-04-30 00:00:00', 100000.00, '{"triggerType":"Rainfall","threshold":"380mm/week","payoutAmount":100000,"dataSource":"NiMet","payoutSpeed":"72 hours"}', '2026-05-04 17:07:58.329412', '2026-06-04 17:07:58.329412', 'default');
INSERT INTO public.policies VALUES (18, 5, 'POL-2025-MTR-00099', 'Motor Third Party - Expired', 'Auto', 20000.00, 'Expired', '2024-12-01 00:00:00', '2025-11-30 00:00:00', 3000000.00, '{"expired":true}', '2024-12-04 17:07:58.329412', '2026-06-04 17:07:58.329412', 'default');
INSERT INTO public.policies VALUES (19, 3, 'POL-2025-HLT-00088', 'Health Plan - Cancelled', 'Health', 35000.00, 'Cancelled', '2025-06-01 00:00:00', '2026-05-31 00:00:00', 5000000.00, '{"cancelledReason":"Switched provider","refundAmount":17500}', '2025-06-04 17:07:58.329412', '2026-06-04 17:07:58.329412', 'default');
INSERT INTO public.policies VALUES (21, 3, 'POL-2026-GL-002', 'Group Life - First Bank Plc 1200 employees', 'Group_Life', 36000000.00, 'Active', '2026-01-01 00:00:00', '2026-12-31 00:00:00', 1200000000.00, NULL, '2026-06-04 20:13:52.444397', '2026-06-04 20:13:52.444397', 'default');
INSERT INTO public.policies VALUES (22, 5, 'POL-2026-GL-003', 'Group Life - GTBank 800 employees', 'Group_Life', 24000000.00, 'Active', '2026-03-01 00:00:00', '2027-02-28 00:00:00', 800000000.00, NULL, '2026-06-04 20:13:52.444397', '2026-06-04 20:13:52.444397', 'default');
INSERT INTO public.policies VALUES (23, 2, 'POL-2026-GL-004', 'Group Life - NNPC Staff 3000 employees', 'Group_Life', 90000000.00, 'Active', '2026-01-15 00:00:00', '2026-12-31 00:00:00', 3000000000.00, NULL, '2026-06-04 20:13:52.444397', '2026-06-04 20:13:52.444397', 'default');
INSERT INTO public.policies VALUES (4, 108, 'POL-2026-MTR-00004', 'Motor Fleet - 12 Delivery Vehicles', 'Auto', 450000.00, 'Active', '2026-03-01 00:00:00', '2027-02-28 00:00:00', 120000000.00, '{"fleetSize":12,"vehicleTypes":["Van","Truck"],"fleetDiscount":15}', '2026-03-04 17:07:58.329412', '2026-06-04 17:07:58.329412', 'default');
INSERT INTO public.policies VALUES (7, 108, 'POL-2026-HLT-00003', 'Health Corporate Plan - 50 employees', 'Health', 2500000.00, 'Active', '2026-04-01 00:00:00', '2027-03-31 00:00:00', 500000000.00, '{"planLevel":"Corporate","employees":50,"inPatient":true,"outPatient":true,"dental":true}', '2026-04-04 17:07:58.329412', '2026-06-04 17:07:58.329412', 'default');
INSERT INTO public.policies VALUES (8, 108, 'POL-2026-PRP-00001', 'Commercial Property - Victoria Island Office', 'Property', 350000.00, 'Active', '2026-01-01 00:00:00', '2026-12-31 00:00:00', 250000000.00, '{"propertyType":"Commercial","address":"33 Akin Adesola, VI, Lagos","constructionType":"Reinforced Concrete","perils":["Fire","Flood","Burglary","Riot"]}', '2025-12-04 17:07:58.329412', '2026-06-04 17:07:58.329412', 'default');
INSERT INTO public.policies VALUES (11, 108, 'POL-2026-LIF-00002', 'Whole Life - 100M Cover', 'Life', 250000.00, 'Active', '2024-01-01 00:00:00', '2099-12-31 00:00:00', 100000000.00, '{"policyTerm":"Whole Life","cashValue":1850000}', '2023-12-04 17:07:58.329412', '2026-06-04 17:07:58.329412', 'default');
INSERT INTO public.policies VALUES (13, 108, 'POL-2026-MIC-00001', 'Crop Shield - Maize 2ha', 'Microinsurance', 3500.00, 'Active', '2026-05-01 00:00:00', '2026-11-30 00:00:00', 150000.00, '{"cropType":"Maize","area":2,"unit":"hectares","triggerCondition":"Rainfall below 20mm in 30 days","payoutModel":"Parametric"}', '2026-05-04 17:07:58.329412', '2026-06-04 17:07:58.329412', 'default');
INSERT INTO public.policies VALUES (14, 108, 'POL-2026-MIC-00002', 'Market Women Shield - Inventory', 'Microinsurance', 2000.00, 'Active', '2026-04-15 00:00:00', '2027-04-14 00:00:00', 500000.00, '{"businessType":"Retail Trade","perils":["Fire","Theft","Flood"]}', '2026-04-04 17:07:58.329412', '2026-06-04 17:07:58.329412', 'default');
INSERT INTO public.policies VALUES (20, 108, 'POL-2026-LIF-00099', 'Term Life - Pending Underwriting', 'Life', 95000.00, 'Pending', '2026-06-01 00:00:00', '2046-05-31 00:00:00', 30000000.00, '{"pendingDocuments":["Medical Report","Income Proof"],"uwStatus":"Awaiting Medical"}', '2026-05-28 17:07:58.329412', '2026-06-04 17:07:58.329412', 'default');
INSERT INTO public.policies VALUES (12, 108, 'POL-2026-GRP-00001', 'Group Life - Dangote Industries 500 employees', 'Group_Life', 15000000.00, 'Active', '2026-01-01 00:00:00', '2026-12-31 00:00:00', 999999999.00, '{"employeeCount":500,"averageSalary":450000,"multiplier":3}', '2025-12-04 17:07:58.329412', '2026-06-04 17:07:58.329412', 'default');


--
-- Data for Name: pos_terminals; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.pos_terminals VALUES (1, 'POS-2026-001', 'pos terminals 1', 'pos terminals 1', 'pos terminals 1', 7, 'active', '2026-05-29 14:49:34.189123', 'pos terminals 1', '{"index": 1, "sample": true}', 1, '2026-05-29 14:49:34.189123', '2026-05-29 14:49:34.189123', 'pos terminals 1', 'pos terminals 1', 'pos terminals 1', '2026-05-29 14:49:34.189123', '{"index": 1, "sample": true}', '2026-05-29 14:49:34.189123', 1);
INSERT INTO public.pos_terminals VALUES (2, 'POS-2026-002', 'pos terminals 2', 'pos terminals 2', 'pos terminals 2', 8, 'active', '2026-05-22 14:49:34.189123', 'pos terminals 2', '{"index": 2, "sample": true}', 2, '2026-05-22 14:49:34.189123', '2026-05-22 14:49:34.189123', 'pos terminals 2', 'pos terminals 2', 'pos terminals 2', '2026-05-22 14:49:34.189123', '{"index": 2, "sample": true}', '2026-05-22 14:49:34.189123', 2);
INSERT INTO public.pos_terminals VALUES (3, 'POS-2026-003', 'pos terminals 3', 'pos terminals 3', 'pos terminals 3', 9, 'active', '2026-05-15 14:49:34.189123', 'pos terminals 3', '{"index": 3, "sample": true}', 3, '2026-05-15 14:49:34.189123', '2026-05-15 14:49:34.189123', 'pos terminals 3', 'pos terminals 3', 'pos terminals 3', '2026-05-15 14:49:34.189123', '{"index": 3, "sample": true}', '2026-05-15 14:49:34.189123', 3);


--
-- Data for Name: premium_collections; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.premium_collections VALUES (1, 1, 1, 185000.00, 'bank_transfer', 'PAY-2026-001', 'Paystack', 'TXN-PSK-001', 'completed', '2026-06-04 19:07:31.376237', '2026-01-15', 'RCT-2026-001', 'Annual premium for Motor Comprehensive POL-2026-001', '2026-06-04 19:07:31.376237');
INSERT INTO public.premium_collections VALUES (2, 2, 1, 250000.00, 'card', 'PAY-2026-002', 'Flutterwave', 'TXN-FLW-001', 'completed', '2026-06-04 19:07:31.376237', '2026-02-01', 'RCT-2026-002', 'Annual premium for Health Insurance POL-2026-002', '2026-06-04 19:07:31.376237');
INSERT INTO public.premium_collections VALUES (3, 3, 2, 45000.00, 'bank_transfer', 'PAY-2026-003', 'Paystack', 'TXN-PSK-002', 'completed', '2026-06-04 19:07:31.376237', '2026-01-20', 'RCT-2026-003', 'Third party motor insurance premium', '2026-06-04 19:07:31.376237');
INSERT INTO public.premium_collections VALUES (4, 4, 2, 65000.00, 'ussd', 'PAY-2026-004', 'mPesa', 'TXN-MPS-001', 'completed', '2026-06-04 19:07:31.376237', '2026-03-01', 'RCT-2026-004', 'Quarterly health premium', '2026-06-04 19:07:31.376237');
INSERT INTO public.premium_collections VALUES (5, 5, 3, 120000.00, 'card', 'PAY-2026-005', 'Paystack', 'TXN-PSK-003', 'completed', '2026-06-04 19:07:31.376237', '2026-03-15', 'RCT-2026-005', 'Property fire insurance premium', '2026-06-04 19:07:31.376237');
INSERT INTO public.premium_collections VALUES (6, 6, 1, 185000.00, 'bank_transfer', 'PAY-2026-006', 'Direct Debit', 'TXN-DD-001', 'pending', '2026-06-04 19:07:31.376237', '2026-07-15', NULL, 'Motor comprehensive renewal premium — due July 2026', '2026-06-04 19:07:31.376237');
INSERT INTO public.premium_collections VALUES (7, 7, 4, 25000.00, 'mobile_money', 'PAY-2026-007', 'OPay', 'TXN-OPY-001', 'failed', '2026-06-04 19:07:31.376237', '2026-05-01', NULL, 'Microinsurance premium — failed due to insufficient balance', '2026-06-04 19:07:31.376237');
INSERT INTO public.premium_collections VALUES (8, 8, 5, 5000000.00, 'bank_transfer', 'PAY-2026-008', 'NIBSS', 'TXN-NBS-001', 'completed', '2026-06-04 19:07:31.376237', '2026-04-01', 'RCT-2026-008', 'Group Life premium for Munis Enterprises', '2026-06-04 19:07:31.376237');
INSERT INTO public.premium_collections VALUES (9, 22, 1, 25000.00, 'card', 'PAY-1780671882417', 'InsurePortal', 'TXN-1780671882417', 'completed', '2026-06-05 15:04:42.417465', NULL, 'RCT-2026-JKRMSZ', 'Premium payment', '2026-06-05 15:04:42.417465');


--
-- Data for Name: premium_rate_audit_logs; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.premium_rate_audit_logs VALUES (1, 1, 'premium rate audit logs 1', 'standard', 1, 'premium rate audit logs 1', '1 Insurance Road, Lagos', '2026-05-29 14:49:34.193343');
INSERT INTO public.premium_rate_audit_logs VALUES (2, 2, 'premium rate audit logs 2', 'standard', 2, 'premium rate audit logs 2', '2 Insurance Road, Lagos', '2026-05-22 14:49:34.193343');
INSERT INTO public.premium_rate_audit_logs VALUES (3, 3, 'premium rate audit logs 3', 'standard', 3, 'premium rate audit logs 3', '3 Insurance Road, Lagos', '2026-05-15 14:49:34.193343');


--
-- Data for Name: premium_rate_changes; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.premium_rate_changes VALUES (1, 1, 1, 0.0500, 0.0500, 1, 'Sample data for premium_rate_changes record 1', '2026-05-29 14:49:34.197237', '2026-05-29 14:49:34.197237');
INSERT INTO public.premium_rate_changes VALUES (2, 2, 2, 0.1000, 0.1000, 2, 'Sample data for premium_rate_changes record 2', '2026-05-22 14:49:34.197237', '2026-05-22 14:49:34.197237');
INSERT INTO public.premium_rate_changes VALUES (3, 3, 3, 0.1500, 0.1500, 3, 'Sample data for premium_rate_changes record 3', '2026-05-15 14:49:34.197237', '2026-05-15 14:49:34.197237');


--
-- Data for Name: premium_rate_tables; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.premium_rate_tables VALUES (3, 2, 'Health Individual 2026', 'Health', '2026-01-01 00:00:00', '2026-12-31 00:00:00', 'active', 4.2500, '2025-12-04 17:07:58.333818', '2026-06-04 17:07:58.333818');
INSERT INTO public.premium_rate_tables VALUES (4, 2, 'Health Corporate 2026', 'Health', '2026-01-01 00:00:00', '2026-12-31 00:00:00', 'active', 3.8000, '2025-12-04 17:07:58.333818', '2026-06-04 17:07:58.333818');
INSERT INTO public.premium_rate_tables VALUES (5, 2, 'Property Commercial 2026', 'Property', '2026-01-01 00:00:00', '2026-12-31 00:00:00', 'active', 0.1500, '2025-12-04 17:07:58.333818', '2026-06-04 17:07:58.333818');
INSERT INTO public.premium_rate_tables VALUES (6, 2, 'Property Residential 2026', 'Property', '2026-01-01 00:00:00', '2026-12-31 00:00:00', 'active', 0.1000, '2025-12-04 17:07:58.333818', '2026-06-04 17:07:58.333818');
INSERT INTO public.premium_rate_tables VALUES (7, 2, 'Term Life 2026', 'Life', '2026-01-01 00:00:00', '2026-12-31 00:00:00', 'active', 0.2400, '2025-12-04 17:07:58.333818', '2026-06-04 17:07:58.333818');
INSERT INTO public.premium_rate_tables VALUES (8, 2, 'Agricultural Multi-Peril 2026', 'Agricultural', '2026-01-01 00:00:00', '2026-12-31 00:00:00', 'active', 1.5000, '2025-12-04 17:07:58.333818', '2026-06-04 17:07:58.333818');
INSERT INTO public.premium_rate_tables VALUES (9, 2, 'Microinsurance Crop 2026', 'Microinsurance', '2026-01-01 00:00:00', '2026-12-31 00:00:00', 'active', 2.3000, '2025-12-04 17:07:58.333818', '2026-06-04 17:07:58.333818');
INSERT INTO public.premium_rate_tables VALUES (10, 2, 'Parametric Weather 2026', 'Parametric', '2026-01-01 00:00:00', '2026-12-31 00:00:00', 'active', 8.0000, '2025-12-04 17:07:58.333818', '2026-06-04 17:07:58.333818');
INSERT INTO public.premium_rate_tables VALUES (11, 1, 'Cyber Insurance Base Rate 2026', 'Cyber', '2026-01-01 00:00:00', '2026-12-31 00:00:00', 'active', 0.0250, '2026-06-04 20:58:18.991851', '2026-06-04 20:58:18.991851');
INSERT INTO public.premium_rate_tables VALUES (12, 1, 'Cyber Insurance Base Rate 2026', 'Cyber', '2026-01-01 00:00:00', '2026-12-31 00:00:00', 'active', 0.0250, '2026-06-04 20:59:32.604558', '2026-06-04 20:59:32.604558');
INSERT INTO public.premium_rate_tables VALUES (1, 2, 'Motor Third Party 2026', 'Motor', '2026-01-01 00:00:00', '2026-12-31 00:00:00', 'active', 0.5000, '2025-12-04 17:07:58.333818', '2026-06-04 17:07:58.333818');
INSERT INTO public.premium_rate_tables VALUES (2, 2, 'Motor Comprehensive 2026', 'Motor', '2026-01-01 00:00:00', '2026-12-31 00:00:00', 'active', 3.5000, '2025-12-04 17:07:58.333818', '2026-06-04 17:07:58.333818');


--
-- Data for Name: premium_risk_factors; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.premium_risk_factors VALUES (1, 1, 'Vehicle Age >10yr', 'vehicle', 1.1500, 10.0000, 30.0000, '2026-06-04 17:10:58.677525', '2026-06-04 17:10:58.677525');
INSERT INTO public.premium_risk_factors VALUES (2, 1, 'Driver Under 25', 'driver', 1.2500, 18.0000, 25.0000, '2026-06-04 17:10:58.677525', '2026-06-04 17:10:58.677525');
INSERT INTO public.premium_risk_factors VALUES (3, 1, 'Lagos Zone', 'geography', 1.2000, 0.0000, 0.0000, '2026-06-04 17:10:58.677525', '2026-06-04 17:10:58.677525');
INSERT INTO public.premium_risk_factors VALUES (4, 2, 'No Claims 3yr', 'discount', 0.8500, 3.0000, 99.0000, '2026-06-04 17:10:58.677525', '2026-06-04 17:10:58.677525');
INSERT INTO public.premium_risk_factors VALUES (5, 2, 'GPS Tracker', 'discount', 0.9000, 0.0000, 0.0000, '2026-06-04 17:10:58.677525', '2026-06-04 17:10:58.677525');
INSERT INTO public.premium_risk_factors VALUES (6, 3, 'Age 50+', 'age', 1.3000, 50.0000, 100.0000, '2026-06-04 17:10:58.677525', '2026-06-04 17:10:58.677525');
INSERT INTO public.premium_risk_factors VALUES (7, 3, 'Pre-existing Conditions', 'medical', 1.5000, 0.0000, 0.0000, '2026-06-04 17:10:58.677525', '2026-06-04 17:10:58.677525');
INSERT INTO public.premium_risk_factors VALUES (8, 4, 'Group 50+ Employees', 'group_size', 0.8000, 50.0000, 9999.0000, '2026-06-04 17:10:58.677525', '2026-06-04 17:10:58.677525');
INSERT INTO public.premium_risk_factors VALUES (9, 5, 'Sprinkler System', 'fire_protection', 0.8500, 0.0000, 0.0000, '2026-06-04 17:10:58.677525', '2026-06-04 17:10:58.677525');
INSERT INTO public.premium_risk_factors VALUES (10, 5, 'Flood Zone A', 'geography', 1.4000, 0.0000, 0.0000, '2026-06-04 17:10:58.677525', '2026-06-04 17:10:58.677525');
INSERT INTO public.premium_risk_factors VALUES (11, 7, 'Smoker', 'lifestyle', 1.4500, 0.0000, 0.0000, '2026-06-04 17:10:58.677525', '2026-06-04 17:10:58.677525');
INSERT INTO public.premium_risk_factors VALUES (12, 7, 'BMI >30', 'health', 1.2000, 30.0000, 100.0000, '2026-06-04 17:10:58.677525', '2026-06-04 17:10:58.677525');
INSERT INTO public.premium_risk_factors VALUES (13, 8, 'Irrigated Land', 'agriculture', 0.9000, 0.0000, 0.0000, '2026-06-04 17:10:58.677525', '2026-06-04 17:10:58.677525');
INSERT INTO public.premium_risk_factors VALUES (14, 8, 'Flood Prone Area', 'geography', 1.3500, 0.0000, 0.0000, '2026-06-04 17:10:58.677525', '2026-06-04 17:10:58.677525');
INSERT INTO public.premium_risk_factors VALUES (15, 10, 'Urban Area', 'geography', 0.8000, 0.0000, 0.0000, '2026-06-04 17:10:58.677525', '2026-06-04 17:10:58.677525');


--
-- Data for Name: qr_codes; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.qr_codes VALUES (5, 'qr_codes 1', 'payment', 'active', 1, 1.50, 'qr_', 'qr_codes 1', '{"i":1}', '2026-05-29 14:50:36.458401', '2026-05-29 14:50:36.458401', 1, '2026-05-29 14:50:36.458401');
INSERT INTO public.qr_codes VALUES (6, 'qr_codes 2', 'profile', 'used', 2, 3.00, 'qr_', 'qr_codes 2', '{"i":2}', '2026-05-22 14:50:36.458401', '2026-05-22 14:50:36.458401', 2, '2026-05-22 14:50:36.458401');
INSERT INTO public.qr_codes VALUES (7, 'qr_codes 3', 'collection', 'expired', 3, 4.50, 'qr_', 'qr_codes 3', '{"i":3}', '2026-05-15 14:50:36.458401', '2026-05-15 14:50:36.458401', 3, '2026-05-15 14:50:36.458401');


--
-- Data for Name: rate_alerts; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.rate_alerts VALUES (1, 7, 'NGN', 'NGN', 0.05000000, 'above', 'active', 0.05000000, '2026-05-29 14:50:04.895837', '{"data": "sample_1"}', '2026-07-05 14:50:04.895837', 'rate_alerts 1', '2026-05-29 14:50:04.895837', '2026-05-29 14:50:04.895837');
INSERT INTO public.rate_alerts VALUES (2, 8, 'NGN', 'NGN', 0.10000000, 'below', 'paused', 0.10000000, '2026-05-22 14:50:04.895837', '{"data": "sample_2"}', '2026-08-04 14:50:04.895837', 'rate_alerts 2', '2026-05-22 14:50:04.895837', '2026-05-22 14:50:04.895837');
INSERT INTO public.rate_alerts VALUES (3, 9, 'NGN', 'NGN', 0.15000000, 'below', 'triggered', 0.15000000, '2026-05-15 14:50:04.895837', '{"data": "sample_3"}', '2026-09-03 14:50:04.895837', 'rate_alerts 3', '2026-05-15 14:50:04.895837', '2026-05-15 14:50:04.895837');


--
-- Data for Name: rate_limit_rules; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.rate_limit_rules VALUES (1, 'rate limit rules 1', 'web', 1, 1, 1, 'rate limit rules 1', true, '2026-05-29 14:49:34.237218');
INSERT INTO public.rate_limit_rules VALUES (2, 'rate limit rules 2', 'web', 2, 2, 2, 'rate limit rules 2', false, '2026-05-22 14:49:34.237218');
INSERT INTO public.rate_limit_rules VALUES (3, 'rate limit rules 3', 'web', 3, 3, 3, 'rate limit rules 3', false, '2026-05-15 14:49:34.237218');


--
-- Data for Name: realtime_tx_alerts; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.realtime_tx_alerts VALUES (1, '1', 'standard', 'realtime tx alerts 1', 'Sample data for realtime_tx_alerts record 1', 'realtime tx alerts 1', true, 'realtime tx alerts 1', '2026-05-29 14:49:34.241267', '2026-05-29 14:49:34.241267');
INSERT INTO public.realtime_tx_alerts VALUES (2, '2', 'standard', 'realtime tx alerts 2', 'Sample data for realtime_tx_alerts record 2', 'realtime tx alerts 2', false, 'realtime tx alerts 2', '2026-05-22 14:49:34.241267', '2026-05-22 14:49:34.241267');
INSERT INTO public.realtime_tx_alerts VALUES (3, '3', 'standard', 'realtime tx alerts 3', 'Sample data for realtime_tx_alerts record 3', 'realtime tx alerts 3', false, 'realtime tx alerts 3', '2026-05-15 14:49:34.241267', '2026-05-15 14:49:34.241267');


--
-- Data for Name: reconciliation_batches; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.reconciliation_batches VALUES (1, 'REC-2026-Q1', 'premium_collection', NULL, NULL, 145, 138, 4, 3, 8750000.00, 'completed', NULL, '2026-04-07 20:59:32.599931', '2026-04-05 20:59:32.599931');
INSERT INTO public.reconciliation_batches VALUES (2, 'REC-2026-Q2', 'premium_collection', NULL, NULL, 98, 93, 3, 2, 5250000.00, 'in_progress', NULL, NULL, '2026-05-30 20:59:32.599931');
INSERT INTO public.reconciliation_batches VALUES (3, 'REC-2026-APR', 'claims_payout', NULL, NULL, 52, 51, 1, 0, 12400000.00, 'completed', NULL, '2026-05-09 20:59:32.599931', '2026-05-07 20:59:32.599931');


--
-- Data for Name: reconciliation_items; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.reconciliation_items VALUES (1, 1, 'REC-2026-001', 'REC-2026-001', 50000.00, 50000.00, 1.50, 'active', 'reconciliation items 1', 1, '2026-05-29 14:49:34.244803', '2026-05-29 14:49:34.244803');
INSERT INTO public.reconciliation_items VALUES (2, 2, 'REC-2026-002', 'REC-2026-002', 100000.00, 100000.00, 3.00, 'active', 'reconciliation items 2', 2, '2026-05-22 14:49:34.244803', '2026-05-22 14:49:34.244803');
INSERT INTO public.reconciliation_items VALUES (3, 3, 'REC-2026-003', 'REC-2026-003', 150000.00, 150000.00, 4.50, 'active', 'reconciliation items 3', 3, '2026-05-15 14:49:34.244803', '2026-05-15 14:49:34.244803');


--
-- Data for Name: referrals; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.referrals VALUES (1, 1, 2, 'adebayo@example.com', NULL, 'REF-ADY-2026', 'Completed', 5000.00, NULL, '2026-05-05 20:59:32.600972', NULL, '2026-06-04 20:59:32.600972');
INSERT INTO public.referrals VALUES (2, 1, 3, 'funke.ade@example.com', NULL, 'REF-FNK-2026', 'Completed', 5000.00, NULL, '2026-05-15 20:59:32.600972', NULL, '2026-06-04 20:59:32.600972');
INSERT INTO public.referrals VALUES (3, 1, 4, 'chidi.eze@example.com', NULL, 'REF-CHD-2026', 'Pending', 5000.00, NULL, '2026-05-30 20:59:32.600972', NULL, '2026-06-04 20:59:32.600972');
INSERT INTO public.referrals VALUES (4, 1, 5, 'amina.bello@example.com', NULL, 'REF-AMN-2026', 'Completed', 5000.00, NULL, '2026-04-20 20:59:32.600972', NULL, '2026-06-04 20:59:32.600972');
INSERT INTO public.referrals VALUES (5, 1, 6, 'tunde.johnson@example.com', NULL, 'REF-TND-2026', 'Completed', 5000.00, NULL, '2026-04-05 20:59:32.600972', NULL, '2026-06-04 20:59:32.600972');


--
-- Data for Name: refunds; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.refunds VALUES (1, 'refunds 1', 1, 1, 'refunds 1', 7, 1, 'refunds 1', '+234801', 50000, 50000, 'NGN', 'refunds 1', 'refunds 1', 'refunds 1', 'refunds 1', 'refunds 1', '2026-05-29 14:50:04.901473', '2026-05-29 14:50:04.901473', 'refunds 1', '2026-05-29 14:50:04.901473', 'refunds 1', 'refunds 1', 'refunds 1', 1, '2026-05-29 14:50:04.901473', '2026-05-29 14:50:04.901473', '2026-05-29 14:50:04.901473');
INSERT INTO public.refunds VALUES (2, 'refunds 2', 2, 2, 'refunds 2', 8, 2, 'refunds 2', '+234802', 100000, 100000, 'NGN', 'refunds 2', 'refunds 2', 'refunds 2', 'refunds 2', 'refunds 2', '2026-05-22 14:50:04.901473', '2026-05-22 14:50:04.901473', 'refunds 2', '2026-05-22 14:50:04.901473', 'refunds 2', 'refunds 2', 'refunds 2', 2, '2026-05-22 14:50:04.901473', '2026-05-22 14:50:04.901473', '2026-05-22 14:50:04.901473');
INSERT INTO public.refunds VALUES (3, 'refunds 3', 3, 3, 'refunds 3', 9, 3, 'refunds 3', '+234803', 150000, 150000, 'NGN', 'refunds 3', 'refunds 3', 'refunds 3', 'refunds 3', 'refunds 3', '2026-05-15 14:50:04.901473', '2026-05-15 14:50:04.901473', 'refunds 3', '2026-05-15 14:50:04.901473', 'refunds 3', 'refunds 3', 'refunds 3', 3, '2026-05-15 14:50:04.901473', '2026-05-15 14:50:04.901473', '2026-05-15 14:50:04.901473');


--
-- Data for Name: reinsurance_bordereaux; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.reinsurance_bordereaux VALUES (8, 2, '2026-Q1', 'premium', 185000000.00, 342, 'reconciled', '2026-04-05 00:00:00', '2026-04-08 00:00:00', '2026-06-05 03:21:09.094558');
INSERT INTO public.reinsurance_bordereaux VALUES (9, 2, '2026-Q1', 'claims', 95000000.00, 28, 'reconciled', '2026-04-05 00:00:00', '2026-04-08 00:00:00', '2026-06-05 03:21:09.094558');
INSERT INTO public.reinsurance_bordereaux VALUES (10, 3, '2026-Q1', 'premium', 120000000.00, 156, 'acknowledged', '2026-04-10 00:00:00', '2026-04-12 00:00:00', '2026-06-05 03:21:09.094558');
INSERT INTO public.reinsurance_bordereaux VALUES (11, 2, '2026-Q2', 'premium', 210000000.00, 398, 'sent', '2026-07-02 00:00:00', NULL, '2026-06-05 03:21:09.094558');
INSERT INTO public.reinsurance_bordereaux VALUES (12, 2, '2026-Q2', 'claims', 108000000.00, 35, 'sent', '2026-07-02 00:00:00', NULL, '2026-06-05 03:21:09.094558');
INSERT INTO public.reinsurance_bordereaux VALUES (13, 3, '2026-Q2', 'premium', 145000000.00, 189, 'draft', NULL, NULL, '2026-06-05 03:21:09.094558');
INSERT INTO public.reinsurance_bordereaux VALUES (14, 4, '2026-Q2', 'premium', 85000000.00, 78, 'draft', NULL, NULL, '2026-06-05 03:21:09.094558');


--
-- Data for Name: reinsurance_cessions; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.reinsurance_cessions VALUES (1, 2, 1, 2000000.00, 3000000.00, 10000.00, 'active', '2026-01-15 00:00:00', '2026-01-04 17:10:58.689482');
INSERT INTO public.reinsurance_cessions VALUES (2, 2, 2, 18000000.00, 27000000.00, 74000.00, 'active', '2026-02-01 00:00:00', '2026-02-04 17:10:58.689482');
INSERT INTO public.reinsurance_cessions VALUES (3, 1, 8, 175000000.00, 75000000.00, 245000.00, 'active', '2026-01-01 00:00:00', '2025-12-04 17:10:58.689482');
INSERT INTO public.reinsurance_cessions VALUES (4, 4, 10, 25000000.00, 25000000.00, 60000.00, 'active', '2025-06-01 00:00:00', '2025-06-04 17:10:58.689482');
INSERT INTO public.reinsurance_cessions VALUES (5, 4, 11, 50000000.00, 50000000.00, 125000.00, 'active', '2024-01-01 00:00:00', '2023-12-04 17:10:58.689482');
INSERT INTO public.reinsurance_cessions VALUES (6, 4, 12, 1250000000.00, 1250000000.00, 7500000.00, 'active', '2026-01-01 00:00:00', '2025-12-04 17:10:58.689482');
INSERT INTO public.reinsurance_cessions VALUES (7, 5, 5, 5000000.00, 5000000.00, 42500.00, 'active', '2026-01-01 00:00:00', '2025-12-04 17:10:58.689482');
INSERT INTO public.reinsurance_cessions VALUES (8, 5, 7, 250000000.00, 250000000.00, 1250000.00, 'active', '2026-04-01 00:00:00', '2026-04-04 17:10:58.689482');
INSERT INTO public.reinsurance_cessions VALUES (9, 6, 15, 2500000.00, 2500000.00, 37500.00, 'active', '2026-04-01 00:00:00', '2026-04-04 17:10:58.689482');
INSERT INTO public.reinsurance_cessions VALUES (10, 6, 16, 7500000.00, 7500000.00, 60000.00, 'active', '2026-03-01 00:00:00', '2026-03-04 17:10:58.689482');
INSERT INTO public.reinsurance_cessions VALUES (11, 1, 1, 300000.00, 700000.00, 7500.00, 'Active', '2026-01-15 00:00:00', '2026-06-04 20:12:42.552811');
INSERT INTO public.reinsurance_cessions VALUES (12, 1, 5, 150000.00, 350000.00, 3750.00, 'Active', '2026-02-10 00:00:00', '2026-06-04 20:12:42.552811');
INSERT INTO public.reinsurance_cessions VALUES (13, 2, 3, 500000.00, 1500000.00, 16000.00, 'Active', '2026-01-20 00:00:00', '2026-06-04 20:12:42.552811');
INSERT INTO public.reinsurance_cessions VALUES (14, 2, 8, 250000.00, 750000.00, 8000.00, 'Active', '2026-03-05 00:00:00', '2026-06-04 20:12:42.552811');
INSERT INTO public.reinsurance_cessions VALUES (15, 3, 10, 1000000.00, 0.00, 40000.00, 'Active', '2026-02-28 00:00:00', '2026-06-04 20:12:42.552811');
INSERT INTO public.reinsurance_cessions VALUES (16, 1, 12, 180000.00, 420000.00, 4500.00, 'Settled', '2026-04-01 00:00:00', '2026-06-04 20:12:42.552811');


--
-- Data for Name: reinsurance_claims_recovery; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.reinsurance_claims_recovery VALUES (6, NULL, 2, 1, 12500000.00, 9375000.00, 9375000.00, 'paid', 'REC-2026-001', '2026-03-15 00:00:00', '2026-04-20 00:00:00', '2026-06-05 03:21:09.094558');
INSERT INTO public.reinsurance_claims_recovery VALUES (7, NULL, 2, 3, 8200000.00, 6150000.00, 6150000.00, 'paid', 'REC-2026-002', '2026-04-01 00:00:00', '2026-05-10 00:00:00', '2026-06-05 03:21:09.094558');
INSERT INTO public.reinsurance_claims_recovery VALUES (8, NULL, 3, 5, 45000000.00, 35000000.00, 0.00, 'approved', 'REC-2026-003', '2026-05-20 00:00:00', NULL, '2026-06-05 03:21:09.094558');
INSERT INTO public.reinsurance_claims_recovery VALUES (9, NULL, 2, 7, 15800000.00, 11850000.00, 0.00, 'notified', 'REC-2026-004', '2026-06-01 00:00:00', NULL, '2026-06-05 03:21:09.094558');
INSERT INTO public.reinsurance_claims_recovery VALUES (10, NULL, 4, 9, 28000000.00, 22400000.00, 0.00, 'pending', NULL, NULL, NULL, '2026-06-05 03:21:09.094558');


--
-- Data for Name: reinsurance_facultative; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.reinsurance_facultative VALUES (1, 1, 500000000.00, 'Large commercial property — Lagos Island warehouse complex', 'placed', 'Lloyd''s Syndicate 2987', 60.00, 0.008500, 2550000.00, '2026-01-01', '2026-12-31', '2026-06-05 03:20:53.690471');
INSERT INTO public.reinsurance_facultative VALUES (2, 3, 250000000.00, 'Marine cargo — bulk petroleum shipment Lagos-Rotterdam', 'placed', 'Swiss Re Corporate Solutions', 70.00, 0.012000, 2100000.00, '2026-03-01', '2026-09-01', '2026-06-05 03:20:53.690471');
INSERT INTO public.reinsurance_facultative VALUES (3, 5, 180000000.00, 'Directors & Officers liability — listed company', 'placed', 'AIG Europe', 50.00, 0.004500, 405000.00, '2026-02-01', '2027-01-31', '2026-06-05 03:20:53.690471');
INSERT INTO public.reinsurance_facultative VALUES (4, 8, 750000000.00, 'Offshore oil platform — Nigeria EEZ', 'open', NULL, NULL, NULL, NULL, '2026-07-01', '2027-06-30', '2026-06-05 03:20:53.690471');
INSERT INTO public.reinsurance_facultative VALUES (5, 12, 120000000.00, 'Cyber insurance — fintech company (high exposure)', 'declined', 'Munich Re', NULL, NULL, NULL, NULL, NULL, '2026-06-05 03:20:53.690471');


--
-- Data for Name: reinsurance_settlements; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.reinsurance_settlements VALUES (9, 2, 'premium_cession', '2026-Q1', 185000000.00, 'NGN', 'paid', '2026-04-30', '2026-04-28 00:00:00', 'SET-PC-2026-Q1-001', '2026-06-05 03:21:09.094558');
INSERT INTO public.reinsurance_settlements VALUES (10, 2, 'claims_recovery', '2026-Q1', 95000000.00, 'NGN', 'paid', '2026-05-15', '2026-05-12 00:00:00', 'SET-CR-2026-Q1-001', '2026-06-05 03:21:09.094558');
INSERT INTO public.reinsurance_settlements VALUES (11, 2, 'commission', '2026-Q1', 46250000.00, 'NGN', 'paid', '2026-04-30', '2026-04-28 00:00:00', 'SET-CM-2026-Q1-001', '2026-06-05 03:21:09.094558');
INSERT INTO public.reinsurance_settlements VALUES (12, 3, 'premium_cession', '2026-Q1', 120000000.00, 'NGN', 'paid', '2026-04-30', '2026-04-25 00:00:00', 'SET-PC-2026-Q1-002', '2026-06-05 03:21:09.094558');
INSERT INTO public.reinsurance_settlements VALUES (13, 2, 'premium_cession', '2026-Q2', 210000000.00, 'NGN', 'invoiced', '2026-07-31', NULL, 'SET-PC-2026-Q2-001', '2026-06-05 03:21:09.094558');
INSERT INTO public.reinsurance_settlements VALUES (14, 2, 'claims_recovery', '2026-Q2', 108000000.00, 'NGN', 'pending', '2026-08-15', NULL, NULL, '2026-06-05 03:21:09.094558');
INSERT INTO public.reinsurance_settlements VALUES (15, 3, 'premium_cession', '2026-Q2', 145000000.00, 'NGN', 'pending', '2026-07-31', NULL, NULL, '2026-06-05 03:21:09.094558');
INSERT INTO public.reinsurance_settlements VALUES (16, 2, 'cash_call', '2026-Q2', 25000000.00, 'NGN', 'overdue', '2026-06-15', NULL, 'CC-2026-001', '2026-06-05 03:21:09.094558');


--
-- Data for Name: reinsurance_treaties; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.reinsurance_treaties VALUES (2, 1, 'Africa Re Quota Share 2026', 'Quota Share', 'Africa Reinsurance Corporation', 0.3000, 5000000.00, 500000000.00, 0.0250, '2026-01-01 00:00:00', '2026-12-31 00:00:00', 'Active', '{Motor,Fire,Marine}', '2026-06-04 20:11:14.680252', '2026-06-04 20:11:14.680252');
INSERT INTO public.reinsurance_treaties VALUES (3, 1, 'Continental Re Surplus 2026', 'Surplus Treaty', 'Continental Reinsurance Plc', 0.2500, 10000000.00, 1000000000.00, 0.0320, '2026-01-01 00:00:00', '2026-12-31 00:00:00', 'Active', '{Motor,Engineering,Liability}', '2026-06-04 20:11:14.680252', '2026-06-04 20:11:14.680252');
INSERT INTO public.reinsurance_treaties VALUES (4, 1, 'Swiss Re XL 2026', 'Excess of Loss', 'Swiss Re Africa', 0.0000, 20000000.00, 2000000000.00, 0.0400, '2026-01-01 00:00:00', '2026-12-31 00:00:00', 'Active', '{Fire,Marine,Aviation}', '2026-06-04 20:11:14.680252', '2026-06-04 20:11:14.680252');
INSERT INTO public.reinsurance_treaties VALUES (5, 1, 'WAICA Re QS 2025', 'Quota Share', 'West African Insurance Companies Association Re', 0.2000, 3000000.00, 300000000.00, 0.0200, '2025-01-01 00:00:00', '2025-12-31 00:00:00', 'Expired', '{Motor,Health}', '2026-06-04 20:11:14.680252', '2026-06-04 20:11:14.680252');
INSERT INTO public.reinsurance_treaties VALUES (6, 1, 'Lloyd''s Cyber Excess of Loss', 'excess_of_loss', 'Lloyd''s of London Syndicate 2623', 0.7500, 50000000.00, 500000000.00, 0.1500, '2026-01-01 00:00:00', '2026-12-31 00:00:00', 'Active', '{Cyber,"Technology E&O"}', '2026-06-04 20:59:32.592347', '2026-06-04 20:59:32.592347');
INSERT INTO public.reinsurance_treaties VALUES (7, 1, 'Lloyd''s Property Catastrophe XL', 'catastrophe_xl', 'Lloyd''s of London Syndicate 1084', 0.6000, 200000000.00, 2000000000.00, 0.1250, '2026-01-01 00:00:00', '2026-12-31 00:00:00', 'Active', '{Property,Fire,Marine}', '2026-06-04 20:59:32.592347', '2026-06-04 20:59:32.592347');


--
-- Data for Name: reversal_requests; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.reversal_requests VALUES (5, '1', 1, 'reversal_reques 1', 1.50, 'rev', 'pending', 1, '2026-05-29 14:50:36.462379', 'reversal_reques 1', '1', '2026-05-29 14:50:36.462379', '2026-05-29 14:50:36.462379');
INSERT INTO public.reversal_requests VALUES (6, '2', 2, 'reversal_reques 2', 3.00, 'rev', 'approved', 2, '2026-05-22 14:50:36.462379', 'reversal_reques 2', '2', '2026-05-22 14:50:36.462379', '2026-05-22 14:50:36.462379');
INSERT INTO public.reversal_requests VALUES (7, '3', 3, 'reversal_reques 3', 4.50, 'rev', 'rejected', 3, '2026-05-15 14:50:36.462379', 'reversal_reques 3', '3', '2026-05-15 14:50:36.462379', '2026-05-15 14:50:36.462379');


--
-- Data for Name: reviews; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.reviews VALUES (1, 1, 'Agent', 1, 1, 'reviews 1', 'reviews 1', true, '2026-05-29 14:50:04.926034', '2026-05-29 14:50:04.926034');
INSERT INTO public.reviews VALUES (2, 2, 'Service', 2, 2, 'reviews 2', 'reviews 2', false, '2026-05-22 14:50:04.926034', '2026-05-22 14:50:04.926034');
INSERT INTO public.reviews VALUES (3, 3, 'Claim', 3, 3, 'reviews 3', 'reviews 3', false, '2026-05-15 14:50:04.926034', '2026-05-15 14:50:04.926034');


--
-- Data for Name: roles; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.roles VALUES (1, 'super_admin', 'Full platform access', '["*"]', true, '2026-06-04 19:07:31.379948');
INSERT INTO public.roles VALUES (2, 'underwriter', 'Underwriting, product mgmt, rate setting', '["underwriting.*", "products.*", "rates.*", "policies.view", "claims.view"]', true, '2026-06-04 19:07:31.379948');
INSERT INTO public.roles VALUES (3, 'claims_manager', 'Claims processing, adjudication, payouts', '["claims.*", "payouts.*", "policies.view", "fraud.view"]', true, '2026-06-04 19:07:31.379948');
INSERT INTO public.roles VALUES (4, 'claims_adjudicator', 'Process and adjudicate claims', '["claims.view", "claims.update", "claims.adjudicate", "fraud.view"]', true, '2026-06-04 19:07:31.379948');
INSERT INTO public.roles VALUES (5, 'agent', 'Sell policies, view commissions', '["policies.create", "policies.view", "commissions.view", "customers.view", "quotes.create"]', true, '2026-06-04 19:07:31.379948');
INSERT INTO public.roles VALUES (6, 'finance_officer', 'Financial dashboard, GL, reconciliation', '["finance.*", "payments.*", "reconciliation.*", "reports.*"]', true, '2026-06-04 19:07:31.379948');
INSERT INTO public.roles VALUES (7, 'compliance_officer', 'NAICOM filings, regulatory reports', '["naicom.*", "compliance.*", "audit.*", "reports.compliance"]', true, '2026-06-04 19:07:31.379948');
INSERT INTO public.roles VALUES (8, 'customer_service', 'Customer queries, basic policy ops', '["customers.view", "policies.view", "claims.view", "claims.create", "communication.*"]', true, '2026-06-04 19:07:31.379948');
INSERT INTO public.roles VALUES (9, 'actuary', 'Actuarial models, reserves, pricing', '["actuarial.*", "rates.*", "reinsurance.view", "reports.actuarial"]', true, '2026-06-04 19:07:31.379948');
INSERT INTO public.roles VALUES (10, 'executive', 'Read-only dashboards and reports', '["dashboard.*", "reports.*", "analytics.*"]', true, '2026-06-04 19:07:31.379948');
INSERT INTO public.roles VALUES (11, 'customer', 'Self-service portal', '["profile.*", "policies.own", "claims.own", "payments.own", "documents.own"]', false, '2026-06-04 19:07:31.379948');


--
-- Data for Name: savings_accounts; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.savings_accounts VALUES (1, 1, '1', 'savings accounts 1', 1.50, 50000.00, 0.0500, 'active', '2026-05-29 14:49:34.302351', '2026-05-29 14:49:34.302351', '2026-05-29 14:49:34.302351');
INSERT INTO public.savings_accounts VALUES (2, 2, '2', 'savings accounts 2', 3.00, 100000.00, 0.1000, 'active', '2026-05-22 14:49:34.302351', '2026-05-22 14:49:34.302351', '2026-05-22 14:49:34.302351');
INSERT INTO public.savings_accounts VALUES (3, 3, '3', 'savings accounts 3', 4.50, 150000.00, 0.1500, 'active', '2026-05-15 14:49:34.302351', '2026-05-15 14:49:34.302351', '2026-05-15 14:49:34.302351');


--
-- Data for Name: savings_plans; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.savings_plans VALUES (7, 1, 'Emergency Fund', 500000.00, 150000.00, 8.50, 'monthly', 'active', '2026-06-05 00:27:58.242055');
INSERT INTO public.savings_plans VALUES (8, 1, 'Health Cover Reserve', 200000.00, 85000.00, 7.00, 'weekly', 'active', '2026-06-05 00:27:58.242055');
INSERT INTO public.savings_plans VALUES (9, 2, 'Family Protection Fund', 1000000.00, 350000.00, 9.00, 'monthly', 'active', '2026-06-05 00:27:58.242055');


--
-- Data for Name: score_improvement_tips; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.score_improvement_tips VALUES (1, 'Maintain continuous coverage without gaps', '+15 points', 'high', 'coverage', NULL, '2026-06-05 04:06:31.137296');
INSERT INTO public.score_improvement_tips VALUES (2, 'Pay premiums on time every month', '+10 points', 'high', 'payment', NULL, '2026-06-05 04:06:31.137296');
INSERT INTO public.score_improvement_tips VALUES (3, 'Reduce claim frequency (file only genuine claims)', '+8 points', 'medium', 'claims', NULL, '2026-06-05 04:06:31.137296');
INSERT INTO public.score_improvement_tips VALUES (4, 'Bundle multiple policies (motor + health + property)', '+12 points', 'medium', 'diversity', NULL, '2026-06-05 04:06:31.137296');
INSERT INTO public.score_improvement_tips VALUES (5, 'Install approved telematics device in vehicle', '+5 points', 'low', 'telematics', NULL, '2026-06-05 04:06:31.137296');
INSERT INTO public.score_improvement_tips VALUES (6, 'Complete annual health wellness check', '+3 points', 'low', 'health', NULL, '2026-06-05 04:06:31.137296');
INSERT INTO public.score_improvement_tips VALUES (7, 'Maintain no-claims bonus for 3+ years', '+20 points', 'high', 'claims', NULL, '2026-06-05 04:06:31.137296');
INSERT INTO public.score_improvement_tips VALUES (8, 'Add family members to group coverage', '+7 points', 'medium', 'coverage', NULL, '2026-06-05 04:06:31.137296');


--
-- Data for Name: service_records; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.service_records VALUES (1, 1, 'service records 1', 'Sample data for service_records record 1', 'service records 1', '{"index": 1, "sample": true}', '2026-05-29 14:49:34.307185', '2026-05-29 14:49:34.307185', '2026-05-29 14:49:34.307185');
INSERT INTO public.service_records VALUES (2, 2, 'service records 2', 'Sample data for service_records record 2', 'service records 2', '{"index": 2, "sample": true}', '2026-05-22 14:49:34.307185', '2026-05-22 14:49:34.307185', '2026-05-22 14:49:34.307185');
INSERT INTO public.service_records VALUES (3, 3, 'service records 3', 'Sample data for service_records record 3', 'service records 3', '{"index": 3, "sample": true}', '2026-05-15 14:49:34.307185', '2026-05-15 14:49:34.307185', '2026-05-15 14:49:34.307185');


--
-- Data for Name: settlement_reconciliation; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.settlement_reconciliation VALUES (5, 'settle 1', 1, 'settlement_reco 1', 1.50, 1.50, 1.50, 'pending', 1, 'settlement_reco 1', '2026-05-29 14:50:36.466353', '2026-05-29 14:50:36.466353');
INSERT INTO public.settlement_reconciliation VALUES (6, 'settle 2', 2, 'settlement_reco 2', 3.00, 3.00, 3.00, 'matched', 2, 'settlement_reco 2', '2026-05-22 14:50:36.466353', '2026-05-22 14:50:36.466353');
INSERT INTO public.settlement_reconciliation VALUES (7, 'settle 3', 3, 'settlement_reco 3', 4.50, 4.50, 4.50, 'discrepancy', 3, 'settlement_reco 3', '2026-05-15 14:50:36.466353', '2026-05-15 14:50:36.466353');


--
-- Data for Name: shareable_links; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.shareable_links VALUES (5, 'shareable_links 1', 'payment', 'active', 1, 1.50, 'sha', 'shareable_links 1', '{"i":1}', 1, 1, '2026-05-29 14:50:36.469883', '2026-05-29 14:50:36.469883', '2026-05-29 14:50:36.469883');
INSERT INTO public.shareable_links VALUES (6, 'shareable_links 2', 'collection', 'expired', 2, 3.00, 'sha', 'shareable_links 2', '{"i":2}', 2, 2, '2026-05-22 14:50:36.469883', '2026-05-22 14:50:36.469883', '2026-05-22 14:50:36.469883');
INSERT INTO public.shareable_links VALUES (7, 'shareable_links 3', 'profile', 'paused', 3, 4.50, 'sha', 'shareable_links 3', '{"i":3}', 3, 3, '2026-05-15 14:50:36.469883', '2026-05-15 14:50:36.469883', '2026-05-15 14:50:36.469883');


--
-- Data for Name: sim_failover_log; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.sim_failover_log VALUES (1, '1', 'sim_failover_log 1', 1, 1, 'sim_failover_log 1', 1, 1, 'sim_failover_log 1', '2026-05-29 14:50:04.97178', '2026-05-29 14:50:04.97178');
INSERT INTO public.sim_failover_log VALUES (2, '2', 'sim_failover_log 2', 2, 2, 'sim_failover_log 2', 2, 2, 'sim_failover_log 2', '2026-05-22 14:50:04.97178', '2026-05-22 14:50:04.97178');
INSERT INTO public.sim_failover_log VALUES (3, '3', 'sim_failover_log 3', 3, 3, 'sim_failover_log 3', 3, 3, 'sim_failover_log 3', '2026-05-15 14:50:04.97178', '2026-05-15 14:50:04.97178');


--
-- Data for Name: sim_orchestrator_config; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.sim_orchestrator_config VALUES (1, '1', 1, 'sim orchestrator config 1', 'sim_orchestrator_config_key_1_fe9c6e315a3685528d68710da786698d', true, '2026-05-29 14:49:34.363173', '2026-05-29 14:49:34.363173');
INSERT INTO public.sim_orchestrator_config VALUES (2, '2', 2, 'sim orchestrator config 2', 'sim_orchestrator_config_key_2_fdd67ba38a8313840da710b85e12b35f', false, '2026-05-22 14:49:34.363173', '2026-05-22 14:49:34.363173');
INSERT INTO public.sim_orchestrator_config VALUES (3, '3', 3, 'sim orchestrator config 3', 'sim_orchestrator_config_key_3_22c44002f609a5d70b8cae076adda2f1', false, '2026-05-15 14:49:34.363173', '2026-05-15 14:49:34.363173');


--
-- Data for Name: sim_probe_log; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.sim_probe_log VALUES (1, 'sim_probe_log 1', '1', 'sim_ 1', 'MTN', 1, 1, 1, 1, 1, 75, true, 1, 1, '1.0.0', '2026-05-29 14:50:04.978105', '2026-05-29 14:50:04.978105');
INSERT INTO public.sim_probe_log VALUES (2, 'sim_probe_log 2', '2', 'sim_ 2', 'Airtel', 2, 2, 2, 2, 2, 80, false, 2, 2, '2.0.0', '2026-05-22 14:50:04.978105', '2026-05-22 14:50:04.978105');
INSERT INTO public.sim_probe_log VALUES (3, 'sim_probe_log 3', '3', 'sim_ 3', 'Airtel', 3, 3, 3, 3, 3, 85, false, 3, 3, '3.0.0', '2026-05-15 14:50:04.978105', '2026-05-15 14:50:04.978105');


--
-- Data for Name: sla_breaches; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.sla_breaches VALUES (1, 1, 'standard', 1, 1, 1, 'sla breaches 1', '2026-05-29 14:49:34.386068', 'sla breaches 1', '2026-05-29 14:49:34.386068');
INSERT INTO public.sla_breaches VALUES (2, 2, 'standard', 2, 2, 2, 'sla breaches 2', '2026-05-22 14:49:34.386068', 'sla breaches 2', '2026-05-22 14:49:34.386068');
INSERT INTO public.sla_breaches VALUES (3, 3, 'standard', 3, 3, 3, 'sla breaches 3', '2026-05-15 14:49:34.386068', 'sla breaches 3', '2026-05-15 14:49:34.386068');


--
-- Data for Name: sla_definitions; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.sla_definitions VALUES (1, 'Claims Processing Time', 'claims', 'processing_hours', 72, 48, 72, '30 days', true, '2025-06-05 13:10:21.005916', NULL);
INSERT INTO public.sla_definitions VALUES (2, 'Policy Issuance Time', 'policy', 'issuance_hours', 24, 16, 24, '30 days', true, '2025-06-05 13:10:21.005916', NULL);
INSERT INTO public.sla_definitions VALUES (3, 'Customer Response Time', 'support', 'response_hours', 4, 2, 4, '7 days', true, '2025-12-07 13:10:21.005916', NULL);
INSERT INTO public.sla_definitions VALUES (4, 'NAICOM Filing Deadline', 'compliance', 'filing_hours', 720, 480, 720, '90 days', true, '2025-06-05 13:10:21.005916', NULL);


--
-- Data for Name: sme_policies; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.sme_policies VALUES (1, 9, 'SME-LOGISTICS-01', 'Obasanjo Logistics Ltd', 'Logistics & Transport', 450000.00, 50000000.00, 'active', '2025-12-04 17:10:58.688735', '2026-06-04 17:10:58.688735');
INSERT INTO public.sme_policies VALUES (2, 14, 'SME-LEGAL-01', 'Williams & Partners Law', 'Professional Services', 120000.00, 25000000.00, 'active', '2026-03-04 17:10:58.688735', '2026-06-04 17:10:58.688735');
INSERT INTO public.sme_policies VALUES (3, 12, 'SME-RETAIL-01', 'Adesanya Fashion House', 'Retail & Fashion', 85000.00, 15000000.00, 'active', '2026-02-04 17:10:58.688735', '2026-06-04 17:10:58.688735');
INSERT INTO public.sme_policies VALUES (4, 10, 'SME-TECH-01', 'TechHub Enugu', 'Technology', 65000.00, 10000000.00, 'active', '2026-04-04 17:10:58.688735', '2026-06-04 17:10:58.688735');


--
-- Data for Name: software_updates; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.software_updates VALUES (1, 'software updates 1', 'Sample data for software_updates record 1', '/uploads/software_updates/1.pdf', 'software updates 1', true, '{"index": 1, "sample": true}', 5, '2026-05-29 14:49:34.390334');
INSERT INTO public.software_updates VALUES (2, 'software updates 2', 'Sample data for software_updates record 2', '/uploads/software_updates/2.pdf', 'software updates 2', false, '{"index": 2, "sample": true}', 10, '2026-05-22 14:49:34.390334');
INSERT INTO public.software_updates VALUES (3, 'software updates 3', 'Sample data for software_updates record 3', '/uploads/software_updates/3.pdf', 'software updates 3', false, '{"index": 3, "sample": true}', 15, '2026-05-15 14:49:34.390334');


--
-- Data for Name: storefront_ads; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.storefront_ads VALUES (5, 'storefront_ads 1', 'storefront_ads 1', 'storefront_ads 1', 'storefront_ads 1', 1, 'draft', 1, 1, 1.50, 1.50, '2026-05-29 14:50:36.473536', '2026-05-29 14:50:36.473536', '2026-05-29 14:50:36.473536', '2026-05-29 14:50:36.473536');
INSERT INTO public.storefront_ads VALUES (6, 'storefront_ads 2', 'storefront_ads 2', 'storefront_ads 2', 'storefront_ads 2', 2, 'active', 2, 2, 3.00, 3.00, '2026-05-22 14:50:36.473536', '2026-05-22 14:50:36.473536', '2026-05-22 14:50:36.473536', '2026-05-22 14:50:36.473536');
INSERT INTO public.storefront_ads VALUES (7, 'storefront_ads 3', 'storefront_ads 3', 'storefront_ads 3', 'storefront_ads 3', 3, 'paused', 3, 3, 4.50, 4.50, '2026-05-15 14:50:36.473536', '2026-05-15 14:50:36.473536', '2026-05-15 14:50:36.473536', '2026-05-15 14:50:36.473536');


--
-- Data for Name: supervisor_agents; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.supervisor_agents VALUES (1, 1, 7, '2026-05-29 14:49:34.411121', 1, '2026-05-29 14:49:34.411121');
INSERT INTO public.supervisor_agents VALUES (2, 2, 8, '2026-05-22 14:49:34.411121', 2, '2026-05-22 14:49:34.411121');
INSERT INTO public.supervisor_agents VALUES (3, 3, 9, '2026-05-15 14:49:34.411121', 3, '2026-05-15 14:49:34.411121');


--
-- Data for Name: system_config; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.system_config VALUES (1, 'system_config_key_1_9c18142069c63e3a4879b418057e7401', 'system config 1', 'Sample data for system_config record 1', 'system config 1', '2026-05-29 14:49:34.415763', '2026-05-29 14:49:34.415763');
INSERT INTO public.system_config VALUES (2, 'system_config_key_2_f4cbeb1d2a120ec9de109e1c63bbb1ea', 'system config 2', 'Sample data for system_config record 2', 'system config 2', '2026-05-22 14:49:34.415763', '2026-05-22 14:49:34.415763');
INSERT INTO public.system_config VALUES (3, 'system_config_key_3_c55e6fe73e2025f59812d431dd7a2242', 'system config 3', 'Sample data for system_config record 3', 'system config 3', '2026-05-15 14:49:34.415763', '2026-05-15 14:49:34.415763');


--
-- Data for Name: system_settings; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.system_settings VALUES (1, 'premium', 'naicom_levy_rate', '0.01', 'NAICOM levy rate applied to all premiums (1%)', 'system', '2026-06-04 19:56:03.63756');
INSERT INTO public.system_settings VALUES (2, 'premium', 'stamp_duty', '50', 'Fixed stamp duty per policy in Naira', 'system', '2026-06-04 19:56:03.63756');
INSERT INTO public.system_settings VALUES (3, 'premium', 'min_premium_motor', '15000', 'Minimum premium for motor insurance', 'system', '2026-06-04 19:56:03.63756');
INSERT INTO public.system_settings VALUES (4, 'premium', 'min_premium_health', '50000', 'Minimum premium for health insurance', 'system', '2026-06-04 19:56:03.63756');
INSERT INTO public.system_settings VALUES (5, 'premium', 'min_premium_life', '25000', 'Minimum premium for life insurance', 'system', '2026-06-04 19:56:03.63756');
INSERT INTO public.system_settings VALUES (6, 'underwriting', 'auto_approve_max', '5000000', 'Maximum sum assured for auto-approval', 'system', '2026-06-04 19:56:03.63756');
INSERT INTO public.system_settings VALUES (7, 'underwriting', 'smoker_loading', '0.25', 'Additional loading for smokers (25%)', 'system', '2026-06-04 19:56:03.63756');
INSERT INTO public.system_settings VALUES (8, 'underwriting', 'age_factor_senior', '1.5', 'Age factor multiplier for 60+', 'system', '2026-06-04 19:56:03.63756');
INSERT INTO public.system_settings VALUES (9, 'underwriting', 'ncd_max_discount', '0.15', 'Maximum no-claims discount (15%)', 'system', '2026-06-04 19:56:03.63756');
INSERT INTO public.system_settings VALUES (10, 'claims', 'fast_track_threshold', '500000', 'Claims below this amount eligible for fast-track', 'system', '2026-06-04 19:56:03.63756');
INSERT INTO public.system_settings VALUES (11, 'claims', 'fraud_score_threshold', '70', 'Fraud score above this triggers investigation', 'system', '2026-06-04 19:56:03.63756');
INSERT INTO public.system_settings VALUES (12, 'claims', 'auto_decline_fraud_score', '90', 'Fraud score above this auto-declines claim', 'system', '2026-06-04 19:56:03.63756');
INSERT INTO public.system_settings VALUES (13, 'kyc', 'tier1_features', '["view_products", "get_quotes"]', 'Features available at KYC Tier 1', 'system', '2026-06-04 19:56:03.63756');
INSERT INTO public.system_settings VALUES (14, 'kyc', 'tier2_features', '["buy_policy", "file_claim", "make_payment"]', 'Features available at KYC Tier 2', 'system', '2026-06-04 19:56:03.63756');
INSERT INTO public.system_settings VALUES (15, 'kyc', 'tier3_features', '["high_value_policy", "investment", "advanced_analytics"]', 'Features available at KYC Tier 3', 'system', '2026-06-04 19:56:03.63756');
INSERT INTO public.system_settings VALUES (16, 'system', 'currency', '"NGN"', 'Default currency', 'system', '2026-06-04 19:56:03.63756');
INSERT INTO public.system_settings VALUES (17, 'system', 'date_format', '"DD/MM/YYYY"', 'Default date display format', 'system', '2026-06-04 19:56:03.63756');
INSERT INTO public.system_settings VALUES (18, 'system', 'max_concurrent_sessions', '5', 'Max concurrent user sessions', 'system', '2026-06-04 19:56:03.63756');


--
-- Data for Name: takaful_pools; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.takaful_pools VALUES (1, 'Motor Takaful Pool', 'general', 25000000.00, 850, 3500000.00, 25.00, 'active', '2026-06-05 04:11:13.040271');
INSERT INTO public.takaful_pools VALUES (2, 'Health Takaful Pool', 'health', 40000000.00, 1200, 5000000.00, 20.00, 'active', '2026-06-05 04:11:13.040271');
INSERT INTO public.takaful_pools VALUES (3, 'Family Takaful Pool', 'family', 60000000.00, 2100, 8000000.00, 15.00, 'active', '2026-06-05 04:11:13.040271');


--
-- Data for Name: takaful_sharia_principles; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.takaful_sharia_principles VALUES (1, 'Tabarru (Donation)', 'Members donate to a common fund for mutual assistance', 'core', 1);
INSERT INTO public.takaful_sharia_principles VALUES (2, 'Mudharabah', 'Profit-sharing between participants and operator', 'investment', 2);
INSERT INTO public.takaful_sharia_principles VALUES (3, 'Wakalah (Agency)', 'Operator acts as agent managing the fund for a fee', 'governance', 3);
INSERT INTO public.takaful_sharia_principles VALUES (4, 'No Gharar', 'Contracts are transparent with no excessive uncertainty', 'compliance', 4);
INSERT INTO public.takaful_sharia_principles VALUES (5, 'No Riba', 'No interest-based investments or charges', 'compliance', 5);
INSERT INTO public.takaful_sharia_principles VALUES (6, 'Surplus Distribution', 'Excess funds returned to participants annually', 'returns', 6);


--
-- Data for Name: telco_credit_scores; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.telco_credit_scores VALUES (1, 1, '+234801', 'telco_credit_scores 1', 1, 'te', '{item1}', true, '2026-05-29 14:50:05.001738', '2026-07-05 14:50:05.001738');
INSERT INTO public.telco_credit_scores VALUES (2, 2, '+234802', 'telco_credit_scores 2', 2, 'te', '{item2}', false, '2026-05-22 14:50:05.001738', '2026-08-04 14:50:05.001738');
INSERT INTO public.telco_credit_scores VALUES (3, 3, '+234803', 'telco_credit_scores 3', 3, 'te', '{item3}', false, '2026-05-15 14:50:05.001738', '2026-09-03 14:50:05.001738');


--
-- Data for Name: telematics_devices; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.telematics_devices VALUES (1, 1, 'TEL-001', 'OBD-II GPS Tracker', 'OBD-II', 'Teltonika', 'FMB920', '352625066123456', 'WVWZZZ3CZWE12345', '2026-01-15 00:00:00', '2026-06-04 20:05:00.742392', 45.00, 3, 1, 12, 85, 'Active', '2026-06-04 21:05:00.742392');
INSERT INTO public.telematics_devices VALUES (2, 1, 'TEL-002', 'Dashcam + GPS', 'Dashcam', 'Viofo', 'A229 Pro', '352625066789012', 'WBAPH5C55BA12345', '2026-02-01 00:00:00', '2026-06-04 19:05:00.742392', 62.00, 5, 4, 25, 78, 'Active', '2026-06-04 21:05:00.742392');
INSERT INTO public.telematics_devices VALUES (3, 2, 'TEL-003', 'Fleet Management Unit', 'Fleet_GPS', 'CalAmp', 'LMU-5530', '352625066345678', '1FTFW1ET7DFA1234', '2026-03-01 00:00:00', '2026-06-04 20:35:00.742392', 120.00, 8, 6, 40, 72, 'Active', '2026-06-04 21:05:00.742392');
INSERT INTO public.telematics_devices VALUES (4, 3, 'TEL-004', 'Smart Tag', 'Bluetooth', 'Apple', 'AirTag', '000000000000001', 'JN1TANT31Z00001', '2026-04-15 00:00:00', '2026-06-04 18:05:00.742392', 28.00, 1, 0, 5, 92, 'Active', '2026-06-04 21:05:00.742392');
INSERT INTO public.telematics_devices VALUES (5, 4, 'TEL-005', 'Fleet Tracker Pro', 'Satellite', 'Globalstar', 'STX3', '352625066901234', 'WDBUF61J21A12345', '2026-01-01 00:00:00', '2026-06-04 20:20:00.742392', 95.00, 6, 3, 30, 76, 'Active', '2026-06-04 21:05:00.742392');


--
-- Data for Name: tenant_branding; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.tenant_branding VALUES (1, 1, '/api/1', '/api/1', '#111111', '#111111', '#111111', '#111111', '#111111', 'tenant_branding 1', 'tenant_branding 1', 'tenant_branding 1', 'tenant_branding 1', 's1@ip.ng', '+234801', '/api/1', '/api/1', 'tenant_branding 1', true, '2026-05-29 14:50:05.006975', '2026-05-29 14:50:05.006975');
INSERT INTO public.tenant_branding VALUES (2, 2, '/api/2', '/api/2', '#222222', '#222222', '#222222', '#222222', '#222222', 'tenant_branding 2', 'tenant_branding 2', 'tenant_branding 2', 'tenant_branding 2', 's2@ip.ng', '+234802', '/api/2', '/api/2', 'tenant_branding 2', false, '2026-05-22 14:50:05.006975', '2026-05-22 14:50:05.006975');
INSERT INTO public.tenant_branding VALUES (3, 3, '/api/3', '/api/3', '#333333', '#333333', '#333333', '#333333', '#333333', 'tenant_branding 3', 'tenant_branding 3', 'tenant_branding 3', 'tenant_branding 3', 's3@ip.ng', '+234803', '/api/3', '/api/3', 'tenant_branding 3', false, '2026-05-15 14:50:05.006975', '2026-05-15 14:50:05.006975');


--
-- Data for Name: tenant_corridors; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.tenant_corridors VALUES (1, 1, 'NG', 'NGN', 'NG', 'NGN', 'active', 50000.00, 50000.00, 1.50, 1, '{"data": "sample_1"}', '{"data": "sample_1"}', '2026-05-29 14:50:05.011054', '2026-05-29 14:50:05.011054');
INSERT INTO public.tenant_corridors VALUES (2, 2, 'NG', 'NGN', 'NG', 'NGN', 'paused', 100000.00, 100000.00, 3.00, 2, '{"data": "sample_2"}', '{"data": "sample_2"}', '2026-05-22 14:50:05.011054', '2026-05-22 14:50:05.011054');
INSERT INTO public.tenant_corridors VALUES (3, 3, 'NG', 'NGN', 'NG', 'NGN', 'disabled', 150000.00, 150000.00, 4.50, 3, '{"data": "sample_3"}', '{"data": "sample_3"}', '2026-05-15 14:50:05.011054', '2026-05-15 14:50:05.011054');


--
-- Data for Name: tenant_feature_toggles; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.tenant_feature_toggles VALUES (1, 1, 'tenant_feature_toggles_key_1_4d0858f9d5412968392087fd51e787bd', true, 'tenant feature toggles 1', 1, '2026-05-29 14:49:34.472177', '2026-05-29 14:49:34.472177');
INSERT INTO public.tenant_feature_toggles VALUES (2, 2, 'tenant_feature_toggles_key_2_e186aec079cc6009404e03225ed96886', false, 'tenant feature toggles 2', 2, '2026-05-22 14:49:34.472177', '2026-05-22 14:49:34.472177');
INSERT INTO public.tenant_feature_toggles VALUES (3, 3, 'tenant_feature_toggles_key_3_4052baa07576c65326f112a93a99c7e3', false, 'tenant feature toggles 3', 3, '2026-05-15 14:49:34.472177', '2026-05-15 14:49:34.472177');


--
-- Data for Name: tenant_fee_overrides; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.tenant_fee_overrides VALUES (1, 1, 1, 'tenant_fee_overrides 1', 'percentage', 1.5000, 1.50, 1.50, '{"data": "sample_1"}', '102.89.1', true, '2026-05-29 14:50:05.015079', '2026-05-29 14:50:05.015079');
INSERT INTO public.tenant_fee_overrides VALUES (2, 2, 2, 'tenant_fee_overrides 2', 'flat', 3.0000, 3.00, 3.00, '{"data": "sample_2"}', '102.89.2', false, '2026-05-22 14:50:05.015079', '2026-05-22 14:50:05.015079');
INSERT INTO public.tenant_fee_overrides VALUES (3, 3, 3, 'tenant_fee_overrides 3', 'tiered', 4.5000, 4.50, 4.50, '{"data": "sample_3"}', '102.89.3', false, '2026-05-15 14:50:05.015079', '2026-05-15 14:50:05.015079');


--
-- Data for Name: tenant_users; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.tenant_users VALUES (1, 1, 1, 's1@ip.ng', 'Sample 1', 'tenant_admin', true, 1, '2026-05-29 14:50:05.019019', '2026-05-29 14:50:05.019019', '2026-05-29 14:50:05.019019', '2026-05-29 14:50:05.019019', '2026-05-29 14:50:05.019019');
INSERT INTO public.tenant_users VALUES (2, 2, 2, 's2@ip.ng', 'Sample 2', 'tenant_operator', false, 2, '2026-05-22 14:50:05.019019', '2026-05-22 14:50:05.019019', '2026-05-22 14:50:05.019019', '2026-05-22 14:50:05.019019', '2026-05-22 14:50:05.019019');
INSERT INTO public.tenant_users VALUES (3, 3, 3, 's3@ip.ng', 'Sample 3', 'tenant_viewer', false, 3, '2026-05-15 14:50:05.019019', '2026-05-15 14:50:05.019019', '2026-05-15 14:50:05.019019', '2026-05-15 14:50:05.019019', '2026-05-15 14:50:05.019019');


--
-- Data for Name: tenants; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.tenants VALUES (1, 'tenants 1', 'Sample 1', 'NG', 'NGN', 'trial', '1', 2, 2, 1.50, 's1@ip.ng', '+234801', '{"data": "sample_1"}', '1', '2026-05-29 14:50:05.023315', '2026-05-29 14:50:05.023315', 'k1', NULL, '{}');
INSERT INTO public.tenants VALUES (2, 'tenants 2', 'Sample 2', 'NG', 'NGN', 'active', '2', 4, 4, 3.00, 's2@ip.ng', '+234802', '{"data": "sample_2"}', '2', '2026-05-22 14:50:05.023315', '2026-05-22 14:50:05.023315', 'k2', NULL, '{}');
INSERT INTO public.tenants VALUES (3, 'tenants 3', 'Sample 3', 'NG', 'NGN', 'suspended', '3', 6, 6, 4.50, 's3@ip.ng', '+234803', '{"data": "sample_3"}', '3', '2026-05-15 14:50:05.023315', '2026-05-15 14:50:05.023315', 'k3', NULL, '{}');
INSERT INTO public.tenants VALUES (4, 'test-insurance-corp', 'Test Insurance Corp', 'NGA', 'NGN', 'trial', NULL, 0, 0, 0.00, 'admin@test.ng', NULL, NULL, NULL, '2026-06-05 17:04:28.405636', '2026-06-05 17:04:28.405636', NULL, 'test.insureportal.ng', '{}');
INSERT INTO public.tenants VALUES (5, 'acme-insurance-ltd', 'Acme Insurance Ltd', 'NGA', 'NGN', 'trial', NULL, 0, 0, 0.00, 'updated@acme.ng', NULL, NULL, NULL, '2026-06-05 17:09:29.036661', '2026-06-05 17:09:29.036661', NULL, NULL, '{}');


--
-- Data for Name: terminal_groups; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.terminal_groups VALUES (1, 'Sample terminal_groups 1', 'Sample data for terminal_groups record 1', '{"index": 1, "sample": true}', '2026-05-29 14:49:34.530326');
INSERT INTO public.terminal_groups VALUES (2, 'Sample terminal_groups 2', 'Sample data for terminal_groups record 2', '{"index": 2, "sample": true}', '2026-05-22 14:49:34.530326');
INSERT INTO public.terminal_groups VALUES (3, 'Sample terminal_groups 3', 'Sample data for terminal_groups record 3', '{"index": 3, "sample": true}', '2026-05-15 14:49:34.530326');


--
-- Data for Name: training_courses; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.training_courses VALUES (1, 'NAICOM Regulatory Compliance', 'Comprehensive training on NAICOM regulations, licensing requirements, and compliance obligations for insurance practitioners', 'compliance', 'video', '/training/naicom-compliance', 480, 80, true, true, 1, NULL, '2026-06-04 20:59:32.597471');
INSERT INTO public.training_courses VALUES (2, 'Anti-Money Laundering (AML/CFT)', 'AML/CFT compliance training covering identification, reporting, and prevention of money laundering through insurance', 'compliance', 'video', '/training/aml-cft', 360, 85, true, true, 1, NULL, '2026-06-04 20:59:32.597471');
INSERT INTO public.training_courses VALUES (3, 'Motor Insurance Underwriting', 'Technical training on motor insurance products, rating factors, claims handling, and Nigerian motor insurance regulations', 'technical', 'interactive', '/training/motor-underwriting', 720, 75, false, true, 1, NULL, '2026-06-04 20:59:32.597471');
INSERT INTO public.training_courses VALUES (4, 'Life Insurance Fundamentals', 'End-to-end training on life insurance products, actuarial basics, premium calculation, and beneficiary management', 'technical', 'video', '/training/life-insurance', 600, 75, false, true, 1, NULL, '2026-06-04 20:59:32.597471');
INSERT INTO public.training_courses VALUES (5, 'Digital Sales & Customer Onboarding', 'Training on digital insurance distribution, KYC processes, and customer engagement strategies', 'sales', 'interactive', '/training/digital-sales', 240, 70, false, true, 1, NULL, '2026-06-04 20:59:32.597471');
INSERT INTO public.training_courses VALUES (6, 'Agricultural Insurance Specialist', 'Specialized training covering crop insurance, livestock coverage, weather index products, and NDVI monitoring', 'technical', 'video', '/training/agricultural', 480, 75, false, true, 1, NULL, '2026-06-04 20:59:32.597471');
INSERT INTO public.training_courses VALUES (7, 'Claims Adjudication & Fraud Prevention', 'Advanced training on claims processing workflow, fraud detection techniques, and NAICOM settlement guidelines', 'claims', 'interactive', '/training/claims-adjudication', 360, 80, true, true, 1, NULL, '2026-06-04 20:59:32.597471');
INSERT INTO public.training_courses VALUES (8, 'Takaful (Islamic Insurance)', 'Training on Shariah-compliant insurance products, Takaful operating models, and regulatory framework in Nigeria', 'technical', 'video', '/training/takaful', 360, 75, false, true, 1, NULL, '2026-06-04 20:59:32.597471');


--
-- Data for Name: training_enrollments; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.training_enrollments VALUES (1, 1, 1, 'completed', 100, 92, '2026-05-05 20:59:40.590843', '2026-05-10 20:59:40.590843', NULL, NULL, '2026-06-04 20:59:40.590843');
INSERT INTO public.training_enrollments VALUES (2, 2, 1, 'completed', 100, 88, '2026-05-15 20:59:40.590843', '2026-05-17 20:59:40.590843', NULL, NULL, '2026-06-04 20:59:40.590843');
INSERT INTO public.training_enrollments VALUES (3, 3, 1, 'in_progress', 65, NULL, '2026-05-25 20:59:40.590843', NULL, NULL, NULL, '2026-06-04 20:59:40.590843');
INSERT INTO public.training_enrollments VALUES (4, 1, 2, 'completed', 100, 85, '2026-05-20 20:59:40.590843', '2026-05-23 20:59:40.590843', NULL, NULL, '2026-06-04 20:59:40.590843');
INSERT INTO public.training_enrollments VALUES (5, 7, 2, 'in_progress', 40, NULL, '2026-05-30 20:59:40.590843', NULL, NULL, NULL, '2026-06-04 20:59:40.590843');


--
-- Data for Name: transaction_limits; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.transaction_limits VALUES (1, 'transaction limits 1', 'standard', 1.50, 1.50, 1.50, true, '2026-05-29 14:49:34.534711', '2026-05-29 14:49:34.534711');
INSERT INTO public.transaction_limits VALUES (2, 'transaction limits 2', 'standard', 3.00, 3.00, 3.00, false, '2026-05-22 14:49:34.534711', '2026-05-22 14:49:34.534711');
INSERT INTO public.transaction_limits VALUES (3, 'transaction limits 3', 'standard', 4.50, 4.50, 4.50, false, '2026-05-15 14:49:34.534711', '2026-05-15 14:49:34.534711');


--
-- Data for Name: transactions; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.transactions VALUES (1, 'TXN-2026-001', 1, 'Insurance', 125000.00, 1250.00, 18750.00, 'Patrick Munis', '+2348012345678', NULL, NULL, NULL, 'App', 'success', NULL, false, false, 0.00, NULL, '2026-04-06 13:11:23.940928', '2026-06-05 13:11:23.940928', false, NULL, false, NULL, NULL, NULL, NULL, 'NGN', NULL, NULL);
INSERT INTO public.transactions VALUES (2, 'TXN-2026-002', 2, 'Insurance', 150000.00, 1500.00, 18000.00, 'Chioma Okafor', '+2348098765432', NULL, NULL, NULL, 'App', 'success', NULL, false, false, 0.00, NULL, '2026-04-21 13:11:23.940928', '2026-06-05 13:11:23.940928', false, NULL, false, NULL, NULL, NULL, NULL, 'NGN', NULL, NULL);
INSERT INTO public.transactions VALUES (3, 'TXN-2026-003', 1, 'Cash Out', 350000.00, 1750.00, 0.00, 'Emeka Eze', '+2348055544433', NULL, NULL, NULL, 'Cash', 'success', NULL, false, false, 0.00, NULL, '2026-05-16 13:11:23.940928', '2026-06-05 13:11:23.940928', false, NULL, false, NULL, NULL, NULL, NULL, 'NGN', NULL, NULL);
INSERT INTO public.transactions VALUES (4, 'TXN-2026-004', 3, 'Insurance', 75000.00, 750.00, 15000.00, 'Aisha Bello', '+2348077788899', NULL, NULL, NULL, 'USSD', 'success', NULL, false, false, 0.00, NULL, '2026-05-21 13:11:23.940928', '2026-06-05 13:11:23.940928', false, NULL, false, NULL, NULL, NULL, NULL, 'NGN', NULL, NULL);
INSERT INTO public.transactions VALUES (5, 'TXN-2026-005', 1, 'Insurance', 200000.00, 2000.00, 20000.00, 'Olumide Adeyemi', '+2348066677788', NULL, NULL, NULL, 'App', 'pending', NULL, false, false, 0.00, NULL, '2026-06-03 13:11:23.940928', '2026-06-05 13:11:23.940928', false, NULL, false, NULL, NULL, NULL, NULL, 'NGN', NULL, NULL);


--
-- Data for Name: tx_monitoring_alerts; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.tx_monitoring_alerts VALUES (1, 1, 'standard', 'tx monitoring alerts 1', 'Sample data for tx_monitoring_alerts record 1', 1.50, 7, true, 1, '2026-05-29 14:49:34.538311', 'tx monitoring alerts 1', '2026-05-29 14:49:34.538311');
INSERT INTO public.tx_monitoring_alerts VALUES (2, 2, 'standard', 'tx monitoring alerts 2', 'Sample data for tx_monitoring_alerts record 2', 3.00, 8, false, 2, '2026-05-22 14:49:34.538311', 'tx monitoring alerts 2', '2026-05-22 14:49:34.538311');
INSERT INTO public.tx_monitoring_alerts VALUES (3, 3, 'standard', 'tx monitoring alerts 3', 'Sample data for tx_monitoring_alerts record 3', 4.50, 9, false, 3, '2026-05-15 14:49:34.538311', 'tx monitoring alerts 3', '2026-05-15 14:49:34.538311');


--
-- Data for Name: underwriting_decisions; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.underwriting_decisions VALUES (1, 1, 1, 'Motor', 'auto_approved', 25.50, 'preferred', -10.00, '[]', '[]', '["No Claims Discount: 3 years = 15% discount", "Anti-theft tracker present"]', NULL, 'Low risk profile, excellent claims history', '2026-06-04 19:07:31.381873', '2026-06-04 19:07:31.381873');
INSERT INTO public.underwriting_decisions VALUES (2, 2, 2, 'Health', 'auto_approved', 42.00, 'standard', 0.00, '["Pre-existing: Type 2 Diabetes — 12 month wait"]', '["Annual health checkup required"]', '["Pre-existing Loading: 50% on diabetes-related", "BMI within range"]', NULL, 'Standard risk with pre-existing condition', '2026-06-04 19:07:31.381873', '2026-06-04 19:07:31.381873');
INSERT INTO public.underwriting_decisions VALUES (3, 3, 3, 'Life', 'referred', 68.50, 'substandard', 35.00, '[]', '["Medical exam required", "Income verification"]', '["Sum Assured exceeds ₦10M — medical required", "Hazardous occupation: Mining"]', NULL, 'Referred to senior underwriter due to occupation class', '2026-06-04 19:07:31.381873', '2026-06-04 19:07:31.381873');
INSERT INTO public.underwriting_decisions VALUES (4, 4, 4, 'Property', 'declined', 92.00, 'decline', 0.00, '[]', '[]', '["Construction: wooden", "No fire protection", "Flood zone"]', NULL, 'Risk too high — wooden structure in flood zone without fire protection', '2026-06-04 19:07:31.381873', '2026-06-04 19:07:31.381873');
INSERT INTO public.underwriting_decisions VALUES (5, 5, 5, 'Motor', 'counter_offer', 55.00, 'standard', 25.00, '["Off-road use excluded"]', '["Install GPS tracker within 30 days"]', '["Young Driver Loading: 25%", "No anti-theft device: +10%"]', NULL, 'Counter offer with tracker requirement', '2026-06-04 19:07:31.381873', '2026-06-04 19:07:31.381873');
INSERT INTO public.underwriting_decisions VALUES (6, NULL, 1, 'Motor', 'auto_approved', 45.00, 'standard', 35.00, '[]', '[]', '[{"rule": "Anti-Theft Loading", "result": "+10% loading"}, {"rule": "Young Driver Loading", "result": "+25% young driver"}]', NULL, 'Auto-decision: auto_approved', '2026-06-04 19:12:42.138528', '2026-06-04 19:12:42.138528');
INSERT INTO public.underwriting_decisions VALUES (7, NULL, 1, 'Motor', 'auto_approved', 20.00, 'preferred', -15.00, '[]', '[]', '[{"rule": "No Claims Discount", "result": "-15% NCD"}]', NULL, 'Auto-decision: auto_approved', '2026-06-04 19:13:13.12361', '2026-06-04 19:13:13.12361');
INSERT INTO public.underwriting_decisions VALUES (8, NULL, 1, 'Motor', 'auto_approved', 35.00, 'standard', 10.00, '[]', '[]', '[{"rule": "Anti-Theft Loading", "result": "+10% loading"}]', NULL, 'Auto-decision: auto_approved', '2026-06-04 19:23:26.618572', '2026-06-04 19:23:26.618572');
INSERT INTO public.underwriting_decisions VALUES (9, NULL, 1, 'Commercial', 'auto_approved', 30.00, 'standard', 0.00, '[]', '[]', '[]', NULL, 'Auto-decision: auto_approved', '2026-06-04 19:23:51.99868', '2026-06-04 19:23:51.99868');
INSERT INTO public.underwriting_decisions VALUES (10, NULL, 1, 'Motor', 'auto_approved', 20.00, 'preferred', -15.00, '[]', '[]', '[{"rule": "No Claims Discount", "result": "-15% NCD"}]', NULL, 'Auto-decision: auto_approved', '2026-06-04 19:45:00.822188', '2026-06-04 19:45:00.822188');
INSERT INTO public.underwriting_decisions VALUES (11, NULL, 1, 'Motor', 'auto_approved', 35.00, 'standard', 10.00, '[]', '[]', '[{"rule": "Anti-Theft Loading", "result": "+10% loading"}]', NULL, 'Auto-decision: auto_approved', '2026-06-04 21:03:32.038181', '2026-06-04 21:03:32.038181');
INSERT INTO public.underwriting_decisions VALUES (12, NULL, 1, 'Motor', 'auto_approved', 35.00, 'standard', 10.00, '[]', '[]', '[{"rule": "Anti-Theft Loading", "result": "+10% loading"}]', NULL, 'Auto-decision: auto_approved', '2026-06-04 21:03:50.744078', '2026-06-04 21:03:50.744078');
INSERT INTO public.underwriting_decisions VALUES (13, NULL, 1, 'Motor', 'auto_approved', 35.00, 'standard', 10.00, '[]', '[]', '[{"rule": "Anti-Theft Loading", "result": "+10% loading"}]', NULL, 'Auto-decision: auto_approved', '2026-06-04 21:04:08.255986', '2026-06-04 21:04:08.255986');
INSERT INTO public.underwriting_decisions VALUES (14, NULL, 1, 'Motor', 'auto_approved', 35.00, 'standard', 10.00, '[]', '[]', '[{"rule": "Anti-Theft Loading", "result": "+10% loading"}]', NULL, 'Auto-decision: auto_approved', '2026-06-04 21:04:13.481433', '2026-06-04 21:04:13.481433');
INSERT INTO public.underwriting_decisions VALUES (15, NULL, 1, 'Motor', 'auto_approved', 35.00, 'standard', 10.00, '[]', '[]', '[{"rule": "Anti-Theft Loading", "result": "+10% loading"}]', NULL, 'Auto-decision: auto_approved', '2026-06-04 21:36:38.732337', '2026-06-04 21:36:38.732337');
INSERT INTO public.underwriting_decisions VALUES (16, NULL, 1, 'Motor', 'auto_approved', 35.00, 'standard', 10.00, '[]', '[]', '[{"rule": "Anti-Theft Loading", "result": "+10% loading"}]', NULL, 'Auto-decision: auto_approved', '2026-06-04 21:51:15.026784', '2026-06-04 21:51:15.026784');
INSERT INTO public.underwriting_decisions VALUES (17, NULL, 1, 'Motor', 'auto_approved', 35.00, 'standard', 10.00, '[]', '[]', '[{"rule": "Anti-Theft Loading", "result": "+10% loading"}]', NULL, 'Auto-decision: auto_approved', '2026-06-05 15:38:35.114281', '2026-06-05 15:38:35.114281');
INSERT INTO public.underwriting_decisions VALUES (18, NULL, 1, 'Motor', 'auto_approved', 35.00, 'standard', 10.00, '[]', '[]', '[{"rule": "Anti-Theft Loading", "result": "+10% loading"}]', NULL, 'Auto-decision: auto_approved', '2026-06-05 15:38:51.953182', '2026-06-05 15:38:51.953182');
INSERT INTO public.underwriting_decisions VALUES (19, NULL, 1, 'Motor', 'auto_approved', 35.00, 'standard', 10.00, '[]', '[]', '[{"rule": "Anti-Theft Loading", "result": "+10% loading"}]', NULL, 'Auto-decision: auto_approved', '2026-06-05 15:52:16.111951', '2026-06-05 15:52:16.111951');
INSERT INTO public.underwriting_decisions VALUES (20, NULL, 1, 'Motor', 'auto_approved', 35.00, 'standard', 10.00, '[]', '[]', '[{"rule": "Anti-Theft Loading", "result": "+10% loading"}]', NULL, 'Auto-decision: auto_approved', '2026-06-05 15:54:03.847357', '2026-06-05 15:54:03.847357');
INSERT INTO public.underwriting_decisions VALUES (21, NULL, 1, 'Motor', 'auto_approved', 35.00, 'standard', 10.00, '[]', '[]', '[{"rule": "Anti-Theft Loading", "result": "+10% loading"}]', NULL, 'Auto-decision: auto_approved', '2026-06-05 16:03:01.210439', '2026-06-05 16:03:01.210439');
INSERT INTO public.underwriting_decisions VALUES (22, NULL, 1, 'Motor', 'auto_approved', 35.00, 'standard', 10.00, '[]', '[]', '[{"rule": "Anti-Theft Loading", "result": "+10% loading"}]', NULL, 'Auto-decision: auto_approved', '2026-06-05 16:06:31.789709', '2026-06-05 16:06:31.789709');
INSERT INTO public.underwriting_decisions VALUES (23, NULL, 1, 'Motor', 'auto_approved', 35.00, 'standard', 10.00, '[]', '[]', '[{"rule": "Anti-Theft Loading", "result": "+10% loading"}]', NULL, 'Auto-decision: auto_approved', '2026-06-05 16:37:46.898935', '2026-06-05 16:37:46.898935');
INSERT INTO public.underwriting_decisions VALUES (24, NULL, 1, 'Motor', 'auto_approved', 35.00, 'standard', 10.00, '[]', '[]', '[{"rule": "Anti-Theft Loading", "result": "+10% loading"}]', NULL, 'Auto-decision: auto_approved', '2026-06-05 16:38:18.309384', '2026-06-05 16:38:18.309384');
INSERT INTO public.underwriting_decisions VALUES (25, NULL, 1, 'Motor', 'auto_approved', 35.00, 'standard', 10.00, '[]', '[]', '[{"rule": "Anti-Theft Loading", "result": "+10% loading"}]', NULL, 'Auto-decision: auto_approved', '2026-06-05 16:59:35.500378', '2026-06-05 16:59:35.500378');
INSERT INTO public.underwriting_decisions VALUES (26, NULL, 1, 'Motor', 'auto_approved', 35.00, 'standard', 10.00, '[]', '[]', '[{"rule": "Anti-Theft Loading", "result": "+10% loading"}]', NULL, 'Auto-decision: auto_approved', '2026-06-05 17:04:32.966664', '2026-06-05 17:04:32.966664');
INSERT INTO public.underwriting_decisions VALUES (27, NULL, 1, 'Motor', 'auto_approved', 35.00, 'standard', 10.00, '[]', '[]', '[{"rule": "Anti-Theft Loading", "result": "+10% loading"}]', NULL, 'Auto-decision: auto_approved', '2026-06-05 17:31:25.634758', '2026-06-05 17:31:25.634758');


--
-- Data for Name: underwriting_rules; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.underwriting_rules VALUES (1, 'Motor', 'Age Eligibility', 'eligibility', '{"max_age": 70, "min_age": 18}', '{"action": "check_age"}', 1, true, 'IA 2003 S.68', '2026-06-04 19:07:31.372025', '2026-06-04 19:07:31.372025');
INSERT INTO public.underwriting_rules VALUES (2, 'Motor', 'Vehicle Age Limit', 'eligibility', '{"max_vehicle_age": 15}', '{"action": "reject", "reason": "Vehicle exceeds maximum age limit"}', 2, true, 'NAICOM/MOT/2020', '2026-06-04 19:07:31.372025', '2026-06-04 19:07:31.372025');
INSERT INTO public.underwriting_rules VALUES (3, 'Motor', 'Anti-Theft Loading', 'pricing', '{"has_tracker": false}', '{"reason": "No anti-theft device", "loading_pct": 10}', 10, true, NULL, '2026-06-04 19:07:31.372025', '2026-06-04 19:07:31.372025');
INSERT INTO public.underwriting_rules VALUES (4, 'Motor', 'Young Driver Loading', 'pricing', '{"driver_age_under": 25}', '{"reason": "Young driver surcharge per NAICOM guidelines", "loading_pct": 25}', 11, true, 'NAICOM/MOT/YD', '2026-06-04 19:07:31.372025', '2026-06-04 19:07:31.372025');
INSERT INTO public.underwriting_rules VALUES (5, 'Motor', 'No Claims Discount', 'pricing', '{"claims_free_years_min": 1}', '{"reason": "No-Claims Discount", "max_discount": 60, "discount_pct_per_year": 5}', 12, true, 'NAICOM/NCD/2020', '2026-06-04 19:07:31.372025', '2026-06-04 19:07:31.372025');
INSERT INTO public.underwriting_rules VALUES (6, 'Motor', 'High Risk Area Loading', 'pricing', '{"high_risk_locations": ["Lagos Island", "Victoria Island", "Lekki"]}', '{"reason": "High-risk location surcharge", "loading_pct": 15}', 13, true, NULL, '2026-06-04 19:07:31.372025', '2026-06-04 19:07:31.372025');
INSERT INTO public.underwriting_rules VALUES (7, 'Motor', 'Fleet Discount', 'pricing', '{"fleet_size_min": 5}', '{"reason": "Fleet discount", "discount_pct": 10}', 14, true, NULL, '2026-06-04 19:07:31.372025', '2026-06-04 19:07:31.372025');
INSERT INTO public.underwriting_rules VALUES (8, 'Health', 'Age Eligibility', 'eligibility', '{"max_age": 65, "min_age": 0}', '{"action": "check_age"}', 1, true, NULL, '2026-06-04 19:07:31.372025', '2026-06-04 19:07:31.372025');
INSERT INTO public.underwriting_rules VALUES (9, 'Health', 'Pre-existing Loading', 'pricing', '{"has_pre_existing": true}', '{"reason": "Pre-existing condition loading", "loading_pct": 50, "waiting_period_months": 12}', 10, true, 'NAICOM/HLT/PE', '2026-06-04 19:07:31.372025', '2026-06-04 19:07:31.372025');
INSERT INTO public.underwriting_rules VALUES (10, 'Health', 'Smoking Loading', 'pricing', '{"is_smoker": true}', '{"reason": "Smoker surcharge", "loading_pct": 35}', 11, true, NULL, '2026-06-04 19:07:31.372025', '2026-06-04 19:07:31.372025');
INSERT INTO public.underwriting_rules VALUES (11, 'Health', 'BMI Loading', 'pricing', '{"bmi_over": 30}', '{"reason": "Obesity loading", "loading_pct": 20}', 12, true, NULL, '2026-06-04 19:07:31.372025', '2026-06-04 19:07:31.372025');
INSERT INTO public.underwriting_rules VALUES (12, 'Health', 'Maternity Waiting', 'exclusion', '{"gender": "female", "age_under": 45}', '{"reason": "Maternity waiting period", "waiting_period_months": 10}', 20, true, NULL, '2026-06-04 19:07:31.372025', '2026-06-04 19:07:31.372025');
INSERT INTO public.underwriting_rules VALUES (13, 'Life', 'Sum Assured Limit', 'limit', '{"income_multiple_max": 25}', '{"action": "limit_sa", "reason": "Sum assured limited to 25x annual income"}', 1, true, 'NAICOM/LIF/SA', '2026-06-04 19:07:31.372025', '2026-06-04 19:07:31.372025');
INSERT INTO public.underwriting_rules VALUES (14, 'Life', 'Medical Exam Threshold', 'eligibility', '{"sum_assured_threshold": 10000000}', '{"action": "require_medical", "reason": "Medical exam required for SA above ₦10M"}', 2, true, NULL, '2026-06-04 19:07:31.372025', '2026-06-04 19:07:31.372025');
INSERT INTO public.underwriting_rules VALUES (15, 'Life', 'Hazardous Occupation', 'pricing', '{"occupation_class": "hazardous"}', '{"reason": "Hazardous occupation loading", "loading_pct": 75}', 10, true, NULL, '2026-06-04 19:07:31.372025', '2026-06-04 19:07:31.372025');
INSERT INTO public.underwriting_rules VALUES (16, 'Property', 'Construction Type Rating', 'pricing', '{"construction": "wooden"}', '{"reason": "Wooden construction loading", "loading_pct": 50}', 10, true, NULL, '2026-06-04 19:07:31.372025', '2026-06-04 19:07:31.372025');
INSERT INTO public.underwriting_rules VALUES (17, 'Property', 'Fire Protection Discount', 'pricing', '{"has_sprinkler": true, "has_fire_alarm": true}', '{"reason": "Fire protection discount", "discount_pct": 15}', 11, true, NULL, '2026-06-04 19:07:31.372025', '2026-06-04 19:07:31.372025');
INSERT INTO public.underwriting_rules VALUES (18, 'Agricultural', 'Farm Size Minimum', 'eligibility', '{"min_hectares": 0.5}', '{"action": "check_size"}', 1, true, NULL, '2026-06-04 19:07:31.372025', '2026-06-04 19:07:31.372025');
INSERT INTO public.underwriting_rules VALUES (19, 'Agricultural', 'NDVI Verification', 'eligibility', '{"requires_ndvi": true}', '{"action": "verify_ndvi", "reason": "Satellite NDVI verification required for claims"}', 2, true, NULL, '2026-06-04 19:07:31.372025', '2026-06-04 19:07:31.372025');
INSERT INTO public.underwriting_rules VALUES (20, 'Marine', 'Vessel Classification', 'eligibility', '{"required_class": "A1"}', '{"action": "check_class", "reason": "Vessel must be Lloyd''s classified"}', 1, true, NULL, '2026-06-04 19:07:31.372025', '2026-06-04 19:07:31.372025');


--
-- Data for Name: user_achievements; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.user_achievements VALUES (1, 1, 1, '2026-01-15 00:00:00', 1, 1);
INSERT INTO public.user_achievements VALUES (2, 1, 2, '2026-01-15 00:00:00', 12, 12);
INSERT INTO public.user_achievements VALUES (3, 1, 3, NULL, 3, 5);
INSERT INTO public.user_achievements VALUES (4, 1, 4, NULL, 0, 6);
INSERT INTO public.user_achievements VALUES (5, 1, 5, '2026-03-01 00:00:00', 3, 3);
INSERT INTO public.user_achievements VALUES (6, 1, 6, NULL, 0, 5);
INSERT INTO public.user_achievements VALUES (7, 1, 7, NULL, 0, 3);
INSERT INTO public.user_achievements VALUES (8, 1, 8, NULL, 0, 12);


--
-- Data for Name: user_roles; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.user_roles VALUES (1, 1, 1, 1, '2026-06-04 19:07:31.380905');


--
-- Data for Name: users; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.users VALUES (2, 'Amara Okafor', 'amara.okafor@insureportal.ng', NULL, 'admin', '2024-12-04 17:07:58.308371', '2026-06-04 17:07:58.308371', '2026-06-04 17:07:58.308371', false, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, false);
INSERT INTO public.users VALUES (3, 'Chidi Eze', 'chidi.eze@insureportal.ng', NULL, 'admin', '2025-06-04 17:07:58.308371', '2026-06-04 17:07:58.308371', '2026-06-04 17:07:58.308371', false, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, false);
INSERT INTO public.users VALUES (4, 'Fatima Bello', 'fatima.bello@insureportal.ng', NULL, 'admin', '2025-04-04 17:07:58.308371', '2026-06-04 17:07:58.308371', '2026-06-04 17:07:58.308371', false, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, false);
INSERT INTO public.users VALUES (5, 'Emeka Nwosu', 'emeka.nwosu@insureportal.ng', NULL, 'admin', '2025-08-04 17:07:58.308371', '2026-06-04 17:07:58.308371', '2026-06-04 17:07:58.308371', false, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, false);
INSERT INTO public.users VALUES (6, 'Ngozi Adeyemi', 'ngozi.adeyemi@insureportal.ng', NULL, 'admin', '2025-10-04 17:07:58.308371', '2026-06-04 17:07:58.308371', '2026-06-04 17:07:58.308371', false, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, false);
INSERT INTO public.users VALUES (7, 'Tunde Afolabi', 'tunde.afolabi@insureportal.ng', NULL, 'admin', '2025-12-04 17:07:58.308371', '2026-06-04 17:07:58.308371', '2026-06-04 17:07:58.308371', false, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, false);
INSERT INTO public.users VALUES (101, 'Adebayo Okafor', 'customer1@insureportal.ng', NULL, 'user', '2026-06-04 22:06:17.129216', '2026-06-04 22:06:17.129216', '2026-06-04 22:06:17.129216', false, NULL, NULL, NULL, NULL, NULL, 'b041c0aeb35bb0fa4aa668ca5a920b590196fdaf9a00eb852c9b7f4d123cc6d6', 'Adebayo Okafor', '+2348012345678', NULL, false);
INSERT INTO public.users VALUES (102, 'Chioma Eze', 'agent1@insureportal.ng', NULL, 'user', '2026-06-04 22:06:17.129216', '2026-06-04 22:06:17.129216', '2026-06-04 22:06:17.129216', false, NULL, NULL, NULL, NULL, NULL, 'f44d1ac9bf0c69b083380b86dbdf3b73797150e3cca4820ac399f7917e607647', 'Chioma Eze', '+2348087654321', NULL, false);
INSERT INTO public.users VALUES (103, 'Ibrahim Musa', 'underwriter1@insureportal.ng', NULL, 'admin', '2026-06-04 22:06:17.129216', '2026-06-04 22:06:17.129216', '2026-06-04 22:06:17.129216', false, NULL, NULL, NULL, NULL, NULL, '73edcdbb1ec7e20131a5908a13d29e2d50032d756410aabcb9049519e46a2088', 'Ibrahim Musa', '+2349011223344', NULL, false);
INSERT INTO public.users VALUES (105, 'Test User 2', 'testuser2@example.com', NULL, 'user', '2026-06-04 22:36:45.396848', '2026-06-04 22:36:45.396848', '2026-06-04 22:36:45.396848', false, NULL, NULL, NULL, NULL, NULL, '7e6e0c3079a08c5cc6036789b57e951f65f82383913ba1a49ae992544f1b4b6e', 'Test User 2', '+2349012345679', NULL, false);
INSERT INTO public.users VALUES (1, 'John Doe', 'john.doe@example.com', NULL, 'user', '2026-05-16 18:23:26.142996', '2026-06-04 23:42:54.721957', '2026-05-16 18:23:26.142996', false, NULL, NULL, NULL, NULL, NULL, 'd3ad9315b7be5dd53b31a273b3b3aba5defe700808305aa16a3062b76658a791', 'Patrick Munis', NULL, '4GQA7JOWQGRVARR2T2ZWS3WTENY63LEX', false);
INSERT INTO public.users VALUES (104, 'Test User', 'testuser@example.com', NULL, 'user', '2026-06-04 22:36:43.368227', '2026-06-05 00:05:16.862779', '2026-06-04 22:36:43.368227', false, NULL, NULL, NULL, NULL, NULL, '8bf729f5f3e2ba07cb421f6046e008ef4958665133b14fded2c7271c4664525f', 'Test User', '+2349012345678', NULL, false);
INSERT INTO public.users VALUES (106, 'New Test User', 'newuser_1780618243@example.com', NULL, 'user', '2026-06-05 00:10:43.080166', '2026-06-05 00:10:43.080166', '2026-06-05 00:10:43.080166', false, NULL, NULL, NULL, NULL, NULL, '937e8d5fbb48bd4949536cd65b8d35c426b80d2f830c5c308e2cdec422ae2244', 'New Test User', '+2348099887766', NULL, false);
INSERT INTO public.users VALUES (107, 'New Test User', 'newuser_1780618255@example.com', NULL, 'user', '2026-06-05 00:10:55.947093', '2026-06-05 00:10:55.947093', '2026-06-05 00:10:55.947093', false, NULL, NULL, NULL, NULL, NULL, '937e8d5fbb48bd4949536cd65b8d35c426b80d2f830c5c308e2cdec422ae2244', 'New Test User', '+2348099887766', NULL, false);
INSERT INTO public.users VALUES (109, 'Test User 27026', 'test-valid-27026@test.com', NULL, 'user', '2026-06-05 13:32:41.294576', '2026-06-05 13:32:41.294576', '2026-06-05 13:32:41.294576', false, NULL, NULL, NULL, NULL, NULL, '$2b$12$9NpbWEIWguixTpsO1BNRjuQS5013aWCuJ8sVOSgFR80xWsigC4Rje', 'Test User 27026', '+23480000027026', NULL, false);
INSERT INTO public.users VALUES (108, 'Demo User', 'demo@insureportal.ng', NULL, 'admin', '2026-06-05 00:28:09.312647', '2026-06-05 00:28:09.312647', '2026-06-05 00:28:09.312647', false, NULL, NULL, NULL, NULL, NULL, '$2b$12$5.iPasjYSg/rfPBF76tKDeuxXXXOZHdBYxuVBds.LBvXXJDlW4V6O', 'Demo User', NULL, NULL, false);
INSERT INTO public.users VALUES (110, 'Integration Test', 'test-1780673931607@integration.test', NULL, 'user', '2026-06-05 15:38:51.928216', '2026-06-05 15:38:51.928216', '2026-06-05 15:38:51.928216', false, NULL, NULL, NULL, NULL, NULL, '$2b$12$rJNC4sYud8QbCimGOb3RL.cHggvuyaN/mhpeL8encXw65k5mwugiW', 'Integration Test', '+2348000000000', NULL, false);
INSERT INTO public.users VALUES (111, 'Integration Test', 'test-1780674735784@integration.test', NULL, 'user', '2026-06-05 15:52:16.088473', '2026-06-05 15:52:16.088473', '2026-06-05 15:52:16.088473', false, NULL, NULL, NULL, NULL, NULL, '$2b$12$2z3Vg.sTiI/tgijdQEuZuuNPfWWpVcJV8e54RVnPW/nDzbFv5zSam', 'Integration Test', '+2348000000000', NULL, false);
INSERT INTO public.users VALUES (112, 'Integration Test', 'test-1780674843509@integration.test', NULL, 'user', '2026-06-05 15:54:03.824058', '2026-06-05 15:54:03.824058', '2026-06-05 15:54:03.824058', false, NULL, NULL, NULL, NULL, NULL, '$2b$12$Kuy4obBAxELl6Xq3CD6v5OzluL7PZ4P/KBab8xWRCoUwNTczQzCIm', 'Integration Test', '+2348000000000', NULL, false);
INSERT INTO public.users VALUES (113, 'Integration Test', 'test-1780675380858@integration.test', NULL, 'user', '2026-06-05 16:03:01.171109', '2026-06-05 16:03:01.171109', '2026-06-05 16:03:01.171109', false, NULL, NULL, NULL, NULL, NULL, '$2b$12$94z7Ii7eRt2vmTHlNRsRC.pznVpI2EAPqhkT5OOl.rseUNXRU58xS', 'Integration Test', '+2348000000000', NULL, false);
INSERT INTO public.users VALUES (114, 'Integration Test', 'test-1780675591414@integration.test', NULL, 'user', '2026-06-05 16:06:31.723793', '2026-06-05 16:06:31.723793', '2026-06-05 16:06:31.723793', false, NULL, NULL, NULL, NULL, NULL, '$2b$12$imQCI57qGx2pzv5E2ir2V.5fCMhW2uut9TYY2T0Ggd81P4aHZwkp2', 'Integration Test', '+2348000000000', NULL, false);
INSERT INTO public.users VALUES (115, 'Integration Test', 'test-1780677466549@integration.test', NULL, 'user', '2026-06-05 16:37:46.860609', '2026-06-05 16:37:46.860609', '2026-06-05 16:37:46.860609', false, NULL, NULL, NULL, NULL, NULL, '$2b$12$87GZ9KqqmnZVRaKFH7bY1O/hjSW.QuYYvW5PLI5S8e9.FqhhduJle', 'Integration Test', '+2348000000000', NULL, false);
INSERT INTO public.users VALUES (116, 'Integration Test', 'test-1780677497971@integration.test', NULL, 'user', '2026-06-05 16:38:18.288139', '2026-06-05 16:38:18.288139', '2026-06-05 16:38:18.288139', false, NULL, NULL, NULL, NULL, NULL, '$2b$12$FkaAu.iqKfVCgQYOSK.XtuCvdwdkF4ESaRbP9kYwZXlANFDfnPYHm', 'Integration Test', '+2348000000000', NULL, false);
INSERT INTO public.users VALUES (117, 'Integration Test', 'test-1780678775182@integration.test', NULL, 'user', '2026-06-05 16:59:35.481211', '2026-06-05 16:59:35.481211', '2026-06-05 16:59:35.481211', false, NULL, NULL, NULL, NULL, NULL, '$2b$12$kkV2lSv9eizc8dTb.zMlWuj986lk2TsxZ30OV4mZIPEyy9C3V2KSq', 'Integration Test', '+2348000000000', NULL, false);
INSERT INTO public.users VALUES (118, 'Integration Test', 'test-1780679072616@integration.test', NULL, 'user', '2026-06-05 17:04:32.930513', '2026-06-05 17:04:32.930513', '2026-06-05 17:04:32.930513', false, NULL, NULL, NULL, NULL, NULL, '$2b$12$MDkr5F5hsOMKI3DP4bzgGudD/kk52tD6ybUlvgbBSTRQHep7XM5.O', 'Integration Test', '+2348000000000', NULL, false);
INSERT INTO public.users VALUES (119, 'Integration Test', 'test-1780680685307@integration.test', NULL, 'user', '2026-06-05 17:31:25.612058', '2026-06-05 17:31:25.612058', '2026-06-05 17:31:25.612058', false, NULL, NULL, NULL, NULL, NULL, '$2b$12$0dT6vHnAVPeZ7z2sNs3lT.oHik56z5g2y/eoZHzIXF3qZtS45npNS', 'Integration Test', '+2348000000000', NULL, false);


--
-- Data for Name: ussd_analytics; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.ussd_analytics VALUES (1, '2026-06-04', 342, 298, 44, 125, 18, 45, 67, 45, '2026-06-05 03:20:53.697145');
INSERT INTO public.ussd_analytics VALUES (2, '2026-06-03', 318, 276, 42, 112, 15, 38, 58, 42, '2026-06-05 03:20:53.697145');
INSERT INTO public.ussd_analytics VALUES (3, '2026-06-02', 295, 258, 37, 98, 12, 42, 55, 48, '2026-06-05 03:20:53.697145');
INSERT INTO public.ussd_analytics VALUES (4, '2026-06-01', 278, 241, 37, 92, 14, 35, 52, 41, '2026-06-05 03:20:53.697145');
INSERT INTO public.ussd_analytics VALUES (5, '2026-05-31', 256, 222, 34, 85, 11, 32, 48, 44, '2026-06-05 03:20:53.697145');
INSERT INTO public.ussd_analytics VALUES (6, '2026-05-30', 310, 270, 40, 108, 16, 40, 62, 46, '2026-06-05 03:20:53.697145');
INSERT INTO public.ussd_analytics VALUES (7, '2026-05-29', 289, 252, 37, 95, 13, 37, 54, 43, '2026-06-05 03:20:53.697145');


--
-- Data for Name: ussd_pins; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.ussd_pins VALUES (1, '08012345678', '$2b$12$LJ3m0xV8Q7Y5K9Z2W1a4YOR6JK8VN5XHGFDSAQWERTYU12345', 0, NULL, '2026-06-05 03:20:53.695264');
INSERT INTO public.ussd_pins VALUES (2, '08098765432', '$2b$12$ABC123DEF456GHI789JKL0MNO1PQR2STU3VWX4YZ567890ABCDE', 0, NULL, '2026-06-05 03:20:53.695264');
INSERT INTO public.ussd_pins VALUES (3, '07033344455', '$2b$12$XYZ789ABC123DEF456GHI0JKL1MNO2PQR3STU4VWX5YZ67890AB', 0, NULL, '2026-06-05 03:20:53.695264');


--
-- Data for Name: ussd_session_log; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.ussd_session_log VALUES (1, 'USSD-1717500000', '08012345678', 0, '*919#', 'Welcome to InsurePortal\n1. Check Policy\n2. File Claim\n3. Pay Premium\n4. Get Quote\n5. My Account\n6. Agent', 'completed', false, NULL, '2026-06-04 10:03:00', '2026-06-05 03:20:53.693147');
INSERT INTO public.ussd_session_log VALUES (2, 'USSD-1717500001', '08098765432', 1, 'POL-001', 'Policy: POL-001\nType: Motor\nStatus: Active\nPremium: ₦45000', 'completed', false, NULL, '2026-06-04 10:05:00', '2026-06-05 03:20:53.693147');
INSERT INTO public.ussd_session_log VALUES (3, 'USSD-1717500002', '07033344455', 3, '25000', 'Payment of ₦25,000 initiated. Enter PIN to confirm.', 'completed', true, NULL, '2026-06-04 11:02:00', '2026-06-05 03:20:53.693147');
INSERT INTO public.ussd_session_log VALUES (4, 'USSD-1717500003', '09011223344', 0, '*919#', 'Welcome to InsurePortal', 'timeout', false, NULL, '2026-06-04 12:00:00', '2026-06-05 03:20:53.693147');
INSERT INTO public.ussd_session_log VALUES (5, 'USSD-1717500004', '08055667788', 4, '1', 'Motor Comprehensive - ₦25,000/yr\nCoverage: Up to ₦50M', 'completed', false, NULL, '2026-06-04 14:30:00', '2026-06-05 03:20:53.693147');
INSERT INTO public.ussd_session_log VALUES (6, 'USSD-1780629883122', '08012345678', 0, '', 'Welcome to InsurePortal\n1. Check Policy Status\n2. File a Claim\n3. Pay Premium\n4. Get Quote\n5. My Account\n6. Agent Support\n7. Renew Policy\n8. Mini Statement\n0. Exit', 'active', false, NULL, '2026-06-05 03:27:43.123', '2026-06-05 03:24:43.124307');
INSERT INTO public.ussd_session_log VALUES (7, 'test-claim-1', '08099887766', 2, '2', 'Select claim type:\n1. Motor Accident\n2. Health\n3. Property Damage\n4. Theft\n5. Life Event', 'active', false, NULL, '2026-06-05 03:28:04.358', '2026-06-05 03:25:04.359124');
INSERT INTO public.ussd_session_log VALUES (8, 'test-claim-1', '08099887766', 2, '1', 'Claim registered successfully!\nType: Motor Accident\nRef: CLM-1780629912490\nSMS confirmation sent to 08099887766\n\n0. Main Menu', 'active', false, 'CLM-1780629912490', '2026-06-05 03:28:12.49', '2026-06-05 03:25:12.496994');
INSERT INTO public.ussd_session_log VALUES (9, 'test-pin-flow', '08033445566', 0, '', 'Welcome to InsurePortal\n1. Check Policy Status\n2. File a Claim\n3. Pay Premium\n4. Get Quote\n5. My Account\n6. Agent Support\n7. Renew Policy\n8. Mini Statement\n0. Exit', 'active', false, NULL, '2026-06-05 03:35:22.191', '2026-06-05 03:32:22.191241');
INSERT INTO public.ussd_session_log VALUES (10, 'test-pin-flow', '08033445566', 5, '5', 'Enter your 4-digit PIN:', 'active', true, NULL, '2026-06-05 03:35:22.207', '2026-06-05 03:32:22.208121');
INSERT INTO public.ussd_session_log VALUES (11, 'test-pin-flow', '08033445566', 51, '1234', 'MY ACCOUNT\n━━━━━━━━━━\nWallet: ₦0\nActive Policies: 20\nPending Claims: 0\n\n1. Transaction History\n2. Update Details\n0. Main Menu', 'active', false, NULL, '2026-06-05 03:35:22.222', '2026-06-05 03:32:22.243763');
INSERT INTO public.ussd_session_log VALUES (12, 'USSD-1780673830453', '08012345678', 0, '', 'Invalid option. Please try again.\nDial *919# for menu.', 'active', false, NULL, '2026-06-05 15:40:10.454', '2026-06-05 15:37:10.454352');
INSERT INTO public.ussd_session_log VALUES (13, 'USSD-1780673915131', '08012345678', 0, '', 'Invalid option. Please try again.\nDial *919# for menu.', 'active', false, NULL, '2026-06-05 15:41:35.132', '2026-06-05 15:38:35.132318');
INSERT INTO public.ussd_session_log VALUES (14, 'USSD-1780673931968', '08012345678', 0, '', 'Invalid option. Please try again.\nDial *919# for menu.', 'active', false, NULL, '2026-06-05 15:41:51.969', '2026-06-05 15:38:51.969192');
INSERT INTO public.ussd_session_log VALUES (15, 'USSD-1780674736127', '08012345678', 0, '', 'Invalid option. Please try again.\nDial *919# for menu.', 'active', false, NULL, '2026-06-05 15:55:16.127', '2026-06-05 15:52:16.127547');
INSERT INTO public.ussd_session_log VALUES (16, 'USSD-1780674843862', '08012345678', 0, '', 'Invalid option. Please try again.\nDial *919# for menu.', 'active', false, NULL, '2026-06-05 15:57:03.862', '2026-06-05 15:54:03.862749');
INSERT INTO public.ussd_session_log VALUES (17, 'USSD-1780675381228', '08012345678', 0, '', 'Invalid option. Please try again.\nDial *919# for menu.', 'active', false, NULL, '2026-06-05 16:06:01.228', '2026-06-05 16:03:01.228697');
INSERT INTO public.ussd_session_log VALUES (18, 'USSD-1780675591822', '08012345678', 0, '', 'Invalid option. Please try again.\nDial *919# for menu.', 'active', false, NULL, '2026-06-05 16:09:31.825', '2026-06-05 16:06:31.825396');
INSERT INTO public.ussd_session_log VALUES (19, 'USSD-1780677466919', '08012345678', 0, '', 'Invalid option. Please try again.\nDial *919# for menu.', 'active', false, NULL, '2026-06-05 16:40:46.919', '2026-06-05 16:37:46.919898');
INSERT INTO public.ussd_session_log VALUES (20, 'USSD-1780677498323', '08012345678', 0, '', 'Invalid option. Please try again.\nDial *919# for menu.', 'active', false, NULL, '2026-06-05 16:41:18.323', '2026-06-05 16:38:18.324047');
INSERT INTO public.ussd_session_log VALUES (21, 'USSD-1780678775515', '08012345678', 0, '', 'Invalid option. Please try again.\nDial *919# for menu.', 'active', false, NULL, '2026-06-05 17:02:35.516', '2026-06-05 16:59:35.516146');
INSERT INTO public.ussd_session_log VALUES (22, 'USSD-1780679072984', '08012345678', 0, '', 'Invalid option. Please try again.\nDial *919# for menu.', 'active', false, NULL, '2026-06-05 17:07:32.985', '2026-06-05 17:04:32.985489');
INSERT INTO public.ussd_session_log VALUES (23, 'USSD-1780680685650', '08012345678', 0, '', 'Invalid option. Please try again.\nDial *919# for menu.', 'active', false, NULL, '2026-06-05 17:34:25.65', '2026-06-05 17:31:25.651056');


--
-- Data for Name: ussd_sessions; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.ussd_sessions VALUES (1, '1', '+2348012345671', 'ussd sessions 1', 'ussd sessions 1', 'active', '2026-05-29 14:49:34.542225', '2026-05-29 14:49:34.542225');
INSERT INTO public.ussd_sessions VALUES (2, '2', '+2348012345672', 'ussd sessions 2', 'ussd sessions 2', 'active', '2026-05-22 14:49:34.542225', '2026-05-22 14:49:34.542225');
INSERT INTO public.ussd_sessions VALUES (3, '3', '+2348012345673', 'ussd sessions 3', 'ussd sessions 3', 'active', '2026-05-15 14:49:34.542225', '2026-05-15 14:49:34.542225');


--
-- Data for Name: vat_records; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.vat_records VALUES (5, '1', 1, 1.50, 1.50, 1.5000, 'standard', 'vat_records 1', 'vat 1', '2026-05-29 14:50:36.476823', '2026-05-29 14:50:36.476823');
INSERT INTO public.vat_records VALUES (6, '2', 2, 3.00, 3.00, 3.0000, 'zero', 'vat_records 2', 'vat 2', '2026-05-22 14:50:36.476823', '2026-05-22 14:50:36.476823');
INSERT INTO public.vat_records VALUES (7, '3', 3, 4.50, 4.50, 4.5000, 'exempt', 'vat_records 3', 'vat 3', '2026-05-15 14:50:36.476823', '2026-05-15 14:50:36.476823');


--
-- Data for Name: velocity_limits; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.velocity_limits VALUES (1, 'Bronze', 1, 50000.00, 1.50, '2026-05-29 14:50:05.047734', 1.50, 1.50, 2, 2);
INSERT INTO public.velocity_limits VALUES (2, 'Silver', 2, 100000.00, 3.00, '2026-05-22 14:50:05.047734', 3.00, 3.00, 4, 4);
INSERT INTO public.velocity_limits VALUES (3, 'Gold', 3, 150000.00, 4.50, '2026-05-15 14:50:05.047734', 4.50, 4.50, 6, 6);


--
-- Data for Name: voice_config; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.voice_config VALUES (1, 'en-NG', 'English (Nigeria)', true, 'google', 'google', 'Welcome to InsurePortal. How can I help you today?', '{policy_inquiry,claims_status,premium_payment,agent_connect,quote_request}');
INSERT INTO public.voice_config VALUES (2, 'yo', 'Yoruba', true, 'google', 'google', 'E kaabo si InsurePortal. Bawo ni mo se le ran yin lowo?', '{policy_inquiry,claims_status,premium_payment}');
INSERT INTO public.voice_config VALUES (3, 'ha', 'Hausa', true, 'google', 'google', 'Barka da zuwa InsurePortal. Yaya zan iya taimaka muku?', '{policy_inquiry,claims_status,premium_payment}');
INSERT INTO public.voice_config VALUES (4, 'ig', 'Igbo', true, 'google', 'google', 'Nnọọ na InsurePortal. Kedu ka m ga-esi nyere gị aka?', '{policy_inquiry,claims_status}');


--
-- Data for Name: voice_sessions; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.voice_sessions VALUES (1, 1, 'voic 1', '102.89.1', 1.5000, 'voice_sessions 1', 'voice_sessions 1', '2026-05-29 14:50:05.052419');
INSERT INTO public.voice_sessions VALUES (2, 2, 'voic 2', '102.89.2', 3.0000, 'voice_sessions 2', 'voice_sessions 2', '2026-05-22 14:50:05.052419');
INSERT INTO public.voice_sessions VALUES (3, 3, 'voic 3', '102.89.3', 4.5000, 'voice_sessions 3', 'voice_sessions 3', '2026-05-15 14:50:05.052419');


--
-- Data for Name: wallet_transactions; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.wallet_transactions VALUES (9, 1, 'credit', 100000.00, 100000.00, 'TOP-001', 'completed', 'Initial top-up via Paystack', '2026-06-05 00:27:58.242055');
INSERT INTO public.wallet_transactions VALUES (10, 1, 'debit', 45000.00, 55000.00, 'POL-PMT-001', 'completed', 'Premium payment - Motor Insurance', '2026-06-05 00:27:58.242055');
INSERT INTO public.wallet_transactions VALUES (11, 1, 'credit', 95000.00, 150000.00, 'CLM-PAY-001', 'completed', 'Claims payout - Property damage', '2026-06-05 00:27:58.242055');
INSERT INTO public.wallet_transactions VALUES (12, 2, 'credit', 75000.00, 75000.00, 'TOP-002', 'completed', 'Bank transfer top-up', '2026-06-05 00:27:58.242055');


--
-- Data for Name: wallets; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.wallets VALUES (7, 1, 150000.00, 'NGN', 'active', '2026-06-05 00:27:58.242055');
INSERT INTO public.wallets VALUES (8, 2, 75000.00, 'NGN', 'active', '2026-06-05 00:27:58.242055');
INSERT INTO public.wallets VALUES (9, 3, 250000.00, 'NGN', 'active', '2026-06-05 00:27:58.242055');


--
-- Data for Name: webhook_deliveries; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.webhook_deliveries VALUES (5, 1, 'webhook_deliver 1', '{"i":1}', 'pending', 1, 'webhook_deliver 1', 1, 1, '2026-05-29 14:50:36.480394', '2026-05-29 14:50:36.480394', '2026-05-29 14:50:36.480394', 1, 1, 1, 1, '2026-05-29 14:50:36.480394');
INSERT INTO public.webhook_deliveries VALUES (6, 2, 'webhook_deliver 2', '{"i":2}', 'delivered', 2, 'webhook_deliver 2', 2, 2, '2026-05-22 14:50:36.480394', '2026-05-22 14:50:36.480394', '2026-05-22 14:50:36.480394', 2, 2, 2, 2, '2026-05-22 14:50:36.480394');
INSERT INTO public.webhook_deliveries VALUES (7, 3, 'webhook_deliver 3', '{"i":3}', 'failed', 3, 'webhook_deliver 3', 3, 3, '2026-05-15 14:50:36.480394', '2026-05-15 14:50:36.480394', '2026-05-15 14:50:36.480394', 3, 3, 3, 3, '2026-05-15 14:50:36.480394');


--
-- Data for Name: webhook_endpoints; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.webhook_endpoints VALUES (1, 'Sample 1', '/api/1', 'k1', '{item1}', true, 1, 1, 2, '2026-05-29 14:50:05.076703', 1, '2026-05-29 14:50:05.076703', '2026-05-29 14:50:05.076703');
INSERT INTO public.webhook_endpoints VALUES (2, 'Sample 2', '/api/2', 'k2', '{item2}', false, 2, 2, 4, '2026-05-22 14:50:05.076703', 2, '2026-05-22 14:50:05.076703', '2026-05-22 14:50:05.076703');
INSERT INTO public.webhook_endpoints VALUES (3, 'Sample 3', '/api/3', 'k3', '{item3}', false, 3, 3, 6, '2026-05-15 14:50:05.076703', 3, '2026-05-15 14:50:05.076703', '2026-05-15 14:50:05.076703');


--
-- Data for Name: webhook_secrets; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.webhook_secrets VALUES (1, 'webhook secrets 1', 'webhook_secrets_key_1_c1f76afe9f5f0529d221a485e4449e0c', 'webhook secrets 1', true, '2026-05-29 14:49:34.635138', '2026-05-29 14:49:34.635138');
INSERT INTO public.webhook_secrets VALUES (2, 'webhook secrets 2', 'webhook_secrets_key_2_e5b98fb147e4da2f08e9635ff3d6e9d0', 'webhook secrets 2', false, '2026-05-22 14:49:34.635138', '2026-05-22 14:49:34.635138');
INSERT INTO public.webhook_secrets VALUES (3, 'webhook secrets 3', 'webhook_secrets_key_3_6475c4ed9fd1f144a2d5d707954949eb', 'webhook secrets 3', false, '2026-05-15 14:49:34.635138', '2026-05-15 14:49:34.635138');


--
-- Data for Name: whatsapp_messages; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.whatsapp_messages VALUES (1, 1, '+234801', 'whatsapp_mes 1', 'whatsapp_messages 1', 'whatsapp_messages 1', 'whatsapp_messages 1', '2026-05-29 14:50:05.081572');
INSERT INTO public.whatsapp_messages VALUES (2, 2, '+234802', 'whatsapp_mes 2', 'whatsapp_messages 2', 'whatsapp_messages 2', 'whatsapp_messages 2', '2026-05-22 14:50:05.081572');
INSERT INTO public.whatsapp_messages VALUES (3, 3, '+234803', 'whatsapp_mes 3', 'whatsapp_messages 3', 'whatsapp_messages 3', 'whatsapp_messages 3', '2026-05-15 14:50:05.081572');


--
-- Data for Name: workflow_definitions; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.workflow_definitions VALUES (1, 'Policy Lifecycle', 'policy', '["quote", "application", "underwriting", "pending_payment", "active", "renewal_due", "lapsed", "cancelled", "expired", "claimed"]', '[{"to": "application", "from": "quote", "trigger": "submit_application", "requiredRole": "agent"}, {"to": "underwriting", "from": "application", "trigger": "auto", "conditions": "kyc_verified"}, {"to": "pending_payment", "from": "underwriting", "trigger": "approve", "requiredRole": "underwriter"}, {"to": "active", "from": "pending_payment", "trigger": "payment_received"}, {"to": "renewal_due", "from": "active", "trigger": "auto", "conditions": "30_days_before_expiry"}, {"to": "active", "from": "renewal_due", "trigger": "renewal_paid"}, {"to": "lapsed", "from": "renewal_due", "trigger": "auto", "conditions": "grace_period_expired"}, {"to": "cancelled", "from": "active", "trigger": "cancel", "requiredRole": "customer_service"}]', true, '2026-06-04 19:07:54.319621');
INSERT INTO public.workflow_definitions VALUES (2, 'Claims Adjudication', 'claim', '["filed", "triage", "investigation", "adjudication", "approved", "declined", "payment_processing", "paid", "closed", "appealed"]', '[{"to": "triage", "from": "filed", "trigger": "auto"}, {"to": "investigation", "from": "triage", "trigger": "assign", "conditions": "amount_over_500000"}, {"to": "adjudication", "from": "triage", "trigger": "auto_fast_track", "conditions": "amount_under_500000"}, {"to": "adjudication", "from": "investigation", "trigger": "complete_investigation"}, {"to": "approved", "from": "adjudication", "trigger": "approve", "requiredRole": "claims_manager"}, {"to": "declined", "from": "adjudication", "trigger": "decline", "requiredRole": "claims_manager"}, {"to": "payment_processing", "from": "approved", "trigger": "auto"}, {"to": "paid", "from": "payment_processing", "trigger": "payment_confirmed"}, {"to": "appealed", "from": "declined", "trigger": "appeal"}]', true, '2026-06-04 19:07:54.319621');
INSERT INTO public.workflow_definitions VALUES (3, 'KYC Verification', 'kyc', '["initiated", "bvn_check", "nin_check", "address_verification", "facial_match", "risk_screening", "approved", "rejected"]', '[{"to": "bvn_check", "from": "initiated", "trigger": "start_verification"}, {"to": "nin_check", "from": "bvn_check", "trigger": "bvn_verified"}, {"to": "address_verification", "from": "nin_check", "trigger": "nin_verified"}, {"to": "facial_match", "from": "address_verification", "trigger": "address_verified"}, {"to": "risk_screening", "from": "facial_match", "trigger": "face_matched"}, {"to": "approved", "from": "risk_screening", "trigger": "screening_passed"}, {"to": "rejected", "from": "risk_screening", "trigger": "screening_failed"}]', true, '2026-06-04 19:07:54.319621');
INSERT INTO public.workflow_definitions VALUES (4, 'Product Approval', 'product', '["draft", "actuarial_review", "compliance_review", "naicom_submission", "naicom_review", "approved", "active", "suspended"]', '[{"to": "actuarial_review", "from": "draft", "trigger": "submit_for_review"}, {"to": "compliance_review", "from": "actuarial_review", "trigger": "actuary_approved"}, {"to": "naicom_submission", "from": "compliance_review", "trigger": "compliance_cleared"}, {"to": "naicom_review", "from": "naicom_submission", "trigger": "submitted_to_naicom"}, {"to": "approved", "from": "naicom_review", "trigger": "naicom_approved"}, {"to": "active", "from": "approved", "trigger": "launch"}, {"to": "suspended", "from": "active", "trigger": "suspend"}]', true, '2026-06-04 19:07:54.319621');
INSERT INTO public.workflow_definitions VALUES (5, 'New Product Approval', 'product', '["draft", "actuarial_review", "compliance_review", "naicom_approval", "active", "rejected"]', '[{"to": "actuarial_review", "from": "draft", "roles": ["product_manager"], "action": "submit_for_review"}, {"to": "compliance_review", "from": "actuarial_review", "roles": ["actuary"], "action": "actuarial_approve"}, {"to": "naicom_approval", "from": "compliance_review", "roles": ["compliance_officer"], "action": "compliance_approve"}, {"to": "active", "from": "naicom_approval", "roles": ["admin"], "action": "naicom_approve"}]', true, '2026-06-04 20:59:32.603735');
INSERT INTO public.workflow_definitions VALUES (6, 'High Value Claim Escalation', 'claim', '["submitted", "initial_review", "senior_review", "investigation", "approved", "declined", "settled"]', '[{"to": "initial_review", "from": "submitted", "roles": ["claims_officer"], "action": "assign"}, {"to": "senior_review", "from": "initial_review", "roles": ["claims_officer"], "action": "escalate", "condition": "amount >= 2000000"}, {"to": "approved", "from": "initial_review", "roles": ["claims_officer"], "action": "approve"}, {"to": "approved", "from": "senior_review", "roles": ["claims_manager"], "action": "approve"}]', true, '2026-06-04 20:59:32.603735');
INSERT INTO public.workflow_definitions VALUES (7, 'Agent Onboarding', 'agent', '["application", "background_check", "training", "certification", "active", "suspended"]', '[{"to": "background_check", "from": "application", "roles": ["agent"], "action": "submit"}, {"to": "training", "from": "background_check", "roles": ["compliance_officer"], "action": "pass_check"}, {"to": "certification", "from": "training", "roles": ["agent"], "action": "complete_training"}, {"to": "active", "from": "certification", "roles": ["admin"], "action": "certify"}]', true, '2026-06-04 20:59:32.603735');


--
-- Data for Name: workflow_instances; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.workflow_instances VALUES (1, 1, 'policy', 1, 'active', '[{"ts": "2026-01-01", "actor": "Agent A", "state": "quote"}, {"ts": "2026-01-02", "actor": "Customer", "state": "application"}, {"ts": "2026-01-02", "actor": "System", "state": "underwriting"}, {"ts": "2026-01-03", "actor": "Underwriter B", "state": "pending_payment"}, {"ts": "2026-01-15", "actor": "System", "state": "active"}]', NULL, '2026-06-04 19:07:54.320593', '2026-06-04 19:07:54.320593');
INSERT INTO public.workflow_instances VALUES (2, 1, 'policy', 18, 'pending_payment', '[{"ts": "2026-05-20", "actor": "Agent C", "state": "quote"}, {"ts": "2026-05-21", "actor": "Customer", "state": "application"}, {"ts": "2026-05-21", "actor": "System", "state": "underwriting"}, {"ts": "2026-05-22", "actor": "Underwriter A", "state": "pending_payment"}]', 'Finance Team', '2026-06-04 19:07:54.320593', '2026-06-04 19:07:54.320593');
INSERT INTO public.workflow_instances VALUES (3, 2, 'claim', 1, 'paid', '[{"ts": "2026-05-01", "actor": "Customer", "state": "filed"}, {"ts": "2026-05-01", "actor": "System", "state": "triage"}, {"ts": "2026-05-01", "actor": "System (fast-track)", "state": "adjudication"}, {"ts": "2026-05-02", "actor": "Claims Manager A", "state": "approved"}, {"ts": "2026-05-05", "actor": "System", "state": "paid"}]', NULL, '2026-06-04 19:07:54.320593', '2026-06-04 19:07:54.320593');
INSERT INTO public.workflow_instances VALUES (4, 2, 'claim', 4, 'investigation', '[{"ts": "2026-05-20", "actor": "Customer", "state": "filed"}, {"ts": "2026-05-20", "actor": "System", "state": "triage"}, {"ts": "2026-05-20", "actor": "System (amount ₦2.5M > threshold)", "state": "investigation"}]', 'Senior Adjudicator', '2026-06-04 19:07:54.320593', '2026-06-04 19:07:54.320593');
INSERT INTO public.workflow_instances VALUES (5, 3, 'kyc', 1, 'approved', '[{"ts": "2026-01-10", "state": "initiated"}, {"ts": "2026-01-10", "state": "bvn_check", "result": "verified"}, {"ts": "2026-01-10", "state": "nin_check", "result": "verified"}, {"ts": "2026-01-11", "state": "address_verification", "result": "verified"}, {"ts": "2026-01-11", "state": "facial_match", "result": "98.5%"}, {"ts": "2026-01-11", "state": "risk_screening", "result": "clear"}, {"ts": "2026-01-11", "state": "approved"}]', NULL, '2026-06-04 19:07:54.320593', '2026-06-04 19:07:54.320593');
INSERT INTO public.workflow_instances VALUES (6, 3, 'kyc', 3, 'nin_check', '[{"ts": "2026-05-25", "state": "initiated"}, {"ts": "2026-05-25", "state": "bvn_check", "result": "verified"}]', 'KYC Team', '2026-06-04 19:07:54.320593', '2026-06-04 19:07:54.320593');


--
-- Name: _migrations_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public._migrations_id_seq', 6, true);


--
-- Name: ab_experiments_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.ab_experiments_id_seq', 5, true);


--
-- Name: achievements_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.achievements_id_seq', 8, true);


--
-- Name: actuarial_calculations_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.actuarial_calculations_id_seq', 6, true);


--
-- Name: actuarial_calculations_userId_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public."actuarial_calculations_userId_seq"', 1, false);


--
-- Name: agent_achievements_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.agent_achievements_id_seq', 3, true);


--
-- Name: agent_badges_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.agent_badges_id_seq', 3, true);


--
-- Name: agent_bank_accounts_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.agent_bank_accounts_id_seq', 3, true);


--
-- Name: agent_commissions_agentId_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public."agent_commissions_agentId_seq"', 1, false);


--
-- Name: agent_commissions_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.agent_commissions_id_seq', 1, true);


--
-- Name: agent_commissions_policyId_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public."agent_commissions_policyId_seq"', 1, false);


--
-- Name: agent_geofence_zones_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.agent_geofence_zones_id_seq', 3, true);


--
-- Name: agent_loans_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.agent_loans_id_seq', 3, true);


--
-- Name: agent_onboarding_progress_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.agent_onboarding_progress_id_seq', 7, true);


--
-- Name: agent_performance_scores_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.agent_performance_scores_id_seq', 3, true);


--
-- Name: agent_push_subscriptions_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.agent_push_subscriptions_id_seq', 3, true);


--
-- Name: agent_suspension_log_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.agent_suspension_log_id_seq', 3, true);


--
-- Name: agents_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.agents_id_seq', 1, true);


--
-- Name: agents_userId_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public."agents_userId_seq"', 1, false);


--
-- Name: agricultural_schemes_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.agricultural_schemes_id_seq', 6, true);


--
-- Name: agricultural_trigger_events_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.agricultural_trigger_events_id_seq', 5, true);


--
-- Name: agricultural_underwriting_rules_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.agricultural_underwriting_rules_id_seq', 5, true);


--
-- Name: analytics_dashboards_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.analytics_dashboards_id_seq', 3, true);


--
-- Name: analytics_events_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.analytics_events_id_seq', 10, true);


--
-- Name: analytics_events_userId_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public."analytics_events_userId_seq"', 1, false);


--
-- Name: analytics_metrics_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.analytics_metrics_id_seq', 1, false);


--
-- Name: api_key_usage_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.api_key_usage_id_seq', 11, true);


--
-- Name: api_keys_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.api_keys_id_seq', 3, true);


--
-- Name: approval_chains_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.approval_chains_id_seq', 7, true);


--
-- Name: approval_requests_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.approval_requests_id_seq', 7, true);


--
-- Name: audit_log_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.audit_log_id_seq', 8, true);


--
-- Name: audit_trail_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.audit_trail_id_seq', 185, true);


--
-- Name: audit_trail_userId_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public."audit_trail_userId_seq"', 169, true);


--
-- Name: backup_snapshots_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.backup_snapshots_id_seq', 1, false);


--
-- Name: bancassurance_offers_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.bancassurance_offers_id_seq', 5, true);


--
-- Name: bancassurance_offers_partnerId_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public."bancassurance_offers_partnerId_seq"', 1, false);


--
-- Name: bancassurance_offers_userId_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public."bancassurance_offers_userId_seq"', 1, false);


--
-- Name: bancassurance_partners_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.bancassurance_partners_id_seq', 1, true);


--
-- Name: bi_report_definitions_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.bi_report_definitions_id_seq', 3, true);


--
-- Name: billing_audit_log_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.billing_audit_log_id_seq', 3, true);


--
-- Name: billing_provisioning_history_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.billing_provisioning_history_id_seq', 3, true);


--
-- Name: billing_role_assignments_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.billing_role_assignments_id_seq', 3, true);


--
-- Name: biometric_audit_events_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.biometric_audit_events_id_seq', 3, true);


--
-- Name: broker_api_keys_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.broker_api_keys_id_seq', 1, false);


--
-- Name: broker_api_keys_userId_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public."broker_api_keys_userId_seq"', 1, false);


--
-- Name: broker_api_usage_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.broker_api_usage_id_seq', 3, true);


--
-- Name: broker_api_usage_keyId_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public."broker_api_usage_keyId_seq"', 3, true);


--
-- Name: broker_api_usage_responseTimeMs_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public."broker_api_usage_responseTimeMs_seq"', 3, true);


--
-- Name: broker_api_usage_statusCode_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public."broker_api_usage_statusCode_seq"', 3, true);


--
-- Name: broker_api_usage_userId_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public."broker_api_usage_userId_seq"', 3, true);


--
-- Name: chat_messages_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.chat_messages_id_seq', 3, true);


--
-- Name: chat_sessions_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.chat_sessions_id_seq', 3, true);


--
-- Name: chatbot_config_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.chatbot_config_id_seq', 4, true);


--
-- Name: claim_evidence_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.claim_evidence_id_seq', 8, true);


--
-- Name: claim_evidence_userId_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public."claim_evidence_userId_seq"', 1, false);


--
-- Name: claim_routing_rules_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.claim_routing_rules_id_seq', 8, true);


--
-- Name: claims_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.claims_id_seq', 20, true);


--
-- Name: claims_payouts_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.claims_payouts_id_seq', 5, true);


--
-- Name: claims_policyId_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public."claims_policyId_seq"', 1, false);


--
-- Name: claims_userId_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public."claims_userId_seq"', 14, true);


--
-- Name: commission_audit_trail_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.commission_audit_trail_id_seq', 3, true);


--
-- Name: commission_cascade_history_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.commission_cascade_history_id_seq', 3, true);


--
-- Name: commission_clawbacks_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.commission_clawbacks_id_seq', 3, true);


--
-- Name: commission_payouts_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.commission_payouts_id_seq', 7, true);


--
-- Name: commission_rules_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.commission_rules_id_seq', 3, true);


--
-- Name: commission_splits_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.commission_splits_id_seq', 5, true);


--
-- Name: commission_tiers_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.commission_tiers_id_seq', 9, true);


--
-- Name: communication_preferences_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.communication_preferences_id_seq', 5, true);


--
-- Name: compliance_checks_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.compliance_checks_id_seq', 3, true);


--
-- Name: compliance_filings_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.compliance_filings_id_seq', 5, true);


--
-- Name: compliance_reports_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.compliance_reports_id_seq', 7, true);


--
-- Name: connectivity_log_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.connectivity_log_id_seq', 3, true);


--
-- Name: credit_applications_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.credit_applications_id_seq', 7, true);


--
-- Name: credit_score_history_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.credit_score_history_id_seq', 7, true);


--
-- Name: currency_rates_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.currency_rates_id_seq', 9, true);


--
-- Name: customer_feedback_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.customer_feedback_id_seq', 8, true);


--
-- Name: customer_feedback_userId_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public."customer_feedback_userId_seq"', 1, false);


--
-- Name: customer_journey_events_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.customer_journey_events_id_seq', 3, true);


--
-- Name: customer_journey_steps_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.customer_journey_steps_id_seq', 3, true);


--
-- Name: customers_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.customers_id_seq', 15, true);


--
-- Name: data_consent_records_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.data_consent_records_id_seq', 3, true);


--
-- Name: data_export_jobs_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.data_export_jobs_id_seq', 3, true);


--
-- Name: data_rights_requests_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.data_rights_requests_id_seq', 3, true);


--
-- Name: db_scaling_metrics_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.db_scaling_metrics_id_seq', 8, true);


--
-- Name: device_commands_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.device_commands_id_seq', 3, true);


--
-- Name: device_compliance_policies_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.device_compliance_policies_id_seq', 3, true);


--
-- Name: device_compliance_violations_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.device_compliance_violations_id_seq', 3, true);


--
-- Name: device_locations_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.device_locations_id_seq', 3, true);


--
-- Name: devices_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.devices_id_seq', 3, true);


--
-- Name: disaster_recovery_config_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.disaster_recovery_config_id_seq', 6, true);


--
-- Name: dispute_evidence_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.dispute_evidence_id_seq', 3, true);


--
-- Name: dispute_messages_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.dispute_messages_id_seq', 3, true);


--
-- Name: disputes_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.disputes_id_seq', 3, true);


--
-- Name: dlq_messages_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.dlq_messages_id_seq', 3, true);


--
-- Name: documents_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.documents_id_seq', 8, true);


--
-- Name: documents_userId_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public."documents_userId_seq"', 1, false);


--
-- Name: dynamic_pricing_history_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.dynamic_pricing_history_id_seq', 8, true);


--
-- Name: dynamic_pricing_history_userId_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public."dynamic_pricing_history_userId_seq"', 1, false);


--
-- Name: email_delivery_log_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.email_delivery_log_id_seq', 3, true);


--
-- Name: email_queue_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.email_queue_id_seq', 3, true);


--
-- Name: embedded_distribution_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.embedded_distribution_id_seq', 6, true);


--
-- Name: embedded_partners_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.embedded_partners_id_seq', 10, true);


--
-- Name: emergency_incidents_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.emergency_incidents_id_seq', 3, true);


--
-- Name: emergency_incidents_userId_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public."emergency_incidents_userId_seq"', 1, false);


--
-- Name: encrypted_fields_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.encrypted_fields_id_seq', 3, true);


--
-- Name: erp_config_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.erp_config_id_seq', 1, false);


--
-- Name: erp_sync_log_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.erp_sync_log_id_seq', 3, true);


--
-- Name: erpnext_reconciliation_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.erpnext_reconciliation_id_seq', 3, true);


--
-- Name: erpnext_reconciliation_userId_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public."erpnext_reconciliation_userId_seq"', 3, true);


--
-- Name: erpnext_transactions_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.erpnext_transactions_id_seq', 34, true);


--
-- Name: erpnext_transactions_userId_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public."erpnext_transactions_userId_seq"', 1, false);


--
-- Name: face_enrollments_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.face_enrollments_id_seq', 3, true);


--
-- Name: family_members_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.family_members_id_seq', 6, true);


--
-- Name: family_members_userId_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public."family_members_userId_seq"', 1, false);


--
-- Name: fee_audit_trail_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.fee_audit_trail_id_seq', 3, true);


--
-- Name: fee_rules_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.fee_rules_id_seq', 1, false);


--
-- Name: fido2_challenges_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.fido2_challenges_id_seq', 11, true);


--
-- Name: fido2_credentials_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.fido2_credentials_id_seq', 7, true);


--
-- Name: file_uploads_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.file_uploads_id_seq', 7, true);


--
-- Name: financial_metrics_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.financial_metrics_id_seq', 18, true);


--
-- Name: financial_transactions_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.financial_transactions_id_seq', 15, true);


--
-- Name: float_reconciliations_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.float_reconciliations_id_seq', 3, true);


--
-- Name: float_topup_requests_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.float_topup_requests_id_seq', 3, true);


--
-- Name: fraud_alerts_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.fraud_alerts_id_seq', 5, true);


--
-- Name: fraud_alerts_userId_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public."fraud_alerts_userId_seq"', 1, false);


--
-- Name: fraud_ml_scores_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.fraud_ml_scores_id_seq', 3, true);


--
-- Name: fraud_rings_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.fraud_rings_id_seq', 3, true);


--
-- Name: fraud_rings_userId_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public."fraud_rings_userId_seq"', 3, true);


--
-- Name: fraud_rules_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.fraud_rules_id_seq', 3, true);


--
-- Name: fraud_scores_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.fraud_scores_id_seq', 3, true);


--
-- Name: fraud_scores_processingTime_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public."fraud_scores_processingTime_seq"', 3, true);


--
-- Name: fraud_scores_userId_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public."fraud_scores_userId_seq"', 3, true);


--
-- Name: gamification_levels_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.gamification_levels_id_seq', 5, true);


--
-- Name: geo_fences_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.geo_fences_id_seq', 3, true);


--
-- Name: geofence_zones_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.geofence_zones_id_seq', 3, true);


--
-- Name: geospatial_zones_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.geospatial_zones_id_seq', 8, true);


--
-- Name: gig_coverage_policies_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.gig_coverage_policies_id_seq', 5, true);


--
-- Name: gig_coverage_policies_userId_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public."gig_coverage_policies_userId_seq"', 1, false);


--
-- Name: gl_accounts_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.gl_accounts_id_seq', 3, true);


--
-- Name: gl_entries_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.gl_entries_id_seq', 3, true);


--
-- Name: gl_journal_entries_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.gl_journal_entries_id_seq', 3, true);


--
-- Name: group_life_members_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.group_life_members_id_seq', 3, true);


--
-- Name: group_life_members_schemeId_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public."group_life_members_schemeId_seq"', 3, true);


--
-- Name: group_life_schemes_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.group_life_schemes_id_seq', 3, true);


--
-- Name: group_life_schemes_userId_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public."group_life_schemes_userId_seq"', 3, true);


--
-- Name: health_programs_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.health_programs_id_seq', 8, true);


--
-- Name: ifrs17_cashflow_scenarios_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.ifrs17_cashflow_scenarios_id_seq', 12, true);


--
-- Name: ifrs17_contract_groups_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.ifrs17_contract_groups_id_seq', 8, true);


--
-- Name: ifrs17_contracts_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.ifrs17_contracts_id_seq', 26, true);


--
-- Name: ifrs17_csm_rollforward_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.ifrs17_csm_rollforward_id_seq', 18, true);


--
-- Name: ifrs17_discount_curves_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.ifrs17_discount_curves_id_seq', 19, true);


--
-- Name: ifrs17_pnl_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.ifrs17_pnl_id_seq', 18, true);


--
-- Name: ifrs17_reinsurance_held_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.ifrs17_reinsurance_held_id_seq', 6, true);


--
-- Name: ifrs17_transition_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.ifrs17_transition_id_seq', 6, true);


--
-- Name: insurance_applications_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.insurance_applications_id_seq', 8, true);


--
-- Name: insurance_applications_userId_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public."insurance_applications_userId_seq"', 1, false);


--
-- Name: insurance_products_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.insurance_products_id_seq', 23, true);


--
-- Name: insurance_radar_alerts_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.insurance_radar_alerts_id_seq', 6, true);


--
-- Name: insuretech_innovations_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.insuretech_innovations_id_seq', 8, true);


--
-- Name: inventory_items_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.inventory_items_id_seq', 3, true);


--
-- Name: invite_codes_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.invite_codes_id_seq', 3, true);


--
-- Name: knowledge_entities_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.knowledge_entities_id_seq', 8, true);


--
-- Name: knowledge_graph_edges_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.knowledge_graph_edges_id_seq', 1, false);


--
-- Name: knowledge_graph_edges_userId_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public."knowledge_graph_edges_userId_seq"', 1, false);


--
-- Name: knowledge_graph_nodes_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.knowledge_graph_nodes_id_seq', 1, false);


--
-- Name: knowledge_graph_nodes_userId_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public."knowledge_graph_nodes_userId_seq"', 1, false);


--
-- Name: kyb_profiles_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.kyb_profiles_id_seq', 2, true);


--
-- Name: kyc_documents_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.kyc_documents_id_seq', 3, true);


--
-- Name: kyc_profiles_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.kyc_profiles_id_seq', 29, true);


--
-- Name: kyc_sessions_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.kyc_sessions_id_seq', 3, true);


--
-- Name: kyc_verifications_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.kyc_verifications_id_seq', 3, true);


--
-- Name: kyc_verifications_userId_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public."kyc_verifications_userId_seq"', 3, true);


--
-- Name: load_test_runs_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.load_test_runs_id_seq', 3, true);


--
-- Name: loyalty_history_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.loyalty_history_id_seq', 3, true);


--
-- Name: loyalty_points_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.loyalty_points_id_seq', 3, true);


--
-- Name: loyalty_points_userId_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public."loyalty_points_userId_seq"', 3, true);


--
-- Name: loyalty_tiers_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.loyalty_tiers_id_seq', 4, true);


--
-- Name: loyalty_transactions_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.loyalty_transactions_id_seq', 3, true);


--
-- Name: loyalty_transactions_userId_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public."loyalty_transactions_userId_seq"', 3, true);


--
-- Name: mcmc_results_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.mcmc_results_id_seq', 3, true);


--
-- Name: mcmc_results_userId_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public."mcmc_results_userId_seq"', 3, true);


--
-- Name: mcmc_simulations_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.mcmc_simulations_id_seq', 3, true);


--
-- Name: mdm_geofence_violations_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.mdm_geofence_violations_id_seq', 3, true);


--
-- Name: merchant_kyc_docs_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.merchant_kyc_docs_id_seq', 3, true);


--
-- Name: merchant_payouts_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.merchant_payouts_id_seq', 3, true);


--
-- Name: merchant_settlements_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.merchant_settlements_id_seq', 8, true);


--
-- Name: merchants_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.merchants_id_seq', 7, true);


--
-- Name: microinsurance_policies_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.microinsurance_policies_id_seq', 5, true);


--
-- Name: microinsurance_policies_userId_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public."microinsurance_policies_userId_seq"', 1, false);


--
-- Name: model_security_audits_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.model_security_audits_id_seq', 4, true);


--
-- Name: mqtt_bridge_config_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.mqtt_bridge_config_id_seq', 3, true);


--
-- Name: multi_sim_profiles_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.multi_sim_profiles_id_seq', 3, true);


--
-- Name: naicom_automated_reports_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.naicom_automated_reports_id_seq', 12, true);


--
-- Name: naicom_data_exchange_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.naicom_data_exchange_id_seq', 10, true);


--
-- Name: naicom_filings_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.naicom_filings_id_seq', 10, true);


--
-- Name: naicom_filings_userId_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public."naicom_filings_userId_seq"', 2, true);


--
-- Name: naicom_financial_reports_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.naicom_financial_reports_id_seq', 6, true);


--
-- Name: naicom_penalties_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.naicom_penalties_id_seq', 3, true);


--
-- Name: naicom_reporting_schedule_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.naicom_reporting_schedule_id_seq', 12, true);


--
-- Name: naicom_returns_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.naicom_returns_id_seq', 6, true);


--
-- Name: ndvi_readings_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.ndvi_readings_id_seq', 12, true);


--
-- Name: niira_insurance_classes_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.niira_insurance_classes_id_seq', 8, true);


--
-- Name: niira_registrations_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.niira_registrations_id_seq', 1, true);


--
-- Name: nmid_verifications_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.nmid_verifications_id_seq', 3, true);


--
-- Name: nmid_verifications_userId_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public."nmid_verifications_userId_seq"', 3, true);


--
-- Name: notification_channels_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.notification_channels_id_seq', 1, false);


--
-- Name: notification_dispatch_log_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.notification_dispatch_log_id_seq', 3, true);


--
-- Name: notification_logs_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.notification_logs_id_seq', 3, true);


--
-- Name: notifications_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.notifications_id_seq', 8, true);


--
-- Name: notifications_userId_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public."notifications_userId_seq"', 1, false);


--
-- Name: observability_alerts_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.observability_alerts_id_seq', 3, true);


--
-- Name: ota_releases_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.ota_releases_id_seq', 3, true);


--
-- Name: ota_update_log_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.ota_update_log_id_seq', 3, true);


--
-- Name: otp_tokens_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.otp_tokens_id_seq', 3, true);


--
-- Name: p2p_memberships_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.p2p_memberships_id_seq', 3, true);


--
-- Name: p2p_memberships_poolId_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public."p2p_memberships_poolId_seq"', 3, true);


--
-- Name: p2p_memberships_userId_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public."p2p_memberships_userId_seq"', 3, true);


--
-- Name: p2p_pools_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.p2p_pools_id_seq', 1, false);


--
-- Name: parametric_triggers_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.parametric_triggers_id_seq', 6, true);


--
-- Name: payment_transactions_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.payment_transactions_id_seq', 18, true);


--
-- Name: payments_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.payments_id_seq', 3, true);


--
-- Name: payments_policyId_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public."payments_policyId_seq"', 1, false);


--
-- Name: payments_userId_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public."payments_userId_seq"', 1, false);


--
-- Name: performance_metrics_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.performance_metrics_id_seq', 11, true);


--
-- Name: pfa_annuities_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.pfa_annuities_id_seq', 2, true);


--
-- Name: pfa_annuity_quotes_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.pfa_annuity_quotes_id_seq', 3, true);


--
-- Name: pfa_annuity_quotes_pfaId_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public."pfa_annuity_quotes_pfaId_seq"', 3, true);


--
-- Name: pfa_annuity_quotes_userId_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public."pfa_annuity_quotes_userId_seq"', 3, true);


--
-- Name: pfa_integration_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.pfa_integration_id_seq', 1, true);


--
-- Name: pfa_partners_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.pfa_partners_id_seq', 3, true);


--
-- Name: platform_health_checks_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.platform_health_checks_id_seq', 3, true);


--
-- Name: platform_incidents_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.platform_incidents_id_seq', 1, false);


--
-- Name: platform_settings_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.platform_settings_id_seq', 3, true);


--
-- Name: pnl_reports_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.pnl_reports_id_seq', 3, true);


--
-- Name: policies_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.policies_id_seq', 23, true);


--
-- Name: policies_userId_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public."policies_userId_seq"', 1, false);


--
-- Name: pos_terminals_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.pos_terminals_id_seq', 3, true);


--
-- Name: premium_collections_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.premium_collections_id_seq', 8, true);


--
-- Name: premium_rate_audit_logs_entityId_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public."premium_rate_audit_logs_entityId_seq"', 3, true);


--
-- Name: premium_rate_audit_logs_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.premium_rate_audit_logs_id_seq', 3, true);


--
-- Name: premium_rate_audit_logs_userId_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public."premium_rate_audit_logs_userId_seq"', 3, true);


--
-- Name: premium_rate_changes_changedBy_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public."premium_rate_changes_changedBy_seq"', 3, true);


--
-- Name: premium_rate_changes_factorId_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public."premium_rate_changes_factorId_seq"', 3, true);


--
-- Name: premium_rate_changes_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.premium_rate_changes_id_seq', 3, true);


--
-- Name: premium_rate_changes_tableId_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public."premium_rate_changes_tableId_seq"', 3, true);


--
-- Name: premium_rate_tables_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.premium_rate_tables_id_seq', 10, true);


--
-- Name: premium_rate_tables_userId_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public."premium_rate_tables_userId_seq"', 1, false);


--
-- Name: premium_risk_factors_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.premium_risk_factors_id_seq', 15, true);


--
-- Name: premium_risk_factors_tableId_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public."premium_risk_factors_tableId_seq"', 1, false);


--
-- Name: qr_codes_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.qr_codes_id_seq', 7, true);


--
-- Name: rate_alerts_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.rate_alerts_id_seq', 3, true);


--
-- Name: rate_limit_rules_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.rate_limit_rules_id_seq', 3, true);


--
-- Name: realtime_tx_alerts_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.realtime_tx_alerts_id_seq', 3, true);


--
-- Name: reconciliation_batches_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.reconciliation_batches_id_seq', 1, false);


--
-- Name: reconciliation_items_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.reconciliation_items_id_seq', 3, true);


--
-- Name: referrals_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.referrals_id_seq', 1, false);


--
-- Name: referrals_referredUserId_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public."referrals_referredUserId_seq"', 1, false);


--
-- Name: referrals_referrerId_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public."referrals_referrerId_seq"', 1, false);


--
-- Name: refunds_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.refunds_id_seq', 3, true);


--
-- Name: reinsurance_bordereaux_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.reinsurance_bordereaux_id_seq', 14, true);


--
-- Name: reinsurance_cessions_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.reinsurance_cessions_id_seq', 16, true);


--
-- Name: reinsurance_cessions_policyId_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public."reinsurance_cessions_policyId_seq"', 1, false);


--
-- Name: reinsurance_cessions_treatyId_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public."reinsurance_cessions_treatyId_seq"', 1, false);


--
-- Name: reinsurance_claims_recovery_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.reinsurance_claims_recovery_id_seq', 10, true);


--
-- Name: reinsurance_facultative_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.reinsurance_facultative_id_seq', 5, true);


--
-- Name: reinsurance_settlements_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.reinsurance_settlements_id_seq', 16, true);


--
-- Name: reinsurance_treaties_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.reinsurance_treaties_id_seq', 5, true);


--
-- Name: reinsurance_treaties_userId_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public."reinsurance_treaties_userId_seq"', 1, false);


--
-- Name: reversal_requests_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.reversal_requests_id_seq', 7, true);


--
-- Name: reviews_entityId_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public."reviews_entityId_seq"', 3, true);


--
-- Name: reviews_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.reviews_id_seq', 3, true);


--
-- Name: reviews_rating_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.reviews_rating_seq', 3, true);


--
-- Name: reviews_userId_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public."reviews_userId_seq"', 3, true);


--
-- Name: roles_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.roles_id_seq', 11, true);


--
-- Name: savings_accounts_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.savings_accounts_id_seq', 3, true);


--
-- Name: savings_accounts_userId_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public."savings_accounts_userId_seq"', 3, true);


--
-- Name: savings_plans_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.savings_plans_id_seq', 9, true);


--
-- Name: score_improvement_tips_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.score_improvement_tips_id_seq', 8, true);


--
-- Name: service_records_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.service_records_id_seq', 3, true);


--
-- Name: settlement_reconciliation_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.settlement_reconciliation_id_seq', 7, true);


--
-- Name: shareable_links_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.shareable_links_id_seq', 7, true);


--
-- Name: sim_failover_log_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.sim_failover_log_id_seq', 3, true);


--
-- Name: sim_orchestrator_config_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.sim_orchestrator_config_id_seq', 3, true);


--
-- Name: sim_probe_log_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.sim_probe_log_id_seq', 3, true);


--
-- Name: sla_breaches_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.sla_breaches_id_seq', 3, true);


--
-- Name: sla_definitions_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.sla_definitions_id_seq', 1, false);


--
-- Name: sme_policies_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.sme_policies_id_seq', 4, true);


--
-- Name: sme_policies_userId_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public."sme_policies_userId_seq"', 1, false);


--
-- Name: software_updates_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.software_updates_id_seq', 3, true);


--
-- Name: storefront_ads_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.storefront_ads_id_seq', 7, true);


--
-- Name: supervisor_agents_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.supervisor_agents_id_seq', 3, true);


--
-- Name: system_config_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.system_config_id_seq', 3, true);


--
-- Name: system_settings_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.system_settings_id_seq', 18, true);


--
-- Name: takaful_pools_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.takaful_pools_id_seq', 3, true);


--
-- Name: takaful_sharia_principles_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.takaful_sharia_principles_id_seq', 6, true);


--
-- Name: telco_credit_scores_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.telco_credit_scores_id_seq', 3, true);


--
-- Name: telco_credit_scores_score_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.telco_credit_scores_score_seq', 3, true);


--
-- Name: telco_credit_scores_userId_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public."telco_credit_scores_userId_seq"', 3, true);


--
-- Name: telematics_devices_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.telematics_devices_id_seq', 1, false);


--
-- Name: tenant_branding_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.tenant_branding_id_seq', 3, true);


--
-- Name: tenant_corridors_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.tenant_corridors_id_seq', 3, true);


--
-- Name: tenant_feature_toggles_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.tenant_feature_toggles_id_seq', 3, true);


--
-- Name: tenant_fee_overrides_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.tenant_fee_overrides_id_seq', 3, true);


--
-- Name: tenant_users_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.tenant_users_id_seq', 3, true);


--
-- Name: tenants_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.tenants_id_seq', 6, true);


--
-- Name: terminal_groups_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.terminal_groups_id_seq', 3, true);


--
-- Name: training_courses_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.training_courses_id_seq', 1, false);


--
-- Name: training_enrollments_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.training_enrollments_id_seq', 1, false);


--
-- Name: transaction_limits_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.transaction_limits_id_seq', 3, true);


--
-- Name: transactions_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.transactions_id_seq', 1, false);


--
-- Name: tx_monitoring_alerts_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.tx_monitoring_alerts_id_seq', 3, true);


--
-- Name: underwriting_decisions_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.underwriting_decisions_id_seq', 5, true);


--
-- Name: underwriting_rules_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.underwriting_rules_id_seq', 20, true);


--
-- Name: user_achievements_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.user_achievements_id_seq', 8, true);


--
-- Name: user_roles_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.user_roles_id_seq', 1, true);


--
-- Name: users_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.users_id_seq', 119, true);


--
-- Name: ussd_analytics_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.ussd_analytics_id_seq', 7, true);


--
-- Name: ussd_pins_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.ussd_pins_id_seq', 3, true);


--
-- Name: ussd_session_log_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.ussd_session_log_id_seq', 23, true);


--
-- Name: ussd_sessions_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.ussd_sessions_id_seq', 3, true);


--
-- Name: vat_records_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.vat_records_id_seq', 7, true);


--
-- Name: velocity_limits_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.velocity_limits_id_seq', 3, true);


--
-- Name: voice_config_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.voice_config_id_seq', 4, true);


--
-- Name: voice_sessions_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.voice_sessions_id_seq', 3, true);


--
-- Name: voice_sessions_userId_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public."voice_sessions_userId_seq"', 3, true);


--
-- Name: wallet_transactions_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.wallet_transactions_id_seq', 12, true);


--
-- Name: wallets_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.wallets_id_seq', 9, true);


--
-- Name: webhook_deliveries_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.webhook_deliveries_id_seq', 7, true);


--
-- Name: webhook_endpoints_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.webhook_endpoints_id_seq', 3, true);


--
-- Name: webhook_secrets_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.webhook_secrets_id_seq', 3, true);


--
-- Name: whatsapp_messages_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.whatsapp_messages_id_seq', 3, true);


--
-- Name: whatsapp_messages_userId_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public."whatsapp_messages_userId_seq"', 3, true);


--
-- Name: workflow_definitions_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.workflow_definitions_id_seq', 4, true);


--
-- Name: workflow_instances_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.workflow_instances_id_seq', 6, true);


--
-- Name: _migrations _migrations_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public._migrations
    ADD CONSTRAINT _migrations_name_key UNIQUE (name);


--
-- Name: _migrations _migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public._migrations
    ADD CONSTRAINT _migrations_pkey PRIMARY KEY (id);


--
-- Name: ab_experiments ab_experiments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ab_experiments
    ADD CONSTRAINT ab_experiments_pkey PRIMARY KEY (id);


--
-- Name: achievements achievements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.achievements
    ADD CONSTRAINT achievements_pkey PRIMARY KEY (id);


--
-- Name: actuarial_calculations actuarial_calculations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.actuarial_calculations
    ADD CONSTRAINT actuarial_calculations_pkey PRIMARY KEY (id);


--
-- Name: agent_achievements agent_achievements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_achievements
    ADD CONSTRAINT agent_achievements_pkey PRIMARY KEY (id);


--
-- Name: agent_badges agent_badges_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_badges
    ADD CONSTRAINT agent_badges_pkey PRIMARY KEY (id);


--
-- Name: agent_bank_accounts agent_bank_accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_bank_accounts
    ADD CONSTRAINT agent_bank_accounts_pkey PRIMARY KEY (id);


--
-- Name: agent_commissions agent_commissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_commissions
    ADD CONSTRAINT agent_commissions_pkey PRIMARY KEY (id);


--
-- Name: agent_geofence_zones agent_geofence_zones_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_geofence_zones
    ADD CONSTRAINT agent_geofence_zones_pkey PRIMARY KEY (id);


--
-- Name: agent_loans agent_loans_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_loans
    ADD CONSTRAINT agent_loans_pkey PRIMARY KEY (id);


--
-- Name: agent_onboarding_progress agent_onboarding_progress_agent_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_onboarding_progress
    ADD CONSTRAINT agent_onboarding_progress_agent_id_unique UNIQUE (agent_id);


--
-- Name: agent_onboarding_progress agent_onboarding_progress_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_onboarding_progress
    ADD CONSTRAINT agent_onboarding_progress_pkey PRIMARY KEY (id);


--
-- Name: agent_performance_scores agent_performance_scores_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_performance_scores
    ADD CONSTRAINT agent_performance_scores_pkey PRIMARY KEY (id);


--
-- Name: agent_push_subscriptions agent_push_subscriptions_endpoint_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_push_subscriptions
    ADD CONSTRAINT agent_push_subscriptions_endpoint_unique UNIQUE (endpoint);


--
-- Name: agent_push_subscriptions agent_push_subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_push_subscriptions
    ADD CONSTRAINT agent_push_subscriptions_pkey PRIMARY KEY (id);


--
-- Name: agent_suspension_log agent_suspension_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_suspension_log
    ADD CONSTRAINT agent_suspension_log_pkey PRIMARY KEY (id);


--
-- Name: agents agents_agentCode_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agents
    ADD CONSTRAINT "agents_agentCode_unique" UNIQUE ("agentCode");


--
-- Name: agents agents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agents
    ADD CONSTRAINT agents_pkey PRIMARY KEY (id);


--
-- Name: agricultural_schemes agricultural_schemes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agricultural_schemes
    ADD CONSTRAINT agricultural_schemes_pkey PRIMARY KEY (id);


--
-- Name: agricultural_trigger_events agricultural_trigger_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agricultural_trigger_events
    ADD CONSTRAINT agricultural_trigger_events_pkey PRIMARY KEY (id);


--
-- Name: agricultural_underwriting_rules agricultural_underwriting_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agricultural_underwriting_rules
    ADD CONSTRAINT agricultural_underwriting_rules_pkey PRIMARY KEY (id);


--
-- Name: analytics_dashboards analytics_dashboards_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_dashboards
    ADD CONSTRAINT analytics_dashboards_pkey PRIMARY KEY (id);


--
-- Name: analytics_events analytics_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_events
    ADD CONSTRAINT analytics_events_pkey PRIMARY KEY (id);


--
-- Name: analytics_metrics analytics_metrics_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_metrics
    ADD CONSTRAINT analytics_metrics_pkey PRIMARY KEY (id);


--
-- Name: api_key_usage api_key_usage_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.api_key_usage
    ADD CONSTRAINT api_key_usage_pkey PRIMARY KEY (id);


--
-- Name: api_keys api_keys_keyHash_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.api_keys
    ADD CONSTRAINT "api_keys_keyHash_unique" UNIQUE ("keyHash");


--
-- Name: api_keys api_keys_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.api_keys
    ADD CONSTRAINT api_keys_pkey PRIMARY KEY (id);


--
-- Name: approval_chains approval_chains_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.approval_chains
    ADD CONSTRAINT approval_chains_pkey PRIMARY KEY (id);


--
-- Name: approval_requests approval_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.approval_requests
    ADD CONSTRAINT approval_requests_pkey PRIMARY KEY (id);


--
-- Name: audit_log audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_pkey PRIMARY KEY (id);


--
-- Name: audit_trail audit_trail_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_trail
    ADD CONSTRAINT audit_trail_pkey PRIMARY KEY (id);


--
-- Name: backup_snapshots backup_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.backup_snapshots
    ADD CONSTRAINT backup_snapshots_pkey PRIMARY KEY (id);


--
-- Name: bancassurance_offers bancassurance_offers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bancassurance_offers
    ADD CONSTRAINT bancassurance_offers_pkey PRIMARY KEY (id);


--
-- Name: bancassurance_partners bancassurance_partners_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bancassurance_partners
    ADD CONSTRAINT bancassurance_partners_pkey PRIMARY KEY (id);


--
-- Name: bi_report_definitions bi_report_definitions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bi_report_definitions
    ADD CONSTRAINT bi_report_definitions_pkey PRIMARY KEY (id);


--
-- Name: billing_audit_log billing_audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.billing_audit_log
    ADD CONSTRAINT billing_audit_log_pkey PRIMARY KEY (id);


--
-- Name: billing_provisioning_history billing_provisioning_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.billing_provisioning_history
    ADD CONSTRAINT billing_provisioning_history_pkey PRIMARY KEY (id);


--
-- Name: billing_role_assignments billing_role_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.billing_role_assignments
    ADD CONSTRAINT billing_role_assignments_pkey PRIMARY KEY (id);


--
-- Name: biometric_audit_events biometric_audit_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.biometric_audit_events
    ADD CONSTRAINT biometric_audit_events_pkey PRIMARY KEY (id);


--
-- Name: broker_api_keys broker_api_keys_apiKey_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.broker_api_keys
    ADD CONSTRAINT "broker_api_keys_apiKey_unique" UNIQUE ("apiKey");


--
-- Name: broker_api_keys broker_api_keys_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.broker_api_keys
    ADD CONSTRAINT broker_api_keys_pkey PRIMARY KEY (id);


--
-- Name: broker_api_usage broker_api_usage_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.broker_api_usage
    ADD CONSTRAINT broker_api_usage_pkey PRIMARY KEY (id);


--
-- Name: chat_messages chat_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_messages
    ADD CONSTRAINT chat_messages_pkey PRIMARY KEY (id);


--
-- Name: chat_sessions chat_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_sessions
    ADD CONSTRAINT chat_sessions_pkey PRIMARY KEY (id);


--
-- Name: chat_sessions chat_sessions_sessionRef_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_sessions
    ADD CONSTRAINT "chat_sessions_sessionRef_unique" UNIQUE ("sessionRef");


--
-- Name: chatbot_config chatbot_config_config_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chatbot_config
    ADD CONSTRAINT chatbot_config_config_key_key UNIQUE (config_key);


--
-- Name: chatbot_config chatbot_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chatbot_config
    ADD CONSTRAINT chatbot_config_pkey PRIMARY KEY (id);


--
-- Name: claim_evidence claim_evidence_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.claim_evidence
    ADD CONSTRAINT claim_evidence_pkey PRIMARY KEY (id);


--
-- Name: claim_routing_rules claim_routing_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.claim_routing_rules
    ADD CONSTRAINT claim_routing_rules_pkey PRIMARY KEY (id);


--
-- Name: claims claims_claimNumber_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.claims
    ADD CONSTRAINT "claims_claimNumber_unique" UNIQUE ("claimNumber");


--
-- Name: claims_payouts claims_payouts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.claims_payouts
    ADD CONSTRAINT claims_payouts_pkey PRIMARY KEY (id);


--
-- Name: claims claims_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.claims
    ADD CONSTRAINT claims_pkey PRIMARY KEY (id);


--
-- Name: commission_audit_trail commission_audit_trail_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.commission_audit_trail
    ADD CONSTRAINT commission_audit_trail_pkey PRIMARY KEY (id);


--
-- Name: commission_cascade_history commission_cascade_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.commission_cascade_history
    ADD CONSTRAINT commission_cascade_history_pkey PRIMARY KEY (id);


--
-- Name: commission_clawbacks commission_clawbacks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.commission_clawbacks
    ADD CONSTRAINT commission_clawbacks_pkey PRIMARY KEY (id);


--
-- Name: commission_payouts commission_payouts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.commission_payouts
    ADD CONSTRAINT commission_payouts_pkey PRIMARY KEY (id);


--
-- Name: commission_rules commission_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.commission_rules
    ADD CONSTRAINT commission_rules_pkey PRIMARY KEY (id);


--
-- Name: commission_splits commission_splits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.commission_splits
    ADD CONSTRAINT commission_splits_pkey PRIMARY KEY (id);


--
-- Name: commission_splits commission_splits_split_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.commission_splits
    ADD CONSTRAINT commission_splits_split_id_unique UNIQUE (split_id);


--
-- Name: commission_tiers commission_tiers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.commission_tiers
    ADD CONSTRAINT commission_tiers_pkey PRIMARY KEY (id);


--
-- Name: commission_tiers commission_tiers_tier_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.commission_tiers
    ADD CONSTRAINT commission_tiers_tier_id_unique UNIQUE (tier_id);


--
-- Name: communication_preferences communication_preferences_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.communication_preferences
    ADD CONSTRAINT communication_preferences_pkey PRIMARY KEY (id);


--
-- Name: communication_preferences communication_preferences_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.communication_preferences
    ADD CONSTRAINT communication_preferences_user_id_key UNIQUE (user_id);


--
-- Name: compliance_checks compliance_checks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.compliance_checks
    ADD CONSTRAINT compliance_checks_pkey PRIMARY KEY (id);


--
-- Name: compliance_filings compliance_filings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.compliance_filings
    ADD CONSTRAINT compliance_filings_pkey PRIMARY KEY (id);


--
-- Name: compliance_reports compliance_reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.compliance_reports
    ADD CONSTRAINT compliance_reports_pkey PRIMARY KEY (id);


--
-- Name: connectivity_log connectivity_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.connectivity_log
    ADD CONSTRAINT connectivity_log_pkey PRIMARY KEY (id);


--
-- Name: credit_applications credit_applications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.credit_applications
    ADD CONSTRAINT credit_applications_pkey PRIMARY KEY (id);


--
-- Name: credit_score_history credit_score_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.credit_score_history
    ADD CONSTRAINT credit_score_history_pkey PRIMARY KEY (id);


--
-- Name: currency_rates currency_rates_from_currency_to_currency_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.currency_rates
    ADD CONSTRAINT currency_rates_from_currency_to_currency_key UNIQUE (from_currency, to_currency);


--
-- Name: currency_rates currency_rates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.currency_rates
    ADD CONSTRAINT currency_rates_pkey PRIMARY KEY (id);


--
-- Name: customer_feedback customer_feedback_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_feedback
    ADD CONSTRAINT customer_feedback_pkey PRIMARY KEY (id);


--
-- Name: customer_journey_events customer_journey_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_journey_events
    ADD CONSTRAINT customer_journey_events_pkey PRIMARY KEY (id);


--
-- Name: customer_journey_steps customer_journey_steps_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_journey_steps
    ADD CONSTRAINT customer_journey_steps_pkey PRIMARY KEY (id);


--
-- Name: customers customers_externalId_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT "customers_externalId_unique" UNIQUE ("externalId");


--
-- Name: customers customers_keycloakSub_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT "customers_keycloakSub_unique" UNIQUE ("keycloakSub");


--
-- Name: customers customers_phone_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_phone_unique UNIQUE (phone);


--
-- Name: customers customers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_pkey PRIMARY KEY (id);


--
-- Name: data_consent_records data_consent_records_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.data_consent_records
    ADD CONSTRAINT data_consent_records_pkey PRIMARY KEY (id);


--
-- Name: data_export_jobs data_export_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.data_export_jobs
    ADD CONSTRAINT data_export_jobs_pkey PRIMARY KEY (id);


--
-- Name: data_rights_requests data_rights_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.data_rights_requests
    ADD CONSTRAINT data_rights_requests_pkey PRIMARY KEY (id);


--
-- Name: db_scaling_metrics db_scaling_metrics_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.db_scaling_metrics
    ADD CONSTRAINT db_scaling_metrics_pkey PRIMARY KEY (id);


--
-- Name: device_commands device_commands_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_commands
    ADD CONSTRAINT device_commands_pkey PRIMARY KEY (id);


--
-- Name: device_compliance_policies device_compliance_policies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_compliance_policies
    ADD CONSTRAINT device_compliance_policies_pkey PRIMARY KEY (id);


--
-- Name: device_compliance_violations device_compliance_violations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_compliance_violations
    ADD CONSTRAINT device_compliance_violations_pkey PRIMARY KEY (id);


--
-- Name: device_locations device_locations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_locations
    ADD CONSTRAINT device_locations_pkey PRIMARY KEY (id);


--
-- Name: devices devices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.devices
    ADD CONSTRAINT devices_pkey PRIMARY KEY (id);


--
-- Name: devices devices_serialNumber_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.devices
    ADD CONSTRAINT "devices_serialNumber_unique" UNIQUE ("serialNumber");


--
-- Name: disaster_recovery_config disaster_recovery_config_component_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.disaster_recovery_config
    ADD CONSTRAINT disaster_recovery_config_component_key UNIQUE (component);


--
-- Name: disaster_recovery_config disaster_recovery_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.disaster_recovery_config
    ADD CONSTRAINT disaster_recovery_config_pkey PRIMARY KEY (id);


--
-- Name: dispute_evidence dispute_evidence_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dispute_evidence
    ADD CONSTRAINT dispute_evidence_pkey PRIMARY KEY (id);


--
-- Name: dispute_messages dispute_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dispute_messages
    ADD CONSTRAINT dispute_messages_pkey PRIMARY KEY (id);


--
-- Name: disputes disputes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.disputes
    ADD CONSTRAINT disputes_pkey PRIMARY KEY (id);


--
-- Name: disputes disputes_ref_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.disputes
    ADD CONSTRAINT disputes_ref_unique UNIQUE (ref);


--
-- Name: dlq_messages dlq_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dlq_messages
    ADD CONSTRAINT dlq_messages_pkey PRIMARY KEY (id);


--
-- Name: documents documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_pkey PRIMARY KEY (id);


--
-- Name: dynamic_pricing_history dynamic_pricing_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dynamic_pricing_history
    ADD CONSTRAINT dynamic_pricing_history_pkey PRIMARY KEY (id);


--
-- Name: email_delivery_log email_delivery_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_delivery_log
    ADD CONSTRAINT email_delivery_log_pkey PRIMARY KEY (id);


--
-- Name: email_queue email_queue_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_queue
    ADD CONSTRAINT email_queue_pkey PRIMARY KEY (id);


--
-- Name: embedded_distribution embedded_distribution_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.embedded_distribution
    ADD CONSTRAINT embedded_distribution_pkey PRIMARY KEY (id);


--
-- Name: embedded_partners embedded_partners_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.embedded_partners
    ADD CONSTRAINT embedded_partners_pkey PRIMARY KEY (id);


--
-- Name: emergency_incidents emergency_incidents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.emergency_incidents
    ADD CONSTRAINT emergency_incidents_pkey PRIMARY KEY (id);


--
-- Name: encrypted_fields encrypted_fields_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.encrypted_fields
    ADD CONSTRAINT encrypted_fields_pkey PRIMARY KEY (id);


--
-- Name: erp_config erp_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.erp_config
    ADD CONSTRAINT erp_config_pkey PRIMARY KEY (id);


--
-- Name: erp_sync_log erp_sync_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.erp_sync_log
    ADD CONSTRAINT erp_sync_log_pkey PRIMARY KEY (id);


--
-- Name: erpnext_reconciliation erpnext_reconciliation_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.erpnext_reconciliation
    ADD CONSTRAINT erpnext_reconciliation_pkey PRIMARY KEY (id);


--
-- Name: erpnext_transactions erpnext_transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.erpnext_transactions
    ADD CONSTRAINT erpnext_transactions_pkey PRIMARY KEY (id);


--
-- Name: face_enrollments face_enrollments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.face_enrollments
    ADD CONSTRAINT face_enrollments_pkey PRIMARY KEY (id);


--
-- Name: family_members family_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.family_members
    ADD CONSTRAINT family_members_pkey PRIMARY KEY (id);


--
-- Name: fee_audit_trail fee_audit_trail_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fee_audit_trail
    ADD CONSTRAINT fee_audit_trail_pkey PRIMARY KEY (id);


--
-- Name: fee_rules fee_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fee_rules
    ADD CONSTRAINT fee_rules_pkey PRIMARY KEY (id);


--
-- Name: fido2_challenges fido2_challenges_challenge_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fido2_challenges
    ADD CONSTRAINT fido2_challenges_challenge_unique UNIQUE (challenge);


--
-- Name: fido2_challenges fido2_challenges_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fido2_challenges
    ADD CONSTRAINT fido2_challenges_pkey PRIMARY KEY (id);


--
-- Name: fido2_credentials fido2_credentials_credentialId_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fido2_credentials
    ADD CONSTRAINT "fido2_credentials_credentialId_unique" UNIQUE ("credentialId");


--
-- Name: fido2_credentials fido2_credentials_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fido2_credentials
    ADD CONSTRAINT fido2_credentials_pkey PRIMARY KEY (id);


--
-- Name: file_uploads file_uploads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.file_uploads
    ADD CONSTRAINT file_uploads_pkey PRIMARY KEY (id);


--
-- Name: financial_metrics financial_metrics_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.financial_metrics
    ADD CONSTRAINT financial_metrics_pkey PRIMARY KEY (id);


--
-- Name: financial_transactions financial_transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.financial_transactions
    ADD CONSTRAINT financial_transactions_pkey PRIMARY KEY (id);


--
-- Name: float_reconciliations float_reconciliations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.float_reconciliations
    ADD CONSTRAINT float_reconciliations_pkey PRIMARY KEY (id);


--
-- Name: float_topup_requests float_topup_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.float_topup_requests
    ADD CONSTRAINT float_topup_requests_pkey PRIMARY KEY (id);


--
-- Name: fraud_alerts fraud_alerts_alertId_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fraud_alerts
    ADD CONSTRAINT "fraud_alerts_alertId_unique" UNIQUE ("alertId");


--
-- Name: fraud_alerts fraud_alerts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fraud_alerts
    ADD CONSTRAINT fraud_alerts_pkey PRIMARY KEY (id);


--
-- Name: fraud_ml_scores fraud_ml_scores_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fraud_ml_scores
    ADD CONSTRAINT fraud_ml_scores_pkey PRIMARY KEY (id);


--
-- Name: fraud_rings fraud_rings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fraud_rings
    ADD CONSTRAINT fraud_rings_pkey PRIMARY KEY (id);


--
-- Name: fraud_rings fraud_rings_ringId_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fraud_rings
    ADD CONSTRAINT "fraud_rings_ringId_unique" UNIQUE ("ringId");


--
-- Name: fraud_rules fraud_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fraud_rules
    ADD CONSTRAINT fraud_rules_pkey PRIMARY KEY (id);


--
-- Name: fraud_scores fraud_scores_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fraud_scores
    ADD CONSTRAINT fraud_scores_pkey PRIMARY KEY (id);


--
-- Name: fraud_scores fraud_scores_scoreId_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fraud_scores
    ADD CONSTRAINT "fraud_scores_scoreId_unique" UNIQUE ("scoreId");


--
-- Name: gamification_levels gamification_levels_level_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gamification_levels
    ADD CONSTRAINT gamification_levels_level_number_key UNIQUE (level_number);


--
-- Name: gamification_levels gamification_levels_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gamification_levels
    ADD CONSTRAINT gamification_levels_pkey PRIMARY KEY (id);


--
-- Name: geo_fences geo_fences_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.geo_fences
    ADD CONSTRAINT geo_fences_pkey PRIMARY KEY (id);


--
-- Name: geofence_zones geofence_zones_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.geofence_zones
    ADD CONSTRAINT geofence_zones_pkey PRIMARY KEY (id);


--
-- Name: geospatial_zones geospatial_zones_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.geospatial_zones
    ADD CONSTRAINT geospatial_zones_pkey PRIMARY KEY (id);


--
-- Name: gig_coverage_policies gig_coverage_policies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gig_coverage_policies
    ADD CONSTRAINT gig_coverage_policies_pkey PRIMARY KEY (id);


--
-- Name: gl_accounts gl_accounts_account_code_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gl_accounts
    ADD CONSTRAINT gl_accounts_account_code_unique UNIQUE (account_code);


--
-- Name: gl_accounts gl_accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gl_accounts
    ADD CONSTRAINT gl_accounts_pkey PRIMARY KEY (id);


--
-- Name: gl_entries gl_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gl_entries
    ADD CONSTRAINT gl_entries_pkey PRIMARY KEY (id);


--
-- Name: gl_journal_entries gl_journal_entries_entry_number_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gl_journal_entries
    ADD CONSTRAINT gl_journal_entries_entry_number_unique UNIQUE (entry_number);


--
-- Name: gl_journal_entries gl_journal_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gl_journal_entries
    ADD CONSTRAINT gl_journal_entries_pkey PRIMARY KEY (id);


--
-- Name: group_life_members group_life_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.group_life_members
    ADD CONSTRAINT group_life_members_pkey PRIMARY KEY (id);


--
-- Name: group_life_schemes group_life_schemes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.group_life_schemes
    ADD CONSTRAINT group_life_schemes_pkey PRIMARY KEY (id);


--
-- Name: health_programs health_programs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.health_programs
    ADD CONSTRAINT health_programs_pkey PRIMARY KEY (id);


--
-- Name: ifrs17_cashflow_scenarios ifrs17_cashflow_scenarios_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ifrs17_cashflow_scenarios
    ADD CONSTRAINT ifrs17_cashflow_scenarios_pkey PRIMARY KEY (id);


--
-- Name: ifrs17_contract_groups ifrs17_contract_groups_group_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ifrs17_contract_groups
    ADD CONSTRAINT ifrs17_contract_groups_group_code_key UNIQUE (group_code);


--
-- Name: ifrs17_contract_groups ifrs17_contract_groups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ifrs17_contract_groups
    ADD CONSTRAINT ifrs17_contract_groups_pkey PRIMARY KEY (id);


--
-- Name: ifrs17_contracts ifrs17_contracts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ifrs17_contracts
    ADD CONSTRAINT ifrs17_contracts_pkey PRIMARY KEY (id);


--
-- Name: ifrs17_csm_rollforward ifrs17_csm_rollforward_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ifrs17_csm_rollforward
    ADD CONSTRAINT ifrs17_csm_rollforward_pkey PRIMARY KEY (id);


--
-- Name: ifrs17_discount_curves ifrs17_discount_curves_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ifrs17_discount_curves
    ADD CONSTRAINT ifrs17_discount_curves_pkey PRIMARY KEY (id);


--
-- Name: ifrs17_pnl ifrs17_pnl_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ifrs17_pnl
    ADD CONSTRAINT ifrs17_pnl_pkey PRIMARY KEY (id);


--
-- Name: ifrs17_reinsurance_held ifrs17_reinsurance_held_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ifrs17_reinsurance_held
    ADD CONSTRAINT ifrs17_reinsurance_held_pkey PRIMARY KEY (id);


--
-- Name: ifrs17_transition ifrs17_transition_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ifrs17_transition
    ADD CONSTRAINT ifrs17_transition_pkey PRIMARY KEY (id);


--
-- Name: insurance_applications insurance_applications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.insurance_applications
    ADD CONSTRAINT insurance_applications_pkey PRIMARY KEY (id);


--
-- Name: insurance_products insurance_products_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.insurance_products
    ADD CONSTRAINT insurance_products_code_key UNIQUE (code);


--
-- Name: insurance_products insurance_products_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.insurance_products
    ADD CONSTRAINT insurance_products_pkey PRIMARY KEY (id);


--
-- Name: insurance_radar_alerts insurance_radar_alerts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.insurance_radar_alerts
    ADD CONSTRAINT insurance_radar_alerts_pkey PRIMARY KEY (id);


--
-- Name: insuretech_innovations insuretech_innovations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.insuretech_innovations
    ADD CONSTRAINT insuretech_innovations_pkey PRIMARY KEY (id);


--
-- Name: inventory_items inventory_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_items
    ADD CONSTRAINT inventory_items_pkey PRIMARY KEY (id);


--
-- Name: inventory_items inventory_items_sku_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_items
    ADD CONSTRAINT inventory_items_sku_unique UNIQUE (sku);


--
-- Name: invite_codes invite_codes_code_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invite_codes
    ADD CONSTRAINT invite_codes_code_unique UNIQUE (code);


--
-- Name: invite_codes invite_codes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invite_codes
    ADD CONSTRAINT invite_codes_pkey PRIMARY KEY (id);


--
-- Name: knowledge_entities knowledge_entities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knowledge_entities
    ADD CONSTRAINT knowledge_entities_pkey PRIMARY KEY (id);


--
-- Name: knowledge_graph_edges knowledge_graph_edges_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knowledge_graph_edges
    ADD CONSTRAINT knowledge_graph_edges_pkey PRIMARY KEY (id);


--
-- Name: knowledge_graph_nodes knowledge_graph_nodes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knowledge_graph_nodes
    ADD CONSTRAINT knowledge_graph_nodes_pkey PRIMARY KEY (id);


--
-- Name: kyb_profiles kyb_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kyb_profiles
    ADD CONSTRAINT kyb_profiles_pkey PRIMARY KEY (id);


--
-- Name: kyc_documents kyc_documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kyc_documents
    ADD CONSTRAINT kyc_documents_pkey PRIMARY KEY (id);


--
-- Name: kyc_profiles kyc_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kyc_profiles
    ADD CONSTRAINT kyc_profiles_pkey PRIMARY KEY (id);


--
-- Name: kyc_sessions kyc_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kyc_sessions
    ADD CONSTRAINT kyc_sessions_pkey PRIMARY KEY (id);


--
-- Name: kyc_sessions kyc_sessions_sessionRef_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kyc_sessions
    ADD CONSTRAINT "kyc_sessions_sessionRef_unique" UNIQUE ("sessionRef");


--
-- Name: kyc_verifications kyc_verifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kyc_verifications
    ADD CONSTRAINT kyc_verifications_pkey PRIMARY KEY (id);


--
-- Name: load_test_runs load_test_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.load_test_runs
    ADD CONSTRAINT load_test_runs_pkey PRIMARY KEY (id);


--
-- Name: load_test_runs load_test_runs_run_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.load_test_runs
    ADD CONSTRAINT load_test_runs_run_id_unique UNIQUE (run_id);


--
-- Name: loyalty_history loyalty_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loyalty_history
    ADD CONSTRAINT loyalty_history_pkey PRIMARY KEY (id);


--
-- Name: loyalty_points loyalty_points_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loyalty_points
    ADD CONSTRAINT loyalty_points_pkey PRIMARY KEY (id);


--
-- Name: loyalty_tiers loyalty_tiers_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loyalty_tiers
    ADD CONSTRAINT loyalty_tiers_name_key UNIQUE (name);


--
-- Name: loyalty_tiers loyalty_tiers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loyalty_tiers
    ADD CONSTRAINT loyalty_tiers_pkey PRIMARY KEY (id);


--
-- Name: loyalty_transactions loyalty_transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loyalty_transactions
    ADD CONSTRAINT loyalty_transactions_pkey PRIMARY KEY (id);


--
-- Name: mcmc_results mcmc_results_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mcmc_results
    ADD CONSTRAINT mcmc_results_pkey PRIMARY KEY (id);


--
-- Name: mcmc_simulations mcmc_simulations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mcmc_simulations
    ADD CONSTRAINT mcmc_simulations_pkey PRIMARY KEY (id);


--
-- Name: mcmc_simulations mcmc_simulations_simulation_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mcmc_simulations
    ADD CONSTRAINT mcmc_simulations_simulation_id_key UNIQUE (simulation_id);


--
-- Name: mdm_geofence_violations mdm_geofence_violations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mdm_geofence_violations
    ADD CONSTRAINT mdm_geofence_violations_pkey PRIMARY KEY (id);


--
-- Name: merchant_kyc_docs merchant_kyc_docs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.merchant_kyc_docs
    ADD CONSTRAINT merchant_kyc_docs_pkey PRIMARY KEY (id);


--
-- Name: merchant_payouts merchant_payouts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.merchant_payouts
    ADD CONSTRAINT merchant_payouts_pkey PRIMARY KEY (id);


--
-- Name: merchant_settlements merchant_settlements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.merchant_settlements
    ADD CONSTRAINT merchant_settlements_pkey PRIMARY KEY (id);


--
-- Name: merchants merchants_keycloakSub_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.merchants
    ADD CONSTRAINT "merchants_keycloakSub_unique" UNIQUE ("keycloakSub");


--
-- Name: merchants merchants_merchantCode_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.merchants
    ADD CONSTRAINT "merchants_merchantCode_unique" UNIQUE ("merchantCode");


--
-- Name: merchants merchants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.merchants
    ADD CONSTRAINT merchants_pkey PRIMARY KEY (id);


--
-- Name: microinsurance_policies microinsurance_policies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.microinsurance_policies
    ADD CONSTRAINT microinsurance_policies_pkey PRIMARY KEY (id);


--
-- Name: model_security_audits model_security_audits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.model_security_audits
    ADD CONSTRAINT model_security_audits_pkey PRIMARY KEY (id);


--
-- Name: mqtt_bridge_config mqtt_bridge_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mqtt_bridge_config
    ADD CONSTRAINT mqtt_bridge_config_pkey PRIMARY KEY (id);


--
-- Name: multi_sim_profiles multi_sim_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.multi_sim_profiles
    ADD CONSTRAINT multi_sim_profiles_pkey PRIMARY KEY (id);


--
-- Name: naicom_automated_reports naicom_automated_reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.naicom_automated_reports
    ADD CONSTRAINT naicom_automated_reports_pkey PRIMARY KEY (id);


--
-- Name: naicom_data_exchange naicom_data_exchange_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.naicom_data_exchange
    ADD CONSTRAINT naicom_data_exchange_pkey PRIMARY KEY (id);


--
-- Name: naicom_filings naicom_filings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.naicom_filings
    ADD CONSTRAINT naicom_filings_pkey PRIMARY KEY (id);


--
-- Name: naicom_financial_reports naicom_financial_reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.naicom_financial_reports
    ADD CONSTRAINT naicom_financial_reports_pkey PRIMARY KEY (id);


--
-- Name: naicom_penalties naicom_penalties_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.naicom_penalties
    ADD CONSTRAINT naicom_penalties_pkey PRIMARY KEY (id);


--
-- Name: naicom_reporting_schedule naicom_reporting_schedule_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.naicom_reporting_schedule
    ADD CONSTRAINT naicom_reporting_schedule_pkey PRIMARY KEY (id);


--
-- Name: naicom_returns naicom_returns_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.naicom_returns
    ADD CONSTRAINT naicom_returns_pkey PRIMARY KEY (id);


--
-- Name: ndvi_readings ndvi_readings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ndvi_readings
    ADD CONSTRAINT ndvi_readings_pkey PRIMARY KEY (id);


--
-- Name: niira_insurance_classes niira_insurance_classes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.niira_insurance_classes
    ADD CONSTRAINT niira_insurance_classes_pkey PRIMARY KEY (id);


--
-- Name: niira_registrations niira_registrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.niira_registrations
    ADD CONSTRAINT niira_registrations_pkey PRIMARY KEY (id);


--
-- Name: niira_registrations niira_registrations_registration_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.niira_registrations
    ADD CONSTRAINT niira_registrations_registration_id_key UNIQUE (registration_id);


--
-- Name: nmid_verifications nmid_verifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nmid_verifications
    ADD CONSTRAINT nmid_verifications_pkey PRIMARY KEY (id);


--
-- Name: notification_channels notification_channels_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_channels
    ADD CONSTRAINT notification_channels_pkey PRIMARY KEY (id);


--
-- Name: notification_dispatch_log notification_dispatch_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_dispatch_log
    ADD CONSTRAINT notification_dispatch_log_pkey PRIMARY KEY (id);


--
-- Name: notification_logs notification_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_logs
    ADD CONSTRAINT notification_logs_pkey PRIMARY KEY (id);


--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);


--
-- Name: observability_alerts observability_alerts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.observability_alerts
    ADD CONSTRAINT observability_alerts_pkey PRIMARY KEY (id);


--
-- Name: ota_releases ota_releases_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ota_releases
    ADD CONSTRAINT ota_releases_pkey PRIMARY KEY (id);


--
-- Name: ota_releases ota_releases_version_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ota_releases
    ADD CONSTRAINT ota_releases_version_unique UNIQUE (version);


--
-- Name: ota_update_log ota_update_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ota_update_log
    ADD CONSTRAINT ota_update_log_pkey PRIMARY KEY (id);


--
-- Name: otp_tokens otp_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.otp_tokens
    ADD CONSTRAINT otp_tokens_pkey PRIMARY KEY (id);


--
-- Name: p2p_memberships p2p_memberships_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.p2p_memberships
    ADD CONSTRAINT p2p_memberships_pkey PRIMARY KEY (id);


--
-- Name: p2p_pools p2p_pools_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.p2p_pools
    ADD CONSTRAINT p2p_pools_pkey PRIMARY KEY (id);


--
-- Name: parametric_triggers parametric_triggers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.parametric_triggers
    ADD CONSTRAINT parametric_triggers_pkey PRIMARY KEY (id);


--
-- Name: password_resets password_resets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.password_resets
    ADD CONSTRAINT password_resets_pkey PRIMARY KEY (user_id);


--
-- Name: payment_transactions payment_transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_transactions
    ADD CONSTRAINT payment_transactions_pkey PRIMARY KEY (id);


--
-- Name: payments payments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_pkey PRIMARY KEY (id);


--
-- Name: performance_metrics performance_metrics_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.performance_metrics
    ADD CONSTRAINT performance_metrics_pkey PRIMARY KEY (id);


--
-- Name: pfa_annuities pfa_annuities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pfa_annuities
    ADD CONSTRAINT pfa_annuities_pkey PRIMARY KEY (id);


--
-- Name: pfa_annuity_quotes pfa_annuity_quotes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pfa_annuity_quotes
    ADD CONSTRAINT pfa_annuity_quotes_pkey PRIMARY KEY (id);


--
-- Name: pfa_integration pfa_integration_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pfa_integration
    ADD CONSTRAINT pfa_integration_pkey PRIMARY KEY (id);


--
-- Name: pfa_partners pfa_partners_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pfa_partners
    ADD CONSTRAINT pfa_partners_pkey PRIMARY KEY (id);


--
-- Name: platform_health_checks platform_health_checks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_health_checks
    ADD CONSTRAINT platform_health_checks_pkey PRIMARY KEY (id);


--
-- Name: platform_incidents platform_incidents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_incidents
    ADD CONSTRAINT platform_incidents_pkey PRIMARY KEY (id);


--
-- Name: platform_settings platform_settings_key_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_settings
    ADD CONSTRAINT platform_settings_key_unique UNIQUE (key);


--
-- Name: platform_settings platform_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_settings
    ADD CONSTRAINT platform_settings_pkey PRIMARY KEY (id);


--
-- Name: pnl_reports pnl_reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pnl_reports
    ADD CONSTRAINT pnl_reports_pkey PRIMARY KEY (id);


--
-- Name: policies policies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.policies
    ADD CONSTRAINT policies_pkey PRIMARY KEY (id);


--
-- Name: policies policies_policyNumber_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.policies
    ADD CONSTRAINT "policies_policyNumber_unique" UNIQUE ("policyNumber");


--
-- Name: pos_terminals pos_terminals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pos_terminals
    ADD CONSTRAINT pos_terminals_pkey PRIMARY KEY (id);


--
-- Name: pos_terminals pos_terminals_serialNumber_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pos_terminals
    ADD CONSTRAINT "pos_terminals_serialNumber_unique" UNIQUE ("serialNumber");


--
-- Name: premium_collections premium_collections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.premium_collections
    ADD CONSTRAINT premium_collections_pkey PRIMARY KEY (id);


--
-- Name: premium_rate_audit_logs premium_rate_audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.premium_rate_audit_logs
    ADD CONSTRAINT premium_rate_audit_logs_pkey PRIMARY KEY (id);


--
-- Name: premium_rate_changes premium_rate_changes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.premium_rate_changes
    ADD CONSTRAINT premium_rate_changes_pkey PRIMARY KEY (id);


--
-- Name: premium_rate_tables premium_rate_tables_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.premium_rate_tables
    ADD CONSTRAINT premium_rate_tables_pkey PRIMARY KEY (id);


--
-- Name: premium_risk_factors premium_risk_factors_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.premium_risk_factors
    ADD CONSTRAINT premium_risk_factors_pkey PRIMARY KEY (id);


--
-- Name: qr_codes qr_codes_code_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qr_codes
    ADD CONSTRAINT qr_codes_code_unique UNIQUE (code);


--
-- Name: qr_codes qr_codes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qr_codes
    ADD CONSTRAINT qr_codes_pkey PRIMARY KEY (id);


--
-- Name: rate_alerts rate_alerts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rate_alerts
    ADD CONSTRAINT rate_alerts_pkey PRIMARY KEY (id);


--
-- Name: rate_limit_rules rate_limit_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rate_limit_rules
    ADD CONSTRAINT rate_limit_rules_pkey PRIMARY KEY (id);


--
-- Name: realtime_tx_alerts realtime_tx_alerts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.realtime_tx_alerts
    ADD CONSTRAINT realtime_tx_alerts_pkey PRIMARY KEY (id);


--
-- Name: reconciliation_batches reconciliation_batches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reconciliation_batches
    ADD CONSTRAINT reconciliation_batches_pkey PRIMARY KEY (id);


--
-- Name: reconciliation_items reconciliation_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reconciliation_items
    ADD CONSTRAINT reconciliation_items_pkey PRIMARY KEY (id);


--
-- Name: referrals referrals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.referrals
    ADD CONSTRAINT referrals_pkey PRIMARY KEY (id);


--
-- Name: referrals referrals_referralCode_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.referrals
    ADD CONSTRAINT "referrals_referralCode_unique" UNIQUE ("referralCode");


--
-- Name: refunds refunds_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refunds
    ADD CONSTRAINT refunds_pkey PRIMARY KEY (id);


--
-- Name: refunds refunds_ref_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refunds
    ADD CONSTRAINT refunds_ref_unique UNIQUE (ref);


--
-- Name: reinsurance_bordereaux reinsurance_bordereaux_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reinsurance_bordereaux
    ADD CONSTRAINT reinsurance_bordereaux_pkey PRIMARY KEY (id);


--
-- Name: reinsurance_cessions reinsurance_cessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reinsurance_cessions
    ADD CONSTRAINT reinsurance_cessions_pkey PRIMARY KEY (id);


--
-- Name: reinsurance_claims_recovery reinsurance_claims_recovery_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reinsurance_claims_recovery
    ADD CONSTRAINT reinsurance_claims_recovery_pkey PRIMARY KEY (id);


--
-- Name: reinsurance_facultative reinsurance_facultative_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reinsurance_facultative
    ADD CONSTRAINT reinsurance_facultative_pkey PRIMARY KEY (id);


--
-- Name: reinsurance_settlements reinsurance_settlements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reinsurance_settlements
    ADD CONSTRAINT reinsurance_settlements_pkey PRIMARY KEY (id);


--
-- Name: reinsurance_treaties reinsurance_treaties_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reinsurance_treaties
    ADD CONSTRAINT reinsurance_treaties_pkey PRIMARY KEY (id);


--
-- Name: reversal_requests reversal_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reversal_requests
    ADD CONSTRAINT reversal_requests_pkey PRIMARY KEY (id);


--
-- Name: reviews reviews_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reviews
    ADD CONSTRAINT reviews_pkey PRIMARY KEY (id);


--
-- Name: roles roles_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_name_key UNIQUE (name);


--
-- Name: roles roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_pkey PRIMARY KEY (id);


--
-- Name: savings_accounts savings_accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.savings_accounts
    ADD CONSTRAINT savings_accounts_pkey PRIMARY KEY (id);


--
-- Name: savings_plans savings_plans_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.savings_plans
    ADD CONSTRAINT savings_plans_pkey PRIMARY KEY (id);


--
-- Name: score_improvement_tips score_improvement_tips_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.score_improvement_tips
    ADD CONSTRAINT score_improvement_tips_pkey PRIMARY KEY (id);


--
-- Name: service_records service_records_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_records
    ADD CONSTRAINT service_records_pkey PRIMARY KEY (id);


--
-- Name: settlement_reconciliation settlement_reconciliation_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.settlement_reconciliation
    ADD CONSTRAINT settlement_reconciliation_pkey PRIMARY KEY (id);


--
-- Name: shareable_links shareable_links_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shareable_links
    ADD CONSTRAINT shareable_links_pkey PRIMARY KEY (id);


--
-- Name: shareable_links shareable_links_slug_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shareable_links
    ADD CONSTRAINT shareable_links_slug_unique UNIQUE (slug);


--
-- Name: sim_failover_log sim_failover_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sim_failover_log
    ADD CONSTRAINT sim_failover_log_pkey PRIMARY KEY (id);


--
-- Name: sim_orchestrator_config sim_orchestrator_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sim_orchestrator_config
    ADD CONSTRAINT sim_orchestrator_config_pkey PRIMARY KEY (id);


--
-- Name: sim_orchestrator_config sim_orchestrator_config_terminalId_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sim_orchestrator_config
    ADD CONSTRAINT "sim_orchestrator_config_terminalId_unique" UNIQUE ("terminalId");


--
-- Name: sim_probe_log sim_probe_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sim_probe_log
    ADD CONSTRAINT sim_probe_log_pkey PRIMARY KEY (id);


--
-- Name: sla_breaches sla_breaches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sla_breaches
    ADD CONSTRAINT sla_breaches_pkey PRIMARY KEY (id);


--
-- Name: sla_definitions sla_definitions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sla_definitions
    ADD CONSTRAINT sla_definitions_pkey PRIMARY KEY (id);


--
-- Name: sme_policies sme_policies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sme_policies
    ADD CONSTRAINT sme_policies_pkey PRIMARY KEY (id);


--
-- Name: software_updates software_updates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.software_updates
    ADD CONSTRAINT software_updates_pkey PRIMARY KEY (id);


--
-- Name: storefront_ads storefront_ads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.storefront_ads
    ADD CONSTRAINT storefront_ads_pkey PRIMARY KEY (id);


--
-- Name: supervisor_agents supervisor_agents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supervisor_agents
    ADD CONSTRAINT supervisor_agents_pkey PRIMARY KEY (id);


--
-- Name: system_config system_config_key_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_config
    ADD CONSTRAINT system_config_key_unique UNIQUE (key);


--
-- Name: system_config system_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_config
    ADD CONSTRAINT system_config_pkey PRIMARY KEY (id);


--
-- Name: system_settings system_settings_category_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_settings
    ADD CONSTRAINT system_settings_category_key_key UNIQUE (category, key);


--
-- Name: system_settings system_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_settings
    ADD CONSTRAINT system_settings_pkey PRIMARY KEY (id);


--
-- Name: takaful_pools takaful_pools_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.takaful_pools
    ADD CONSTRAINT takaful_pools_pkey PRIMARY KEY (id);


--
-- Name: takaful_sharia_principles takaful_sharia_principles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.takaful_sharia_principles
    ADD CONSTRAINT takaful_sharia_principles_pkey PRIMARY KEY (id);


--
-- Name: telco_credit_scores telco_credit_scores_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telco_credit_scores
    ADD CONSTRAINT telco_credit_scores_pkey PRIMARY KEY (id);


--
-- Name: telematics_devices telematics_devices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telematics_devices
    ADD CONSTRAINT telematics_devices_pkey PRIMARY KEY (id);


--
-- Name: tenant_branding tenant_branding_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_branding
    ADD CONSTRAINT tenant_branding_pkey PRIMARY KEY (id);


--
-- Name: tenant_corridors tenant_corridors_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_corridors
    ADD CONSTRAINT tenant_corridors_pkey PRIMARY KEY (id);


--
-- Name: tenant_feature_toggles tenant_feature_toggles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_feature_toggles
    ADD CONSTRAINT tenant_feature_toggles_pkey PRIMARY KEY (id);


--
-- Name: tenant_fee_overrides tenant_fee_overrides_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_fee_overrides
    ADD CONSTRAINT tenant_fee_overrides_pkey PRIMARY KEY (id);


--
-- Name: tenant_users tenant_users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_users
    ADD CONSTRAINT tenant_users_pkey PRIMARY KEY (id);


--
-- Name: tenants tenants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenants
    ADD CONSTRAINT tenants_pkey PRIMARY KEY (id);


--
-- Name: tenants tenants_slug_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenants
    ADD CONSTRAINT tenants_slug_unique UNIQUE (slug);


--
-- Name: terminal_groups terminal_groups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.terminal_groups
    ADD CONSTRAINT terminal_groups_pkey PRIMARY KEY (id);


--
-- Name: training_courses training_courses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.training_courses
    ADD CONSTRAINT training_courses_pkey PRIMARY KEY (id);


--
-- Name: training_enrollments training_enrollments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.training_enrollments
    ADD CONSTRAINT training_enrollments_pkey PRIMARY KEY (id);


--
-- Name: transaction_limits transaction_limits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transaction_limits
    ADD CONSTRAINT transaction_limits_pkey PRIMARY KEY (id);


--
-- Name: transactions transactions_idempotencyKey_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT "transactions_idempotencyKey_unique" UNIQUE ("idempotencyKey");


--
-- Name: transactions transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_pkey PRIMARY KEY (id);


--
-- Name: transactions transactions_ref_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_ref_unique UNIQUE (ref);


--
-- Name: tx_monitoring_alerts tx_monitoring_alerts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tx_monitoring_alerts
    ADD CONSTRAINT tx_monitoring_alerts_pkey PRIMARY KEY (id);


--
-- Name: underwriting_decisions underwriting_decisions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.underwriting_decisions
    ADD CONSTRAINT underwriting_decisions_pkey PRIMARY KEY (id);


--
-- Name: underwriting_rules underwriting_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.underwriting_rules
    ADD CONSTRAINT underwriting_rules_pkey PRIMARY KEY (id);


--
-- Name: user_achievements user_achievements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_achievements
    ADD CONSTRAINT user_achievements_pkey PRIMARY KEY (id);


--
-- Name: user_achievements user_achievements_user_id_achievement_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_achievements
    ADD CONSTRAINT user_achievements_user_id_achievement_id_key UNIQUE (user_id, achievement_id);


--
-- Name: user_roles user_roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_pkey PRIMARY KEY (id);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: ussd_analytics ussd_analytics_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ussd_analytics
    ADD CONSTRAINT ussd_analytics_pkey PRIMARY KEY (id);


--
-- Name: ussd_pins ussd_pins_phone_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ussd_pins
    ADD CONSTRAINT ussd_pins_phone_key UNIQUE (phone);


--
-- Name: ussd_pins ussd_pins_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ussd_pins
    ADD CONSTRAINT ussd_pins_pkey PRIMARY KEY (id);


--
-- Name: ussd_session_log ussd_session_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ussd_session_log
    ADD CONSTRAINT ussd_session_log_pkey PRIMARY KEY (id);


--
-- Name: ussd_sessions ussd_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ussd_sessions
    ADD CONSTRAINT ussd_sessions_pkey PRIMARY KEY (id);


--
-- Name: ussd_sessions ussd_sessions_sessionId_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ussd_sessions
    ADD CONSTRAINT "ussd_sessions_sessionId_unique" UNIQUE ("sessionId");


--
-- Name: vat_records vat_records_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vat_records
    ADD CONSTRAINT vat_records_pkey PRIMARY KEY (id);


--
-- Name: velocity_limits velocity_limits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.velocity_limits
    ADD CONSTRAINT velocity_limits_pkey PRIMARY KEY (id);


--
-- Name: velocity_limits velocity_limits_tier_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.velocity_limits
    ADD CONSTRAINT velocity_limits_tier_unique UNIQUE (tier);


--
-- Name: voice_config voice_config_language_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.voice_config
    ADD CONSTRAINT voice_config_language_code_key UNIQUE (language_code);


--
-- Name: voice_config voice_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.voice_config
    ADD CONSTRAINT voice_config_pkey PRIMARY KEY (id);


--
-- Name: voice_sessions voice_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.voice_sessions
    ADD CONSTRAINT voice_sessions_pkey PRIMARY KEY (id);


--
-- Name: wallet_transactions wallet_transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wallet_transactions
    ADD CONSTRAINT wallet_transactions_pkey PRIMARY KEY (id);


--
-- Name: wallets wallets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wallets
    ADD CONSTRAINT wallets_pkey PRIMARY KEY (id);


--
-- Name: wallets wallets_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wallets
    ADD CONSTRAINT wallets_user_id_key UNIQUE (user_id);


--
-- Name: webhook_deliveries webhook_deliveries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.webhook_deliveries
    ADD CONSTRAINT webhook_deliveries_pkey PRIMARY KEY (id);


--
-- Name: webhook_endpoints webhook_endpoints_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.webhook_endpoints
    ADD CONSTRAINT webhook_endpoints_pkey PRIMARY KEY (id);


--
-- Name: webhook_secrets webhook_secrets_integrationName_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.webhook_secrets
    ADD CONSTRAINT "webhook_secrets_integrationName_unique" UNIQUE ("integrationName");


--
-- Name: webhook_secrets webhook_secrets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.webhook_secrets
    ADD CONSTRAINT webhook_secrets_pkey PRIMARY KEY (id);


--
-- Name: whatsapp_messages whatsapp_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whatsapp_messages
    ADD CONSTRAINT whatsapp_messages_pkey PRIMARY KEY (id);


--
-- Name: workflow_definitions workflow_definitions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_definitions
    ADD CONSTRAINT workflow_definitions_pkey PRIMARY KEY (id);


--
-- Name: workflow_instances workflow_instances_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_instances
    ADD CONSTRAINT workflow_instances_pkey PRIMARY KEY (id);


--
-- Name: agent_push_subscriptions_agent_code_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agent_push_subscriptions_agent_code_idx ON public.agent_push_subscriptions USING btree ("agentCode");


--
-- Name: agents_agentCode_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "agents_agentCode_idx" ON public.agents USING btree ("agentCode");


--
-- Name: agents_deletedAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "agents_deletedAt_idx" ON public.agents USING btree ("deletedAt");


--
-- Name: agents_hierarchyRole_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "agents_hierarchyRole_idx" ON public.agents USING btree ("hierarchyRole");


--
-- Name: agents_parentAgentId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "agents_parentAgentId_idx" ON public.agents USING btree ("parentAgentId");


--
-- Name: agents_tenantId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "agents_tenantId_idx" ON public.agents USING btree ("tenantId");


--
-- Name: agents_tier_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agents_tier_idx ON public.agents USING btree (tier);


--
-- Name: agz_agentId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "agz_agentId_idx" ON public.agent_geofence_zones USING btree ("agentId");


--
-- Name: analytics_metricName_bucket_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "analytics_metricName_bucket_idx" ON public.analytics_metrics USING btree ("metricName", "bucketMinute");


--
-- Name: apikeys_keyHash_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "apikeys_keyHash_idx" ON public.api_keys USING btree ("keyHash");


--
-- Name: apikeys_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX apikeys_status_idx ON public.api_keys USING btree (status);


--
-- Name: apikeys_userId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "apikeys_userId_idx" ON public.api_keys USING btree ("userId");


--
-- Name: apiusage_apiKeyId_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "apiusage_apiKeyId_createdAt_idx" ON public.api_key_usage USING btree ("apiKeyId", "createdAt");


--
-- Name: audit_action_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_action_idx ON public.audit_log USING btree (action);


--
-- Name: audit_agentId_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "audit_agentId_createdAt_idx" ON public.audit_log USING btree ("agentId", "createdAt");


--
-- Name: audit_tenantId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "audit_tenantId_idx" ON public.audit_log USING btree ("tenantId");


--
-- Name: bae_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "bae_createdAt_idx" ON public.biometric_audit_events USING btree ("createdAt");


--
-- Name: bae_eventType_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "bae_eventType_idx" ON public.biometric_audit_events USING btree ("eventType");


--
-- Name: bae_outcome_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX bae_outcome_idx ON public.biometric_audit_events USING btree (outcome);


--
-- Name: bae_sessionId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "bae_sessionId_idx" ON public.biometric_audit_events USING btree ("sessionId");


--
-- Name: bae_tenantId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "bae_tenantId_idx" ON public.biometric_audit_events USING btree ("tenantId");


--
-- Name: bae_userId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "bae_userId_idx" ON public.biometric_audit_events USING btree ("userId");


--
-- Name: bal_action_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX bal_action_idx ON public.billing_audit_log USING btree (action);


--
-- Name: bal_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX bal_created_at_idx ON public.billing_audit_log USING btree (created_at);


--
-- Name: bal_resource_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX bal_resource_idx ON public.billing_audit_log USING btree (resource_type, resource_id);


--
-- Name: bal_tenant_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX bal_tenant_idx ON public.billing_audit_log USING btree (tenant_id);


--
-- Name: bal_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX bal_user_idx ON public.billing_audit_log USING btree (user_id);


--
-- Name: bph_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX bph_status_idx ON public.billing_provisioning_history USING btree (status);


--
-- Name: bph_step_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX bph_step_idx ON public.billing_provisioning_history USING btree (step);


--
-- Name: bph_tenant_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX bph_tenant_idx ON public.billing_provisioning_history USING btree (tenant_id);


--
-- Name: bra_role_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX bra_role_idx ON public.billing_role_assignments USING btree (billing_role);


--
-- Name: bra_tenant_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX bra_tenant_idx ON public.billing_role_assignments USING btree (tenant_id);


--
-- Name: bra_user_tenant_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX bra_user_tenant_idx ON public.billing_role_assignments USING btree (user_id, tenant_id);


--
-- Name: cat_action_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX cat_action_idx ON public.commission_audit_trail USING btree (action);


--
-- Name: cat_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX cat_created_at_idx ON public.commission_audit_trail USING btree (created_at);


--
-- Name: cat_entity_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX cat_entity_idx ON public.commission_audit_trail USING btree (entity_type, entity_id);


--
-- Name: cch_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "cch_createdAt_idx" ON public.commission_cascade_history USING btree ("createdAt");


--
-- Name: cch_originAgentId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "cch_originAgentId_idx" ON public.commission_cascade_history USING btree ("originAgentId");


--
-- Name: cch_recipientAgentId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "cch_recipientAgentId_idx" ON public.commission_cascade_history USING btree ("recipientAgentId");


--
-- Name: cch_transactionRef_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "cch_transactionRef_idx" ON public.commission_cascade_history USING btree ("transactionRef");


--
-- Name: chat_agentId_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "chat_agentId_status_idx" ON public.chat_sessions USING btree ("agentId", status);


--
-- Name: chat_msg_sessionId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "chat_msg_sessionId_idx" ON public.chat_messages USING btree ("sessionId");


--
-- Name: cmd_deviceId_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "cmd_deviceId_status_idx" ON public.device_commands USING btree ("deviceId", status);


--
-- Name: compliance_tenantId_period_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "compliance_tenantId_period_idx" ON public.compliance_reports USING btree ("tenantId", period);


--
-- Name: connectivity_log_agent_recorded_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX connectivity_log_agent_recorded_idx ON public.connectivity_log USING btree ("agentCode", "recordedAt");


--
-- Name: credit_agentId_computedAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "credit_agentId_computedAt_idx" ON public.credit_score_history USING btree ("agentId", "computedAt");


--
-- Name: credit_app_agentId_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "credit_app_agentId_status_idx" ON public.credit_applications USING btree ("agentId", status);


--
-- Name: cs_is_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX cs_is_active_idx ON public.commission_splits USING btree (is_active);


--
-- Name: cs_transaction_type_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX cs_transaction_type_idx ON public.commission_splits USING btree (transaction_type);


--
-- Name: ct_is_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ct_is_active_idx ON public.commission_tiers USING btree (is_active);


--
-- Name: ct_transaction_type_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ct_transaction_type_idx ON public.commission_tiers USING btree (transaction_type);


--
-- Name: customers_deletedAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "customers_deletedAt_idx" ON public.customers USING btree ("deletedAt");


--
-- Name: customers_phone_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX customers_phone_idx ON public.customers USING btree (phone);


--
-- Name: customers_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX customers_status_idx ON public.customers USING btree (status);


--
-- Name: customers_tenantId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "customers_tenantId_idx" ON public.customers USING btree ("tenantId");


--
-- Name: dcp_enabled_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX dcp_enabled_idx ON public.device_compliance_policies USING btree (enabled);


--
-- Name: dcp_tenantId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "dcp_tenantId_idx" ON public.device_compliance_policies USING btree ("tenantId");


--
-- Name: dcv_detectedAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "dcv_detectedAt_idx" ON public.device_compliance_violations USING btree ("detectedAt");


--
-- Name: dcv_deviceId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "dcv_deviceId_idx" ON public.device_compliance_violations USING btree ("deviceId");


--
-- Name: dcv_policyId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "dcv_policyId_idx" ON public.device_compliance_violations USING btree ("policyId");


--
-- Name: dcv_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX dcv_status_idx ON public.device_compliance_violations USING btree (status);


--
-- Name: ddr_status_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ddr_status_createdAt_idx" ON public.data_rights_requests USING btree (status, "createdAt");


--
-- Name: devices_agentId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "devices_agentId_idx" ON public.devices USING btree ("agentId");


--
-- Name: devices_serialNumber_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "devices_serialNumber_idx" ON public.devices USING btree ("serialNumber");


--
-- Name: devices_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX devices_status_idx ON public.devices USING btree (status);


--
-- Name: devices_tenantId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "devices_tenantId_idx" ON public.devices USING btree ("tenantId");


--
-- Name: dispute_agentId_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "dispute_agentId_status_idx" ON public.disputes USING btree ("agentId", status);


--
-- Name: dispute_msg_disputeId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "dispute_msg_disputeId_idx" ON public.dispute_messages USING btree ("disputeId");


--
-- Name: dispute_tenantId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "dispute_tenantId_idx" ON public.disputes USING btree ("tenantId");


--
-- Name: dloc_deviceId_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "dloc_deviceId_createdAt_idx" ON public.device_locations USING btree ("deviceId", "createdAt");


--
-- Name: dlq_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "dlq_createdAt_idx" ON public.dlq_messages USING btree ("createdAt");


--
-- Name: dlq_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX dlq_status_idx ON public.dlq_messages USING btree (status);


--
-- Name: dlq_topic_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX dlq_topic_idx ON public.dlq_messages USING btree (topic);


--
-- Name: email_delivery_provider_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX email_delivery_provider_idx ON public.email_delivery_log USING btree (provider, created_at);


--
-- Name: email_delivery_queue_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX email_delivery_queue_id_idx ON public.email_delivery_log USING btree (email_queue_id);


--
-- Name: email_status_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "email_status_createdAt_idx" ON public.email_queue USING btree (status, "createdAt");


--
-- Name: erp_entityType_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "erp_entityType_idx" ON public.erp_sync_log USING btree ("entityType");


--
-- Name: erp_status_nextRetry_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "erp_status_nextRetry_idx" ON public.erp_sync_log USING btree (status, "nextRetryAt");


--
-- Name: fe_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX fe_active_idx ON public.face_enrollments USING btree ("userId", "isActive");


--
-- Name: fe_tenantId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "fe_tenantId_idx" ON public.face_enrollments USING btree ("tenantId");


--
-- Name: fe_userId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "fe_userId_idx" ON public.face_enrollments USING btree ("userId");


--
-- Name: fido2_agentId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "fido2_agentId_idx" ON public.fido2_credentials USING btree ("agentId");


--
-- Name: fido2_credentialId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "fido2_credentialId_idx" ON public.fido2_credentials USING btree ("credentialId");


--
-- Name: fido2_userId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "fido2_userId_idx" ON public.fido2_credentials USING btree ("userId");


--
-- Name: fido2ch_challenge_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX fido2ch_challenge_idx ON public.fido2_challenges USING btree (challenge);


--
-- Name: fido2ch_expiresAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "fido2ch_expiresAt_idx" ON public.fido2_challenges USING btree ("expiresAt");


--
-- Name: fraud_rules_category_enabled_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX fraud_rules_category_enabled_idx ON public.fraud_rules USING btree (category, enabled);


--
-- Name: fraud_severity_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX fraud_severity_idx ON public.fraud_alerts USING btree (severity);


--
-- Name: fraud_tenantId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "fraud_tenantId_idx" ON public.fraud_alerts USING btree ("tenantId");


--
-- Name: idx_claims_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_claims_tenant ON public.claims USING btree ("tenantId");


--
-- Name: idx_file_uploads_entity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_file_uploads_entity ON public.file_uploads USING btree ("entityType", "entityId");


--
-- Name: idx_file_uploads_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_file_uploads_user ON public.file_uploads USING btree ("userId");


--
-- Name: idx_payments_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payments_tenant ON public.payments USING btree ("tenantId");


--
-- Name: idx_policies_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_policies_tenant ON public.policies USING btree ("tenantId");


--
-- Name: idx_users_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_tenant ON public.users USING btree ("tenantId");


--
-- Name: invite_codes_code_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX invite_codes_code_idx ON public.invite_codes USING btree (code);


--
-- Name: invite_codes_createdBy_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "invite_codes_createdBy_idx" ON public.invite_codes USING btree ("createdBy");


--
-- Name: invite_codes_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX invite_codes_status_idx ON public.invite_codes USING btree (status);


--
-- Name: kyc_agentId_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "kyc_agentId_status_idx" ON public.kyc_sessions USING btree ("agentId", status);


--
-- Name: kyc_customerId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "kyc_customerId_idx" ON public.kyc_sessions USING btree ("customerId");


--
-- Name: kyc_tenantId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "kyc_tenantId_idx" ON public.kyc_sessions USING btree ("tenantId");


--
-- Name: links_agentId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "links_agentId_idx" ON public.shareable_links USING btree ("agentId");


--
-- Name: links_slug_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX links_slug_idx ON public.shareable_links USING btree (slug);


--
-- Name: loyalty_agentId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "loyalty_agentId_idx" ON public.loyalty_history USING btree ("agentId");


--
-- Name: ltr_started_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ltr_started_at_idx ON public.load_test_runs USING btree (started_at);


--
-- Name: ltr_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ltr_status_idx ON public.load_test_runs USING btree (status);


--
-- Name: merchants_deletedAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "merchants_deletedAt_idx" ON public.merchants USING btree ("deletedAt");


--
-- Name: merchants_merchantCode_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "merchants_merchantCode_idx" ON public.merchants USING btree ("merchantCode");


--
-- Name: merchants_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX merchants_status_idx ON public.merchants USING btree (status);


--
-- Name: merchants_tenantId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "merchants_tenantId_idx" ON public.merchants USING btree ("tenantId");


--
-- Name: mgv_detectedAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "mgv_detectedAt_idx" ON public.mdm_geofence_violations USING btree ("detectedAt");


--
-- Name: mgv_deviceId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "mgv_deviceId_idx" ON public.mdm_geofence_violations USING btree ("deviceId");


--
-- Name: mgv_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mgv_status_idx ON public.mdm_geofence_violations USING btree (status);


--
-- Name: ms_merchantId_period_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ms_merchantId_period_idx" ON public.merchant_settlements USING btree ("merchantId", period);


--
-- Name: ota_log_deviceId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ota_log_deviceId_idx" ON public.ota_update_log USING btree ("deviceId");


--
-- Name: ota_log_releaseId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ota_log_releaseId_idx" ON public.ota_update_log USING btree ("releaseId");


--
-- Name: ota_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ota_status_idx ON public.ota_releases USING btree (status);


--
-- Name: ota_version_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ota_version_idx ON public.ota_releases USING btree (version);


--
-- Name: otp_agentId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "otp_agentId_idx" ON public.otp_tokens USING btree ("agentId");


--
-- Name: otp_expiresAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "otp_expiresAt_idx" ON public.otp_tokens USING btree ("expiresAt");


--
-- Name: pos_agentId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "pos_agentId_idx" ON public.pos_terminals USING btree ("agentId");


--
-- Name: pos_serialNumber_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "pos_serialNumber_idx" ON public.pos_terminals USING btree ("serialNumber");


--
-- Name: pos_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pos_status_idx ON public.pos_terminals USING btree (status);


--
-- Name: pos_tenantId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "pos_tenantId_idx" ON public.pos_terminals USING btree ("tenantId");


--
-- Name: qr_agentId_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "qr_agentId_status_idx" ON public.qr_codes USING btree ("agentId", status);


--
-- Name: qr_expiresAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "qr_expiresAt_idx" ON public.qr_codes USING btree ("expiresAt");


--
-- Name: rate_alert_agent_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX rate_alert_agent_status_idx ON public.rate_alerts USING btree (agent_id, status);


--
-- Name: rate_alert_pair_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX rate_alert_pair_idx ON public.rate_alerts USING btree (base_currency, target_currency);


--
-- Name: refund_agentId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "refund_agentId_idx" ON public.refunds USING btree ("agentId");


--
-- Name: refund_disputeId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "refund_disputeId_idx" ON public.refunds USING btree ("disputeId");


--
-- Name: refund_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX refund_status_idx ON public.refunds USING btree (status);


--
-- Name: refund_transactionRef_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "refund_transactionRef_idx" ON public.refunds USING btree ("transactionRef");


--
-- Name: reversal_agentId_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "reversal_agentId_status_idx" ON public.reversal_requests USING btree ("agentId", status);


--
-- Name: sim_failover_log_agent_switched_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sim_failover_log_agent_switched_idx ON public.sim_failover_log USING btree ("agentCode", "switchedAt");


--
-- Name: sim_failover_log_terminal_switched_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sim_failover_log_terminal_switched_idx ON public.sim_failover_log USING btree ("terminalId", "switchedAt");


--
-- Name: sim_orchestrator_config_terminal_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX sim_orchestrator_config_terminal_idx ON public.sim_orchestrator_config USING btree ("terminalId");


--
-- Name: sim_probe_log_agent_probed_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sim_probe_log_agent_probed_idx ON public.sim_probe_log USING btree ("agentCode", "probedAt");


--
-- Name: sim_probe_log_slot_probed_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sim_probe_log_slot_probed_idx ON public.sim_probe_log USING btree (slot, "probedAt");


--
-- Name: supv_agentId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "supv_agentId_idx" ON public.supervisor_agents USING btree ("agentId");


--
-- Name: supv_supervisorId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "supv_supervisorId_idx" ON public.supervisor_agents USING btree ("supervisorId");


--
-- Name: svc_terminalId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "svc_terminalId_idx" ON public.service_records USING btree ("terminalId");


--
-- Name: system_config_key_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX system_config_key_idx ON public.system_config USING btree (key);


--
-- Name: tenant_branding_tenantId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "tenant_branding_tenantId_idx" ON public.tenant_branding USING btree ("tenantId");


--
-- Name: tenant_corridors_route_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tenant_corridors_route_idx ON public.tenant_corridors USING btree ("sourceCountry", "destinationCountry");


--
-- Name: tenant_corridors_tenantId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "tenant_corridors_tenantId_idx" ON public.tenant_corridors USING btree ("tenantId");


--
-- Name: tenant_fee_overrides_corridorId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "tenant_fee_overrides_corridorId_idx" ON public.tenant_fee_overrides USING btree ("corridorId");


--
-- Name: tenant_fee_overrides_tenantId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "tenant_fee_overrides_tenantId_idx" ON public.tenant_fee_overrides USING btree ("tenantId");


--
-- Name: tenant_users_email_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tenant_users_email_idx ON public.tenant_users USING btree (email);


--
-- Name: tenant_users_tenantId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "tenant_users_tenantId_idx" ON public.tenant_users USING btree ("tenantId");


--
-- Name: tenant_users_userId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "tenant_users_userId_idx" ON public.tenant_users USING btree ("userId");


--
-- Name: tenants_slug_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX tenants_slug_idx ON public.tenants USING btree (slug);


--
-- Name: tenants_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tenants_status_idx ON public.tenants USING btree (status);


--
-- Name: topup_agentId_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "topup_agentId_status_idx" ON public.float_topup_requests USING btree ("agentId", status);


--
-- Name: topup_tenantId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "topup_tenantId_idx" ON public.float_topup_requests USING btree ("tenantId");


--
-- Name: tx_agentId_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "tx_agentId_createdAt_idx" ON public.transactions USING btree ("agentId", "createdAt");


--
-- Name: tx_deletedAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "tx_deletedAt_idx" ON public.transactions USING btree ("deletedAt");


--
-- Name: tx_idempotencyKey_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "tx_idempotencyKey_idx" ON public.transactions USING btree ("idempotencyKey");


--
-- Name: tx_ref_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX tx_ref_idx ON public.transactions USING btree (ref);


--
-- Name: tx_status_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "tx_status_createdAt_idx" ON public.transactions USING btree (status, "createdAt");


--
-- Name: tx_tenantId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "tx_tenantId_idx" ON public.transactions USING btree ("tenantId");


--
-- Name: tx_type_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "tx_type_createdAt_idx" ON public.transactions USING btree (type, "createdAt");


--
-- Name: users_role_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX users_role_idx ON public.users USING btree (role);


--
-- Name: users_tenantId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "users_tenantId_idx" ON public.users USING btree ("tenantId");


--
-- Name: vat_agentId_period_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "vat_agentId_period_idx" ON public.vat_records USING btree ("agentId", period);


--
-- Name: agent_onboarding_progress agent_onboarding_progress_agent_id_agents_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_onboarding_progress
    ADD CONSTRAINT agent_onboarding_progress_agent_id_agents_id_fk FOREIGN KEY (agent_id) REFERENCES public.agents(id);


--
-- Name: api_key_usage api_key_usage_apiKeyId_api_keys_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.api_key_usage
    ADD CONSTRAINT "api_key_usage_apiKeyId_api_keys_id_fk" FOREIGN KEY ("apiKeyId") REFERENCES public.api_keys(id);


--
-- Name: api_keys api_keys_userId_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.api_keys
    ADD CONSTRAINT "api_keys_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES public.users(id);


--
-- Name: approval_requests approval_requests_chain_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.approval_requests
    ADD CONSTRAINT approval_requests_chain_id_fkey FOREIGN KEY (chain_id) REFERENCES public.approval_chains(id);


--
-- Name: claim_evidence claim_evidence_claimid_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.claim_evidence
    ADD CONSTRAINT claim_evidence_claimid_fk FOREIGN KEY ("claimId") REFERENCES public.claims(id) ON DELETE CASCADE;


--
-- Name: claims claims_policyid_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.claims
    ADD CONSTRAINT claims_policyid_fk FOREIGN KEY ("policyId") REFERENCES public.policies(id) ON DELETE CASCADE;


--
-- Name: claims claims_userid_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.claims
    ADD CONSTRAINT claims_userid_fk FOREIGN KEY ("userId") REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: commission_payouts commission_payouts_agent_id_agents_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.commission_payouts
    ADD CONSTRAINT commission_payouts_agent_id_agents_id_fk FOREIGN KEY (agent_id) REFERENCES public.agents(id);


--
-- Name: communication_preferences communication_preferences_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.communication_preferences
    ADD CONSTRAINT communication_preferences_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: credit_applications credit_applications_agentId_agents_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.credit_applications
    ADD CONSTRAINT "credit_applications_agentId_agents_id_fk" FOREIGN KEY ("agentId") REFERENCES public.agents(id);


--
-- Name: credit_score_history credit_score_history_agentId_agents_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.credit_score_history
    ADD CONSTRAINT "credit_score_history_agentId_agents_id_fk" FOREIGN KEY ("agentId") REFERENCES public.agents(id);


--
-- Name: customers customers_preferredAgentId_agents_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT "customers_preferredAgentId_agents_id_fk" FOREIGN KEY ("preferredAgentId") REFERENCES public.agents(id);


--
-- Name: fido2_challenges fido2_challenges_agentId_agents_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fido2_challenges
    ADD CONSTRAINT "fido2_challenges_agentId_agents_id_fk" FOREIGN KEY ("agentId") REFERENCES public.agents(id);


--
-- Name: fido2_challenges fido2_challenges_userId_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fido2_challenges
    ADD CONSTRAINT "fido2_challenges_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES public.users(id);


--
-- Name: fido2_credentials fido2_credentials_agentId_agents_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fido2_credentials
    ADD CONSTRAINT "fido2_credentials_agentId_agents_id_fk" FOREIGN KEY ("agentId") REFERENCES public.agents(id);


--
-- Name: fido2_credentials fido2_credentials_userId_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fido2_credentials
    ADD CONSTRAINT "fido2_credentials_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES public.users(id);


--
-- Name: file_uploads file_uploads_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.file_uploads
    ADD CONSTRAINT "file_uploads_userId_fkey" FOREIGN KEY ("userId") REFERENCES public.users(id);


--
-- Name: ifrs17_cashflow_scenarios ifrs17_cashflow_scenarios_group_code_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ifrs17_cashflow_scenarios
    ADD CONSTRAINT ifrs17_cashflow_scenarios_group_code_fkey FOREIGN KEY (group_code) REFERENCES public.ifrs17_contract_groups(group_code);


--
-- Name: ifrs17_csm_rollforward ifrs17_csm_rollforward_group_code_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ifrs17_csm_rollforward
    ADD CONSTRAINT ifrs17_csm_rollforward_group_code_fkey FOREIGN KEY (group_code) REFERENCES public.ifrs17_contract_groups(group_code);


--
-- Name: ifrs17_pnl ifrs17_pnl_group_code_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ifrs17_pnl
    ADD CONSTRAINT ifrs17_pnl_group_code_fkey FOREIGN KEY (group_code) REFERENCES public.ifrs17_contract_groups(group_code);


--
-- Name: ifrs17_reinsurance_held ifrs17_reinsurance_held_group_code_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ifrs17_reinsurance_held
    ADD CONSTRAINT ifrs17_reinsurance_held_group_code_fkey FOREIGN KEY (group_code) REFERENCES public.ifrs17_contract_groups(group_code);


--
-- Name: ifrs17_transition ifrs17_transition_group_code_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ifrs17_transition
    ADD CONSTRAINT ifrs17_transition_group_code_fkey FOREIGN KEY (group_code) REFERENCES public.ifrs17_contract_groups(group_code);


--
-- Name: kyc_profiles kyc_profiles_userid_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kyc_profiles
    ADD CONSTRAINT kyc_profiles_userid_fk FOREIGN KEY ("userId") REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: merchant_settlements merchant_settlements_merchantId_merchants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.merchant_settlements
    ADD CONSTRAINT "merchant_settlements_merchantId_merchants_id_fk" FOREIGN KEY ("merchantId") REFERENCES public.merchants(id);


--
-- Name: merchants merchants_preferredAgentId_agents_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.merchants
    ADD CONSTRAINT "merchants_preferredAgentId_agents_id_fk" FOREIGN KEY ("preferredAgentId") REFERENCES public.agents(id);


--
-- Name: multi_sim_profiles multi_sim_profiles_terminalId_pos_terminals_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.multi_sim_profiles
    ADD CONSTRAINT "multi_sim_profiles_terminalId_pos_terminals_id_fk" FOREIGN KEY ("terminalId") REFERENCES public.pos_terminals(id);


--
-- Name: ota_update_log ota_update_log_deviceId_devices_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ota_update_log
    ADD CONSTRAINT "ota_update_log_deviceId_devices_id_fk" FOREIGN KEY ("deviceId") REFERENCES public.devices(id);


--
-- Name: ota_update_log ota_update_log_releaseId_ota_releases_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ota_update_log
    ADD CONSTRAINT "ota_update_log_releaseId_ota_releases_id_fk" FOREIGN KEY ("releaseId") REFERENCES public.ota_releases(id);


--
-- Name: password_resets password_resets_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.password_resets
    ADD CONSTRAINT password_resets_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: payments payments_policyid_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_policyid_fk FOREIGN KEY ("policyId") REFERENCES public.policies(id) ON DELETE CASCADE;


--
-- Name: payments payments_userid_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_userid_fk FOREIGN KEY ("userId") REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: pfa_annuities pfa_annuities_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pfa_annuities
    ADD CONSTRAINT pfa_annuities_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: pfa_integration pfa_integration_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pfa_integration
    ADD CONSTRAINT pfa_integration_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: policies policies_userid_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.policies
    ADD CONSTRAINT policies_userid_fk FOREIGN KEY ("userId") REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: qr_codes qr_codes_agentId_agents_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qr_codes
    ADD CONSTRAINT "qr_codes_agentId_agents_id_fk" FOREIGN KEY ("agentId") REFERENCES public.agents(id);


--
-- Name: reinsurance_bordereaux reinsurance_bordereaux_treaty_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reinsurance_bordereaux
    ADD CONSTRAINT reinsurance_bordereaux_treaty_id_fkey FOREIGN KEY (treaty_id) REFERENCES public.reinsurance_treaties(id);


--
-- Name: reinsurance_claims_recovery reinsurance_claims_recovery_treaty_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reinsurance_claims_recovery
    ADD CONSTRAINT reinsurance_claims_recovery_treaty_id_fkey FOREIGN KEY (treaty_id) REFERENCES public.reinsurance_treaties(id);


--
-- Name: reinsurance_settlements reinsurance_settlements_treaty_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reinsurance_settlements
    ADD CONSTRAINT reinsurance_settlements_treaty_id_fkey FOREIGN KEY (treaty_id) REFERENCES public.reinsurance_treaties(id);


--
-- Name: reversal_requests reversal_requests_agentId_agents_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reversal_requests
    ADD CONSTRAINT "reversal_requests_agentId_agents_id_fk" FOREIGN KEY ("agentId") REFERENCES public.agents(id);


--
-- Name: reversal_requests reversal_requests_reviewedBy_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reversal_requests
    ADD CONSTRAINT "reversal_requests_reviewedBy_users_id_fk" FOREIGN KEY ("reviewedBy") REFERENCES public.users(id);


--
-- Name: service_records service_records_terminalId_pos_terminals_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_records
    ADD CONSTRAINT "service_records_terminalId_pos_terminals_id_fk" FOREIGN KEY ("terminalId") REFERENCES public.pos_terminals(id);


--
-- Name: settlement_reconciliation settlement_reconciliation_agent_id_agents_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.settlement_reconciliation
    ADD CONSTRAINT settlement_reconciliation_agent_id_agents_id_fk FOREIGN KEY (agent_id) REFERENCES public.agents(id);


--
-- Name: shareable_links shareable_links_agentId_agents_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shareable_links
    ADD CONSTRAINT "shareable_links_agentId_agents_id_fk" FOREIGN KEY ("agentId") REFERENCES public.agents(id);


--
-- Name: storefront_ads storefront_ads_agentId_agents_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.storefront_ads
    ADD CONSTRAINT "storefront_ads_agentId_agents_id_fk" FOREIGN KEY ("agentId") REFERENCES public.agents(id);


--
-- Name: user_achievements user_achievements_achievement_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_achievements
    ADD CONSTRAINT user_achievements_achievement_id_fkey FOREIGN KEY (achievement_id) REFERENCES public.achievements(id);


--
-- Name: user_achievements user_achievements_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_achievements
    ADD CONSTRAINT user_achievements_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: vat_records vat_records_agentId_agents_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vat_records
    ADD CONSTRAINT "vat_records_agentId_agents_id_fk" FOREIGN KEY ("agentId") REFERENCES public.agents(id);


--
-- Name: webhook_deliveries webhook_deliveries_endpoint_id_webhook_endpoints_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.webhook_deliveries
    ADD CONSTRAINT webhook_deliveries_endpoint_id_webhook_endpoints_id_fk FOREIGN KEY (endpoint_id) REFERENCES public.webhook_endpoints(id);


--
-- PostgreSQL database dump complete
--

\unrestrict bLx1uC9HT2l8tzO1FJApfzCz4nd7EkLLb1jLFY1KJDMheQ6bFLX4tUoaUbfGfb8

