export type DocumentType = "invoice" | "proposal" | "receipt" | "contract" | "nda" | "quote" | "purchase_order" | "statement" | "certificate" | "brief" | "letter" | "resume" | "report" | "agenda" | "memo";

export const docTypeLabels: Record<DocumentType, string> = {
  invoice: "Tax Invoice",
  proposal: "Project Proposal",
  receipt: "Payment Receipt",
  contract: "Service Contract",
  nda: "Non-Disclosure (NDA)",
  quote: "Price Quote",
  purchase_order: "Purchase Order",
  statement: "Account Statement",
  certificate: "Certificate of Completion",
  brief: "Creative Brief",
  letter: "Cover Letter",
  resume: "Professional Resume",
  report: "Status Report",
  agenda: "Meeting Agenda",
  memo: "Internal Memo",
};

export type FieldDefinition =
  | { type: "text" | "textarea" | "date" | "color" | "number"; key: string; label: string; placeholder?: string }
  | { type: "list"; key: string; label: string; itemLabel: string; columns: { key: string; label: string; type: "text" | "number" | "date" }[] }
  | { type: "group"; label: string; fields: FieldDefinition[] };

export const templateSchemas: Record<DocumentType, FieldDefinition[]> = {
  invoice: [
    {
      type: "group", label: "Document Info", fields: [
        { type: "text", key: "invoiceNumber", label: "Invoice Number" },
        { type: "date", key: "date", label: "Date" },
        { type: "date", key: "dueDate", label: "Due Date" },
      ]
    },
    {
      type: "group", label: "Entities", fields: [
        { type: "text", key: "companyName", label: "Your Company" },
        { type: "textarea", key: "companyAddress", label: "Your Address" },
        { type: "text", key: "clientName", label: "Client Name" },
        { type: "textarea", key: "clientAddress", label: "Client Address" },
      ]
    },
    {
      type: "list", key: "items", label: "Line Items", itemLabel: "Item", columns: [
        { type: "text", key: "description", label: "Description" },
        { type: "number", key: "quantity", label: "Qty" },
        { type: "number", key: "price", label: "Price" },
      ]
    }
  ],
  proposal: [
    {
      type: "group", label: "Project Basics", fields: [
        { type: "text", key: "projectName", label: "Project Name" },
        { type: "text", key: "clientName", label: "Client Name" },
        { type: "text", key: "preparedBy", label: "Prepared By" },
        { type: "date", key: "date", label: "Date" },
      ]
    },
    {
      type: "group", label: "Content", fields: [
        { type: "textarea", key: "introduction", label: "Introduction" },
        { type: "textarea", key: "scope", label: "Scope of Work" },
      ]
    },
    {
      type: "group", label: "Terms", fields: [
        { type: "text", key: "timeline", label: "Timeline" },
        { type: "text", key: "budget", label: "Estimated Budget" },
      ]
    }
  ],
  receipt: [
    {
      type: "group", label: "Transaction Info", fields: [
        { type: "text", key: "receiptNumber", label: "Receipt #" },
        { type: "date", key: "date", label: "Date Paid" },
        { type: "text", key: "paymentMethod", label: "Payment Method" },
      ]
    },
    {
      type: "group", label: "Entities", fields: [
        { type: "text", key: "companyName", label: "Company Name" },
        { type: "text", key: "customerName", label: "Customer Name" },
      ]
    },
    {
      type: "list", key: "items", label: "Purchased Items", itemLabel: "Item", columns: [
        { type: "text", key: "desc", label: "Description" },
        { type: "number", key: "price", label: "Price" },
      ]
    }
  ],
  contract: [
    {
      type: "group", label: "Agreement Basics", fields: [
        { type: "text", key: "contractTitle", label: "Contract Title" },
        { type: "text", key: "providerName", label: "Provider Name" },
        { type: "text", key: "clientName", label: "Client Name" },
        { type: "date", key: "effectiveDate", label: "Effective Date" },
        { type: "text", key: "governingLaw", label: "Governing Law" },
      ]
    },
    {
      type: "group", label: "Legal Terms", fields: [
        { type: "textarea", key: "terms", label: "Terms & Conditions" },
      ]
    }
  ],
  nda: [
    {
      type: "group", label: "Parties", fields: [
        { type: "text", key: "disclosingParty", label: "Disclosing Party" },
        { type: "text", key: "receivingParty", label: "Receiving Party" },
        { type: "date", key: "date", label: "Date" },
      ]
    },
    {
      type: "group", label: "Details", fields: [
        { type: "textarea", key: "purpose", label: "Purpose of Disclosure" },
        { type: "number", key: "durationYears", label: "Duration (Years)" },
      ]
    }
  ],
  quote: [
    {
      type: "group", label: "Quote Details", fields: [
        { type: "text", key: "quoteNumber", label: "Quote Number" },
        { type: "date", key: "date", label: "Date" },
        { type: "date", key: "validUntil", label: "Valid Until" },
      ]
    },
    {
      type: "group", label: "Entities", fields: [
        { type: "text", key: "companyName", label: "Your Company" },
        { type: "text", key: "clientName", label: "Client Name" },
      ]
    },
    {
      type: "list", key: "items", label: "Services Estimations", itemLabel: "Service", columns: [
        { type: "text", key: "description", label: "Description" },
        { type: "number", key: "quantity", label: "Hours/Qty" },
        { type: "number", key: "rate", label: "Rate" },
      ]
    }
  ],
  purchase_order: [
    {
      type: "group", label: "Order Info", fields: [
        { type: "text", key: "poNumber", label: "PO Number" },
        { type: "date", key: "date", label: "Date" },
        { type: "textarea", key: "deliveryAddress", label: "Delivery Address" },
      ]
    },
    {
      type: "group", label: "Vendor", fields: [
        { type: "text", key: "vendorName", label: "Vendor Name" },
        { type: "text", key: "buyerName", label: "Buyer Name" },
      ]
    },
    {
      type: "list", key: "items", label: "Items to Order", itemLabel: "Product", columns: [
        { type: "text", key: "description", label: "Product" },
        { type: "number", key: "quantity", label: "Qty" },
        { type: "number", key: "unitPrice", label: "Unit Price" },
      ]
    }
  ],
  statement: [
    {
      type: "group", label: "Statement Info", fields: [
        { type: "text", key: "accountNumber", label: "Account #" },
        { type: "text", key: "period", label: "Period" },
        { type: "date", key: "date", label: "Issue Date" },
      ]
    },
    {
      type: "group", label: "Entities", fields: [
        { type: "text", key: "companyName", label: "Your Company" },
        { type: "text", key: "clientName", label: "Client Name" },
      ]
    },
    {
      type: "list", key: "transactions", label: "Transactions", itemLabel: "Transaction", columns: [
        { type: "date", key: "date", label: "Date" },
        { type: "text", key: "description", label: "Description" },
        { type: "number", key: "amount", label: "Amount" },
      ]
    }
  ],
  certificate: [
    {
      type: "group", label: "Certificate Details", fields: [
        { type: "text", key: "title", label: "Certificate Title" },
        { type: "text", key: "recipientName", label: "Recipient Name" },
        { type: "text", key: "description", label: "Description/Reason" },
        { type: "date", key: "date", label: "Date Issued" },
        { type: "text", key: "issuerName", label: "Issuer Name" },
        { type: "text", key: "issuerTitle", label: "Issuer Title" },
      ]
    }
  ],
  brief: [
    {
      type: "group", label: "Project Brief", fields: [
        { type: "text", key: "projectName", label: "Project Name" },
        { type: "text", key: "clientName", label: "Client Name" },
        { type: "date", key: "date", label: "Date" },
      ]
    },
    {
      type: "group", label: "Details", fields: [
        { type: "textarea", key: "objective", label: "Objective" },
        { type: "textarea", key: "targetAudience", label: "Target Audience" },
        { type: "textarea", key: "deliverables", label: "Deliverables" },
      ]
    }
  ],
  letter: [
    {
      type: "group", label: "Letter Info", fields: [
        { type: "text", key: "senderName", label: "Sender Name" },
        { type: "text", key: "recipientName", label: "Recipient Name" },
        { type: "date", key: "date", label: "Date" },
        { type: "text", key: "subject", label: "Subject" },
      ]
    },
    {
      type: "group", label: "Content", fields: [
        { type: "textarea", key: "body", label: "Body" },
        { type: "text", key: "signOff", label: "Sign-off" },
      ]
    }
  ],
  resume: [
    {
      type: "group", label: "Personal Info", fields: [
        { type: "text", key: "name", label: "Full Name" },
        { type: "text", key: "role", label: "Professional Role" },
        { type: "text", key: "contact", label: "Contact Info" },
        { type: "textarea", key: "summary", label: "Summary" },
      ]
    },
    {
      type: "list", key: "experience", label: "Experience", itemLabel: "Job", columns: [
        { type: "text", key: "company", label: "Company" },
        { type: "text", key: "role", label: "Role" },
        { type: "text", key: "years", label: "Years" },
      ]
    },
    {
      type: "list", key: "skills", label: "Skills", itemLabel: "Skill", columns: [
        { type: "text", key: "skillName", label: "Skill" },
        { type: "text", key: "level", label: "Level (e.g. Expert)" },
      ]
    }
  ],
  report: [
    {
      type: "group", label: "Report Info", fields: [
        { type: "text", key: "title", label: "Report Title" },
        { type: "text", key: "author", label: "Prepared By" },
        { type: "date", key: "date", label: "Date" },
      ]
    },
    {
      type: "group", label: "Content", fields: [
        { type: "textarea", key: "executiveSummary", label: "Executive Summary" },
        { type: "textarea", key: "body", label: "Main Report Body" },
      ]
    }
  ],
  agenda: [
    {
      type: "group", label: "Meeting Info", fields: [
        { type: "text", key: "meetingName", label: "Meeting Title" },
        { type: "date", key: "date", label: "Date" },
        { type: "text", key: "time", label: "Time" },
        { type: "text", key: "location", label: "Location" },
      ]
    },
    {
      type: "list", key: "agendaItems", label: "Agenda Items", itemLabel: "Topic", columns: [
        { type: "text", key: "timeSlot", label: "Time Slot" },
        { type: "text", key: "topic", label: "Topic" },
        { type: "text", key: "owner", label: "Owner" },
      ]
    }
  ],
  memo: [
    {
      type: "group", label: "Memo Header", fields: [
        { type: "text", key: "to", label: "To" },
        { type: "text", key: "from", label: "From" },
        { type: "date", key: "date", label: "Date" },
        { type: "text", key: "subject", label: "Subject" },
      ]
    },
    {
      type: "group", label: "Message", fields: [
        { type: "textarea", key: "message", label: "Message" },
      ]
    }
  ]
};

export const defaultTemplateData: Record<DocumentType, any> = {
  invoice: { companyName: "Moduo 2.0 Inc", companyAddress: "123 Workspace Ave\nTech City, CA 94105", clientName: "Acme Corp", clientAddress: "980 Road St.\nCapital, CA 94110", invoiceNumber: "INV-2026-001", date: "2026-02-21", dueDate: "2026-03-21", primaryColor: "#3a3a3a", items: [{ id: 1, description: "Software Architecture", quantity: 1, price: 4500 }] },
  proposal: { projectName: "Moduo 2.0 Platform", clientName: "Titanium Corp", preparedBy: "Moduo Agency", date: "2026-02-21", introduction: "We are thrilled to submit this proposal...", scope: "1. Brand Identity\n2. Next.js Frontend\n3. Rust Backend", timeline: "Estimated 12 Weeks", budget: "$24,500.00", primaryColor: "#3a3a3a" },
  receipt: { companyName: "Moduo 2.0 Inc", receiptNumber: "REC-9941A", date: "2026-02-21", paymentMethod: "Visa ending in •••• 4242", customerName: "Jane Doe", primaryColor: "#3a3a3a", items: [{ id: 1, desc: "Premium (Annual)", price: 299 }] },
  contract: { contractTitle: "Master Services Agreement", providerName: "Moduo 2.0 Inc.", clientName: "Acme Corp", effectiveDate: "2026-02-21", governingLaw: "State of California", terms: "1. SERVICES.\nClient agrees to pay Provider...", primaryColor: "#3a3a3a" },
  nda: { disclosingParty: "Moduo 2.0 Inc.", receivingParty: "Stealth Startup", date: "2026-02-21", purpose: "Evaluating a business relationship", durationYears: 2, primaryColor: "#3a3a3a" },
  quote: { quoteNumber: "QT-882", date: "2026-02-21", validUntil: "2026-03-21", companyName: "Moduo 2.0 Inc", clientName: "Acme Corp", primaryColor: "#3a3a3a", items: [{ id: 1, description: "Consulting", quantity: 10, rate: 150 }] },
  purchase_order: { poNumber: "PO-3309", date: "2026-02-21", deliveryAddress: "Main Warehouse\n450 Dock St.", vendorName: "Tech Supplies Co.", buyerName: "Moduo Procurement", primaryColor: "#3a3a3a", items: [{ id: 1, description: "MacBook Pro M4", quantity: 5, unitPrice: 2499 }] },
  statement: { accountNumber: "ACC-10924", period: "Jan 1 - Jan 31, 2026", date: "2026-02-01", companyName: "Moduo 2.0 Inc", clientName: "Acme Corp", primaryColor: "#3a3a3a", transactions: [{ id: 1, date: "2026-01-15", description: "Payment Received", amount: -4500 }, { id: 2, date: "2026-01-20", description: "New Invoice #881", amount: 1500 }] },
  certificate: { title: "Certificate of Excellence", recipientName: "Mike Grochowski", description: "For outstanding contributions to the Moduo 2.0 codebase and innovative agentic tool usage.", date: "2026-02-21", issuerName: "AI Assistant", issuerTitle: "Lead AI Engineer", primaryColor: "#3a3a3a" },
  brief: { projectName: "Moduo Marketing Site", clientName: "Internal", date: "2026-02-21", objective: "Design a high-converting landing page for the new AI features.", targetAudience: "SaaS Founders, Product Managers, CTOs", deliverables: "Figma Mockups, Webflow site", primaryColor: "#3a3a3a" },
  letter: { senderName: "Mike Grochowski", recipientName: "Hiring Manager", date: "2026-02-21", subject: "Application for Senior Engineer", body: "I am writing to express my interest in the position...", signOff: "Sincerely,\nMike", primaryColor: "#3a3a3a" },
  resume: { name: "John Doe", role: "Full-Stack Engineer", contact: "john@doe.com | github.com/johndoe", summary: "Experienced engineer passionate about AI and modern web design.", primaryColor: "#3a3a3a", experience: [{ id: 1, company: "Moduo", role: "Developer", years: "2023-Present" }], skills: [{ id: 1, skillName: "React", level: "Expert" }] },
  report: { title: "Q1 Performance Analysis", author: "Analytics Team", date: "2026-02-21", executiveSummary: "Q1 saw a 45% increase in MRR due to the launch of AI subagents.", body: "The user engagement metrics highlight that...", primaryColor: "#3a3a3a" },
  agenda: { meetingName: "All-Hands Sync", date: "2026-02-22", time: "10:00 AM PST", location: "Zoom", primaryColor: "#3a3a3a", agendaItems: [{ id: 1, timeSlot: "10:00", topic: "Intro & Numbers", owner: "CEO" }, { id: 2, timeSlot: "10:15", topic: "Product Updates", owner: "CPO" }] },
  memo: { to: "All Employees", from: "Leadership", date: "2026-02-21", subject: "New Workspace Templates Feature", message: "We are excited to announce the release of 15 new templates in the workspace!", primaryColor: "#3a3a3a" },
};
