type MindmapEmptyStateProps = {
  icon: string;
  title: string;
  description: string;
};

export function MindmapEmptyState({ icon, title, description }: MindmapEmptyStateProps) {
  return (
    <div className="grid h-full place-content-center gap-3 text-center">
      <div className="text-[40px]" aria-hidden="true">
        {icon}
      </div>
      <h2 className="text-[16px] font-bold text-[#c0c5d4]">{title}</h2>
      <p className="max-w-[280px] text-[12px] text-[#5a5f6e]">{description}</p>
    </div>
  );
}

export function MindmapLoadingState() {
  return (
    <div className="grid h-full place-content-center text-center">
      <div className="flex flex-col items-center gap-3">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#303429] border-t-emerald-500" />
        <p className="text-[12px] text-[#7a846a]">Loading mindmap...</p>
      </div>
    </div>
  );
}
