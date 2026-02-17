import { useCallback, useEffect, useState } from "react";
import { useLocalSearchParams } from "expo-router";
import { useAuth } from "../../src/providers/auth-provider";

type PublicFormRow = {
  form_id: string;
  form_name: string;
  form_description: string;
  form_schema: { fields?: Array<{ id: string; label: string; type: string; required?: boolean }> } | null;
  is_locked: boolean;
};

export default function PublicFormPage() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const { supabase, configError } = useAuth();

  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [accessCode, setAccessCode] = useState("");
  const [form, setForm] = useState<PublicFormRow | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [step, setStep] = useState(0);
  const inputClass =
    "w-full rounded-lg border border-[#2a3040] bg-[#0a0d13] px-3 py-2 text-sm text-[#dbe3f5] outline-none focus:border-[#465067] focus:ring-0";
  const buttonClass =
    "rounded-lg border border-[#2d313c] bg-[#121722] px-3 py-2 text-sm text-[#dbe3f5] transition hover:bg-[#171d2a] disabled:opacity-50";

  const loadForm = useCallback(
    async (code?: string) => {
      if (!supabase || !slug) return;
      setLoading(true);
      setError(null);
      try {
        const { data, error: rpcError } = await supabase.rpc("forms_public_get_by_slug", {
          p_slug: slug,
          p_access_code: code ?? null,
        });
        if (rpcError) throw rpcError;
        const row = Array.isArray(data) ? ((data[0] ?? null) as PublicFormRow | null) : null;
        if (!row) {
          setForm(null);
          setError("Form link not found or no longer active.");
          return;
        }
        setForm(row);
        setStep(0);
      } catch (nextError: any) {
        setForm(null);
        setError(nextError?.message ?? "Unable to load form.");
      } finally {
        setLoading(false);
      }
    },
    [slug, supabase]
  );

  useEffect(() => {
    void loadForm();
  }, [loadForm]);

  const fields = form?.form_schema?.fields ?? [];
  const currentField = fields[step] ?? null;
  const isLastStep = step >= Math.max(0, fields.length - 1);

  const canProceedStep = () => {
    if (!currentField?.required) return true;
    return !!`${answers[currentField.id] ?? ""}`.trim();
  };

  const submitForm = async () => {
    if (!supabase || !slug || !form) return;

    const missingRequired = fields.find((field) => field.required && !`${answers[field.id] ?? ""}`.trim());
    if (missingRequired) {
      setError(`Fill required field: ${missingRequired.label}`);
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const { error: rpcError } = await supabase.rpc("forms_public_submit", {
        p_slug: slug,
        p_answers: answers,
        p_meta: {
          userAgent: typeof navigator !== "undefined" ? navigator.userAgent : null,
        },
        p_access_code: accessCode || null,
      });
      if (rpcError) throw rpcError;
      setDone(true);
    } catch (nextError: any) {
      setError(nextError?.message ?? "Submission failed.");
    } finally {
      setSubmitting(false);
    }
  };

  const nextStep = () => {
    if (!currentField) return;
    if (!canProceedStep()) {
      setError(`Fill required field: ${currentField.label}`);
      return;
    }
    setError(null);
    setStep((current) => Math.min(current + 1, fields.length - 1));
  };

  const previousStep = () => {
    setError(null);
    setStep((current) => Math.max(0, current - 1));
  };

  if (configError || !supabase) {
    return <div className="grid min-h-screen place-content-center text-[#d6dbe7]">{configError ?? "Supabase unavailable."}</div>;
  }

  if (done) {
    return (
      <div className="grid min-h-screen place-content-center bg-[#090b10] px-4 text-center text-[#dbe3f5]">
        <div>
          <h1 className="text-3xl font-semibold">Thanks</h1>
          <p className="mt-2 text-[#9aa6bf]">Your submission was recorded.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#090b10] px-4 py-12 text-[#dbe3f5]">
      <div className="mx-auto w-full max-w-2xl rounded-2xl border border-[#202634] bg-[#0f121a] p-6 space-y-4">
        <h1 className="text-2xl font-semibold">{form?.form_name ?? "Shared form"}</h1>
        {form?.form_description ? <p className="text-sm text-[#9aa6bf]">{form.form_description}</p> : null}
        {error ? <p className="rounded-lg border border-[#3b2630] bg-[#22131a] px-3 py-2 text-sm text-[#f2b8c6]">{error}</p> : null}

        {loading ? <p className="text-sm text-[#9aa6bf]">Loading...</p> : null}

        {form?.is_locked ? (
          <div className="space-y-3">
            <p className="text-sm text-[#9aa6bf]">This form is protected by an access code.</p>
            <input
              className={inputClass}
              type="password"
              value={accessCode}
              onChange={(event) => setAccessCode(event.target.value)}
              placeholder="Enter access code"
            />
            <button
              className={buttonClass}
              onClick={() => void loadForm(accessCode)}
            >
              Unlock form
            </button>
          </div>
        ) : null}

        {form && !form.is_locked ? (
          <div className="space-y-3">
            {fields.length ? (
              <>
                <p className="text-xs text-[#9aa6bf]">
                  Question {step + 1} of {fields.length}
                </p>
                <label key={currentField?.id} className="block space-y-1">
                  <span className="text-sm text-[#cfd8ea]">
                    {currentField?.label}
                    {currentField?.required ? <span className="text-[#f4a9ba]"> *</span> : null}
                  </span>
                  {currentField?.type === "long_text" ? (
                    <textarea
                      className={`min-h-24 ${inputClass}`}
                      value={(currentField && answers[currentField.id]) ?? ""}
                      onChange={(event) =>
                        currentField && setAnswers((current) => ({ ...current, [currentField.id]: event.target.value }))
                      }
                    />
                  ) : (
                    <input
                      className={inputClass}
                      type={
                        currentField?.type === "email"
                          ? "email"
                          : currentField?.type === "number"
                            ? "number"
                            : "text"
                      }
                      value={(currentField && answers[currentField.id]) ?? ""}
                      onChange={(event) =>
                        currentField && setAnswers((current) => ({ ...current, [currentField.id]: event.target.value }))
                      }
                    />
                  )}
                </label>
                <div className="flex items-center gap-2">
                  <button className={buttonClass} disabled={step === 0} onClick={previousStep}>
                    Previous
                  </button>
                  {isLastStep ? (
                    <button className={buttonClass} disabled={submitting} onClick={() => void submitForm()}>
                      {submitting ? "Submitting..." : "Submit"}
                    </button>
                  ) : (
                    <button className={buttonClass} onClick={nextStep}>
                      Next
                    </button>
                  )}
                </div>
              </>
            ) : (
              <button className={buttonClass} disabled={submitting} onClick={() => void submitForm()}>
                {submitting ? "Submitting..." : "Submit"}
              </button>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
