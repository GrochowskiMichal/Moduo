import { useEffect, useState } from "react";
import { Keyboard, X } from "lucide-react";

const SHORTCUTS = [
    { keys: "N", label: "Add a new node" },
    { keys: "Drag on canvas", label: "Box-select nodes and connections" },
    { keys: "Shift + Click", label: "Toggle-select node/connection" },
    { keys: "Cmd/Ctrl (hold)", label: "Hand mode: pan canvas" },
    { keys: "Backspace / Delete", label: "Delete selected items" },
    { keys: "Cmd/Ctrl + Click node", label: "Open node inline editor" },
    { keys: "Cmd/Ctrl + Click connection", label: "Open connection style menu" },
    { keys: "Tab", label: "Add child node" },
    { keys: "Enter", label: "Add sibling node" },
    { keys: "Cmd/Ctrl + D", label: "Duplicate selected items" },
    { keys: "Cmd/Ctrl + Z", label: "Undo" },
    { keys: "Cmd/Ctrl + Shift + Z", label: "Redo" },
    { keys: "Esc", label: "Close active editor / clear selection" },
];

export function MindmapToolbar() {
    const [isOpen, setIsOpen] = useState(false);

    useEffect(() => {
        if (!isOpen || typeof window === "undefined") return;
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") setIsOpen(false);
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [isOpen]);

    return (
        <>
            <nav
                className="absolute bottom-4 left-1/2 z-20 -translate-x-1/2 rounded-2xl bg-[#111111]/90 p-2 shadow-[0_16px_36px_rgba(0,0,0,0.62),0_6px_14px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.05)] backdrop-blur-xl"
                role="toolbar"
                aria-label="Mindmap toolbar"
            >
                <button
                    type="button"
                    onClick={() => setIsOpen(true)}
                    className="p-2 text-[#9ea3ae] transition-none focus-visible:rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                    aria-label="Open keyboard shortcuts"
                    title="Keyboard shortcuts"
                >
                    <Keyboard size={18} />
                </button>
            </nav>

            {isOpen ? (
                <div className="absolute inset-0 z-[120] flex items-center justify-center bg-black/45 p-4">
                    <div className="w-full max-w-[520px] rounded-2xl border border-[#2a2a2a] bg-[#141414]/95 p-4 shadow-2xl backdrop-blur-xl">
                        <div className="mb-3 flex items-center">
                            <h2 className="text-[14px] font-semibold text-[#f1f1f1]">Keyboard shortcuts</h2>
                            <button
                                type="button"
                                onClick={() => setIsOpen(false)}
                                className="ml-auto rounded-lg p-1.5 text-[#9ea3ae] transition-colors hover:bg-[#202020] hover:text-[#f1f1f1]"
                                aria-label="Close shortcuts modal"
                            >
                                <X size={14} />
                            </button>
                        </div>
                        <ul className="space-y-1.5">
                            {SHORTCUTS.map((item) => (
                                <li key={item.keys} className="flex items-center gap-3 rounded-lg bg-[#1a1a1a] px-3 py-2">
                                    <span className="min-w-[170px] rounded-md bg-[#202020] px-2 py-1 text-[11px] font-semibold text-[#d8d8d8]">
                                        {item.keys}
                                    </span>
                                    <span className="text-[12px] text-[#b0b0b0]">{item.label}</span>
                                </li>
                            ))}
                        </ul>
                    </div>
                </div>
            ) : null}
        </>
    );
}
