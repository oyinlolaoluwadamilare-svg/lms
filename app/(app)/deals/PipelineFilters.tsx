interface Option {
  id: string;
  label: string;
}

// A plain GET form, not a client component: filters are just the URL's search params, and Next
// re-renders the server component page from them on submit. No client-side state to keep in sync,
// no JS required for the filters to work at all.
export function PipelineFilters({
  accounts,
  practiceLines,
  stages,
  owners,
  values,
  view,
}: {
  accounts: Option[];
  practiceLines: Option[];
  stages: Option[];
  owners: Option[];
  values: Record<string, string | undefined>;
  view?: string;
}) {
  return (
    <form method="get" className="flex flex-wrap items-end gap-3 rounded-token border border-line bg-raised p-4">
      {view ? <input type="hidden" name="view" value={view} /> : null}
      <Select name="stage" label="Stage" value={values.stage} options={stages} />
      <Select name="owner" label="Owner" value={values.owner} options={owners} />
      <Select name="practiceLine" label="Practice line" value={values.practiceLine} options={practiceLines} />
      <Select name="account" label="Account" value={values.account} options={accounts} />
      <Select
        name="clientType"
        label="Client type"
        value={values.clientType}
        options={[
          { id: "new", label: "New" },
          { id: "existing", label: "Existing" },
        ]}
      />
      <Select
        name="forecastCategory"
        label="Forecast category"
        value={values.forecastCategory}
        options={[
          { id: "pipeline", label: "Pipeline" },
          { id: "best_case", label: "Best case" },
          { id: "commit", label: "Commit" },
          { id: "closed", label: "Closed" },
        ]}
      />
      <Select
        name="status"
        label="Status"
        value={values.status}
        options={[
          { id: "active", label: "Active" },
          { id: "won", label: "Won" },
          { id: "lost", label: "Lost" },
          { id: "on_hold", label: "On hold" },
        ]}
      />

      <div className="flex flex-col gap-1.5">
        <label htmlFor="closeFrom" className="text-sm font-medium text-ink">
          Close date from
        </label>
        <input
          id="closeFrom"
          name="closeFrom"
          type="date"
          defaultValue={values.closeFrom ?? ""}
          className="rounded-token border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:ring-2 focus:ring-accent"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="closeTo" className="text-sm font-medium text-ink">
          Close date to
        </label>
        <input
          id="closeTo"
          name="closeTo"
          type="date"
          defaultValue={values.closeTo ?? ""}
          className="rounded-token border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:ring-2 focus:ring-accent"
        />
      </div>

      <div className="flex gap-2">
        <button
          type="submit"
          className="rounded-token bg-accent px-4 py-2 text-sm font-medium text-surface outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          Apply filters
        </button>
        <a
          href="/deals"
          className="rounded-token border border-line px-4 py-2 text-sm font-medium text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          Clear
        </a>
      </div>
    </form>
  );
}

function Select({
  name,
  label,
  value,
  options,
}: {
  name: string;
  label: string;
  value: string | undefined;
  options: Option[];
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={name} className="text-sm font-medium text-ink">
        {label}
      </label>
      <select
        id={name}
        name={name}
        defaultValue={value ?? ""}
        className="rounded-token border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:ring-2 focus:ring-accent"
      >
        <option value="">Any</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}
