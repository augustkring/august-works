const purposes = [
  ["native_task_execution", "Assist agents with assigned tasks"],
  ["general_work", "Support general internal reasoning"],
  ["foundation_bootstrap", "Draft company knowledge for review"],
] as const;
export function CognitivePurposeSelector({ id, value, onChange }: { id: string; value: string; onChange: (value: string) => void }) {
  return <div className="space-y-2"><label htmlFor={id}>How may this knowledge be used?</label><select id={id} className="w-full rounded-md border border-input bg-background p-2" value={value} onChange={(event) => onChange(event.target.value)}>{purposes.map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></div>;
}
