import type { ReactNode } from "react";
import { formatMoney } from "@/domain/money";
import type { DealListRow } from "@/services/deals";

const STATUS_CLASS: Record<DealListRow["status"], string> = {
  active: "text-ink",
  won: "text-won",
  lost: "text-lost",
  on_hold: "text-risk",
};

const STATUS_LABEL: Record<DealListRow["status"], string> = {
  active: "Active",
  won: "Won",
  lost: "Lost",
  on_hold: "On hold",
};

// Reference/name are deliberately plain text, not a link to /deals/[id] - that route doesn't
// exist yet (docs/07-build-backlog.md M1.6, a later milestone), and a link to a 404 is worse than
// no link.
export function PipelineTable({ deals }: { deals: DealListRow[] }) {
  return (
    <div className="overflow-x-auto rounded-token border border-line">
      <table className="w-full min-w-[900px] text-[13.5px]">
        <thead className="bg-raised text-left text-ink">
          <tr>
            <Th>Reference</Th>
            <Th>Name</Th>
            <Th>Account</Th>
            <Th>Practice line</Th>
            <Th>Stage</Th>
            <Th>Owner</Th>
            <Th>Client</Th>
            <Th>Forecast</Th>
            <Th>Expected close</Th>
            <Th>Value</Th>
            <Th>Weighted</Th>
            <Th>Status</Th>
          </tr>
        </thead>
        <tbody>
          {deals.map((deal) => (
            <tr key={deal.id} className="border-t border-line">
              <Td className="font-medium">{deal.reference}</Td>
              <Td>{deal.name}</Td>
              <Td>{deal.accountName}</Td>
              <Td>{deal.practiceLineName}</Td>
              <Td>{deal.stage.name}</Td>
              <Td>{deal.ownerName ?? "—"}</Td>
              <Td className="capitalize">{deal.clientType}</Td>
              <Td className="capitalize">{deal.forecastCategory.replace("_", " ")}</Td>
              <Td>{deal.expectedCloseDate ?? "—"}</Td>
              <Td>{deal.value ? formatMoney(deal.value) : "—"}</Td>
              <Td>{deal.weightedValue ? formatMoney(deal.weightedValue) : "—"}</Td>
              <Td className={STATUS_CLASS[deal.status]}>{STATUS_LABEL[deal.status]}</Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Th({ children }: { children: ReactNode }) {
  return <th className="px-3 py-2 font-medium">{children}</th>;
}

function Td({ children, className }: { children: ReactNode; className?: string }) {
  return <td className={`px-3 py-2 text-ink ${className ?? ""}`}>{children}</td>;
}
