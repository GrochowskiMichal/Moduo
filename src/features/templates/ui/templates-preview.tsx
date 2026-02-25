import { DocumentType } from "./template-schema";

export function TemplatesPreview({ docType, data }: { docType: DocumentType; data: any }) {
    const p = data.primaryColor || "#333";

    // Shared Helper
    const FormattedValue = ({ val, type }: { val: any; type?: "currency" }) => {
        if (type === "currency" && typeof val === "number") {
            return `$${val.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
        }
        return val || "";
    };

    const renderContent = () => {
        switch (docType) {
            case "invoice": {
                const subtotal = data.items?.reduce((a: number, b: any) => a + (b.quantity || 0) * (b.price || 0), 0) || 0;
                return (
                    <div className="p-16">
                        <div className="flex justify-between items-start mb-16 border-b-2 pb-12 transition-colors" style={{ borderColor: `${p}20` }}>
                            <div><h1 className="text-[42px] font-black tracking-tighter text-gray-900 mb-2 leading-none">INVOICE</h1><p className="text-[16px] font-bold text-gray-400"># {data.invoiceNumber}</p></div>
                            <div className="text-right"><h2 className="text-[20px] font-black text-gray-900 mb-1">{data.companyName}</h2><p className="text-[13px] font-medium text-gray-500 whitespace-pre-wrap">{data.companyAddress}</p></div>
                        </div>
                        <div className="flex justify-between items-end mb-16">
                            <div><h3 className="text-[11px] font-bold uppercase tracking-widest text-gray-400 mb-2">Billed To</h3><h4 className="text-[18px] font-bold text-gray-900">{data.clientName}</h4><p className="text-[13px] font-medium text-gray-500 whitespace-pre-wrap">{data.clientAddress}</p></div>
                            <div className="text-right flex gap-12 bg-gray-50 p-5 rounded-2xl border border-gray-100">
                                <div><p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">Date</p><p className="text-[14px] font-bold text-gray-900">{data.date}</p></div>
                                <div><p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">Due</p><p className="text-[14px] font-bold text-gray-900">{data.dueDate}</p></div>
                            </div>
                        </div>
                        <div className="mb-12">
                            <div className="flex border-b-2 border-gray-100 pb-3 mb-4 transition-colors" style={{ borderBottomColor: `${p}30` }}>
                                <div className="flex-1 text-[11px] font-bold uppercase tracking-widest text-gray-400">Description</div>
                                <div className="w-24 text-center text-[11px] font-bold uppercase tracking-widest text-gray-400">Qty</div><div className="w-32 text-right text-[11px] font-bold uppercase tracking-widest text-gray-400">Price</div><div className="w-32 text-right text-[11px] font-bold uppercase tracking-widest text-gray-400">Amount</div>
                            </div>
                            {data.items?.map((item: any) => (
                                <div key={item.id} className="flex py-4 border-b border-gray-50 items-center">
                                    <div className="flex-1 text-[14px] font-bold text-gray-800">{item.description}</div>
                                    <div className="w-24 text-center text-[14px] font-medium text-gray-600">{item.quantity}</div>
                                    <div className="w-32 text-right text-[14px] font-medium text-gray-600"><FormattedValue val={item.price} type="currency" /></div>
                                    <div className="w-32 text-right text-[14px] font-bold text-gray-900"><FormattedValue val={(item.quantity || 0) * (item.price || 0)} type="currency" /></div>
                                </div>
                            ))}
                        </div>
                        <div className="flex justify-end">
                            <div className="w-80 rounded-2xl bg-gray-50/50 p-6 border border-gray-100/50">
                                <div className="flex justify-between mb-4 pb-4 border-b border-gray-200 text-[13px] font-bold text-gray-500"><span>Subtotal</span><span><FormattedValue val={subtotal} type="currency" /></span></div>
                                <div className="flex justify-between items-center text-[22px] font-black tracking-tight" style={{ color: p }}><span className="text-[14px] uppercase tracking-widest">Total</span><span><FormattedValue val={subtotal * 1.1} type="currency" /></span></div>
                            </div>
                        </div>
                    </div>
                );
            }
            case "proposal": return (
                <div className="p-16">
                    <div className="text-center mb-20 mt-10">
                        <h2 className="text-[14px] font-bold tracking-[0.2em] text-gray-400 uppercase mb-4 transition-colors">Project Proposal</h2>
                        <h1 className="text-[48px] font-black tracking-tight text-gray-900 leading-none mb-6 max-w-2xl mx-auto">{data.projectName}</h1>
                        <div className="w-24 h-1.5 mx-auto bg-gray-200 rounded-full transition-colors" style={{ backgroundColor: p }} />
                    </div>
                    <div className="grid grid-cols-2 gap-12 mb-16 p-8 rounded-3xl bg-gray-50 border border-gray-100">
                        <div><p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">Prepared For</p><p className="text-[16px] font-black text-gray-900">{data.clientName}</p></div>
                        <div><p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">Prepared By</p><p className="text-[16px] font-black text-gray-900">{data.preparedBy}</p></div>
                        <div className="col-span-2 border-t border-gray-200 pt-6"><p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">Date</p><p className="text-[14px] font-bold text-gray-700">{data.date}</p></div>
                    </div>
                    <div className="mb-12"><h3 className="text-[20px] font-black text-gray-900 mb-4 flex items-center gap-3"><span className="w-3 h-3 rounded-full" style={{ backgroundColor: p }} />Introduction</h3><p className="text-[15px] leading-relaxed text-gray-600">{data.introduction}</p></div>
                    <div className="mb-12"><h3 className="text-[20px] font-black text-gray-900 mb-4 flex items-center gap-3"><span className="w-3 h-3 rounded-full" style={{ backgroundColor: p }} />Scope of Work</h3><div className="p-6 rounded-2xl border-2" style={{ borderColor: `${p}20`, backgroundColor: `${p}05` }}><p className="text-[15px] leading-relaxed text-gray-800 font-medium whitespace-pre-wrap">{data.scope}</p></div></div>
                    <div className="grid grid-cols-2 gap-8 border-t-2 border-gray-100 pt-12">
                        <div><p className="text-[11px] font-bold uppercase tracking-widest text-gray-400 mb-2">Timeline</p><p className="text-[20px] font-black text-gray-900">{data.timeline}</p></div>
                        <div><p className="text-[11px] font-bold uppercase tracking-widest text-gray-400 mb-2">Investment</p><p className="text-[28px] font-black tracking-tight" style={{ color: p }}>{data.budget}</p></div>
                    </div>
                </div>
            );
            case "receipt": return (
                <div className="p-20">
                    <div className="flex justify-between items-center mb-16">
                        <div className="flex items-center gap-4"><div className="w-12 h-12 rounded-xl flex items-center justify-center text-white" style={{ backgroundColor: p }}><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg></div>
                            <div><h1 className="text-[28px] font-black tracking-tighter text-gray-900 leading-none mb-1">RECEIPT</h1><p className="text-[13px] font-bold text-gray-400">{data.companyName}</p></div>
                        </div>
                        <div className="text-right"><p className="text-[14px] font-black text-gray-900 mb-1">{data.receiptNumber}</p><p className="text-[12px] font-bold text-gray-500">{data.date}</p></div>
                    </div>
                    <div className="flex justify-between mb-12 p-8 rounded-3xl bg-gray-50 border border-gray-100">
                        <div><p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">Customer</p><p className="text-[15px] font-bold text-gray-900">{data.customerName}</p></div>
                        <div className="text-right"><p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">Payment Method</p><p className="text-[15px] font-bold text-gray-900">{data.paymentMethod}</p></div>
                    </div>
                    <div className="mb-12 text-[15px] font-bold text-gray-800">
                        {data.items?.map((item: any) => (<div key={item.id} className="flex justify-between border-b border-gray-50 py-5"><span>{item.desc}</span><span><FormattedValue val={item.price} type="currency" /></span></div>))}
                    </div>
                    <div className="flex justify-between items-center py-6 border-y-2 border-gray-100 border-dashed mb-[80px]">
                        <span className="text-[16px] font-black uppercase tracking-widest text-gray-400">Paid</span><span className="text-[36px] font-black tracking-tight" style={{ color: p }}><FormattedValue val={data.items?.reduce((a: number, b: any) => a + (b.price || 0), 0)} type="currency" /></span>
                    </div>
                </div>
            );
            case "contract": return (
                <div className="p-20 relative">
                    <div className="absolute top-0 right-0 w-32 h-32 opacity-10" style={{ backgroundColor: p, clipPath: 'polygon(100% 0, 0 0, 100% 100%)' }} />
                    <h1 className="text-[32px] font-black text-gray-900 mb-12 text-center underline decoration-2 underline-offset-8" style={{ textDecorationColor: p }}>{data.contractTitle}</h1>
                    <p className="text-[13px] text-gray-600 leading-loose text-justify mb-8">This Agreement is made on <strong>{data.effectiveDate}</strong>, by and between <strong>{data.providerName}</strong> ("Provider") and <strong>{data.clientName}</strong> ("Client").</p>
                    <div className="border-l-4 pl-6 py-2 mb-8" style={{ borderColor: p }}><p className="text-[14px] whitespace-pre-wrap leading-loose text-gray-800 font-medium font-serif">{data.terms}</p></div>
                    <div className="mt-16 text-[13px] text-gray-500 italic">Governing Law: {data.governingLaw}</div>
                    <div className="grid grid-cols-2 gap-16 mt-16 pt-16 border-t border-gray-200">
                        <div><div className="border-b border-gray-300 pb-2 mb-2"><span className="text-gray-400 text-[11px] uppercase tracking-widest">Sign:</span></div><p className="text-[14px] font-bold text-gray-800">{data.providerName}</p></div>
                        <div><div className="border-b border-gray-300 pb-2 mb-2"><span className="text-gray-400 text-[11px] uppercase tracking-widest">Sign:</span></div><p className="text-[14px] font-bold text-gray-800">{data.clientName}</p></div>
                    </div>
                </div>
            );
            case "nda": return (
                <div className="p-20">
                    <div className="flex items-center gap-4 border-b-4 pb-8 mb-12" style={{ borderBottomColor: p }}>
                        <div className="p-3 bg-gray-100 rounded-xl" style={{ color: p }}><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg></div>
                        <h1 className="text-[28px] font-black text-gray-900 uppercase tracking-widest leading-none mt-1 text-center w-full">NDA</h1>
                    </div>
                    <p className="text-[14px] leading-10 text-gray-800 font-medium mb-12">This Non-Disclosure Agreement is entered on <strong>{data.date}</strong> by <strong>{data.disclosingParty}</strong> and <strong>{data.receivingParty}</strong> for <strong>{data.purpose}</strong>.</p>
                    <div className="bg-gray-50 p-8 rounded-2xl mb-12 border border-gray-200"><h3 className="text-[16px] font-bold text-gray-900 mb-4 flex items-center gap-2">Obligations</h3><p className="text-[13px] text-gray-600 leading-loose">The Receiving Party shall hold and maintain the Confidential Information in strict confidence.</p></div>
                    <div className="bg-gray-50 p-8 rounded-2xl mb-16 border border-gray-200"><h3 className="text-[16px] font-bold text-gray-900 mb-4">Duration</h3><p className="text-[13px] text-gray-600 leading-loose">The duration shall be <strong>{data.durationYears} years</strong>.</p></div>
                    <div className="grid grid-cols-2 gap-20">
                        <div><div className="border-b-2 border-gray-300 h-10 mb-2"></div><p className="text-[12px] font-bold text-gray-400 uppercase tracking-widest">{data.disclosingParty}</p></div>
                        <div><div className="border-b-2 border-gray-300 h-10 mb-2"></div><p className="text-[12px] font-bold text-gray-400 uppercase tracking-widest">{data.receivingParty}</p></div>
                    </div>
                </div>
            );
            case "quote": return (
                <div className="p-16">
                    <div className="border-b-4 pb-12 mb-12 flex justify-between" style={{ borderColor: p }}>
                        <div><h1 className="text-[36px] font-black text-gray-900 mb-2">QUOTE</h1><p className="text-[16px] text-gray-500 font-mono">{data.quoteNumber}</p></div>
                        <div className="text-right"><h2 className="text-[20px] font-bold text-gray-800">{data.companyName}</h2><p className="text-[14px] text-gray-500 mt-2">To: {data.clientName}</p></div>
                    </div>
                    <div className="flex gap-16 mb-12 text-[14px]"><div className="flex gap-2"><span className="font-bold text-gray-400">Date:</span><span className="font-medium text-gray-900">{data.date}</span></div><div className="flex gap-2"><span className="font-bold text-gray-400">Valid Until:</span><span className="font-medium text-gray-900">{data.validUntil}</span></div></div>
                    <div className="mb-12">
                        <div className="flex border-b-2 border-gray-200 pb-3 mb-4 text-[12px] font-bold text-gray-400 uppercase tracking-widest"><div className="flex-1">Service</div><div className="w-24 text-center">Hrs/Qty</div><div className="w-32 text-right">Rate</div><div className="w-32 text-right">Ext</div></div>
                        {data.items?.map((item: any) => (<div key={item.id} className="flex py-4 border-b border-gray-50"><div className="flex-1 font-bold text-gray-800">{item.description}</div><div className="w-24 text-center text-gray-600">{item.quantity}</div><div className="w-32 text-right text-gray-600"><FormattedValue val={item.rate} type="currency" /></div><div className="w-32 text-right font-bold text-gray-900"><FormattedValue val={(item.quantity || 0) * (item.rate || 0)} type="currency" /></div></div>))}
                    </div>
                </div>
            );
            case "purchase_order": return (
                <div className="p-16 relative overflow-hidden">
                    <div className="absolute top-0 right-0 p-8 text-white rounded-bl-3xl" style={{ backgroundColor: p }}><h2 className="font-mono text-2xl font-bold">{data.poNumber}</h2><p className="text-sm tracking-widest uppercase opacity-80 mt-1">Purchase Order</p></div>
                    <h1 className="text-3xl font-black text-gray-900 mb-16 pt-10">{data.buyerName}</h1>
                    <div className="grid grid-cols-2 gap-12 mb-16">
                        <div><h3 className="text-sm font-bold text-gray-400 uppercase tracking-widest mb-2">Vendor</h3><p className="text-xl font-bold text-gray-900">{data.vendorName}</p></div>
                        <div><h3 className="text-sm font-bold text-gray-400 uppercase tracking-widest mb-2">Deliver To</h3><p className="text-md text-gray-600 whitespace-pre-wrap">{data.deliveryAddress}</p></div>
                    </div>
                    <table className="w-full text-left mb-16"><thead className="border-b-2 border-gray-200"><tr className="text-xs uppercase tracking-widest text-gray-400"><th className="pb-4">Product</th><th className="pb-4 text-center w-24">Qty</th><th className="pb-4 w-32 text-right">Unit Price</th><th className="pb-4 w-32 text-right">Total</th></tr></thead><tbody className="text-sm font-medium">
                        {data.items?.map((item: any) => (<tr key={item.id} className="border-b border-gray-50"><td className="py-5 text-gray-800 font-bold">{item.description}</td><td className="py-5 text-center text-gray-600">{item.quantity}</td><td className="py-5 text-right text-gray-600"><FormattedValue val={item.unitPrice} type="currency" /></td><td className="py-5 text-right text-gray-900 font-bold"><FormattedValue val={(item.quantity || 0) * (item.unitPrice || 0)} type="currency" /></td></tr>))}
                    </tbody></table>
                </div>
            );
            case "statement": return (
                <div className="p-16"><div className="text-center mb-16"><h1 className="text-3xl font-black text-gray-900 uppercase tracking-widest mb-2" style={{ color: p }}>Statement</h1><p className="text-gray-500">Account: {data.accountNumber}</p></div><div className="flex justify-between items-end border-b-2 pb-8 mb-8"><div><h3 className="text-lg font-bold text-gray-900">{data.clientName}</h3><p className="text-sm text-gray-500 mt-1">From: {data.companyName}</p></div><div className="text-right text-sm text-gray-500"><p className="mb-1"><strong>Period:</strong> {data.period}</p><p><strong>Issued:</strong> {data.date}</p></div></div>
                    <div className="mb-8"><div className="flex text-xs font-bold uppercase tracking-widest text-gray-400 border-b pb-3 mb-3"><div className="w-32">Date</div><div className="flex-1">Description</div><div className="w-32 text-right">Amount</div></div>
                        {data.transactions?.map((t: any) => (<div key={t.id} className="flex py-3 text-sm border-b border-gray-50"><div className="w-32 text-gray-500">{t.date}</div><div className="flex-1 font-bold text-gray-800">{t.description}</div><div className={`w-32 text-right font-bold ${t.amount < 0 ? 'text-[#6a6a6a]' : 'text-gray-900'}`}><FormattedValue val={t.amount} type="currency" /></div></div>))}</div></div>
            );
            case "certificate": return (
                <div className="p-12 h-full flex items-center justify-center">
                    <div className="w-full h-full border-[16px] rounded-3xl p-16 text-center flex flex-col justify-center relative overflow-hidden" style={{ borderColor: p }}>
                        <div className="w-64 h-64 absolute top-[-50px] right-[-50px] rounded-full opacity-5" style={{ backgroundColor: p }} />
                        <div className="w-96 h-96 absolute bottom-[-100px] left-[-100px] rounded-full opacity-5" style={{ backgroundColor: p }} />
                        <h2 className="text-xl font-bold uppercase tracking-[0.3em] mb-4 text-gray-500">Certificate of Completion</h2>
                        <h1 className="text-6xl font-black text-gray-900 mb-12 uppercase" style={{ color: p }}>{data.title}</h1>
                        <p className="text-lg text-gray-500 mb-4 antialiased">This is proudly presented to</p>
                        <h3 className="text-4xl font-serif italic text-gray-900 mb-8 border-b-2 pb-4 inline-block mx-auto px-16" style={{ borderColor: `${p}40` }}>{data.recipientName}</h3>
                        <p className="text-md text-gray-600 max-w-lg mx-auto leading-relaxed mb-24">{data.description}</p>
                        <div className="flex justify-between items-center w-full px-16 text-left">
                            <div><div className="border-b-2 border-gray-300 w-48 mb-2"></div><p className="text-sm font-bold text-gray-800">{data.date}</p><p className="text-xs text-gray-400 uppercase tracking-widest mt-1">Date Issued</p></div>
                            <div className="text-right"><div className="border-b-2 border-gray-300 w-48 mb-2 ml-auto"></div><p className="text-sm font-bold text-gray-800">{data.issuerName}</p><p className="text-xs text-gray-400 uppercase tracking-widest mt-1">{data.issuerTitle}</p></div>
                        </div>
                    </div>
                </div>
            );
            case "brief": return (
                <div className="p-16">
                    <div className="border-base border-4 rounded-3xl border-gray-900 p-12 relative">
                        <div className="absolute top-[-24px] left-12 bg-white px-6"><h1 className="text-3xl font-black text-gray-900">PROJECT BRIEF</h1></div>
                        <div className="grid grid-cols-2 gap-8 mb-12 pt-4"><div><h3 className="text-xs uppercase tracking-widest text-gray-400 mb-2">Project</h3><p className="text-xl font-black" style={{ color: p }}>{data.projectName}</p></div><div><h3 className="text-xs uppercase tracking-widest text-gray-400 mb-2">Client</h3><p className="text-xl font-bold text-gray-800">{data.clientName}</p></div></div>
                        <div className="space-y-12">
                            <div><h3 className="text-lg font-bold flex items-center gap-3 mb-4"><span className="w-4 h-4 rounded" style={{ backgroundColor: p }} /> Objective</h3><p className="text-base text-gray-600 leading-loose">{data.objective}</p></div>
                            <div><h3 className="text-lg font-bold flex items-center gap-3 mb-4"><span className="w-4 h-4 rounded" style={{ backgroundColor: p }} /> Target Audience</h3><p className="text-base text-gray-600 leading-loose">{data.targetAudience}</p></div>
                            <div className="p-6 rounded-xl bg-gray-50"><h3 className="text-sm font-black uppercase text-gray-900 mb-3">Deliverables</h3><p className="text-sm text-gray-700 whitespace-pre-wrap">{data.deliverables}</p></div>
                        </div>
                    </div>
                </div>
            );
            case "resume": return (
                <div className="p-16 flex flex-col h-full">
                    <div className="mb-12 border-l-8 pl-8" style={{ borderColor: p }}>
                        <h1 className="text-5xl font-black text-gray-900 mb-3">{data.name}</h1>
                        <h2 className="text-2xl font-bold text-gray-400 mb-4">{data.role}</h2>
                        <p className="text-sm text-gray-500 font-mono">{data.contact}</p>
                    </div>
                    <p className="text-base text-gray-700 leading-relaxed mb-12">{data.summary}</p>
                    <div className="grid grid-cols-3 gap-12">
                        <div className="col-span-2">
                            <h3 className="text-lg font-black uppercase tracking-widest mb-6 border-b-2 pb-2" style={{ borderColor: `${p}30` }}>Experience</h3>
                            {data.experience?.map((exp: any) => (
                                <div key={exp.id} className="mb-8 relative"><div className="absolute left-[-20px] top-1.5 w-2 h-2 rounded-full" style={{ backgroundColor: p }}></div><div className="flex justify-between items-baseline mb-1"><h4 className="text-lg font-bold text-gray-900">{exp.role}</h4><span className="text-sm font-bold text-gray-400">{exp.years}</span></div><p className="text-md text-gray-600">{exp.company}</p></div>
                            ))}
                        </div>
                        <div>
                            <h3 className="text-lg font-black uppercase tracking-widest mb-6 border-b-2 pb-2" style={{ borderColor: `${p}30` }}>Core Skills</h3>
                            <div className="flex flex-col gap-4">
                                {data.skills?.map((sk: any) => (<div key={sk.id}><div className="flex justify-between text-sm font-bold mb-1"><span className="text-gray-800">{sk.skillName}</span><span className="text-gray-400">{sk.level}</span></div><div className="h-1.5 w-full bg-gray-100 rounded-full overflow-hidden"><div className="h-full rounded-full" style={{ width: sk.level === 'Expert' ? '100%' : sk.level === 'Intermediate' ? '60%' : '30%', backgroundColor: p }}></div></div></div>))}
                            </div>
                        </div>
                    </div>
                </div>
            );
            case "memo": return (
                <div className="p-20 relative"><div className="absolute top-10 right-10 flex flex-col items-center"><div className="w-16 h-16 rounded-full flex items-center justify-center text-white mb-2" style={{ backgroundColor: p }}><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" /><polyline points="22,6 12,13 2,6" /></svg></div><span className="font-bold text-xs uppercase tracking-widest text-gray-400">INTERNAL MEMO</span></div>
                    <div className="border-y-4 py-8 mb-16 mt-8" style={{ borderColor: `${p}20` }}><div className="grid grid-cols-2 gap-y-4"><div className="flex gap-4"><span className="w-16 font-bold text-gray-400 uppercase text-xs tracking-widest">To:</span><span className="font-bold text-gray-900">{data.to}</span></div><div className="flex gap-4"><span className="w-16 font-bold text-gray-400 uppercase text-xs tracking-widest">Date:</span><span className="font-bold text-gray-900">{data.date}</span></div>
                        <div className="flex gap-4"><span className="w-16 font-bold text-gray-400 uppercase text-xs tracking-widest">From:</span><span className="font-bold text-gray-900">{data.from}</span></div><div className="flex gap-4"><span className="w-16 font-bold text-gray-400 uppercase text-xs tracking-widest">Subject:</span><span className="font-bold uppercase" style={{ color: p }}>{data.subject}</span></div></div></div>
                    <p className="text-base text-gray-800 leading-loose whitespace-pre-wrap">{data.message}</p>
                </div>
            );
            case "agenda": return (
                <div className="p-16"><div className="bg-gray-900 text-white rounded-3xl p-10 mb-12 shadow-2xl relative overflow-hidden"><div className="absolute top-0 right-0 w-64 h-64 rounded-full mix-blend-overlay opacity-50 translate-x-1/2 -translate-y-1/2" style={{ backgroundColor: p }} /><h1 className="text-3xl font-black tracking-tight mb-2">{data.meetingName}</h1><p className="text-gray-400 flex items-center gap-4"><span className="font-bold text-white">{data.date} // {data.time}</span> • <span>{data.location}</span></p></div>
                    <div className="px-6">{data.agendaItems?.map((item: any, idx: number) => (<div key={item.id} className="flex gap-8 py-6 border-b border-gray-100 relative"><div className="w-20 text-sm font-bold text-gray-400 pt-1">{item.timeSlot}</div><div className="flex-1">
                        <div className="absolute w-4 h-4 rounded-full border-4 border-white left-[90px] top-7 translate-y-[-50%]" style={{ backgroundColor: p, boxShadow: `0 0 0 2px ${p}30` }} />
                        <h3 className="text-lg font-bold text-gray-900 mb-1">{item.topic}</h3><p className="text-sm text-gray-500 font-medium">{item.owner}</p></div></div>))}</div></div>
            );
            case "report": return (
                <div className="p-20"><div className="border-l-8 pl-8 mb-16" style={{ borderColor: p }}><h1 className="text-5xl font-black text-gray-900 mb-6 tracking-tighter leading-none">{data.title}</h1><div className="flex gap-8 text-sm font-bold uppercase tracking-widest text-gray-400"><span>By {data.author}</span><span>{data.date}</span></div></div>
                    <div className="bg-gray-50 p-10 rounded-3xl mb-12 border border-gray-100"><h3 className="text-xs font-black uppercase tracking-widest mb-4 flex items-center gap-3" style={{ color: p }}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12" /></svg> Executive Summary</h3><p className="text-base text-gray-800 leading-loose font-medium">{data.executiveSummary}</p></div>
                    <div className="text-base text-gray-700 leading-loose whitespace-pre-wrap">{data.body}</div></div>
            );
            case "letter": return (
                <div className="p-20"><div className="flex justify-between items-start mb-24"><div className="w-1/2"><h1 className="text-2xl font-black text-gray-900 mb-1">{data.senderName}</h1><div className="h-1 w-12 mt-4" style={{ backgroundColor: p }} /></div><div className="text-right text-sm font-bold text-gray-400">{data.date}</div></div>
                    <div className="mb-12"><p className="text-sm font-bold text-gray-600">To: <span className="text-gray-900">{data.recipientName}</span></p><h3 className="text-lg font-bold text-gray-900 mt-4 mb-2">Subject: {data.subject}</h3></div>
                    <p className="text-base text-gray-800 leading-loose whitespace-pre-wrap mb-16">{data.body}</p>
                    <p className="text-base text-gray-800 font-bold whitespace-pre-wrap">{data.signOff}</p></div>
            );
            default: return null;
        }
    };

    return (
        <div className="flex-1 bg-[#0A0A0A] overflow-y-auto custom-scrollbar relative bg-[radial-gradient(#1a1a1a_1px,transparent_1px)] [background-size:16px_16px]">
            <div className="sticky top-0 z-10 flex items-center justify-end p-4 pointer-events-none">
                <div className="flex items-center gap-3 bg-[#111] p-1.5 pr-4 pl-1.5 rounded-xl border border-[#333] shadow-2xl pointer-events-auto">
                    <div className="px-3 py-1 bg-[#1a1a1a] rounded-lg border border-[#222]">
                        <span className="text-[11px] font-black text-[#888] tracking-widest uppercase">{docType} Preview</span>
                    </div>
                    <button className="flex items-center gap-2 rounded-lg bg-[#2f2f2f] hover:bg-[#3a3a3a] px-3 py-1.5 text-[12px] font-bold text-[#f3f3f3] shadow transition-colors">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg> Export PDF
                    </button>
                </div>
            </div>
            <div className="flex items-center justify-center p-8 pb-24 min-h-full">
                <div className="w-[800px] bg-white shadow-2xl overflow-hidden transition-all duration-300" style={{ minHeight: '1131px', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)' }}>
                    {/* Header strip */}
                    {["invoice", "proposal", "contract"].includes(docType) && <div className="h-4 w-full transition-colors" style={{ backgroundColor: p }} />}
                    {renderContent()}
                </div>
            </div>
        </div>
    );
}
