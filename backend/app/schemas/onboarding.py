"""Multi-step signup for a multi-asset platform: domestic stocks, foreign stocks,
crypto and exchange products.

Each step is its own model so a client can post one screen at a time and resume
later. `POST /onboarding/step` takes a discriminated union keyed on `step`, so a
single endpoint validates every screen with the exact rules that screen needs.
"""

import re
from datetime import date, datetime
from enum import Enum
from typing import Annotated, Any, Literal

from pydantic import (
    BaseModel,
    BeforeValidator,
    ConfigDict,
    Field,
    StringConstraints,
    model_validator,
)

from app.schemas.common import ErrorResponse

# --------------------------------------------------------------------------- #
# Reusable constrained types
# --------------------------------------------------------------------------- #

def _upper(value: Any) -> Any:
    """Normalise before the pattern runs — StringConstraints applies its own `to_upper`
    *after* matching, so a lowercase `in` would otherwise fail an `^[A-Z]{2}$` code.

    Order in the Annotated below matters twice over: the constraints must come first so
    the pattern stays part of the generated JSON schema (a validator wrapping them makes
    pydantic drop it from OpenAPI), and the BeforeValidator must come second so it ends
    up outermost and runs against the raw input.
    """
    return value.upper() if isinstance(value, str) else value


CountryCode = Annotated[
    str,
    StringConstraints(strip_whitespace=True, pattern=r"^[A-Z]{2}$"),
    BeforeValidator(_upper),
    Field(description="ISO 3166-1 alpha-2", examples=["IN"]),
]
UpperCode = Annotated[
    str,
    StringConstraints(strip_whitespace=True, pattern=r"^[A-Z0-9]{2,34}$"),
    BeforeValidator(_upper),
]
PersonName = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=64, pattern=r"^[^\d]+$")
]


# --------------------------------------------------------------------------- #
# Enums — every choice a client may send is closed, so an unknown value is a 422
# --------------------------------------------------------------------------- #


class OnboardingStep(str, Enum):
    contact = "contact"
    personal = "personal"
    address = "address"
    identity = "identity"
    tax = "tax"
    financial = "financial"
    markets = "markets"
    funding = "funding"
    security = "security"
    agreements = "agreements"


# The order is the funnel: a step is accepted only once its predecessors exist.
STEP_ORDER: tuple[OnboardingStep, ...] = tuple(OnboardingStep)


class OnboardingStatus(str, Enum):
    not_started = "not_started"
    in_progress = "in_progress"
    under_review = "under_review"
    approved = "approved"
    rejected = "rejected"


class KycTier(str, Enum):
    unverified = "unverified"  # signed up, nothing verified
    basic = "basic"            # identity document on file
    verified = "verified"      # full application submitted
    pro = "pro"               # derivatives approved by review


class Gender(str, Enum):
    male = "male"
    female = "female"
    other = "other"
    undisclosed = "undisclosed"


class DocumentType(str, Enum):
    passport = "passport"
    national_id = "national_id"
    drivers_licence = "drivers_licence"
    pan = "pan"
    aadhaar = "aadhaar"


class PepStatus(str, Enum):
    none = "none"
    self_ = "self"
    related = "related"


class SourceOfFunds(str, Enum):
    salary = "salary"
    business_income = "business_income"
    investments = "investments"
    savings = "savings"
    inheritance = "inheritance"
    crypto_trading = "crypto_trading"
    loan = "loan"
    other = "other"


class Occupation(str, Enum):
    salaried_private = "salaried_private"
    salaried_public = "salaried_public"
    government = "government"
    business_owner = "business_owner"
    professional = "professional"
    student = "student"
    retired = "retired"
    homemaker = "homemaker"
    unemployed = "unemployed"
    other = "other"


class MoneyBand(str, Enum):
    """Currency-neutral bands; the amount currency is declared alongside."""

    lt_25k = "lt_25k"
    b_25k_100k = "25k_100k"
    b_100k_500k = "100k_500k"
    b_500k_1m = "500k_1m"
    gt_1m = "gt_1m"


class RiskTolerance(str, Enum):
    low = "low"
    medium = "medium"
    high = "high"


class InvestmentObjective(str, Enum):
    capital_preservation = "capital_preservation"
    income = "income"
    long_term_growth = "long_term_growth"
    speculation = "speculation"
    hedging = "hedging"


class Product(str, Enum):
    domestic_equity_delivery = "domestic_equity_delivery"
    domestic_equity_intraday = "domestic_equity_intraday"
    domestic_derivatives = "domestic_derivatives"
    foreign_equity = "foreign_equity"
    mutual_funds = "mutual_funds"
    commodities = "commodities"
    forex = "forex"
    crypto_spot = "crypto_spot"
    crypto_derivatives = "crypto_derivatives"
    crypto_staking = "crypto_staking"


# Leveraged products need a suitability check before they can be requested.
LEVERAGED_PRODUCTS: frozenset[Product] = frozenset(
    {
        Product.domestic_derivatives,
        Product.domestic_equity_intraday,
        Product.commodities,
        Product.forex,
        Product.crypto_derivatives,
    }
)

# Products that only go live after a human review of the income proof.
REVIEW_GATED_PRODUCTS: frozenset[Product] = frozenset(
    {Product.domestic_derivatives, Product.commodities, Product.forex, Product.crypto_derivatives}
)


class Currency(str, Enum):
    INR = "INR"
    USD = "USD"
    EUR = "EUR"
    GBP = "GBP"
    AED = "AED"
    SGD = "SGD"


class AccountType(str, Enum):
    savings = "savings"
    current = "current"
    checking = "checking"


class RoutingType(str, Enum):
    ifsc = "ifsc"
    swift = "swift"
    iban = "iban"
    aba = "aba"
    sort_code = "sort_code"


# Each scheme has a fixed shape, so a typo is caught here rather than by a failed transfer.
ROUTING_PATTERNS: dict[RoutingType, tuple[str, str]] = {
    RoutingType.ifsc: (r"^[A-Z]{4}0[A-Z0-9]{6}$", "IFSC is 4 letters, a 0, then 6 alphanumerics"),
    RoutingType.swift: (r"^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$", "SWIFT/BIC is 8 or 11 characters"),
    RoutingType.iban: (r"^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$", "IBAN is a country code, 2 check digits, then the account"),
    RoutingType.aba: (r"^[0-9]{9}$", "ABA routing number is 9 digits"),
    RoutingType.sort_code: (r"^[0-9]{6}$", "Sort code is 6 digits"),
}


class FundingMethod(str, Enum):
    bank_transfer = "bank_transfer"
    upi = "upi"
    card = "card"
    crypto_deposit = "crypto_deposit"


class CryptoNetwork(str, Enum):
    bitcoin = "bitcoin"
    ethereum = "ethereum"
    tron = "tron"
    solana = "solana"
    bsc = "bsc"
    polygon = "polygon"


class TwoFactorMethod(str, Enum):
    totp = "totp"
    sms = "sms"
    email = "email"
    passkey = "passkey"


class AgreementDocument(str, Enum):
    terms_of_service = "terms_of_service"
    privacy_policy = "privacy_policy"
    tax_declaration = "tax_declaration"
    risk_disclosure_securities = "risk_disclosure_securities"
    risk_disclosure_derivatives = "risk_disclosure_derivatives"
    risk_disclosure_crypto = "risk_disclosure_crypto"
    cross_border_remittance = "cross_border_remittance"


# Consent is only meaningful if it covers the products the user asked for.
ALWAYS_REQUIRED_AGREEMENTS: frozenset[AgreementDocument] = frozenset(
    {
        AgreementDocument.terms_of_service,
        AgreementDocument.privacy_policy,
        AgreementDocument.tax_declaration,
    }
)

AGREEMENTS_BY_PRODUCT: dict[Product, frozenset[AgreementDocument]] = {
    Product.domestic_equity_delivery: frozenset({AgreementDocument.risk_disclosure_securities}),
    Product.domestic_equity_intraday: frozenset(
        {AgreementDocument.risk_disclosure_securities, AgreementDocument.risk_disclosure_derivatives}
    ),
    Product.domestic_derivatives: frozenset({AgreementDocument.risk_disclosure_derivatives}),
    Product.foreign_equity: frozenset(
        {AgreementDocument.risk_disclosure_securities, AgreementDocument.cross_border_remittance}
    ),
    Product.mutual_funds: frozenset({AgreementDocument.risk_disclosure_securities}),
    Product.commodities: frozenset({AgreementDocument.risk_disclosure_derivatives}),
    Product.forex: frozenset(
        {AgreementDocument.risk_disclosure_derivatives, AgreementDocument.cross_border_remittance}
    ),
    Product.crypto_spot: frozenset({AgreementDocument.risk_disclosure_crypto}),
    Product.crypto_derivatives: frozenset(
        {AgreementDocument.risk_disclosure_crypto, AgreementDocument.risk_disclosure_derivatives}
    ),
    Product.crypto_staking: frozenset({AgreementDocument.risk_disclosure_crypto}),
}


# --------------------------------------------------------------------------- #
# Shared sub-objects
# --------------------------------------------------------------------------- #


class _Strict(BaseModel):
    """Reject unknown keys everywhere, so a stray field is a 422 not a silent drop."""

    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")


class Address(_Strict):
    line1: str = Field(min_length=3, max_length=128)
    line2: str | None = Field(default=None, min_length=1, max_length=128)
    city: str = Field(min_length=1, max_length=64)
    state: str = Field(min_length=1, max_length=64)
    postal_code: str = Field(min_length=3, max_length=16, pattern=r"^[A-Za-z0-9][A-Za-z0-9 \-]{1,15}$")
    country: CountryCode


class BankAccount(_Strict):
    account_holder_name: str = Field(min_length=2, max_length=128)
    account_number: UpperCode = Field(examples=["50100123456789"])
    account_type: AccountType
    bank_name: str = Field(min_length=2, max_length=128)
    routing_type: RoutingType
    routing_code: UpperCode = Field(examples=["HDFC0001234"])
    currency: Currency

    @model_validator(mode="after")
    def _routing_shape(self) -> "BankAccount":
        pattern, hint = ROUTING_PATTERNS[self.routing_type]
        if not re.fullmatch(pattern, self.routing_code):
            raise ValueError(f"Invalid {self.routing_type.value} code — {hint}")
        return self


class AcceptedAgreement(_Strict):
    """Consent is stored per document *and* version — a reissued policy needs re-consent."""

    document: AgreementDocument
    version: str = Field(min_length=1, max_length=32, examples=["2026-01-15"])


# --------------------------------------------------------------------------- #
# Per-step request bodies
# --------------------------------------------------------------------------- #


class ContactStep(_Strict):
    step: Literal[OnboardingStep.contact]
    mobile_country_code: str = Field(pattern=r"^\+[1-9][0-9]{0,3}$", examples=["+91"])
    mobile_number: str = Field(pattern=r"^[0-9]{6,15}$", examples=["9876543210"])
    country_of_residence: CountryCode
    nationality: CountryCode


class PersonalStep(_Strict):
    step: Literal[OnboardingStep.personal]
    first_name: PersonName
    middle_name: PersonName | None = None
    last_name: PersonName
    date_of_birth: date
    gender: Gender
    place_of_birth_country: CountryCode

    @model_validator(mode="after")
    def _plausible_age(self) -> "PersonalStep":
        today = date.today()
        dob = self.date_of_birth
        age = today.year - dob.year - ((today.month, today.day) < (dob.month, dob.day))
        if age < 18:
            raise ValueError("Account holder must be at least 18 years old")
        if age > 100:
            raise ValueError("Date of birth is implausible")
        return self


class AddressStep(_Strict):
    step: Literal[OnboardingStep.address]
    residential: Address
    permanent_same_as_residential: bool = True
    permanent: Address | None = None

    @model_validator(mode="after")
    def _permanent_present(self) -> "AddressStep":
        if self.permanent_same_as_residential and self.permanent is not None:
            raise ValueError("Do not send `permanent` when it is the same as the residential address")
        if not self.permanent_same_as_residential and self.permanent is None:
            raise ValueError("`permanent` is required when it differs from the residential address")
        return self


# Formats are fixed per document, so a mistyped number never reaches the KYC vendor.
DOCUMENT_PATTERNS: dict[DocumentType, tuple[str, str]] = {
    DocumentType.pan: (r"^[A-Z]{5}[0-9]{4}[A-Z]$", "PAN is 5 letters, 4 digits, 1 letter"),
    DocumentType.aadhaar: (r"^[2-9][0-9]{11}$", "Aadhaar is 12 digits and cannot start with 0 or 1"),
    DocumentType.passport: (r"^[A-Z0-9]{6,12}$", "Passport number is 6-12 alphanumerics"),
    DocumentType.national_id: (r"^[A-Z0-9]{4,20}$", "National ID is 4-20 alphanumerics"),
    DocumentType.drivers_licence: (r"^[A-Z0-9]{6,20}$", "Licence number is 6-20 alphanumerics"),
}
# Documents that carry an expiry must have a future one; PAN/Aadhaar do not expire.
EXPIRING_DOCUMENTS: frozenset[DocumentType] = frozenset(
    {DocumentType.passport, DocumentType.drivers_licence}
)


class IdentityStep(_Strict):
    step: Literal[OnboardingStep.identity]
    document_type: DocumentType
    document_number: UpperCode
    issuing_country: CountryCode
    expiry_date: date | None = None

    @model_validator(mode="after")
    def _document_shape(self) -> "IdentityStep":
        pattern, hint = DOCUMENT_PATTERNS[self.document_type]
        if not re.fullmatch(pattern, self.document_number):
            raise ValueError(f"Invalid {self.document_type.value} number — {hint}")
        if self.document_type in EXPIRING_DOCUMENTS:
            if self.expiry_date is None:
                raise ValueError(f"`expiry_date` is required for a {self.document_type.value}")
            if self.expiry_date <= date.today():
                raise ValueError("Document has expired")
        elif self.expiry_date is not None:
            raise ValueError(f"A {self.document_type.value} does not carry an expiry date")
        return self


class TaxStep(_Strict):
    step: Literal[OnboardingStep.tax]
    tax_residency_country: CountryCode
    tax_identification_number: UpperCode | None = None
    no_tin_reason: str | None = Field(default=None, min_length=3, max_length=200)
    is_us_person: bool
    pep_status: PepStatus
    source_of_funds: SourceOfFunds
    source_of_funds_detail: str | None = Field(default=None, min_length=3, max_length=200)

    @model_validator(mode="after")
    def _tin_or_reason(self) -> "TaxStep":
        if self.tax_identification_number is None and not self.no_tin_reason:
            raise ValueError("Provide `tax_identification_number` or `no_tin_reason`")
        if self.tax_identification_number is not None and self.no_tin_reason:
            raise ValueError("Send either `tax_identification_number` or `no_tin_reason`, not both")
        if self.source_of_funds is SourceOfFunds.other and not self.source_of_funds_detail:
            raise ValueError("`source_of_funds_detail` is required when source_of_funds is `other`")
        return self


class FinancialStep(_Strict):
    step: Literal[OnboardingStep.financial]
    occupation: Occupation
    employer_designation : str | None = Field(default=None, min_length=2, max_length=128)
    income_currency: Currency
    annual_income_band: MoneyBand
    net_worth_band: MoneyBand
    investment_experience_years: int = Field(ge=0, le=70)
    risk_tolerance: RiskTolerance
    investment_objectives: list[InvestmentObjective] = Field(min_length=1, max_length=5)

    @model_validator(mode="after")
    def _consistent(self) -> "FinancialStep":
        if len(set(self.investment_objectives)) != len(self.investment_objectives):
            raise ValueError("`investment_objectives` must not repeat a value")
        employed = {Occupation.salaried_private, Occupation.salaried_public, Occupation.government}
        if self.occupation in employed and not self.employer_designation:
            raise ValueError("`employer_designation` is required for a salaried occupation")
        return self


class MarketsStep(_Strict):
    step: Literal[OnboardingStep.markets]
    products: list[Product] = Field(min_length=1, max_length=len(Product))
    base_currency: Currency

    @model_validator(mode="after")
    def _unique_products(self) -> "MarketsStep":
        if len(set(self.products)) != len(self.products):
            raise ValueError("`products` must not repeat a value")
        return self


class FundingStep(_Strict):
    step: Literal[OnboardingStep.funding]
    primary_method: FundingMethod
    bank_account: BankAccount | None = None
    crypto_deposit_networks: list[CryptoNetwork] = Field(default_factory=list, max_length=len(CryptoNetwork))

    @model_validator(mode="after")
    def _method_matches_instrument(self) -> "FundingStep":
        if self.primary_method is FundingMethod.crypto_deposit:
            if not self.crypto_deposit_networks:
                raise ValueError("Pick at least one network for crypto deposits")
        elif self.bank_account is None:
            raise ValueError(f"`bank_account` is required for {self.primary_method.value}")
        if len(set(self.crypto_deposit_networks)) != len(self.crypto_deposit_networks):
            raise ValueError("`crypto_deposit_networks` must not repeat a value")
        return self


class SecurityStep(_Strict):
    step: Literal[OnboardingStep.security]
    two_factor_method: TwoFactorMethod
    # Shown in every outbound email so a phishing copy is obvious.
    anti_phishing_code: str | None = Field(default=None, pattern=r"^[A-Za-z0-9]{4,20}$")
    withdrawal_whitelist_only: bool = True
    notify_on_new_device: bool = True


class AgreementsStep(_Strict):
    step: Literal[OnboardingStep.agreements]
    accepted: list[AcceptedAgreement] = Field(min_length=1, max_length=len(AgreementDocument))

    @model_validator(mode="after")
    def _unique_documents(self) -> "AgreementsStep":
        documents = [a.document for a in self.accepted]
        if len(set(documents)) != len(documents):
            raise ValueError("`accepted` must not list the same document twice")
        return self


StepPayload = Annotated[
    ContactStep
    | PersonalStep
    | AddressStep
    | IdentityStep
    | TaxStep
    | FinancialStep
    | MarketsStep
    | FundingStep
    | SecurityStep
    | AgreementsStep,
    Field(discriminator="step"),
]


# --------------------------------------------------------------------------- #
# Responses
# --------------------------------------------------------------------------- #


class OnboardingSessionResponse(BaseModel):
    """Server-side onboarding session — what has been captured and what is next."""

    uid: str
    status: OnboardingStatus
    kyc_tier: KycTier
    current_step: OnboardingStep | None = Field(
        default=None, description="Next step to submit; null once every step is captured"
    )
    completed_steps: list[OnboardingStep]
    remaining_steps: list[OnboardingStep]
    progress_percent: int = Field(ge=0, le=100)
    ready_to_submit: bool
    steps: dict[str, Any] = Field(
        default_factory=dict,
        description="Captured data per step. Identity, tax, mobile and bank numbers come back masked.",
    )
    created_at: datetime | None = None
    updated_at: datetime | None = None
    expires_at: datetime | None = Field(
        default=None, description="An in-progress session is dropped after this instant"
    )
    submitted_at: datetime | None = None


class OnboardingSubmitResponse(BaseModel):
    uid: str
    status: OnboardingStatus
    kyc_tier: KycTier
    enabled_products: list[Product] = Field(description="Live immediately")
    pending_products: list[Product] = Field(description="Held until income proof is reviewed")
    submitted_at: datetime


# 409 covers every state clash on this feature: wrong order, already submitted,
# missing steps at submit time, an ineligible product, or a document already used.
STEP_CONFLICT = {
    409: {
        "model": ErrorResponse,
        "description": "Step out of order, session already submitted, incomplete at submit, "
        "product not permitted for this profile, or document already registered",
    }
}
