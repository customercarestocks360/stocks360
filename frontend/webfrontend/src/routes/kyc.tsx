import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { useAuth, type KycProfile } from "@/components/AuthProvider";
import { Confetti } from "@/components/ui/confetti";

function AuthPageShell({ children }: { children: ReactNode }) {
  return (
    <div className="h-screen overflow-hidden bg-background text-foreground">
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
  { key: "verification", label: "Verification" },
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
  const [idUploaded, setIdUploaded] = useState(false);
  const [selfieUploaded, setSelfieUploaded] = useState(false);
  const [kycNumber, setKycNumber] = useState("");
  const [verifying, setVerifying] = useState(false);

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

  if (kycCompleted && !celebrate) {
    return (
      <AuthPageShell>
        <div className="relative w-full max-w-md rounded-3xl border border-border bg-card/80 p-8 text-center shadow-2xl backdrop-blur-xl">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-up/10 text-up">
            <i className="fa-solid fa-circle-check text-lg" />
          </div>
          <h1 className="mt-4 text-xl font-bold text-foreground">You're already verified</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Your have completed 90% of the details.
          </p>
          <Link
            to="/"
            className="mt-6 inline-block rounded-xl bg-primary px-5 py-2.5 text-sm font-bold uppercase tracking-wider text-primary-foreground transition-opacity hover:opacity-90"
          >
            Back to home
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
      if (!tax.tax_identification_number.trim()) return "Tax identification number is required.";
    }
    if (currentStepKey === "verification") {
      if (!idUploaded || !selfieUploaded) return "Please upload both your ID document and a selfie.";
      if (!kycNumber.trim()) return "Enter your KYC verification number.";
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
    };
    setVerifying(true);
    setTimeout(() => {
      setVerifying(false);
      submitKyc(profile);
      setCelebrate(true);
      setTimeout(() => setCelebrate(false), 3200);
    }, 1600);
  };

  const handleBack = () => {
    setError("");
    setStepIndex((i) => Math.max(0, i - 1));
  };

  return (
    <div className="h-screen overflow-y-auto bg-background text-foreground">
      {celebrate && <Confetti />}
      <div className="grid-bg fixed inset-0 -z-10 opacity-40" />

      <div className="relative mx-auto max-w-2xl px-6 py-16">
        {celebrate ? (
          <div className="rounded-3xl border border-border bg-card p-10 text-center shadow-2xl">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-up/10 text-up">
              <i className="fa-solid fa-party-horn text-2xl" />
            </div>
            <h1 className="mt-5 text-2xl font-bold text-foreground">You're verified! 🎉</h1>
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
              <div className="mt-10 rounded-3xl border border-border bg-card p-7 shadow-sm">
                {currentStepKey === "contact" && (
                  <div className="space-y-4">
                    <div className="grid grid-cols-3 gap-3">
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
                    <div className="grid grid-cols-2 gap-3">
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
                    <div className="grid grid-cols-2 gap-3">
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
                    <div className="grid grid-cols-2 gap-3">
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
                    <Field label="Tax identification number">
                      <input
                        value={tax.tax_identification_number}
                        onChange={(e) => setTax({ ...tax, tax_identification_number: e.target.value.toUpperCase() })}
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

                {currentStepKey === "verification" && (
                  <div className="space-y-4">
                    <p className="text-sm text-muted-foreground">
                      Upload a photo of your identity document and a selfie so we can confirm they match.
                    </p>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <button
                        type="button"
                        onClick={() => setIdUploaded(true)}
                        className={`flex flex-col items-center gap-2 rounded-2xl border border-dashed p-6 text-center transition-colors ${
                          idUploaded ? "border-up bg-up/5" : "border-border hover:border-primary/40"
                        }`}
                      >
                        <i
                          className={`fa-solid ${idUploaded ? "fa-circle-check text-up" : "fa-id-card text-muted-foreground"} text-2xl`}
                        />
                        <span className="text-sm font-medium text-foreground">
                          {idUploaded ? "ID document uploaded" : "Upload ID document"}
                        </span>
                        <span className="text-xs text-muted-foreground">Front side, clearly readable</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setSelfieUploaded(true)}
                        className={`flex flex-col items-center gap-2 rounded-2xl border border-dashed p-6 text-center transition-colors ${
                          selfieUploaded ? "border-up bg-up/5" : "border-border hover:border-primary/40"
                        }`}
                      >
                        <i
                          className={`fa-solid ${selfieUploaded ? "fa-circle-check text-up" : "fa-camera text-muted-foreground"} text-2xl`}
                        />
                        <span className="text-sm font-medium text-foreground">
                          {selfieUploaded ? "Selfie uploaded" : "Upload a selfie"}
                        </span>
                        <span className="text-xs text-muted-foreground">Holding your ID document</span>
                      </button>
                    </div>
                    <Field label="KYC verification number">
                      <input
                        value={kycNumber}
                        onChange={(e) => setKycNumber(e.target.value.toUpperCase())}
                        placeholder="Enter the KYC number sent to you"
                        className={inputClass}
                      />
                    </Field>
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
