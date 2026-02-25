import { GripHorizontal, X } from "lucide-react";
import { createContext, useContext, type ReactNode } from "react";
import type { WidgetConfig } from "../../types";

type WidgetShellEditContextValue = {
  isLocked: boolean;
  onRemove: () => void;
  dragAttributes?: Record<string, unknown>;
  dragListeners?: Record<string, unknown>;
};

const WidgetShellEditContext = createContext<WidgetShellEditContextValue | null>(null);

export function WidgetShellEditProvider({
  value,
  children,
}: {
  value: WidgetShellEditContextValue;
  children: ReactNode;
}) {
  return <WidgetShellEditContext.Provider value={value}>{children}</WidgetShellEditContext.Provider>;
}

type Props = {
  config: WidgetConfig;
  title: string;
  controls?: ReactNode;
  className?: string;
  children: ReactNode;
};

export function WidgetShell({ config, title, controls, className = "flex h-full flex-col bg-[#111111]", children }: Props) {
  const edit = useContext(WidgetShellEditContext);
  const shouldRenderHeader = edit ? !edit.isLocked : true;
  const showTitle = !(edit && !edit.isLocked);

  return (
    <div className={`${className} min-h-0`}>
      {shouldRenderHeader ? (
        <div className="border-b border-[#212121] px-3 py-2">
          <div className="flex items-center justify-between gap-2">
            {showTitle ? <p className="text-[12px] font-semibold text-[#efefef]">{title}</p> : <span />}
            <div className="flex min-w-0 items-center justify-end gap-2">
              {controls}
              {edit && !edit.isLocked ? (
                <div className="flex items-center gap-1 rounded-md border border-[#2a2a2a] bg-[#161616] px-1 py-1">
                  <button
                    type="button"
                    {...(edit.dragListeners ?? {})}
                    {...(edit.dragAttributes ?? {})}
                    className="grid h-5 w-5 place-items-center cursor-grab text-[#848484] active:cursor-grabbing hover:text-[#d9d9d9]"
                    title="Drag widget"
                  >
                    <GripHorizontal size={12} strokeWidth={1.9} />
                  </button>
                  <button
                    type="button"
                    className="grid h-5 w-5 place-items-center text-[#888888] hover:text-[#f1a3a3]"
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.stopPropagation();
                      edit.onRemove();
                    }}
                    title="Remove widget"
                  >
                    <X size={12} strokeWidth={1.8} />
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}
