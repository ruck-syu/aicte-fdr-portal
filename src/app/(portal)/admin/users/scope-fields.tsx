"use client";

import { useState } from "react";
import { CLEARANCE_CELL_LABELS, REGION_LABELS, ROLE_LABELS } from "@/lib/labels";
import type { AppRole, ClearanceCell, Region } from "@/lib/types";
import { Field } from "@/components/ui";

/** Role picker that only shows the scope field the chosen role needs. */
export function ScopeFields({
  idPrefix,
  institutions,
  defaults,
}: {
  idPrefix: string;
  institutions: { id: string; name: string; aicte_id: string }[];
  defaults?: {
    role: AppRole | null;
    institution_id: string | null;
    region: Region | null;
    clearance_cell: ClearanceCell | null;
  };
}) {
  const [role, setRole] = useState<string>(defaults?.role ?? "");
  return (
    <>
      <Field label="Role" required htmlFor={`${idPrefix}-role`}>
        <select
          id={`${idPrefix}-role`}
          name="role"
          required
          className="input"
          value={role}
          onChange={(e) => setRole(e.target.value)}
        >
          <option value="" disabled>
            Select role…
          </option>
          {Object.entries(ROLE_LABELS).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </Field>
      {role === "institute_user" && (
        <Field label="Institution" required htmlFor={`${idPrefix}-inst`}>
          <select
            id={`${idPrefix}-inst`}
            name="institution_id"
            required
            className="input"
            defaultValue={defaults?.institution_id ?? ""}
          >
            <option value="" disabled>
              Select institution…
            </option>
            {institutions.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name} ({i.aicte_id})
              </option>
            ))}
          </select>
        </Field>
      )}
      {role === "regional_officer" && (
        <Field label="Region" required htmlFor={`${idPrefix}-region`}>
          <select id={`${idPrefix}-region`} name="region" required className="input" defaultValue={defaults?.region ?? ""}>
            <option value="" disabled>
              Select region…
            </option>
            {Object.entries(REGION_LABELS).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </Field>
      )}
      {role === "release_officer" && (
        <Field label="Clearance cell" required htmlFor={`${idPrefix}-cell`} hint="The officer signs releases for this cell only">
          <select id={`${idPrefix}-cell`} name="clearance_cell" required className="input" defaultValue={defaults?.clearance_cell ?? ""}>
            <option value="" disabled>
              Select cell…
            </option>
            {Object.entries(CLEARANCE_CELL_LABELS).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </Field>
      )}
    </>
  );
}
