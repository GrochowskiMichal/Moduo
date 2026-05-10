import { useState, useCallback, useMemo } from "react";
import type { UseTimetrackingState } from "../hooks/use-timetracking";
import { formatDuration } from "./timetracking-workspace";

type Props = { tt: UseTimetrackingState };

export function ProjectsView({ tt }: Props) {
  const [showAddProject, setShowAddProject] = useState(false);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState("#60A5FA");
  const [newClient, setNewClient] = useState("");
  const [newBudget, setNewBudget] = useState("");

  const projectStats = useMemo(() => {
    const map = new Map<string, number>();
    for (const entry of tt.entries) {
      if (entry.projectId) {
        map.set(entry.projectId, (map.get(entry.projectId) ?? 0) + (entry.duration || 0));
      }
    }
    return map;
  }, [tt.entries]);

  const handleAdd = useCallback(async () => {
    if (!newName.trim()) return;
    await tt.createProject({
      name: newName,
      color: newColor,
      clientName: newClient,
      budgetHours: newBudget ? parseFloat(newBudget) : null,
    });
    setShowAddProject(false);
    setNewName("");
    setNewColor("#60A5FA");
    setNewClient("");
    setNewBudget("");
  }, [tt, newName, newColor, newClient, newBudget]);

  return (
    <div className="tt-projects">
      <div className="tt-section-header">
        <h3 className="tt-section-title">Projects</h3>
        <button className="tt-btn-add-sm" onClick={() => setShowAddProject(true)}>+ Add</button>
      </div>

      {tt.projects.length === 0 ? (
        <div className="tt-empty-categories">
          <span className="tt-empty-icon">📁</span>
          <p>No projects yet. Create a project to allocate time to specific clients or initiatives.</p>
          <button className="tt-btn-add" onClick={() => setShowAddProject(true)}>+ Create Project</button>
        </div>
      ) : (
        <div className="tt-project-grid">
          {tt.projects.map(project => {
            const totalSeconds = projectStats.get(project.id) ?? 0;
            const totalHours = totalSeconds / 3600;
            const budgetPct = project.budgetHours ? Math.min(100, Math.round((totalHours / project.budgetHours) * 100)) : null;

            return (
              <div className="tt-project-card" key={project.id}>
                <div className="tt-project-card-header">
                  <div className="tt-project-info">
                    <span className="tt-project-dot-lg" style={{ background: project.color }} />
                    <div>
                      <h4 className="tt-project-card-name">{project.name}</h4>
                      {project.clientName && <span className="tt-project-client">{project.clientName}</span>}
                    </div>
                  </div>
                  <button className="tt-btn-delete-sm" onClick={() => tt.deleteProject(project.id)}>×</button>
                </div>
                <div className="tt-project-stats">
                  <span className="tt-project-hours">{formatDuration(totalSeconds)}</span>
                  {project.budgetHours && (
                    <span className="tt-project-budget">of {project.budgetHours}h budget</span>
                  )}
                </div>
                {budgetPct !== null && (
                  <div className="tt-budget-bar-track">
                    <div
                      className={`tt-budget-bar-fill ${budgetPct >= 90 ? "tt-budget-danger" : budgetPct >= 70 ? "tt-budget-warn" : ""}`}
                      style={{ width: `${budgetPct}%`, background: project.color }}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {showAddProject && (
        <div className="tt-modal-overlay" onClick={() => setShowAddProject(false)}>
          <div className="tt-modal" onClick={e => e.stopPropagation()}>
            <h3>New Project</h3>
            <div className="tt-form-group">
              <label>Name</label>
              <input className="tt-input" value={newName} onChange={e => setNewName(e.target.value)} placeholder="e.g. Client Website" autoFocus />
            </div>
            <div className="tt-form-row">
              <div className="tt-form-group">
                <label>Color</label>
                <input className="tt-input" type="color" value={newColor} onChange={e => setNewColor(e.target.value)} />
              </div>
              <div className="tt-form-group">
                <label>Client Name</label>
                <input className="tt-input" value={newClient} onChange={e => setNewClient(e.target.value)} placeholder="Optional" />
              </div>
            </div>
            <div className="tt-form-group">
              <label>Budget (hours)</label>
              <input className="tt-input" type="number" value={newBudget} onChange={e => setNewBudget(e.target.value)} placeholder="Optional" min={0} />
            </div>
            <div className="tt-form-actions">
              <button className="tt-btn-cancel" onClick={() => setShowAddProject(false)}>Cancel</button>
              <button className="tt-btn-primary" onClick={handleAdd}>Create</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
