"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { TeamAssignmentRow, TeamLeadOption } from "@/services/teamAssignments";
import { setTeamAssignmentManagerAction } from "./actions";

interface TeamAssignmentsAdminProps {
  assignments: TeamAssignmentRow[];
  teamLeadsByPracticeLineId: Record<string, TeamLeadOption[]>;
}

// M6.5 (docs/07-build-backlog.md): grouped by practice line, since a BDE's own eligible managers
// are exactly that practice line's own Team Leads (migration 0021's own validate_user_roles_manager()
// trigger enforces this server-side regardless of what this picker offers - CLAUDE.md #1).
export function TeamAssignmentsAdmin({ assignments, teamLeadsByPracticeLineId }: TeamAssignmentsAdminProps) {
  const router = useRouter();

  const [drafts, setDrafts] = useState<Record<string, string>>(
    Object.fromEntries(assignments.map((a) => [a.userRoleId, a.managerId ?? ""])),
  );
  const [savingId, setSavingId] = useState<string | null>(null);
  const [errorId, setErrorId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const byPractice = new Map<string, TeamAssignmentRow[]>();
  for (const assignment of assignments) {
    const list = byPractice.get(assignment.practiceLineName);
    if (list) list.push(assignment);
    else byPractice.set(assignment.practiceLineName, [assignment]);
  }

  async function handleSave(assignment: TeamAssignmentRow) {
    if (savingId) return;
    setSavingId(assignment.userRoleId);
    setErrorId(null);
    setError(null);

    const result = await setTeamAssignmentManagerAction({
      userRoleId: assignment.userRoleId,
      managerId: drafts[assignment.userRoleId] ?? "",
    });

    setSavingId(null);
    if (!result.ok) {
      setErrorId(assignment.userRoleId);
      setError(result.message);
      return;
    }
    router.refresh();
  }

  if (assignments.length === 0) {
    return <p className="text-sm text-muted">No BDEs are configured yet.</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      {[...byPractice.entries()].map(([practiceLineName, rows]) => {
        const teamLeads = teamLeadsByPracticeLineId[rows[0]!.practiceLineId] ?? [];
        return (
          <section key={practiceLineName} className="flex flex-col gap-3 rounded-token border border-line bg-raised p-6">
            <h2 className="text-sm font-semibold text-ink">{practiceLineName}</h2>
            {teamLeads.length === 0 ? (
              <p className="text-sm text-muted">No Team Lead is configured for this practice line yet.</p>
            ) : null}
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs font-medium text-muted">
                  <th className="pb-2 pr-4 font-medium">BDE</th>
                  <th className="pb-2 pr-4 font-medium">Reports to</th>
                  <th className="pb-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {rows.map((assignment) => (
                  <tr key={assignment.userRoleId} className="border-t border-line">
                    <td className="py-2 pr-4 text-ink">{assignment.fullName}</td>
                    <td className="py-2 pr-4">
                      <select
                        value={drafts[assignment.userRoleId] ?? ""}
                        onChange={(e) => setDrafts((prev) => ({ ...prev, [assignment.userRoleId]: e.target.value }))}
                        disabled={teamLeads.length === 0}
                        className="w-48 rounded-token border border-line bg-surface px-3 py-1.5 text-ink outline-none focus:ring-2 focus:ring-accent disabled:opacity-60"
                      >
                        <option value="">Unassigned</option>
                        {teamLeads.map((teamLead) => (
                          <option key={teamLead.id} value={teamLead.id}>
                            {teamLead.fullName}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="py-2">
                      <button
                        type="button"
                        onClick={() => handleSave(assignment)}
                        disabled={savingId === assignment.userRoleId}
                        className="rounded-token border border-line px-3 py-1.5 text-xs font-medium text-ink outline-none hover:bg-surface focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60"
                      >
                        {savingId === assignment.userRoleId ? "Saving…" : "Save"}
                      </button>
                      {errorId === assignment.userRoleId && error ? (
                        <p role="alert" aria-live="polite" className="mt-1 text-xs text-lost">
                          {error}
                        </p>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        );
      })}
    </div>
  );
}
