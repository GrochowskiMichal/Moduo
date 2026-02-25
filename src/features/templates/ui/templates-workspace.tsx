import { useState, useEffect } from "react";
import { DocumentType, defaultTemplateData } from "./template-schema";
import { TemplatesEditor } from "./templates-editor";
import { TemplatesPreview } from "./templates-preview";
import { FeaturePanelsShell } from "../../../components/app/feature-panels-shell";

export function TemplatesWorkspace() {
    const [docType, setDocType] = useState<DocumentType>("invoice");
    const [activeTab, setActiveTab] = useState<"data" | "design">("data");
    const [docMenuOpen, setDocMenuOpen] = useState(false);

    // We map the active data based on docType to avoid massive complex state hooks.
    const [templateState, setTemplateState] = useState<Record<DocumentType, any>>(defaultTemplateData);

    // Derive active data snippet
    const activeData = templateState[docType];

    const setActiveData = (newData: any) => {
        setTemplateState((prev) => ({
            ...prev,
            [docType]: newData,
        }));
    };

    return (
        <FeaturePanelsShell
            feature="templates"
            left={
                <TemplatesEditor
                    docType={docType}
                    setDocType={setDocType}
                    data={activeData}
                    setData={setActiveData}
                    activeTab={activeTab}
                    setActiveTab={setActiveTab}
                    docMenuOpen={docMenuOpen}
                    setDocMenuOpen={setDocMenuOpen}
                />
            }
            center={<TemplatesPreview docType={docType} data={activeData} />}
        />
    );
}
