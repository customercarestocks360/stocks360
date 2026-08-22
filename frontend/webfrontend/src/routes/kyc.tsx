import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useAuth } from "@/components/AuthProvider";
import { Confetti } from "@/components/ui/confetti";
import { ApiError } from "@/lib/api";
import { currentIdToken } from "@/lib/firebase";
import { adminAmendUserKyc, adminFetchUserDetail } from "@/lib/users-api";
import {
  ACCOUNT_TYPES,
  AGREEMENT_DOCUMENTS,
  AMENDABLE_STEPS,
  CRYPTO_NETWORKS,
  CURRENCIES,
  DOCUMENT_TYPES,
  EMPLOYED_OCCUPATIONS,
  EXPIRING_DOCUMENT_TYPES,
  FUNDING_METHODS,
  GENDERS,
  INVESTMENT_OBJECTIVES,
  MONEY_BANDS,
  OCCUPATIONS,
  ONBOARDING_STEP_LABELS,
  ONBOARDING_STEPS,
  PEP_STATUSES,
  PRODUCTS,
  ROUTING_TYPES,
  RISK_TOLERANCES,
  SOURCES_OF_FUNDS,
  TWO_FACTOR_METHODS,
  amendOnboardingStep,
  fetchOnboardingSession,
  submitOnboardingApplication,
  submitOnboardingStep,
  type AcceptedAgreement,
  type AddressStepInput,
  type AgreementDocument,
  type ContactStepInput,
  type FinancialStepInput,
  type FundingStepInput,
  type IdentityStepInput,
  type MarketsStepInput,
  type OnboardingSession,
  type OnboardingStep,
  type OnboardingStepInput,
  type PersonalStepInput,
  type PostalAddress,
  type RoutingType,
  type SecurityStepInput,
  type TaxStepInput,
} from "@/lib/onboarding-api";

function AuthPageShell({ children }: { children: ReactNode }) {
  return (
    <div className="h-dvh overflow-hidden bg-background text-foreground pt-safe pb-safe">
      <div className="relative flex h-full items-center justify-center overflow-hidden px-6 py-4">
        <div className="grid-bg absolute inset-0 opacity-40" />
        <div className="halo absolute inset-0" />
        {children}
      </div>
    </div>
  );
}

type KycSearch = { edit?: boolean; step?: OnboardingStep; uid?: string };

export const Route = createFileRoute("/kyc")({
  validateSearch: (search: Record<string, unknown>): KycSearch => {
    const step = ONBOARDING_STEPS.includes(search["step"] as OnboardingStep)
      ? (search["step"] as OnboardingStep)
      : undefined;
    const uid = typeof search["uid"] === "string" && search["uid"] ? search["uid"] : undefined;
    return {
      ...(search["edit"] === true ? { edit: true as const } : {}),
      ...(step ? { step } : {}),
      ...(uid ? { uid } : {}),
    };
  },
  head: () => ({
    meta: [
      { title: "Complete your KYC — Stocks360" },
      { name: "description", content: "Verify your identity to unlock deposits and trading." },
    ],
  }),
  component: KycPage,
});

const STEPS: { key: OnboardingStep; label: string }[] = ONBOARDING_STEPS.map((key) => ({
  key,
  label: ONBOARDING_STEP_LABELS[key],
}));

/**
 * Every one of these is required no matter which products are requested — sending them
 * all is always a superset of what `POST /onboarding/step` actually requires for the
 * chosen products, so it can never be rejected as incomplete. Not minimal, but always correct.
 */
const AGREEMENT_VERSION = "2026-01-15";
const AGREEMENT_LABELS: Record<AgreementDocument, string> = {
  terms_of_service: "Terms of Service",
  privacy_policy: "Privacy Policy",
  tax_declaration: "Tax Declaration",
  risk_disclosure_securities: "Risk Disclosure — Securities",
  cross_border_remittance: "Cross-Border Remittance",
  risk_disclosure_crypto: "Risk Disclosure — Crypto",
  risk_disclosure_derivatives: "Risk Disclosure — Derivatives",
};

const COUNTRIES = [
  { code: "IN", name: "India" },
  { code: "US", name: "United States" },
  { code: "GB", name: "United Kingdom" },
  { code: "AE", name: "UAE" },
  { code: "SG", name: "Singapore" },
];

const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

/** Mirrors `backend/app/schemas/onboarding.py` — sending something these reject is a
 * wasted round-trip that only the server would have caught, as a plain 422. */
const MOBILE_COUNTRY_CODE_REGEX = /^\+[1-9][0-9]{0,3}$/;

const DOCUMENT_NUMBER_PATTERNS: Record<
  (typeof DOCUMENT_TYPES)[number],
  { pattern: RegExp; hint: string }
> = {
  pan: { pattern: PAN_REGEX, hint: "Enter a valid PAN (e.g. ABCDE1234F)." },
  aadhaar: {
    pattern: /^[2-9][0-9]{11}$/,
    hint: "Aadhaar is 12 digits and can't start with 0 or 1.",
  },
  passport: { pattern: /^[A-Z0-9]{6,12}$/, hint: "Passport number is 6-12 letters/digits." },
  national_id: { pattern: /^[A-Z0-9]{4,20}$/, hint: "National ID is 4-20 letters/digits." },
  drivers_licence: { pattern: /^[A-Z0-9]{6,20}$/, hint: "Licence number is 6-20 letters/digits." },
};

const TIN_REGEX = /^[A-Z0-9]{2,34}$/;
const ACCOUNT_NUMBER_REGEX = /^[A-Z0-9]{2,34}$/;

const ROUTING_CODE_PATTERNS: Record<RoutingType, { pattern: RegExp; hint: string }> = {
  ifsc: {
    pattern: /^[A-Z]{4}0[A-Z0-9]{6}$/,
    hint: "IFSC is 4 letters, a 0, then 6 alphanumerics.",
  },
  swift: {
    pattern: /^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/,
    hint: "SWIFT/BIC is 8 or 11 characters.",
  },
  iban: {
    pattern: /^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$/,
    hint: "IBAN is a country code, 2 check digits, then the account.",
  },
  aba: { pattern: /^[0-9]{9}$/, hint: "ABA routing number is 9 digits." },
  sort_code: { pattern: /^[0-9]{6}$/, hint: "Sort code is 6 digits." },
};

const GENDER_LABELS: Record<(typeof GENDERS)[number], string> = {
  female: "Female",
  male: "Male",
  other: "Other",
  undisclosed: "Prefer not to say",
};

const DOCUMENT_TYPE_LABELS: Record<(typeof DOCUMENT_TYPES)[number], string> = {
  pan: "PAN",
  aadhaar: "Aadhaar",
  passport: "Passport",
  national_id: "National ID",
  drivers_licence: "Driver's licence",
};

const SOURCE_OF_FUNDS_LABELS: Record<(typeof SOURCES_OF_FUNDS)[number], string> = {
  salary: "Salary",
  business_income: "Business income",
  investments: "Investments",
  savings: "Savings",
  inheritance: "Inheritance",
  crypto_trading: "Crypto trading",
  loan: "Loan",
  other: "Other",
};

const OCCUPATION_LABELS: Record<(typeof OCCUPATIONS)[number], string> = {
  salaried_private: "Salaried — private sector",
  salaried_public: "Salaried — public sector",
  government: "Government employee",
  business_owner: "Business owner",
  professional: "Professional (doctor, lawyer, consultant, etc.)",
  student: "Student",
  retired: "Retired",
  homemaker: "Homemaker",
  unemployed: "Unemployed",
  other: "Other",
};

const MONEY_BAND_LABELS: Record<(typeof MONEY_BANDS)[number], string> = {
  lt_25k: "Under 25k",
  "25k_100k": "25k – 100k",
  "100k_500k": "100k – 500k",
  "500k_1m": "500k – 1M",
  gt_1m: "1M+",
};

const INVESTMENT_OBJECTIVE_LABELS: Record<(typeof INVESTMENT_OBJECTIVES)[number], string> = {
  long_term_growth: "Long-term growth",
  income: "Income",
  capital_preservation: "Capital preservation",
  speculation: "Speculation",
  hedging: "Hedging",
};

const PRODUCT_LABELS: Record<(typeof PRODUCTS)[number], string> = {
  domestic_equity_delivery: "Domestic equity (delivery)",
  domestic_equity_intraday: "Domestic equity (intraday)",
  domestic_derivatives: "Domestic derivatives",
  foreign_equity: "Foreign equity",
  mutual_funds: "Mutual funds",
  commodities: "Commodities",
  forex: "Forex",
  crypto_spot: "Crypto — spot",
  crypto_derivatives: "Crypto — derivatives",
  crypto_staking: "Crypto — staking",
};

const FUNDING_METHOD_LABELS: Record<(typeof FUNDING_METHODS)[number], string> = {
  bank_transfer: "Bank transfer",
  upi: "UPI",
  card: "Card",
  crypto_deposit: "Crypto deposit",
};

const CRYPTO_NETWORK_LABELS: Record<(typeof CRYPTO_NETWORKS)[number], string> = {
  bitcoin: "Bitcoin",
  ethereum: "Ethereum",
  tron: "Tron",
  solana: "Solana",
  bsc: "BNB Smart Chain",
  polygon: "Polygon",
};

const ACCOUNT_TYPE_LABELS: Record<(typeof ACCOUNT_TYPES)[number], string> = {
  savings: "Savings",
  current: "Current",
  checking: "Checking",
};

const ROUTING_TYPE_LABELS: Record<(typeof ROUTING_TYPES)[number], string> = {
  ifsc: "IFSC (India)",
  swift: "SWIFT / BIC",
  iban: "IBAN",
  aba: "ABA routing number (US)",
  sort_code: "Sort code (UK)",
};

const ROUTING_CODE_PLACEHOLDER: Record<(typeof ROUTING_TYPES)[number], string> = {
  ifsc: "HDFC0001234",
  swift: "HDFCINBB",
  iban: "GB29NWBK60161331926819",
  aba: "021000021",
  sort_code: "123456",
};

// Local form-state shapes differ from the `*StepInput` wire shapes on purpose: a field the
// backend accepts as *absent* (via `?:`) is instead always-present-but-possibly-`undefined`
// here, so an unset field can be cleared with `{ ...prev, field: undefined }` — which
// `exactOptionalPropertyTypes` forbids on an optional key but allows on a `T | undefined`
// one. `buildPayload()` is what turns "present but undefined" back into "absent" for the
// actual request.
type Contact = Omit<ContactStepInput, "step">;
type Personal = Omit<PersonalStepInput, "step">;
type AddressState = {
  residential: PostalAddress;
  permanent_same_as_residential: boolean;
  permanent: PostalAddress;
};
type Identity = {
  document_type: IdentityStepInput["document_type"];
  document_number: string;
  issuing_country: string;
  expiry_date: string | undefined;
};
type Tax = {
  tax_residency_country: string;
  tax_identification_number: string | undefined;
  no_tin_reason: string | undefined;
  is_us_person: boolean;
  pep_status: TaxStepInput["pep_status"];
  source_of_funds: TaxStepInput["source_of_funds"];
  source_of_funds_detail: string | undefined;
};
type Financial = Omit<FinancialStepInput, "step" | "employer_designation"> & {
  employer_designation: string | undefined;
};
type MarketsPrefs = Omit<MarketsStepInput, "step">;
type Funding = {
  primary_method: FundingStepInput["primary_method"];
  bank_account: NonNullable<FundingStepInput["bank_account"]>;
  crypto_deposit_networks: NonNullable<FundingStepInput["crypto_deposit_networks"]>;
};
type Security = Omit<SecurityStepInput, "step" | "anti_phishing_code"> & {
  anti_phishing_code: string | undefined;
};

const BLANK_ADDRESS: PostalAddress = {
  line1: "",
  city: "",
  state: "",
  postal_code: "",
  country: "IN",
};

function CountrySelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="mt-2 w-full rounded sm:rounded-xl border border-border bg-background/60 px-3 py-2.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40"
    >
      {COUNTRIES.map((c) => (
        <option key={c.code} value={c.code}>
          {c.name}
        </option>
      ))}
    </select>
  );
}

function CurrencySelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="mt-2 w-full rounded sm:rounded-xl border border-border bg-background/60 px-3 py-2.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40"
    >
      {CURRENCIES.map((c) => (
        <option key={c} value={c}>
          {c}
        </option>
      ))}
    </select>
  );
}

function BandSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="mt-2 w-full rounded sm:rounded-xl border border-border bg-background/60 px-3 py-2.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40"
    >
      {MONEY_BANDS.map((b) => (
        <option key={b} value={b}>
          {MONEY_BAND_LABELS[b]}
        </option>
      ))}
    </select>
  );
}

function CheckboxRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <label className="flex items-center gap-2 text-sm text-muted-foreground">
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        className="h-4 w-4 shrink-0 cursor-pointer rounded border-border accent-primary"
      />
      {label}
    </label>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string | undefined;
  children: ReactNode;
}) {
  return (
    <label className="block text-sm font-medium text-foreground">
      {label}
      {children}
      {hint && <span className="mt-1 block text-xs font-normal text-muted-foreground">{hint}</span>}
    </label>
  );
}

const inputClass =
  "mt-2 w-full rounded sm:rounded-xl border border-border bg-background/60 px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40";

function AddressFields({
  value,
  onChange,
}: {
  value: PostalAddress;
  onChange: (next: PostalAddress) => void;
}) {
  return (
    <div className="space-y-4">
      <Field label="Address line 1">
        <input
          value={value.line1}
          onChange={(e) => onChange({ ...value, line1: e.target.value })}
          className={inputClass}
        />
      </Field>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="City">
          <input
            value={value.city}
            onChange={(e) => onChange({ ...value, city: e.target.value })}
            className={inputClass}
          />
        </Field>
        <Field label="State">
          <input
            value={value.state}
            onChange={(e) => onChange({ ...value, state: e.target.value })}
            className={inputClass}
          />
        </Field>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Postal code">
          <input
            value={value.postal_code}
            onChange={(e) => onChange({ ...value, postal_code: e.target.value })}
            className={inputClass}
          />
        </Field>
        <Field label="Country">
          <CountrySelect
            value={value.country}
            onChange={(v) => onChange({ ...value, country: v })}
          />
        </Field>
      </div>
    </div>
  );
}

/** Fields the backend returns masked once captured — never safe to resubmit verbatim. */
const MASKED_FIELD_HINT =
  "Already saved — leave blank unless you want to change it, then re-enter the new value.";

function KycPage() {
  const navigate = useNavigate();
  const { isLoggedIn, onboardingStatus, refreshProfile } = useAuth();
  const { edit, step: targetStep, uid: adminUid } = Route.useSearch();

  /** Editing one section of an already-submitted application, entered from account.tsx's
   * "Edit" button on a KYC recap group — as opposed to the ordered signup funnel below.
   * `adminUid` set means this same edit form is correcting someone else's application from
   * the admin panel, via `PATCH /admin/users/{uid}/kyc` instead of `PATCH /onboarding/kyc`. */
  const isEditMode =
    edit === true && targetStep !== undefined && AMENDABLE_STEPS.includes(targetStep);

  const [loadingSession, setLoadingSession] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [completedSteps, setCompletedSteps] = useState<Set<OnboardingStep>>(new Set());
  const [readyToSubmit, setReadyToSubmit] = useState(false);
  const [alreadySubmitted, setAlreadySubmitted] = useState(false);

  const [stepIndex, setStepIndex] = useState(() =>
    isEditMode
      ? Math.max(
          0,
          STEPS.findIndex((s) => s.key === targetStep),
        )
      : 0,
  );
  const [error, setError] = useState("");
  const [celebrate, setCelebrate] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const currentStepKey = STEPS[stepIndex]?.key ?? "contact";

  const [contact, setContact] = useState<Contact>({
    mobile_country_code: "+91",
    mobile_number: "",
    country_of_residence: "IN",
    nationality: "IN",
  });
  const [personal, setPersonal] = useState<Personal>({
    first_name: "",
    last_name: "",
    date_of_birth: "",
    gender: "female",
    place_of_birth_country: "IN",
  });
  const [address, setAddress] = useState<AddressState>({
    residential: BLANK_ADDRESS,
    permanent_same_as_residential: true,
    permanent: BLANK_ADDRESS,
  });
  const [identity, setIdentity] = useState<Identity>({
    document_type: "pan",
    document_number: "",
    issuing_country: "IN",
    expiry_date: undefined,
  });
  const [tax, setTax] = useState<Tax>({
    tax_residency_country: "IN",
    tax_identification_number: "",
    no_tin_reason: "",
    is_us_person: false,
    pep_status: "none",
    source_of_funds: "salary",
    source_of_funds_detail: "",
  });
  const [financial, setFinancial] = useState<Financial>({
    occupation: "salaried_private",
    employer_designation: "",
    income_currency: "INR",
    annual_income_band: "100k_500k",
    net_worth_band: "100k_500k",
    investment_experience_years: 0,
    risk_tolerance: "medium",
    investment_objectives: [],
  });
  const [marketsPrefs, setMarketsPrefs] = useState<MarketsPrefs>({
    products: [],
    base_currency: "INR",
  });
  const [funding, setFunding] = useState<Funding>({
    primary_method: "bank_transfer",
    bank_account: {
      account_holder_name: "",
      account_number: "",
      account_type: "savings",
      bank_name: "",
      routing_type: "ifsc",
      routing_code: "",
      currency: "INR",
    },
    crypto_deposit_networks: [],
  });
  const [security, setSecurity] = useState<Security>({
    two_factor_method: "email",
    anti_phishing_code: "",
    withdrawal_whitelist_only: true,
    notify_on_new_device: true,
  });
  const [acceptedDocs, setAcceptedDocs] = useState<Set<AgreementDocument>>(new Set());

  const toggleInArray = <T,>(arr: T[], value: T): T[] =>
    arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value];

  const hydrateFromSession = useCallback(
    (session: OnboardingSession) => {
      setCompletedSteps(new Set(session.completed_steps));
      setReadyToSubmit(session.ready_to_submit);
      setAlreadySubmitted(session.submitted_at !== null);
      // A submitted session normally has nothing left to hydrate into — the funnel below is
      // never shown once `alreadySubmitted` gates it. Edit mode is the one case that reaches
      // the wizard anyway, and needs the captured fields prefilled to correct them.
      if (session.submitted_at !== null && !isEditMode) return;

      const data = <T,>(step: OnboardingStep): (Partial<T> & Record<string, unknown>) | undefined =>
        session.steps[step]?.data as (Partial<T> & Record<string, unknown>) | undefined;

      const c = data<ContactStepInput>("contact");
      if (c) {
        setContact((prev) => ({
          ...prev,
          mobile_country_code: (c.mobile_country_code as string) ?? prev.mobile_country_code,
          // Masked once captured — leave blank so an untouched resubmit can never send "**1234".
          mobile_number: "",
          country_of_residence: (c.country_of_residence as string) ?? prev.country_of_residence,
          nationality: (c.nationality as string) ?? prev.nationality,
        }));
      }
      const p = data<PersonalStepInput>("personal");
      if (p) {
        setPersonal((prev) => ({
          ...prev,
          first_name: (p.first_name as string) ?? prev.first_name,
          last_name: (p.last_name as string) ?? prev.last_name,
          date_of_birth: (p.date_of_birth as string) ?? prev.date_of_birth,
          gender: (p.gender as Personal["gender"]) ?? prev.gender,
          place_of_birth_country:
            (p.place_of_birth_country as string) ?? prev.place_of_birth_country,
        }));
      }
      const a = data<AddressStepInput>("address");
      if (a) {
        setAddress((prev) => ({
          residential: (a.residential as PostalAddress) ?? prev.residential,
          permanent_same_as_residential:
            (a.permanent_same_as_residential as boolean) ?? prev.permanent_same_as_residential,
          permanent: (a.permanent as PostalAddress) ?? prev.permanent,
        }));
      }
      const id = data<IdentityStepInput>("identity");
      if (id) {
        setIdentity((prev) => ({
          document_type: (id.document_type as Identity["document_type"]) ?? prev.document_type,
          document_number: "", // masked once captured
          issuing_country: (id.issuing_country as string) ?? prev.issuing_country,
          expiry_date: id.expiry_date as string | undefined,
        }));
      }
      const t = data<TaxStepInput>("tax");
      if (t) {
        setTax((prev) => ({
          tax_residency_country: (t.tax_residency_country as string) ?? prev.tax_residency_country,
          tax_identification_number: "", // masked once captured
          no_tin_reason: (t.no_tin_reason as string) ?? "",
          is_us_person: (t.is_us_person as boolean) ?? prev.is_us_person,
          pep_status: (t.pep_status as Tax["pep_status"]) ?? prev.pep_status,
          source_of_funds: (t.source_of_funds as Tax["source_of_funds"]) ?? prev.source_of_funds,
          source_of_funds_detail: (t.source_of_funds_detail as string) ?? "",
        }));
      }
      const f = data<FinancialStepInput>("financial");
      if (f) {
        setFinancial((prev) => ({
          occupation: (f.occupation as Financial["occupation"]) ?? prev.occupation,
          employer_designation: (f.employer_designation as string) ?? "",
          income_currency:
            (f.income_currency as Financial["income_currency"]) ?? prev.income_currency,
          annual_income_band:
            (f.annual_income_band as Financial["annual_income_band"]) ?? prev.annual_income_band,
          net_worth_band: (f.net_worth_band as Financial["net_worth_band"]) ?? prev.net_worth_band,
          investment_experience_years:
            (f.investment_experience_years as number) ?? prev.investment_experience_years,
          risk_tolerance: (f.risk_tolerance as Financial["risk_tolerance"]) ?? prev.risk_tolerance,
          investment_objectives:
            (f.investment_objectives as Financial["investment_objectives"]) ??
            prev.investment_objectives,
        }));
      }
      const m = data<MarketsStepInput>("markets");
      if (m) {
        setMarketsPrefs((prev) => ({
          products: (m.products as MarketsPrefs["products"]) ?? prev.products,
          base_currency: (m.base_currency as MarketsPrefs["base_currency"]) ?? prev.base_currency,
        }));
      }
      const fund = data<FundingStepInput>("funding");
      if (fund) {
        setFunding((prev) => ({
          primary_method: (fund.primary_method as Funding["primary_method"]) ?? prev.primary_method,
          bank_account: fund.bank_account
            ? {
                ...(fund.bank_account as NonNullable<FundingStepInput["bank_account"]>),
                account_number: "",
              }
            : prev.bank_account,
          crypto_deposit_networks:
            (fund.crypto_deposit_networks as Funding["crypto_deposit_networks"]) ??
            prev.crypto_deposit_networks,
        }));
      }
      const sec = data<SecurityStepInput>("security");
      if (sec) {
        setSecurity((prev) => ({
          two_factor_method:
            (sec.two_factor_method as Security["two_factor_method"]) ?? prev.two_factor_method,
          anti_phishing_code: (sec.anti_phishing_code as string) ?? prev.anti_phishing_code,
          withdrawal_whitelist_only:
            (sec.withdrawal_whitelist_only as boolean) ?? prev.withdrawal_whitelist_only,
          notify_on_new_device: (sec.notify_on_new_device as boolean) ?? prev.notify_on_new_device,
        }));
      }
      const ag = data<{ accepted: AcceptedAgreement[] }>("agreements");
      if (ag?.accepted) setAcceptedDocs(new Set(ag.accepted.map((d) => d.document)));

      // Edit mode targets one specific step from the URL — resuming the funnel's own
      // current_step would jump away from it (a submitted session has none left, which
      // resolves to the last step).
      if (isEditMode) return;
      const idx = session.current_step
        ? STEPS.findIndex((s) => s.key === session.current_step)
        : STEPS.length - 1;
      setStepIndex(Math.max(0, idx));
    },
    [isEditMode],
  );

  // --- Resume: hydrate every step's local state from the server session, once. ---------
  useEffect(() => {
    if (!isLoggedIn) return;
    let cancelled = false;
    void (async () => {
      setLoadingSession(true);
      setLoadError("");
      try {
        const token = await currentIdToken();
        const session = adminUid
          ? (await adminFetchUserDetail(adminUid, token)).kyc
          : await fetchOnboardingSession(token);
        if (cancelled) return;
        hydrateFromSession(session);
      } catch (err) {
        if (cancelled) return;
        setLoadError(
          err instanceof ApiError
            ? err.message
            : "Could not load this application. Please try again.",
        );
      } finally {
        if (!cancelled) setLoadingSession(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [adminUid, hydrateFromSession, isLoggedIn]);

  if (!isLoggedIn) {
    return (
      <AuthPageShell>
        <div className="relative w-full max-w-md rounded sm:rounded-3xl border border-border bg-card/80 p-8 text-center shadow-2xl backdrop-blur-xl">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-secondary text-primary">
            <i className="fa-solid fa-lock text-lg" />
          </div>
          <h1 className="mt-4 text-xl font-bold text-foreground">Sign in required</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            You need to sign in before completing your KYC verification.
          </p>
          <Link
            to="/login"
            className="mt-6 inline-block rounded sm:rounded-xl bg-primary px-5 py-2.5 text-sm font-bold uppercase tracking-wider text-primary-foreground transition-opacity hover:opacity-90"
          >
            Go to sign in
          </Link>
        </div>
      </AuthPageShell>
    );
  }

  if (loadingSession) {
    return (
      <AuthPageShell>
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <i className="fa-solid fa-circle-notch fa-spin" />
          Loading your application…
        </div>
      </AuthPageShell>
    );
  }

  if (loadError) {
    return (
      <AuthPageShell>
        <div className="relative w-full max-w-md rounded sm:rounded-3xl border border-border bg-card/80 p-8 text-center shadow-2xl backdrop-blur-xl">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <i className="fa-solid fa-triangle-exclamation text-lg" />
          </div>
          <h1 className="mt-4 text-xl font-bold text-foreground">
            Could not load your application
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">{loadError}</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-6 inline-block rounded sm:rounded-xl bg-primary px-5 py-2.5 text-sm font-bold uppercase tracking-wider text-primary-foreground transition-opacity hover:opacity-90"
          >
            Try again
          </button>
        </div>
      </AuthPageShell>
    );
  }

  if (alreadySubmitted && !celebrate && !isEditMode) {
    return (
      <AuthPageShell>
        <div className="relative w-full max-w-md rounded sm:rounded-3xl border border-border bg-card/80 p-8 text-center shadow-2xl backdrop-blur-xl">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-up/10 text-up">
            <i className="fa-solid fa-check text-lg" />
          </div>
          <h1 className="mt-4 text-xl font-bold text-foreground">Application already submitted</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            {onboardingStatus === "approved"
              ? "Your KYC application has been approved. Head to your account to see what's enabled."
              : onboardingStatus === "rejected"
                ? "Your KYC application was not approved. Contact support for details."
                : "Your KYC application is on file and under review."}
          </p>
          <Link
            to="/account"
            search={{ tab: "account" }}
            className="mt-6 inline-block rounded sm:rounded-xl bg-primary px-5 py-2.5 text-sm font-bold uppercase tracking-wider text-primary-foreground transition-opacity hover:opacity-90"
          >
            Go to account
          </Link>
        </div>
      </AuthPageShell>
    );
  }

  const validateStep = (): string => {
    if (currentStepKey === "contact") {
      if (!MOBILE_COUNTRY_CODE_REGEX.test(contact.mobile_country_code))
        return "Enter a valid country code (e.g. +91).";
      if (!/^\d{6,15}$/.test(contact.mobile_number)) return "Enter a valid mobile number.";
    }
    if (currentStepKey === "personal") {
      if (!personal.first_name.trim() || !personal.last_name.trim())
        return "First and last name are required.";
      if (!personal.date_of_birth) return "Date of birth is required.";
      const age =
        (Date.now() - new Date(personal.date_of_birth).getTime()) / (365.25 * 24 * 3600 * 1000);
      if (age < 18) return "You must be at least 18 years old.";
    }
    if (currentStepKey === "address") {
      const r = address.residential;
      if (!r.line1.trim() || !r.city.trim() || !r.state.trim() || !r.postal_code.trim())
        return "Please complete your residential address.";
      if (r.country === "IN" && !/^\d{6}$/.test(r.postal_code))
        return "Enter a valid 6-digit postal code.";
      if (!address.permanent_same_as_residential) {
        const perm = address.permanent;
        if (
          !perm.line1.trim() ||
          !perm.city.trim() ||
          !perm.state.trim() ||
          !perm.postal_code.trim()
        )
          return "Please complete your permanent address, or mark it the same as residential.";
      }
    }
    if (currentStepKey === "identity") {
      if (!identity.document_number.trim()) return "Document number is required.";
      const docCheck = DOCUMENT_NUMBER_PATTERNS[identity.document_type];
      if (!docCheck.pattern.test(identity.document_number.toUpperCase())) return docCheck.hint;
      if (EXPIRING_DOCUMENT_TYPES.includes(identity.document_type) && !identity.expiry_date)
        return "Enter the document's expiry date.";
    }
    if (currentStepKey === "tax") {
      if (!tax.tax_identification_number?.trim() && !tax.no_tin_reason?.trim())
        return "Enter your tax ID, or explain why you don't have one.";
      if (
        tax.tax_identification_number?.trim() &&
        !TIN_REGEX.test(tax.tax_identification_number.toUpperCase())
      )
        return "Tax ID must be 2-34 letters/digits.";
      if (tax.source_of_funds === "other" && !tax.source_of_funds_detail?.trim())
        return "Describe your source of funds.";
    }
    if (currentStepKey === "financial") {
      if (
        EMPLOYED_OCCUPATIONS.includes(financial.occupation) &&
        !financial.employer_designation?.trim()
      )
        return "Employer designation is required.";
      if (financial.investment_experience_years < 0)
        return "Investment experience can't be negative.";
      if (financial.investment_objectives.length === 0)
        return "Pick at least one investment objective.";
    }
    if (currentStepKey === "markets") {
      if (marketsPrefs.products.length === 0) return "Pick at least one product you'll trade.";
    }
    if (currentStepKey === "funding") {
      if (funding.primary_method === "crypto_deposit") {
        if (funding.crypto_deposit_networks.length === 0)
          return "Pick at least one network for crypto deposits.";
      } else {
        const b = funding.bank_account;
        if (
          !b.account_holder_name.trim() ||
          !b.account_number.trim() ||
          !b.bank_name.trim() ||
          !b.routing_code.trim()
        )
          return "Please complete your bank account details.";
        if (!ACCOUNT_NUMBER_REGEX.test(b.account_number.toUpperCase()))
          return "Account number must be 2-34 letters/digits.";
        const routingCheck = ROUTING_CODE_PATTERNS[b.routing_type];
        if (!routingCheck.pattern.test(b.routing_code.toUpperCase())) return routingCheck.hint;
      }
    }
    if (currentStepKey === "security") {
      if (!security.anti_phishing_code?.trim()) return "Set an anti-phishing code.";
    }
    if (currentStepKey === "agreements") {
      if (acceptedDocs.size < AGREEMENT_DOCUMENTS.length)
        return "Please accept all agreements to continue.";
    }
    return "";
  };

  const buildPayload = (): OnboardingStepInput => {
    switch (currentStepKey) {
      case "contact":
        return { step: "contact", ...contact };
      case "personal":
        return { step: "personal", ...personal };
      case "address":
        return {
          step: "address",
          residential: address.residential,
          permanent_same_as_residential: address.permanent_same_as_residential,
          ...(address.permanent_same_as_residential ? {} : { permanent: address.permanent }),
        };
      case "identity":
        return {
          step: "identity",
          document_type: identity.document_type,
          document_number: identity.document_number.toUpperCase(),
          issuing_country: identity.issuing_country,
          ...(EXPIRING_DOCUMENT_TYPES.includes(identity.document_type) && identity.expiry_date
            ? { expiry_date: identity.expiry_date }
            : {}),
        };
      case "tax":
        return {
          step: "tax",
          tax_residency_country: tax.tax_residency_country,
          ...(tax.tax_identification_number?.trim()
            ? { tax_identification_number: tax.tax_identification_number.toUpperCase() }
            : tax.no_tin_reason?.trim()
              ? { no_tin_reason: tax.no_tin_reason }
              : {}),
          is_us_person: tax.is_us_person,
          pep_status: tax.pep_status,
          source_of_funds: tax.source_of_funds,
          ...(tax.source_of_funds === "other" && tax.source_of_funds_detail?.trim()
            ? { source_of_funds_detail: tax.source_of_funds_detail }
            : {}),
        };
      case "financial":
        return {
          step: "financial",
          occupation: financial.occupation,
          ...(EMPLOYED_OCCUPATIONS.includes(financial.occupation) &&
          financial.employer_designation?.trim()
            ? { employer_designation: financial.employer_designation }
            : {}),
          income_currency: financial.income_currency,
          annual_income_band: financial.annual_income_band,
          net_worth_band: financial.net_worth_band,
          investment_experience_years: financial.investment_experience_years,
          risk_tolerance: financial.risk_tolerance,
          investment_objectives: financial.investment_objectives,
        };
      case "markets":
        return {
          step: "markets",
          products: marketsPrefs.products,
          base_currency: marketsPrefs.base_currency,
        };
      case "funding":
        return {
          step: "funding",
          primary_method: funding.primary_method,
          ...(funding.primary_method === "crypto_deposit"
            ? { crypto_deposit_networks: funding.crypto_deposit_networks }
            : { bank_account: funding.bank_account }),
        };
      case "security":
        return {
          step: "security",
          two_factor_method: security.two_factor_method,
          ...(security.anti_phishing_code?.trim()
            ? { anti_phishing_code: security.anti_phishing_code }
            : {}),
          withdrawal_whitelist_only: security.withdrawal_whitelist_only,
          notify_on_new_device: security.notify_on_new_device,
        };
      case "agreements":
        return {
          step: "agreements",
          accepted: Array.from(acceptedDocs).map((document) => ({
            document,
            version: AGREEMENT_VERSION,
          })),
        };
    }
  };

  const handleContinue = async () => {
    const msg = validateStep();
    if (msg) {
      setError(msg);
      return;
    }
    setError("");
    setSubmitting(true);
    try {
      const token = await currentIdToken();

      if (isEditMode) {
        if (adminUid) {
          await adminAmendUserKyc(adminUid, buildPayload(), token);
          void navigate({ to: "/admin" });
        } else {
          await amendOnboardingStep(buildPayload(), token);
          void navigate({ to: "/account", search: { tab: "account" } });
        }
        return;
      }

      const session = await submitOnboardingStep(buildPayload(), token);
      setCompletedSteps(new Set(session.completed_steps));
      setReadyToSubmit(session.ready_to_submit);

      if (session.ready_to_submit) {
        const result = await submitOnboardingApplication(token);
        await refreshProfile();
        setAlreadySubmitted(true);
        setCelebrate(true);
        void result; // enabled/pending products are read back from the refreshed profile
        return;
      }

      const idx = session.current_step
        ? STEPS.findIndex((s) => s.key === session.current_step)
        : stepIndex + 1;
      setStepIndex(Math.min(STEPS.length - 1, Math.max(idx, 0)));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleBack = () => {
    setError("");
    setStepIndex((i) => Math.max(0, i - 1));
  };

  const stepAlreadyCaptured = completedSteps.has(currentStepKey);

  return (
    <div className="h-dvh overflow-y-auto bg-background text-foreground pt-safe">
      {celebrate && <Confetti />}
      <div className="grid-bg fixed inset-0 -z-10 opacity-40" />

      <div className="relative mx-auto max-w-2xl px-4 py-10 sm:px-6 sm:py-16">
        {celebrate ? (
          <div className="rounded sm:rounded-3xl border border-border bg-card p-10 text-center shadow-2xl">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-up/10 text-up">
              <i className="fa-solid fa-party-horn text-2xl" />
            </div>
            <h1 className="mt-5 text-2xl font-bold text-foreground">You're verified! </h1>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              Congrats — your KYC application has been submitted and is under review. Non-leveraged
              products are live now; anything leveraged waits on your income proof.
            </p>
            <Link
              to="/"
              className="mt-7 inline-block rounded sm:rounded-xl bg-primary px-6 py-3 text-sm font-bold uppercase tracking-wider text-primary-foreground transition-opacity hover:opacity-90"
            >
              Go to dashboard
            </Link>
          </div>
        ) : (
          <>
            <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
              {isEditMode
                ? `Edit ${ONBOARDING_STEP_LABELS[currentStepKey]}`
                : "Complete your remaining details"}
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {isEditMode
                ? "Correct this section of your account details."
                : "A few quick steps to verify your identity before you can deposit and trade."}
            </p>

            {/* ── Horizontal step indicator ── */}
            {!isEditMode && (
              <div className="mt-8 flex items-center">
                {STEPS.map((step, i) => (
                  <div key={step.key} className="flex flex-1 items-center last:flex-none">
                    <div className="flex flex-col items-center gap-2">
                      <div
                        className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold transition-colors ${
                          i < stepIndex || completedSteps.has(step.key)
                            ? "bg-up text-white"
                            : i === stepIndex
                              ? "bg-primary text-primary-foreground"
                              : "border border-border bg-background text-muted-foreground"
                        }`}
                      >
                        {i < stepIndex || completedSteps.has(step.key) ? (
                          <i className="fa-solid fa-check text-[11px]" />
                        ) : (
                          i + 1
                        )}
                      </div>
                      <span
                        className={`text-[11px] font-medium ${
                          i <= stepIndex ? "text-foreground" : "text-muted-foreground"
                        }`}
                      >
                        {step.label}
                      </span>
                    </div>
                    {i < STEPS.length - 1 && (
                      <div className="mx-2 h-0.5 flex-1 rounded-full bg-border">
                        <div
                          className="h-0.5 rounded-full bg-up transition-all duration-500"
                          style={{ width: i < stepIndex ? "100%" : "0%" }}
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* ── Step content ── */}
            <div className="mt-10 rounded sm:rounded-3xl border border-border bg-card p-4 shadow-sm sm:p-7">
              {currentStepKey === "contact" && (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <Field label="Country code">
                      <input
                        value={contact.mobile_country_code}
                        onChange={(e) => {
                          const digits = e.target.value.replace(/\D/g, "").slice(0, 4);
                          setContact({
                            ...contact,
                            mobile_country_code: digits ? `+${digits}` : "",
                          });
                        }}
                        placeholder="+91"
                        className={inputClass}
                      />
                    </Field>
                    <div className="col-span-2">
                      <Field
                        label="Mobile number"
                        hint={stepAlreadyCaptured ? MASKED_FIELD_HINT : undefined}
                      >
                        <input
                          value={contact.mobile_number}
                          onChange={(e) =>
                            setContact({
                              ...contact,
                              mobile_number: e.target.value.replace(/\D/g, ""),
                            })
                          }
                          placeholder="9876543210"
                          className={inputClass}
                        />
                      </Field>
                    </div>
                  </div>
                  <Field label="Country of residence">
                    <CountrySelect
                      value={contact.country_of_residence}
                      onChange={(v) => setContact({ ...contact, country_of_residence: v })}
                    />
                  </Field>
                  <Field label="Nationality">
                    <CountrySelect
                      value={contact.nationality}
                      onChange={(v) => setContact({ ...contact, nationality: v })}
                    />
                  </Field>
                </div>
              )}

              {currentStepKey === "personal" && (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <Field label="First name">
                      <input
                        value={personal.first_name}
                        onChange={(e) => setPersonal({ ...personal, first_name: e.target.value })}
                        className={inputClass}
                      />
                    </Field>
                    <Field label="Last name">
                      <input
                        value={personal.last_name}
                        onChange={(e) => setPersonal({ ...personal, last_name: e.target.value })}
                        className={inputClass}
                      />
                    </Field>
                  </div>
                  <Field label="Date of birth">
                    <input
                      type="date"
                      value={personal.date_of_birth}
                      onChange={(e) => setPersonal({ ...personal, date_of_birth: e.target.value })}
                      className={inputClass}
                    />
                  </Field>
                  <Field label="Gender">
                    <select
                      value={personal.gender}
                      onChange={(e) =>
                        setPersonal({ ...personal, gender: e.target.value as Personal["gender"] })
                      }
                      className={inputClass}
                    >
                      {GENDERS.map((g) => (
                        <option key={g} value={g}>
                          {GENDER_LABELS[g]}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Place of birth (country)">
                    <CountrySelect
                      value={personal.place_of_birth_country}
                      onChange={(v) => setPersonal({ ...personal, place_of_birth_country: v })}
                    />
                  </Field>
                </div>
              )}

              {currentStepKey === "address" && (
                <div className="space-y-5">
                  <div>
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Residential address
                    </h3>
                    <div className="mt-3">
                      <AddressFields
                        value={address.residential}
                        onChange={(residential) => setAddress({ ...address, residential })}
                      />
                    </div>
                  </div>
                  <label className="flex items-center gap-2 text-sm text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={address.permanent_same_as_residential}
                      onChange={(e) =>
                        setAddress({ ...address, permanent_same_as_residential: e.target.checked })
                      }
                      className="h-4 w-4 shrink-0 cursor-pointer rounded border-border accent-primary"
                    />
                    Permanent address is the same as residential
                  </label>
                  {!address.permanent_same_as_residential && (
                    <div>
                      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Permanent address
                      </h3>
                      <div className="mt-3">
                        <AddressFields
                          value={address.permanent}
                          onChange={(permanent) => setAddress({ ...address, permanent })}
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}

              {currentStepKey === "identity" && (
                <div className="space-y-4">
                  <Field label="Document type">
                    <select
                      value={identity.document_type}
                      onChange={(e) =>
                        setIdentity({
                          ...identity,
                          document_type: e.target.value as Identity["document_type"],
                          expiry_date: undefined,
                        })
                      }
                      className={inputClass}
                    >
                      {DOCUMENT_TYPES.map((d) => (
                        <option key={d} value={d}>
                          {DOCUMENT_TYPE_LABELS[d]}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field
                    label="Document number"
                    hint={stepAlreadyCaptured ? MASKED_FIELD_HINT : undefined}
                  >
                    <input
                      value={identity.document_number}
                      onChange={(e) =>
                        setIdentity({ ...identity, document_number: e.target.value.toUpperCase() })
                      }
                      placeholder={
                        identity.document_type === "pan" ? "ABCDE1234F" : "Document number"
                      }
                      className={inputClass}
                    />
                  </Field>
                  <Field label="Issuing country">
                    <CountrySelect
                      value={identity.issuing_country}
                      onChange={(v) => setIdentity({ ...identity, issuing_country: v })}
                    />
                  </Field>
                  {EXPIRING_DOCUMENT_TYPES.includes(identity.document_type) && (
                    <Field label="Expiry date">
                      <input
                        type="date"
                        value={identity.expiry_date ?? ""}
                        onChange={(e) => setIdentity({ ...identity, expiry_date: e.target.value })}
                        className={inputClass}
                      />
                    </Field>
                  )}
                </div>
              )}

              {currentStepKey === "tax" && (
                <div className="space-y-4">
                  <Field label="Tax residency country">
                    <CountrySelect
                      value={tax.tax_residency_country}
                      onChange={(v) => setTax({ ...tax, tax_residency_country: v })}
                    />
                  </Field>
                  <Field
                    label="Tax identification number"
                    hint={
                      stepAlreadyCaptured ? MASKED_FIELD_HINT : "Leave blank if you don't have one."
                    }
                  >
                    <input
                      value={tax.tax_identification_number ?? ""}
                      onChange={(e) =>
                        setTax({ ...tax, tax_identification_number: e.target.value.toUpperCase() })
                      }
                      placeholder="Leave blank if not applicable"
                      className={inputClass}
                    />
                  </Field>
                  {!tax.tax_identification_number?.trim() && (
                    <Field label="Why don't you have a tax ID?">
                      <input
                        value={tax.no_tin_reason ?? ""}
                        onChange={(e) => setTax({ ...tax, no_tin_reason: e.target.value })}
                        placeholder="e.g. Not required in my country of residence"
                        className={inputClass}
                      />
                    </Field>
                  )}
                  <Field label="Source of funds">
                    <select
                      value={tax.source_of_funds}
                      onChange={(e) =>
                        setTax({
                          ...tax,
                          source_of_funds: e.target.value as Tax["source_of_funds"],
                        })
                      }
                      className={inputClass}
                    >
                      {SOURCES_OF_FUNDS.map((s) => (
                        <option key={s} value={s}>
                          {SOURCE_OF_FUNDS_LABELS[s]}
                        </option>
                      ))}
                    </select>
                  </Field>
                  {tax.source_of_funds === "other" && (
                    <Field label="Describe your source of funds">
                      <input
                        value={tax.source_of_funds_detail ?? ""}
                        onChange={(e) => setTax({ ...tax, source_of_funds_detail: e.target.value })}
                        className={inputClass}
                      />
                    </Field>
                  )}
                  <Field label="Politically exposed person (PEP) status">
                    <select
                      value={tax.pep_status}
                      onChange={(e) =>
                        setTax({ ...tax, pep_status: e.target.value as Tax["pep_status"] })
                      }
                      className={inputClass}
                    >
                      {PEP_STATUSES.map((p) => (
                        <option key={p} value={p}>
                          {p === "none"
                            ? "Not a PEP"
                            : p === "self"
                              ? "I am a PEP"
                              : "Family member of a PEP"}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <label className="flex items-center gap-2 text-sm text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={tax.is_us_person}
                      onChange={(e) => setTax({ ...tax, is_us_person: e.target.checked })}
                      className="h-4 w-4 shrink-0 cursor-pointer rounded border-border accent-primary"
                    />
                    I am a US person for tax purposes
                  </label>
                </div>
              )}

              {currentStepKey === "financial" && (
                <div className="space-y-4">
                  <Field label="Occupation">
                    <select
                      value={financial.occupation}
                      onChange={(e) =>
                        setFinancial({
                          ...financial,
                          occupation: e.target.value as Financial["occupation"],
                        })
                      }
                      className={inputClass}
                    >
                      {OCCUPATIONS.map((o) => (
                        <option key={o} value={o}>
                          {OCCUPATION_LABELS[o]}
                        </option>
                      ))}
                    </select>
                  </Field>
                  {EMPLOYED_OCCUPATIONS.includes(financial.occupation) && (
                    <Field label="Employer / designation">
                      <input
                        value={financial.employer_designation ?? ""}
                        onChange={(e) =>
                          setFinancial({ ...financial, employer_designation: e.target.value })
                        }
                        className={inputClass}
                      />
                    </Field>
                  )}
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <Field label="Income currency">
                      <CurrencySelect
                        value={financial.income_currency}
                        onChange={(v) =>
                          setFinancial({
                            ...financial,
                            income_currency: v as Financial["income_currency"],
                          })
                        }
                      />
                    </Field>
                    <Field label="Investment experience (years)">
                      <input
                        type="number"
                        min={0}
                        max={70}
                        value={financial.investment_experience_years}
                        onChange={(e) =>
                          setFinancial({
                            ...financial,
                            investment_experience_years: Math.max(
                              0,
                              Math.min(70, Number(e.target.value) || 0),
                            ),
                          })
                        }
                        className={inputClass}
                      />
                    </Field>
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <Field label="Annual income band">
                      <BandSelect
                        value={financial.annual_income_band}
                        onChange={(v) =>
                          setFinancial({
                            ...financial,
                            annual_income_band: v as Financial["annual_income_band"],
                          })
                        }
                      />
                    </Field>
                    <Field label="Net worth band">
                      <BandSelect
                        value={financial.net_worth_band}
                        onChange={(v) =>
                          setFinancial({
                            ...financial,
                            net_worth_band: v as Financial["net_worth_band"],
                          })
                        }
                      />
                    </Field>
                  </div>
                  <Field label="Risk tolerance">
                    <select
                      value={financial.risk_tolerance}
                      onChange={(e) =>
                        setFinancial({
                          ...financial,
                          risk_tolerance: e.target.value as Financial["risk_tolerance"],
                        })
                      }
                      className={inputClass}
                    >
                      {RISK_TOLERANCES.map((r) => (
                        <option key={r} value={r}>
                          {r[0]!.toUpperCase() + r.slice(1)}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <div>
                    <span className="text-sm font-medium text-foreground">
                      Investment objectives
                    </span>
                    <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {INVESTMENT_OBJECTIVES.map((o) => (
                        <CheckboxRow
                          key={o}
                          label={INVESTMENT_OBJECTIVE_LABELS[o]}
                          checked={financial.investment_objectives.includes(o)}
                          onChange={() =>
                            setFinancial({
                              ...financial,
                              investment_objectives: toggleInArray(
                                financial.investment_objectives,
                                o,
                              ),
                            })
                          }
                        />
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {currentStepKey === "markets" && (
                <div className="space-y-4">
                  <div>
                    <span className="text-sm font-medium text-foreground">
                      Products you'll trade
                    </span>
                    <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {PRODUCTS.map((p) => (
                        <CheckboxRow
                          key={p}
                          label={PRODUCT_LABELS[p]}
                          checked={marketsPrefs.products.includes(p)}
                          onChange={() =>
                            setMarketsPrefs({
                              ...marketsPrefs,
                              products: toggleInArray(marketsPrefs.products, p),
                            })
                          }
                        />
                      ))}
                    </div>
                  </div>
                  <Field label="Base currency">
                    <CurrencySelect
                      value={marketsPrefs.base_currency}
                      onChange={(v) =>
                        setMarketsPrefs({
                          ...marketsPrefs,
                          base_currency: v as MarketsPrefs["base_currency"],
                        })
                      }
                    />
                  </Field>
                </div>
              )}

              {currentStepKey === "funding" && (
                <div className="space-y-4">
                  <Field label="Primary funding method">
                    <select
                      value={funding.primary_method}
                      onChange={(e) =>
                        setFunding({
                          ...funding,
                          primary_method: e.target.value as Funding["primary_method"],
                        })
                      }
                      className={inputClass}
                    >
                      {FUNDING_METHODS.map((m) => (
                        <option key={m} value={m}>
                          {FUNDING_METHOD_LABELS[m]}
                        </option>
                      ))}
                    </select>
                  </Field>

                  {funding.primary_method === "crypto_deposit" ? (
                    <div>
                      <span className="text-sm font-medium text-foreground">Networks</span>
                      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                        {CRYPTO_NETWORKS.map((n) => (
                          <CheckboxRow
                            key={n}
                            label={CRYPTO_NETWORK_LABELS[n]}
                            checked={funding.crypto_deposit_networks.includes(n)}
                            onChange={() =>
                              setFunding({
                                ...funding,
                                crypto_deposit_networks: toggleInArray(
                                  funding.crypto_deposit_networks,
                                  n,
                                ),
                              })
                            }
                          />
                        ))}
                      </div>
                    </div>
                  ) : (
                    <>
                      <Field label="Account holder name">
                        <input
                          value={funding.bank_account.account_holder_name}
                          onChange={(e) =>
                            setFunding({
                              ...funding,
                              bank_account: {
                                ...funding.bank_account,
                                account_holder_name: e.target.value,
                              },
                            })
                          }
                          className={inputClass}
                        />
                      </Field>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <Field label="Bank name">
                          <input
                            value={funding.bank_account.bank_name}
                            onChange={(e) =>
                              setFunding({
                                ...funding,
                                bank_account: {
                                  ...funding.bank_account,
                                  bank_name: e.target.value,
                                },
                              })
                            }
                            className={inputClass}
                          />
                        </Field>
                        <Field label="Account type">
                          <select
                            value={funding.bank_account.account_type}
                            onChange={(e) =>
                              setFunding({
                                ...funding,
                                bank_account: {
                                  ...funding.bank_account,
                                  account_type: e.target
                                    .value as Funding["bank_account"]["account_type"],
                                },
                              })
                            }
                            className={inputClass}
                          >
                            {ACCOUNT_TYPES.map((t) => (
                              <option key={t} value={t}>
                                {ACCOUNT_TYPE_LABELS[t]}
                              </option>
                            ))}
                          </select>
                        </Field>
                      </div>
                      <Field
                        label="Account number"
                        hint={stepAlreadyCaptured ? MASKED_FIELD_HINT : undefined}
                      >
                        <input
                          value={funding.bank_account.account_number}
                          onChange={(e) =>
                            setFunding({
                              ...funding,
                              bank_account: {
                                ...funding.bank_account,
                                account_number: e.target.value.replace(/\s/g, ""),
                              },
                            })
                          }
                          className={inputClass}
                        />
                      </Field>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <Field label="Routing type">
                          <select
                            value={funding.bank_account.routing_type}
                            onChange={(e) =>
                              setFunding({
                                ...funding,
                                bank_account: {
                                  ...funding.bank_account,
                                  routing_type: e.target
                                    .value as Funding["bank_account"]["routing_type"],
                                },
                              })
                            }
                            className={inputClass}
                          >
                            {ROUTING_TYPES.map((r) => (
                              <option key={r} value={r}>
                                {ROUTING_TYPE_LABELS[r]}
                              </option>
                            ))}
                          </select>
                        </Field>
                        <Field label="Routing code">
                          <input
                            value={funding.bank_account.routing_code}
                            onChange={(e) =>
                              setFunding({
                                ...funding,
                                bank_account: {
                                  ...funding.bank_account,
                                  routing_code: e.target.value.toUpperCase(),
                                },
                              })
                            }
                            placeholder={
                              ROUTING_CODE_PLACEHOLDER[funding.bank_account.routing_type]
                            }
                            className={inputClass}
                          />
                        </Field>
                      </div>
                      <Field label="Account currency">
                        <CurrencySelect
                          value={funding.bank_account.currency}
                          onChange={(v) =>
                            setFunding({
                              ...funding,
                              bank_account: {
                                ...funding.bank_account,
                                currency: v as Funding["bank_account"]["currency"],
                              },
                            })
                          }
                        />
                      </Field>
                    </>
                  )}
                </div>
              )}

              {currentStepKey === "security" && (
                <div className="space-y-4">
                  <Field label="Two-factor method">
                    <select
                      value={security.two_factor_method}
                      onChange={(e) =>
                        setSecurity({
                          ...security,
                          two_factor_method: e.target.value as Security["two_factor_method"],
                        })
                      }
                      className={inputClass}
                    >
                      {TWO_FACTOR_METHODS.map((m) => (
                        <option key={m} value={m}>
                          {m === "email" ? "Email" : "None (not recommended)"}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Anti-phishing code">
                    <input
                      value={security.anti_phishing_code ?? ""}
                      onChange={(e) =>
                        setSecurity({ ...security, anti_phishing_code: e.target.value })
                      }
                      placeholder="Shown in every genuine email we send you"
                      className={inputClass}
                    />
                  </Field>
                  <CheckboxRow
                    label="Only allow withdrawals to whitelisted addresses"
                    checked={security.withdrawal_whitelist_only}
                    onChange={() =>
                      setSecurity({
                        ...security,
                        withdrawal_whitelist_only: !security.withdrawal_whitelist_only,
                      })
                    }
                  />
                  <CheckboxRow
                    label="Notify me when a new device signs in"
                    checked={security.notify_on_new_device}
                    onChange={() =>
                      setSecurity({
                        ...security,
                        notify_on_new_device: !security.notify_on_new_device,
                      })
                    }
                  />
                </div>
              )}

              {currentStepKey === "agreements" && (
                <div className="space-y-4">
                  <p className="text-sm text-muted-foreground">
                    Review and accept the following to finish setting up your account.
                  </p>
                  <div className="space-y-2">
                    {AGREEMENT_DOCUMENTS.map((doc) => (
                      <CheckboxRow
                        key={doc}
                        label={AGREEMENT_LABELS[doc]}
                        checked={acceptedDocs.has(doc)}
                        onChange={() =>
                          setAcceptedDocs((prev) => {
                            const next = new Set(prev);
                            if (next.has(doc)) next.delete(doc);
                            else next.add(doc);
                            return next;
                          })
                        }
                      />
                    ))}
                  </div>
                </div>
              )}

              {error && <p className="mt-4 text-xs font-medium text-destructive">{error}</p>}

              <div className="mt-7 flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={
                    isEditMode
                      ? () =>
                          void navigate(
                            adminUid
                              ? { to: "/admin" }
                              : { to: "/account", search: { tab: "account" } },
                          )
                      : stepIndex === 0
                        ? () => navigate({ to: "/" })
                        : handleBack
                  }
                  disabled={submitting}
                  className="rounded sm:rounded-xl border border-border px-5 py-2.5 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
                >
                  {isEditMode || stepIndex === 0 ? "Cancel" : "Back"}
                </button>
                <button
                  type="button"
                  onClick={() => void handleContinue()}
                  disabled={submitting}
                  className="flex items-center gap-2 rounded sm:rounded-xl bg-primary px-6 py-2.5 text-sm font-bold uppercase tracking-wider text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
                >
                  {submitting && <i className="fa-solid fa-circle-notch fa-spin" />}
                  {submitting
                    ? "Saving..."
                    : isEditMode
                      ? "Save changes"
                      : stepIndex === STEPS.length - 1 ||
                          (readyToSubmit && currentStepKey === "agreements")
                        ? "Submit & finish"
                        : "Continue"}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
