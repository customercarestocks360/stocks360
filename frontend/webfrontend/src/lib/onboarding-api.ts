/**
 * Typed wrappers over the backend's `/onboarding/*` routes. Every type here mirrors
 * `backend/app/schemas/onboarding.py` field-for-field — if one changes there, it changes
 * here, and a stray field on either side surfaces as a `422` rather than a silent drop
 * (the backend declares every step model `extra="forbid"`).
 *
 * One endpoint, ten shapes: `POST /onboarding/step` takes a discriminated union keyed on
 * `step`, so each step's body and validation rules are exactly what that screen needs. The
 * server is the only source of truth for ordering and eligibility — this file does not
 * re-implement any of those rules, it only shapes the request and response.
 */
import { apiFetch } from "@/lib/api";

export const ONBOARDING_STEPS = [
  "contact",
  "personal",
  "address",
  "identity",
  "tax",
  "financial",
  "markets",
  "funding",
  "security",
  "agreements",
] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

/** Shared between the funnel (`/kyc`) and its read-only recap (`/account`), so the two never drift. */
export const ONBOARDING_STEP_LABELS: Record<OnboardingStep, string> = {
  contact: "Contact",
  personal: "Personal",
  address: "Address",
  identity: "Identity",
  tax: "Tax",
  financial: "Financial",
  markets: "Markets",
  funding: "Funding",
  security: "Security",
  agreements: "Agreements",
};

export type OnboardingStatus =
  "not_started" | "in_progress" | "under_review" | "approved" | "rejected";
export type KycTier = "unverified" | "basic" | "verified" | "pro";

export const GENDERS = ["male", "female", "other", "undisclosed"] as const;
export type Gender = (typeof GENDERS)[number];

export const DOCUMENT_TYPES = [
  "passport",
  "national_id",
  "drivers_licence",
  "pan",
  "aadhaar",
] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

/** Documents that carry an expiry — the backend requires `expiry_date` for exactly these. */
export const EXPIRING_DOCUMENT_TYPES: readonly DocumentType[] = ["passport", "drivers_licence"];

export const PEP_STATUSES = ["none", "self", "related"] as const;
export type PepStatus = (typeof PEP_STATUSES)[number];

export const SOURCES_OF_FUNDS = [
  "salary",
  "business_income",
  "investments",
  "savings",
  "inheritance",
  "crypto_trading",
  "loan",
  "other",
] as const;
export type SourceOfFunds = (typeof SOURCES_OF_FUNDS)[number];

export const OCCUPATIONS = [
  "salaried_private",
  "salaried_public",
  "government",
  "business_owner",
  "professional",
  "student",
  "retired",
  "homemaker",
  "unemployed",
  "other",
] as const;
export type Occupation = (typeof OCCUPATIONS)[number];

/** Occupations the backend requires an `employer_designation` for. */
export const EMPLOYED_OCCUPATIONS: readonly Occupation[] = [
  "salaried_private",
  "salaried_public",
  "government",
];

export const MONEY_BANDS = ["lt_25k", "25k_100k", "100k_500k", "500k_1m", "gt_1m"] as const;
export type MoneyBand = (typeof MONEY_BANDS)[number];

export const RISK_TOLERANCES = ["low", "medium", "high"] as const;
export type RiskTolerance = (typeof RISK_TOLERANCES)[number];

export const INVESTMENT_OBJECTIVES = [
  "capital_preservation",
  "income",
  "long_term_growth",
  "speculation",
  "hedging",
] as const;
export type InvestmentObjective = (typeof INVESTMENT_OBJECTIVES)[number];

export const PRODUCTS = [
  "domestic_equity_delivery",
  "domestic_equity_intraday",
  "domestic_derivatives",
  "foreign_equity",
  "mutual_funds",
  "commodities",
  "forex",
  "crypto_spot",
  "crypto_derivatives",
  "crypto_staking",
] as const;
export type Product = (typeof PRODUCTS)[number];

export const CURRENCIES = ["INR", "USD", "EUR", "GBP", "AED", "SGD"] as const;
export type Currency = (typeof CURRENCIES)[number];

export const ACCOUNT_TYPES = ["savings", "current", "checking"] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const ROUTING_TYPES = ["ifsc", "swift", "iban", "aba", "sort_code"] as const;
export type RoutingType = (typeof ROUTING_TYPES)[number];

export const FUNDING_METHODS = ["bank_transfer", "upi", "card", "crypto_deposit"] as const;
export type FundingMethod = (typeof FUNDING_METHODS)[number];

export const CRYPTO_NETWORKS = ["bitcoin", "ethereum", "tron", "solana", "bsc", "polygon"] as const;
export type CryptoNetwork = (typeof CRYPTO_NETWORKS)[number];

/**
 * Exactly two values, matching `backend/app/schemas/onboarding.py::TwoFactorMethod`. There
 * is no SMS provider and no TOTP/passkey enrolment flow anywhere in this codebase — offering
 * them would be a checkbox that does nothing at sign-in. `email` piggybacks on a channel the
 * user already has to control; `none` is an honest name for declining rather than a method
 * that silently no-ops.
 */
export const TWO_FACTOR_METHODS = ["email", "none"] as const;
export type TwoFactorMethod = (typeof TWO_FACTOR_METHODS)[number];

export const AGREEMENT_DOCUMENTS = [
  "terms_of_service",
  "privacy_policy",
  "tax_declaration",
  "risk_disclosure_securities",
  "risk_disclosure_derivatives",
  "risk_disclosure_crypto",
  "cross_border_remittance",
] as const;
export type AgreementDocument = (typeof AGREEMENT_DOCUMENTS)[number];

// --------------------------------------------------------------------------------------- //
// Shared sub-objects
// --------------------------------------------------------------------------------------- //

export type PostalAddress = {
  line1: string;
  line2?: string;
  city: string;
  state: string;
  postal_code: string;
  country: string;
};

export type BankAccount = {
  account_holder_name: string;
  account_number: string;
  account_type: AccountType;
  bank_name: string;
  routing_type: RoutingType;
  routing_code: string;
  currency: Currency;
};

export type AcceptedAgreement = { document: AgreementDocument; version: string };

// --------------------------------------------------------------------------------------- //
// Per-step request bodies — the exact shape POST /onboarding/step expects for each `step`
// --------------------------------------------------------------------------------------- //

export type ContactStepInput = {
  step: "contact";
  mobile_country_code: string;
  mobile_number: string;
  country_of_residence: string;
  nationality: string;
};

export type PersonalStepInput = {
  step: "personal";
  first_name: string;
  middle_name?: string;
  last_name: string;
  /** ISO date, `YYYY-MM-DD`. */
  date_of_birth: string;
  gender: Gender;
  place_of_birth_country: string;
};

export type AddressStepInput = {
  step: "address";
  residential: PostalAddress;
  permanent_same_as_residential: boolean;
  permanent?: PostalAddress;
};

export type IdentityStepInput = {
  step: "identity";
  document_type: DocumentType;
  document_number: string;
  issuing_country: string;
  /** ISO date. Required for passport/drivers_licence, forbidden otherwise. */
  expiry_date?: string;
};

export type TaxStepInput = {
  step: "tax";
  tax_residency_country: string;
  tax_identification_number?: string;
  no_tin_reason?: string;
  is_us_person: boolean;
  pep_status: PepStatus;
  source_of_funds: SourceOfFunds;
  source_of_funds_detail?: string;
};

export type FinancialStepInput = {
  step: "financial";
  occupation: Occupation;
  employer_designation?: string;
  income_currency: Currency;
  annual_income_band: MoneyBand;
  net_worth_band: MoneyBand;
  investment_experience_years: number;
  risk_tolerance: RiskTolerance;
  investment_objectives: InvestmentObjective[];
};

export type MarketsStepInput = {
  step: "markets";
  products: Product[];
  base_currency: Currency;
};

export type FundingStepInput = {
  step: "funding";
  primary_method: FundingMethod;
  bank_account?: BankAccount;
  crypto_deposit_networks?: CryptoNetwork[];
};

export type SecurityStepInput = {
  step: "security";
  two_factor_method: TwoFactorMethod;
  anti_phishing_code?: string;
  withdrawal_whitelist_only: boolean;
  notify_on_new_device: boolean;
};

export type AgreementsStepInput = {
  step: "agreements";
  accepted: AcceptedAgreement[];
};

export type OnboardingStepInput =
  | ContactStepInput
  | PersonalStepInput
  | AddressStepInput
  | IdentityStepInput
  | TaxStepInput
  | FinancialStepInput
  | MarketsStepInput
  | FundingStepInput
  | SecurityStepInput
  | AgreementsStepInput;

// --------------------------------------------------------------------------------------- //
// Responses
// --------------------------------------------------------------------------------------- //

/**
 * One captured step as the session reports it back. `data` is the step body minus `step`
 * itself — shaped like the matching `*StepInput` above, except that a handful of fields
 * (`mobile_number`, `document_number`, `tax_identification_number`,
 * `bank_account.account_number`) come back masked once captured, so this is intentionally
 * loose rather than re-declaring ten near-identical "masked" variants.
 */
export type CapturedStep = { data: Record<string, unknown>; at: string };

export type OnboardingSession = {
  uid: string;
  status: OnboardingStatus;
  kyc_tier: KycTier;
  current_step: OnboardingStep | null;
  completed_steps: OnboardingStep[];
  remaining_steps: OnboardingStep[];
  progress_percent: number;
  ready_to_submit: boolean;
  steps: Partial<Record<OnboardingStep, CapturedStep>>;
  created_at: string | null;
  updated_at: string | null;
  expires_at: string | null;
  submitted_at: string | null;
};

export type OnboardingSubmitResult = {
  uid: string;
  status: OnboardingStatus;
  kyc_tier: KycTier;
  enabled_products: Product[];
  pending_products: Product[];
  submitted_at: string;
};

/**
 * `POST /onboarding/step` — submits one screen. `409` if it arrives out of order, the
 * session is already submitted, or (on `markets`) a requested product fails the
 * suitability/jurisdiction gate. `422` on a malformed body for that step.
 */
export function submitOnboardingStep(
  payload: OnboardingStepInput,
  token: string,
): Promise<OnboardingSession> {
  return apiFetch<OnboardingSession>("/onboarding/step", {
    method: "POST",
    token,
    body: payload,
  });
}

/**
 * `GET /onboarding/session` — resume: progress plus everything captured, with the four
 * sensitive leaf fields masked. Returns a `not_started` session rather than a `404` before
 * the first step, so a client can always ask where to begin.
 */
export function fetchOnboardingSession(token: string): Promise<OnboardingSession> {
  return apiFetch<OnboardingSession>("/onboarding/session", { token });
}

/**
 * `POST /onboarding/submit` — freezes the session into the permanent KYC record and opens
 * the requested products. `404` if no session exists yet, `409` if a step is missing or the
 * identity document is already registered to another account.
 */
export function submitOnboardingApplication(token: string): Promise<OnboardingSubmitResult> {
  return apiFetch<OnboardingSubmitResult>("/onboarding/submit", { method: "POST", token });
}
