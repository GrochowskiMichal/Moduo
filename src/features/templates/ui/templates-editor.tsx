import { DocumentType, templateSchemas, docTypeLabels, FieldDefinition } from "./template-schema";

interface TemplatesEditorProps {
    docType: DocumentType;
    setDocType: (type: DocumentType) => void;
    data: any;
    setData: (data: any) => void;
    activeTab: "data" | "design";
    setActiveTab: (tab: "data" | "design") => void;
    docMenuOpen: boolean;
    setDocMenuOpen: (open: boolean) => void;
}

export function TemplatesEditor({
    docType,
    setDocType,
    data,
    setData,
    activeTab,
    setActiveTab,
    docMenuOpen,
    setDocMenuOpen,
}: TemplatesEditorProps) {
    const schema = templateSchemas[docType] || [];

    const handleFieldChange = (key: string, value: any) => {
        setData({ ...data, [key]: value });
    };

    const handleListChange = (listKey: string, itemId: number, fieldKey: string, value: any) => {
        const list = data[listKey] || [];
        const updated = list.map((item: any) => (item.id === itemId ? { ...item, [fieldKey]: value } : item));
        setData({ ...data, [listKey]: updated });
    };

    const addListItem = (listKey: string) => {
        const list = data[listKey] || [];
        setData({ ...data, [listKey]: [...list, { id: Date.now() }] });
    };

    const removeListItem = (listKey: string, itemId: number) => {
        const list = data[listKey] || [];
        setData({ ...data, [listKey]: list.filter((item: any) => item.id !== itemId) });
    };

    const renderField = (field: Exclude<FieldDefinition, { type: "group" } | { type: "list" }>) => {
        return (
            <div key={field.key} className="flex flex-col gap-2">
                <label className="text-[12px] font-bold text-[#888]">{field.label}</label>
                {field.type === "textarea" ? (
                    <textarea
                        rows={4}
                        className="w-full rounded-xl border border-[#333] bg-[#161616] px-3 py-2 text-[13px] text-[#ccc] outline-none hover:border-[#444] focus:border-[#555] transition-all custom-scrollbar leading-relaxed"
                        value={data[field.key] || ""}
                        onChange={(e) => handleFieldChange(field.key, e.target.value)}
                    />
                ) : field.type === "date" ? (
                    <input
                        type="date"
                        className="w-full rounded-xl border border-[#333] bg-[#161616] px-3 py-2 text-[13px] text-[#f3f3f3] outline-none color-scheme-dark hover:border-[#444] focus:border-[#555] transition-all"
                        value={data[field.key] || ""}
                        onChange={(e) => handleFieldChange(field.key, e.target.value)}
                    />
                ) : (
                    <input
                        type={field.type}
                        className="w-full rounded-xl border border-[#333] bg-[#161616] px-3 py-2 text-[13px] text-[#f3f3f3] outline-none hover:border-[#444] focus:border-[#555] transition-all font-medium"
                        value={data[field.key] || ""}
                        onChange={(e) => handleFieldChange(field.key, e.target.value)}
                    />
                )}
            </div>
        );
    };

    const renderList = (field: Extract<FieldDefinition, { type: "list" }>) => {
        const items = data[field.key] || [];
        return (
            <div key={field.key} className="space-y-4">
                <div className="flex items-center justify-between">
                    <h3 className="text-[11px] font-black uppercase tracking-widest text-[#555]">{field.label}</h3>
                    <button onClick={() => addListItem(field.key)} className="text-[12px] font-bold text-[#bcbcbc] hover:text-[#e2e2e2] transition-colors">
                        + Add {field.itemLabel}
                    </button>
                </div>
                <div className="flex flex-col gap-3">
                    {items.map((item: any) => (
                        <div key={item.id} className="group relative rounded-2xl border border-[#2a2a2a] bg-[#141414] p-4 flex flex-col gap-3">
                            <button
                                onClick={() => removeListItem(field.key, item.id)}
                                className="absolute right-3 top-3 opacity-0 group-hover:opacity-100 p-1.5 text-[#555] hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-all"
                            >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6L6 18M6 6l12 12" /></svg>
                            </button>

                            <div className="flex flex-wrap gap-4 pr-6">
                                {field.columns.map((col) => (
                                    <div key={col.key} className={`flex flex-col gap-1.5 ${col.type === "number" ? "w-24" : "flex-1 min-w-[120px]"}`}>
                                        <label className="text-[10px] font-bold text-[#666]">{col.label}</label>
                                        <input
                                            type={col.type}
                                            className="w-full bg-[#1a1a1a] rounded-lg px-2 py-1.5 text-[13px] text-[#ddd] outline-none border border-[#333] focus:border-[#555]"
                                            value={item[col.key] || ""}
                                            onChange={(e) => handleListChange(field.key, item.id, col.key, col.type === "number" ? Number(e.target.value) : e.target.value)}
                                        />
                                    </div>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        );
    };

    return (
        <div className="flex h-full w-full min-w-0 flex-col bg-[#111111]">
            <div className="flex flex-col border-b border-[#222222]">
                <div className="flex h-16 items-center justify-between px-6">
                    <div className="flex items-center gap-3">
                        <div className="grid h-8 w-8 place-items-center rounded-lg bg-[#2a2a2a] text-[#d0d0d0]">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" /><polyline points="14 2 14 8 20 8" /><path d="M16 13H8" /><path d="M16 17H8" /><path d="M10 9H8" /></svg>
                        </div>
                        <h1 className="text-[16px] font-bold text-[#f3f3f3] tracking-tight">Template Builder</h1>
                    </div>
                </div>

                <div className="px-6 pb-4 pt-2 relative">
                    <label className="text-[11px] font-bold uppercase tracking-widest text-[#555] mb-2 block">Document Type</label>
                    <button
                        onClick={() => setDocMenuOpen(!docMenuOpen)}
                        className="flex w-full items-center justify-between rounded-xl border border-[#333] bg-[#161616] px-4 py-3 text-[13px] font-bold text-[#f3f3f3] hover:border-[#555] focus:border-[#555] transition-all shadow-inner shadow-black/40"
                    >
                        <div className="flex items-center gap-2 drop-shadow-sm">
                            <div className="h-3 w-3 rounded-full" style={{ backgroundColor: data.primaryColor || "#3a3a3a" }} />
                            <span>{docTypeLabels[docType]}</span>
                        </div>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#888" strokeWidth="2.5"><polyline points="6 9 12 15 18 9" /></svg>
                    </button>

                    {docMenuOpen && (
                        <>
                            <div className="fixed inset-0 z-40" onClick={() => setDocMenuOpen(false)} />
                            <div className="absolute left-6 right-6 top-[72px] z-50 mt-2 flex flex-col gap-1 rounded-xl border border-[#333] bg-[#1a1a1a] p-2 shadow-2xl max-h-[300px] overflow-y-auto custom-scrollbar">
                                {(Object.keys(docTypeLabels) as DocumentType[]).map((type) => (
                                    <button
                                        key={type}
                                        onClick={() => {
                                            setDocType(type);
                                            setDocMenuOpen(false);
                                        }}
                                        className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[13px] font-bold transition-all ${docType === type ? "bg-[#333] text-white" : "text-[#aaa] hover:bg-[#222] hover:text-[#f3f3f3]"
                                            }`}
                                    >
                                        <span>{docTypeLabels[type]}</span>
                                        {docType === type && <svg className="ml-auto" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#b5b5b5" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>}
                                    </button>
                                ))}
                            </div>
                        </>
                    )}
                </div>
            </div>

            <div className="flex border-b border-[#222222] px-4 pt-2 gap-2">
                <button onClick={() => setActiveTab("data")} className={`px-4 py-2.5 text-[13px] font-bold border-b-2 transition-all ${activeTab === "data" ? "border-[#555] text-[#d0d0d0]" : "border-transparent text-[#666] hover:text-[#aaa]"}`}>Document Data</button>
                <button onClick={() => setActiveTab("design")} className={`px-4 py-2.5 text-[13px] font-bold border-b-2 transition-all ${activeTab === "design" ? "border-[#555] text-[#d0d0d0]" : "border-transparent text-[#666] hover:text-[#aaa]"}`}>Design & Styling</button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">
                {activeTab === "data" ? (
                    <div className="flex flex-col gap-8">
                        {schema.map((section, idx) => {
                            if (section.type === "group") {
                                return (
                                    <div key={idx} className="space-y-4">
                                        <h3 className="text-[11px] font-black uppercase tracking-widest text-[#555]">{section.label}</h3>
                                        <div className="grid grid-cols-2 gap-4">
                                            {section.fields.map((f: any) => (
                                                <div key={f.key} className={f.type === "textarea" ? "col-span-2" : "col-span-1"}>
                                                    {renderField(f)}
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                );
                            }
                            if (section.type === "list") {
                                return renderList(section);
                            }
                            return null;
                        })}
                    </div>
                ) : (
                    <div className="flex flex-col gap-8">
                        <div className="space-y-4">
                            <h3 className="text-[11px] font-black uppercase tracking-widest text-[#555]">Color Theme</h3>
                            <div className="flex items-center justify-between rounded-xl border border-[#2a2a2a] bg-[#141414] p-4">
                                <div className="flex flex-col gap-1">
                                    <span className="text-[13px] font-bold text-[#eee]">Primary Brand Color</span>
                                    <span className="text-[11px] text-[#777]">Used to tint templates contextually.</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <input
                                        type="color"
                                        value={data.primaryColor || "#000"}
                                        onChange={(e) => handleFieldChange("primaryColor", e.target.value)}
                                        className="w-10 h-10 rounded-lg cursor-pointer border-0 bg-transparent p-0 [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:border-none [&::-webkit-color-swatch]:rounded-lg shadow"
                                    />
                                    <span className="text-[12px] font-mono font-bold text-[#aaa] uppercase">{data.primaryColor}</span>
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
