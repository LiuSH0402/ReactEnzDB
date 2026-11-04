export default function Badge({ children, tone = "blue" }: { children: React.ReactNode; tone?: "blue" | "green" | "amber" | "slate" }) {
  const tones = {
    blue: "bg-primary/10 text-primary border-primary/20",
    green: "bg-green/10 text-green border-green/20",
    amber: "bg-amber-100 text-amber-800 border-amber-200",
    slate: "bg-slate-100 text-slate-600 border-slate-200 dark:bg-white/10 dark:text-white/70 dark:border-white/10",
  };
  return (
    <span className={`inline-flex items-center rounded-[2px] border px-2.5 py-1 text-xs font-semibold ${tones[tone]}`}>
      {children}
    </span>
  );
}
