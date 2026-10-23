"use client";

import { useEffect, useRef, useState } from "react";
import { formatDate, formatINR } from "@/lib/format";
import type { AphRate } from "@/lib/types";
import { Field } from "@/components/ui";

/**
 * APH rate picker. Choosing a card row fills the programme and amount; editing
 * the amount away from the card reveals the reason the database requires.
 */
export function RateFields({ rates }: { rates: AphRate[] }) {
  const [rateId, setRateId] = useState("");
  const [program, setProgram] = useState("");
  const [amount, setAmount] = useState("");
  const selectRef = useRef<HTMLSelectElement>(null);
  const rate = rates.find((r) => r.id === rateId) ?? null;
  const differs = rate !== null && Number(amount) !== Number(rate.amount);

  // The form resets itself after a successful submit; controlled fields have to
  // follow, or they keep the previous demand's figures.
  useEffect(() => {
    const form = selectRef.current?.form;
    if (!form) return;
    const onReset = () => {
      setRateId("");
      setProgram("");
      setAmount("");
    };
    form.addEventListener("reset", onReset);
    return () => form.removeEventListener("reset", onReset);
  }, []);

  return (
    <>
      <Field label="APH rate card" htmlFor="aph_rate_id" hint="Choosing a row fills the programme and the APH amount.">
        <select
          ref={selectRef}
          id="aph_rate_id"
          name="aph_rate_id"
          className="input"
          value={rateId}
          onChange={(e) => {
            setRateId(e.target.value);
            const next = rates.find((r) => r.id === e.target.value);
            if (next) {
              setProgram(next.program_label);
              setAmount(String(next.amount));
            }
          }}
        >
          <option value="">Not in the rate card</option>
          {rates.map((r) => (
            <option key={r.id} value={r.id}>
              {r.program_label} — {formatINR(r.amount)}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Programme / course" htmlFor="program">
        <input
          id="program"
          name="program"
          className="input"
          value={program}
          onChange={(e) => setProgram(e.target.value)}
        />
      </Field>
      <Field label="Required amount (₹)" required htmlFor="required_amount">
        <input
          id="required_amount"
          name="required_amount"
          required
          inputMode="decimal"
          className="input num"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
      </Field>
      {rate && (
        <p className="text-xs text-slate-500 sm:col-span-2 lg:col-span-3">
          APH rate: {formatINR(rate.amount)} · {rate.source_note ?? "rate card"} · effective{" "}
          {formatDate(rate.effective_from)}
        </p>
      )}
      {differs && (
        <Field
          label="Override reason"
          required
          htmlFor="override_note"
          className="sm:col-span-2 lg:col-span-3"
          hint="The amount differs from the APH rate; the reason is written to the audit trail."
        >
          <input
            id="override_note"
            name="override_note"
            required
            className="input"
            placeholder="e.g. Government college — APH exemption"
          />
        </Field>
      )}
    </>
  );
}
