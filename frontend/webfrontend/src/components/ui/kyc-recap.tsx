import {
  AMENDABLE_STEPS,
  ONBOARDING_STEPS,
  ONBOARDING_STEP_LABELS,
  type OnboardingSession,
  type OnboardingStep,
} from "@/lib/onboarding-api";

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium text-foreground">{value}</span>
    </div>
  );
}

function DetailGroup({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </h3>
        {action}
      </div>
      <div className="mt-1 divide-y divide-border/60">{children}</div>
    </div>
  );
}

/**
 * Words that read wrong under plain Title Case, for both field names (`pep_status`) and
 * enum-like values (`ifsc`, `upi`). One list serves both, since a key and a value go
 * through the same word-by-word titling below.
 */
const ACRONYMS = new Set([
  "pan",
  "pep",
  "us",
  "tin",
  "id",
  "ip",
  "ifsc",
  "swift",
  "iban",
  "aba",
  "upi",
  "bsc",
]);

const LABEL_OVERRIDES: Record<string, string> = {
  is_us_person: "US person",
  no_tin_reason: "Reason for no tax ID",
  accepted_from: "Consent recorded from",
  user_agent: "Browser",
};

function titleWord(word: string): string {
  return ACRONYMS.has(word) ? word.toUpperCase() : word.charAt(0).toUpperCase() + word.slice(1);
}

/** `document_number` -> "Document Number", with a few overrides for anything that reads oddly. */
function humanizeKey(key: string): string {
  return LABEL_OVERRIDES[key] ?? key.split("_").map(titleWord).join(" ");
}

/** A masked value (`"******3210"`) contains characters outside this shape, so it always passes through untouched. */
const ENUM_LIKE = /^[a-z0-9]+(_[a-z0-9]+)*$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function summarizeObject(obj: Record<string, unknown>): string {
  return Object.entries(obj)
    .map(([key, value]) => `${humanizeKey(key)}: ${formatValue(value)}`)
    .join(", ");
}

/** Renders any one captured value as a display string — the same rule for a top-level field and a nested one. */
function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) {
    if (value.length === 0) return "—";
    return value.map((v) => (isPlainObject(v) ? summarizeObject(v) : formatValue(v))).join(", ");
  }
  if (isPlainObject(value)) return summarizeObject(value);
  if (typeof value === "string") return ENUM_LIKE.test(value) ? humanizeKey(value) : value;
  return String(value);
}

/** One step's captured fields, recursing into nested objects (address, bank account) as sub-groups. */
function StepFields({ data }: { data: Record<string, unknown> }) {
  return (
    <div className="mt-1 divide-y divide-border/60">
      {Object.entries(data).map(([key, value]) =>
        isPlainObject(value) ? (
          <div key={key} className="py-2.5">
            <div className="text-sm text-muted-foreground">{humanizeKey(key)}</div>
            <div className="mt-1.5 rounded-lg bg-background/40 px-3">
              <StepFields data={value} />
            </div>
          </div>
        ) : (
          <DetailRow key={key} label={humanizeKey(key)} value={formatValue(value)} />
        ),
      )}
    </div>
  );
}

/**
 * Recap of a submitted KYC application, straight from `GET /onboarding/session` (or its
 * admin equivalent). The backend has already masked the sensitive leaf fields (mobile
 * number, document number, tax ID, bank account number) before this ever sees them, so
 * nothing here re-masks anything — it only turns the captured data into readable groups,
 * one per onboarding step.
 *
 * Pass `onEditStep` to add an "Edit" action per amendable section (`markets`/`agreements`
 * never get one — `PATCH /onboarding/kyc` refuses both). Omit it for a plain read-only
 * recap.
 */
export function KycDetails({
  session,
  onEditStep,
}: {
  session: OnboardingSession;
  onEditStep?: (step: OnboardingStep) => void;
}) {
  return (
    <div className="mt-5 space-y-5">
      {ONBOARDING_STEPS.map((step) => {
        const captured = session.steps[step];
        if (!captured) return null;
        return (
          <DetailGroup
            key={step}
            title={ONBOARDING_STEP_LABELS[step]}
            action={
              onEditStep && AMENDABLE_STEPS.includes(step) ? (
                <button
                  type="button"
                  onClick={() => onEditStep(step)}
                  className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                >
                  <i className="fa-solid fa-pen text-[10px]" />
                  Edit
                </button>
              ) : undefined
            }
          >
            <StepFields data={captured.data} />
          </DetailGroup>
        );
      })}
      {!onEditStep && (
        <p className="text-xs text-muted-foreground/70">
          These details were submitted with your application and can't be edited here. Contact
          support if anything needs correcting.
        </p>
      )}
    </div>
  );
}
