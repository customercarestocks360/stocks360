import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { useAuth, type KycProfile } from "@/components/AuthProvider";
import { Confetti } from "@/components/ui/confetti";

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

export const Route = createFileRoute("/kyc")({
  head: () => ({
    meta: [
      { title: "Complete your KYC — Stocks360" },
      { name: "description", content: "Verify your identity to unlock deposits and trading." },
    ],
  }),
  component: KycPage,
});

const STEPS = [
  { key: "contact", label: "Contact" },
  { key: "personal", label: "Personal" },
  { key: "address", label: "Address" },
  { key: "identity", label: "Identity" },
  { key: "tax", label: "Tax" },
  { key: "financial", label: "Financial" },
  { key: "markets", label: "Markets" },
  { key: "funding", label: "Funding" },
  { key: "security", label: "Security" },
  { key: "agreements", label: "Agreements" },
] as const;

const AGREEMENT_VERSION = "2026-01-15";
const AGREEMENT_DOCS = [
  { key: "terms_of_service", label: "Terms of Service" },
  { key: "privacy_policy", label: "Privacy Policy" },
  { key: "tax_declaration", label: "Tax Declaration" },
  { key: "risk_disclosure_securities", label: "Risk Disclosure — Securities" },
  { key: "cross_border_remittance", label: "Cross-Border Remittance" },
  { key: "risk_disclosure_crypto", label: "Risk Disclosure — Crypto" },
  { key: "risk_disclosure_derivatives", label: "Risk Disclosure — Derivatives" },
] as const;

const COUNTRIES = [
  { code: "IN", name: "India" },
  { code: "US", name: "United States" },
  { code: "GB", name: "United Kingdom" },
  { code: "AE", name: "UAE" },
  { code: "SG", name: "Singapore" },
];

const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

type Contact = KycProfile["contact"];
type Personal = KycProfile["personal"];
type Address = KycProfile["address"];
type Identity = KycProfile["identity"];
type Tax = KycProfile["tax"];
type Financial = KycProfile["financial"];
type MarketsPrefs = KycProfile["markets"];
type Funding = KycProfile["funding"];
type Security = KycProfile["security"];

function CountrySelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="mt-2 w-full rounded-xl border border-border bg-background/60 px-3 py-2.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40"
    >
      {COUNTRIES.map((c) => (
        <option key={c.code} value={c.code}>
          {c.name}
        </option>
      ))}
    </select>
  );
}

const CURRENCIES = ["INR", "USD", "EUR", "GBP", "AED", "SGD"];
const INCOME_BANDS = [
  { code: "0_100k", label: "Under 100k" },
  { code: "100k_500k", label: "100k – 500k" },
  { code: "500k_1m", label: "500k – 1M" },
  { code: "1m_5m", label: "1M – 5M" },
  { code: "5m_plus", label: "5M+" },
];

function CurrencySelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="mt-2 w-full rounded-xl border border-border bg-background/60 px-3 py-2.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40"
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
      className="mt-2 w-full rounded-xl border border-border bg-background/60 px-3 py-2.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40"
    >
      {INCOME_BANDS.map((b) => (
        <option key={b.code} value={b.code}>
          {b.label}
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

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block text-sm font-medium text-foreground">
      {label}
      {children}
    </label>
  );
}

const inputClass =
  "mt-2 w-full rounded-xl border border-border bg-background/60 px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40";

function KycPage() {
  const navigate = useNavigate();
  const { isLoggedIn, kycCompleted, submitKyc } = useAuth();
  const [stepIndex, setStepIndex] = useState(0);
  const [error, setError] = useState("");
  const [celebrate, setCelebrate] = useState(false);
  const currentStepKey = STEPS[stepIndex]!.key;

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
  const [address, setAddress] = useState<Address>({
    residential: { line1: "", city: "", state: "", postal_code: "", country: "IN" },
    permanent_same_as_residential: true,
  });
  const [identity, setIdentity] = useState<Identity>({
    document_type: "pan",
    document_number: "",
    issuing_country: "IN",
  });
  const [tax, setTax] = useState<Tax>({
    tax_residency_country: "IN",
    tax_identification_number: "",
    is_us_person: false,
    pep_status: "none",
    source_of_funds: "salary",
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
  });
  const [security, setSecurity] = useState<Security>({
    two_factor_method: "totp",
    anti_phishing_code: "",
    withdrawal_whitelist_only: true,
    notify_on_new_device: true,
  });
  const [acceptedDocs, setAcceptedDocs] = useState<Set<string>>(new Set());
  const [verifying, setVerifying] = useState(false);

  const toggleInArray = (arr: string[], value: string) =>
    arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value];

  if (!isLoggedIn) {
    return (
      <AuthPageShell>
        <div className="relative w-full max-w-md rounded-3xl border border-border bg-card/80 p-8 text-center shadow-2xl backdrop-blur-xl">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-secondary text-primary">
            <i className="fa-solid fa-lock text-lg" />
          </div>
          <h1 className="mt-4 text-xl font-bold text-foreground">Sign in required</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            You need to sign in before completing your KYC verification.
          </p>
          <Link
            to="/login"
            className="mt-6 inline-block rounded-xl bg-primary px-5 py-2.5 text-sm font-bold uppercase tracking-wider text-primary-foreground transition-opacity hover:opacity-90"
          >
            Go to sign in
          </Link>
        </div>
      </AuthPageShell>
    );
  }



  const validateStep = (): string => {
    if (currentStepKey === "contact") {
      if (!/^\d{7,14}$/.test(contact.mobile_number)) return "Enter a valid mobile number.";
    }
    if (currentStepKey === "personal") {
      if (!personal.first_name.trim() || !personal.last_name.trim()) return "First and last name are required.";
      if (!personal.date_of_birth) return "Date of birth is required.";
      const age = (Date.now() - new Date(personal.date_of_birth).getTime()) / (365.25 * 24 * 3600 * 1000);
      if (age < 18) return "You must be at least 18 years old.";
    }
    if (currentStepKey === "address") {
      const r = address.residential;
      if (!r.line1.trim() || !r.city.trim() || !r.state.trim()) return "Please complete your residential address.";
      if (r.country === "IN" && !/^\d{6}$/.test(r.postal_code)) return "Enter a valid 6-digit postal code.";
    }
    if (currentStepKey === "identity") {
      if (!identity.document_number.trim()) return "Document number is required.";
      if (identity.document_type === "pan" && !PAN_REGEX.test(identity.document_number.toUpperCase()))
        return "Enter a valid PAN (e.g. ABCDE1234F).";
    }
    if (currentStepKey === "tax") {
      // Tax identification number is optional — not every jurisdiction issues one.
    }
    if (currentStepKey === "financial") {
      if (financial.occupation.startsWith("salaried") && !financial.employer_designation.trim())
        return "Employer designation is required.";
      if (financial.investment_experience_years < 0) return "Investment experience can't be negative.";
      if (financial.investment_objectives.length === 0) return "Pick at least one investment objective.";
    }
    if (currentStepKey === "markets") {
      if (marketsPrefs.products.length === 0) return "Pick at least one product you'll trade.";
    }
    if (currentStepKey === "funding") {
      const b = funding.bank_account;
      if (!b.account_holder_name.trim() || !b.account_number.trim() || !b.bank_name.trim() || !b.routing_code.trim())
        return "Please complete your bank account details.";
    }
    if (currentStepKey === "security") {
      if (!security.anti_phishing_code.trim()) return "Set an anti-phishing code.";
    }
    if (currentStepKey === "agreements") {
      if (acceptedDocs.size < AGREEMENT_DOCS.length) return "Please accept all agreements to continue.";
    }
    return "";
  };

  const handleContinue = () => {
    const msg = validateStep();
    if (msg) {
      setError(msg);
      return;
    }
    setError("");
    if (stepIndex < STEPS.length - 1) {
      setStepIndex((i) => i + 1);
      return;
    }
    const profile: KycProfile = {
      contact,
      personal,
      address,
      identity: { ...identity, document_number: identity.document_number.toUpperCase() },
      tax,
      financial,
      markets: marketsPrefs,
      funding,
      security,
      agreements: {
        accepted: AGREEMENT_DOCS.map((d) => ({ document: d.key, version: AGREEMENT_VERSION })),
      },
    };
    setVerifying(true);
    setTimeout(() => {
      setVerifying(false);
      submitKyc(profile);
      setCelebrate(true);
      setTimeout(() => setCelebrate(true));
    }, 1600);
  };

  const handleBack = () => {
    setError("");
    setStepIndex((i) => Math.max(0, i - 1));
  };

  return (
    <div className="h-dvh overflow-y-auto bg-background text-foreground pt-safe">
      {celebrate && <Confetti />}
      <div className="grid-bg fixed inset-0 -z-10 opacity-40" />

      <div className="relative mx-auto max-w-2xl px-4 py-10 sm:px-6 sm:py-16">
        {celebrate ? (
          <div className="rounded-3xl border border-border bg-card p-10 text-center shadow-2xl">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-up/10 text-up">
              <i className="fa-solid fa-party-horn text-2xl" />
            </div>
            <h1 className="mt-5 text-2xl font-bold text-foreground">You're verified! </h1>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              Congrats — your KYC verification is complete. You can now deposit funds and start trading.
            </p>
            <Link
              to="/"
              className="mt-7 inline-block rounded-xl bg-primary px-6 py-3 text-sm font-bold uppercase tracking-wider text-primary-foreground transition-opacity hover:opacity-90"
            >
              Go to dashboard
            </Link>
          </div>
        ) : (
          <>
            <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
              Complete your remaining details
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              A few quick steps to verify your identity before you can deposit and trade.
            </p>

              {/* ── Horizontal step indicator ── */}
              <div className="mt-8 flex items-center">
                {STEPS.map((step, i) => (
                  <div key={step.key} className="flex flex-1 items-center last:flex-none">
                    <div className="flex flex-col items-center gap-2">
                      <div
                        className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold transition-colors ${
                          i < stepIndex
                            ? "bg-up text-white"
                            : i === stepIndex
                              ? "bg-primary text-primary-foreground"
                              : "border border-border bg-background text-muted-foreground"
                        }`}
                      >
                        {i < stepIndex ? <i className="fa-solid fa-check text-[11px]" /> : i + 1}
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

              {/* ── Step content ── */}
              <div className="mt-10 rounded-3xl border border-border bg-card p-4 shadow-sm sm:p-7">
                {currentStepKey === "contact" && (
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                      <Field label="Country code">
                        <input
                          value={contact.mobile_country_code}
                          onChange={(e) => setContact({ ...contact, mobile_country_code: e.target.value })}
                          className={inputClass}
                        />
                      </Field>
                      <div className="col-span-2">
                        <Field label="Mobile number">
                          <input
                            value={contact.mobile_number}
                            onChange={(e) =>
                              setContact({ ...contact, mobile_number: e.target.value.replace(/\D/g, "") })
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
                        onChange={(e) => setPersonal({ ...personal, gender: e.target.value })}
                        className={inputClass}
                      >
                        <option value="female">Female</option>
                        <option value="male">Male</option>
                        <option value="other">Other</option>
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
                  <div className="space-y-4">
                    <Field label="Address line 1">
                      <input
                        value={address.residential.line1}
                        onChange={(e) =>
                          setAddress({ ...address, residential: { ...address.residential, line1: e.target.value } })
                        }
                        className={inputClass}
                      />
                    </Field>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <Field label="City">
                        <input
                          value={address.residential.city}
                          onChange={(e) =>
                            setAddress({ ...address, residential: { ...address.residential, city: e.target.value } })
                          }
                          className={inputClass}
                        />
                      </Field>
                      <Field label="State">
                        <input
                          value={address.residential.state}
                          onChange={(e) =>
                            setAddress({ ...address, residential: { ...address.residential, state: e.target.value } })
                          }
                          className={inputClass}
                        />
                      </Field>
                    </div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <Field label="Postal code">
                        <input
                          value={address.residential.postal_code}
                          onChange={(e) =>
                            setAddress({
                              ...address,
                              residential: { ...address.residential, postal_code: e.target.value.replace(/\D/g, "") },
                            })
                          }
                          className={inputClass}
                        />
                      </Field>
                      <Field label="Country">
                        <CountrySelect
                          value={address.residential.country}
                          onChange={(v) =>
                            setAddress({ ...address, residential: { ...address.residential, country: v } })
                          }
                        />
                      </Field>
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
                  </div>
                )}

                {currentStepKey === "identity" && (
                  <div className="space-y-4">
                    <Field label="Document type">
                      <select
                        value={identity.document_type}
                        onChange={(e) => setIdentity({ ...identity, document_type: e.target.value })}
                        className={inputClass}
                      >
                        <option value="pan">PAN</option>
                        <option value="passport">Passport</option>
                        <option value="aadhaar">Aadhaar</option>
                        <option value="national_id">National ID</option>
                      </select>
                    </Field>
                    <Field label="Document number">
                      <input
                        value={identity.document_number}
                        onChange={(e) =>
                          setIdentity({ ...identity, document_number: e.target.value.toUpperCase() })
                        }
                        placeholder={identity.document_type === "pan" ? "ABCDE1234F" : "Document number"}
                        className={inputClass}
                      />
                    </Field>
                    <Field label="Issuing country">
                      <CountrySelect
                        value={identity.issuing_country}
                        onChange={(v) => setIdentity({ ...identity, issuing_country: v })}
                      />
                    </Field>
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
                    <Field label="Tax identification number (optional)">
                      <input
                        value={tax.tax_identification_number}
                        onChange={(e) => setTax({ ...tax, tax_identification_number: e.target.value.toUpperCase() })}
                        placeholder="Leave blank if not applicable"
                        className={inputClass}
                      />
                    </Field>
                    <Field label="Source of funds">
                      <select
                        value={tax.source_of_funds}
                        onChange={(e) => setTax({ ...tax, source_of_funds: e.target.value })}
                        className={inputClass}
                      >
                        <option value="salary">Salary</option>
                        <option value="business">Business income</option>
                        <option value="investments">Investments</option>
                        <option value="inheritance">Inheritance</option>
                        <option value="other">Other</option>
                      </select>
                    </Field>
                    <Field label="Politically exposed person (PEP) status">
                      <select
                        value={tax.pep_status}
                        onChange={(e) => setTax({ ...tax, pep_status: e.target.value })}
                        className={inputClass}
                      >
                        <option value="none">Not a PEP</option>
                        <option value="self">I am a PEP</option>
                        <option value="family_member">Family member of a PEP</option>
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
                        onChange={(e) => setFinancial({ ...financial, occupation: e.target.value })}
                        className={inputClass}
                      >
                        <option value="salaried_private">Salaried — private sector</option>
                        <option value="salaried_government">Salaried — government</option>
                        <option value="self_employed">Self-employed</option>
                        <option value="business_owner">Business owner</option>
                        <option value="student">Student</option>
                        <option value="retired">Retired</option>
                        <option value="unemployed">Unemployed</option>
                      </select>
                    </Field>
                    {financial.occupation.startsWith("salaried") && (
                      <Field label="Employer designation">
                        <input
                          value={financial.employer_designation}
                          onChange={(e) => setFinancial({ ...financial, employer_designation: e.target.value })}
                          className={inputClass}
                        />
                      </Field>
                    )}
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <Field label="Income currency">
                        <CurrencySelect
                          value={financial.income_currency}
                          onChange={(v) => setFinancial({ ...financial, income_currency: v })}
                        />
                      </Field>
                      <Field label="Investment experience (years)">
                        <input
                          type="number"
                          min={0}
                          value={financial.investment_experience_years}
                          onChange={(e) =>
                            setFinancial({
                              ...financial,
                              investment_experience_years: Math.max(0, Number(e.target.value) || 0),
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
                          onChange={(v) => setFinancial({ ...financial, annual_income_band: v })}
                        />
                      </Field>
                      <Field label="Net worth band">
                        <BandSelect
                          value={financial.net_worth_band}
                          onChange={(v) => setFinancial({ ...financial, net_worth_band: v })}
                        />
                      </Field>
                    </div>
                    <Field label="Risk tolerance">
                      <select
                        value={financial.risk_tolerance}
                        onChange={(e) => setFinancial({ ...financial, risk_tolerance: e.target.value })}
                        className={inputClass}
                      >
                        <option value="low">Low</option>
                        <option value="medium">Medium</option>
                        <option value="high">High</option>
                      </select>
                    </Field>
                    <div>
                      <span className="text-sm font-medium text-foreground">Investment objectives</span>
                      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                        {[
                          { key: "long_term_growth", label: "Long-term growth" },
                          { key: "income", label: "Income" },
                          { key: "capital_preservation", label: "Capital preservation" },
                          { key: "speculation", label: "Speculation" },
                          { key: "hedging", label: "Hedging" },
                        ].map((o) => (
                          <CheckboxRow
                            key={o.key}
                            label={o.label}
                            checked={financial.investment_objectives.includes(o.key)}
                            onChange={() =>
                              setFinancial({
                                ...financial,
                                investment_objectives: toggleInArray(financial.investment_objectives, o.key),
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
                      <span className="text-sm font-medium text-foreground">Products you'll trade</span>
                      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                        {[
                          { key: "domestic_equity_delivery", label: "Domestic equity (delivery)" },
                          { key: "foreign_equity", label: "Foreign equity" },
                          { key: "etf", label: "ETFs" },
                          { key: "forex", label: "Forex" },
                          { key: "commodities", label: "Commodities" },
                          { key: "crypto_spot", label: "Crypto — spot" },
                          { key: "crypto_derivatives", label: "Crypto — derivatives" },
                        ].map((o) => (
                          <CheckboxRow
                            key={o.key}
                            label={o.label}
                            checked={marketsPrefs.products.includes(o.key)}
                            onChange={() =>
                              setMarketsPrefs({
                                ...marketsPrefs,
                                products: toggleInArray(marketsPrefs.products, o.key),
                              })
                            }
                          />
                        ))}
                      </div>
                    </div>
                    <Field label="Base currency">
                      <CurrencySelect
                        value={marketsPrefs.base_currency}
                        onChange={(v) => setMarketsPrefs({ ...marketsPrefs, base_currency: v })}
                      />
                    </Field>
                  </div>
                )}

                {currentStepKey === "funding" && (
                  <div className="space-y-4">
                    <Field label="Primary funding method">
                      <select
                        value={funding.primary_method}
                        onChange={(e) => setFunding({ ...funding, primary_method: e.target.value })}
                        className={inputClass}
                      >
                        <option value="bank_transfer">Bank transfer</option>
                        <option value="card">Card</option>
                        <option value="crypto_deposit">Crypto deposit</option>
                      </select>
                    </Field>
                    <Field label="Account holder name">
                      <input
                        value={funding.bank_account.account_holder_name}
                        onChange={(e) =>
                          setFunding({
                            ...funding,
                            bank_account: { ...funding.bank_account, account_holder_name: e.target.value },
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
                              bank_account: { ...funding.bank_account, bank_name: e.target.value },
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
                              bank_account: { ...funding.bank_account, account_type: e.target.value },
                            })
                          }
                          className={inputClass}
                        >
                          <option value="savings">Savings</option>
                          <option value="current">Current</option>
                        </select>
                      </Field>
                    </div>
                    <Field label="Account number">
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
                              bank_account: { ...funding.bank_account, routing_type: e.target.value },
                            })
                          }
                          className={inputClass}
                        >
                          <option value="ifsc">IFSC</option>
                          <option value="swift">SWIFT</option>
                          <option value="routing_number">Routing number</option>
                        </select>
                      </Field>
                      <Field label={funding.bank_account.routing_type === "ifsc" ? "IFSC code" : "Routing code"}>
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
                          className={inputClass}
                        />
                      </Field>
                    </div>
                    <Field label="Account currency">
                      <CurrencySelect
                        value={funding.bank_account.currency}
                        onChange={(v) =>
                          setFunding({ ...funding, bank_account: { ...funding.bank_account, currency: v } })
                        }
                      />
                    </Field>
                  </div>
                )}

                {currentStepKey === "security" && (
                  <div className="space-y-4">
                    <Field label="Two-factor method">
                      <select
                        value={security.two_factor_method}
                        onChange={(e) => setSecurity({ ...security, two_factor_method: e.target.value })}
                        className={inputClass}
                      >
                        <option value="totp">Authenticator app (TOTP)</option>
                        <option value="sms">SMS</option>
                        <option value="email">Email</option>
                      </select>
                    </Field>
                    <Field label="Anti-phishing code">
                      <input
                        value={security.anti_phishing_code}
                        onChange={(e) => setSecurity({ ...security, anti_phishing_code: e.target.value })}
                        placeholder="Shown in every genuine email we send you"
                        className={inputClass}
                      />
                    </Field>
                    <CheckboxRow
                      label="Only allow withdrawals to whitelisted addresses"
                      checked={security.withdrawal_whitelist_only}
                      onChange={() =>
                        setSecurity({ ...security, withdrawal_whitelist_only: !security.withdrawal_whitelist_only })
                      }
                    />
                    <CheckboxRow
                      label="Notify me when a new device signs in"
                      checked={security.notify_on_new_device}
                      onChange={() => setSecurity({ ...security, notify_on_new_device: !security.notify_on_new_device })}
                    />
                  </div>
                )}

                {currentStepKey === "agreements" && (
                  <div className="space-y-4">
                    <p className="text-sm text-muted-foreground">
                      Review and accept the following to finish setting up your account.
                    </p>
                    <div className="space-y-2">
                      {AGREEMENT_DOCS.map((doc) => (
                        <CheckboxRow
                          key={doc.key}
                          label={doc.label}
                          checked={acceptedDocs.has(doc.key)}
                          onChange={() =>
                            setAcceptedDocs((prev) => {
                              const next = new Set(prev);
                              next.has(doc.key) ? next.delete(doc.key) : next.add(doc.key);
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
                    onClick={stepIndex === 0 ? () => navigate({ to: "/" }) : handleBack}
                    disabled={verifying}
                    className="rounded-xl border border-border px-5 py-2.5 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
                  >
                    {stepIndex === 0 ? "Cancel" : "Back"}
                  </button>
                  <button
                    type="button"
                    onClick={handleContinue}
                    disabled={verifying}
                    className="flex items-center gap-2 rounded-xl bg-primary px-6 py-2.5 text-sm font-bold uppercase tracking-wider text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
                  >
                    {verifying && <i className="fa-solid fa-circle-notch fa-spin" />}
                    {verifying
                      ? "Verifying..."
                      : stepIndex === STEPS.length - 1
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
