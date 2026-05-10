import { useState, useCallback } from "react";
import type { UseTimetrackingState } from "../hooks/use-timetracking";
import type { ProductivityScore, RuleMatchType } from "../types";

type Props = { tt: UseTimetrackingState };

export function CategoriesView({ tt }: Props) {
  const [showAddCategory, setShowAddCategory] = useState(false);
  const [showAddRule, setShowAddRule] = useState(false);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState("#60A5FA");
  const [newIcon, setNewIcon] = useState("⏱️");
  const [newScore, setNewScore] = useState<ProductivityScore>(0);
  const [newRuleCategoryId, setNewRuleCategoryId] = useState("");
  const [newRuleMatchType, setNewRuleMatchType] = useState<RuleMatchType>("app");
  const [newRuleMatchValue, setNewRuleMatchValue] = useState("");

  const handleAddCategory = useCallback(async () => {
    if (!newName.trim()) return;
    await tt.createCategory({
      name: newName,
      color: newColor,
      icon: newIcon,
      productivityScore: newScore,
    });
    setShowAddCategory(false);
    setNewName("");
    setNewColor("#60A5FA");
    setNewIcon("⏱️");
    setNewScore(0);
  }, [tt, newName, newColor, newIcon, newScore]);

  const handleAddRule = useCallback(async () => {
    if (!newRuleCategoryId || !newRuleMatchValue.trim()) return;
    await tt.createRule({
      categoryId: newRuleCategoryId,
      matchType: newRuleMatchType,
      matchValue: newRuleMatchValue,
    });
    setShowAddRule(false);
    setNewRuleCategoryId("");
    setNewRuleMatchType("app");
    setNewRuleMatchValue("");
  }, [tt, newRuleCategoryId, newRuleMatchType, newRuleMatchValue]);

  const SCORE_OPTIONS: Array<{ value: ProductivityScore; label: string }> = [
    { value: 1,    label: "Productive" },
    { value: 0.5,  label: "Somewhat Productive" },
    { value: 0,    label: "Neutral" },
    { value: -0.5, label: "Somewhat Distracting" },
    { value: -1,   label: "Distracting" },
  ];

  const ICON_OPTIONS = ["⏱️", "⌨️", "💬", "🎨", "🔍", "✍️", "📅", "📱", "🎮", "📋", "📚", "🧪", "🔧", "🎧", "📧", "🌐"];

  return (
    <div className="tt-categories">
      {/* Categories Section */}
      <div className="tt-categories-section">
        <div className="tt-section-header">
          <h3 className="tt-section-title">Categories</h3>
          <button className="tt-btn-add-sm" onClick={() => setShowAddCategory(true)}>+ Add</button>
        </div>

        <div className="tt-category-grid">
          {tt.categories.map(cat => (
            <div className="tt-category-card" key={cat.id}>
              <div className="tt-category-card-header">
                <div className="tt-category-badge" style={{ background: cat.color + "22", color: cat.color }}>
                  <span>{cat.icon}</span>
                  <span>{cat.name}</span>
                </div>
                <button
                  className="tt-btn-delete-sm"
                  onClick={() => tt.deleteCategory(cat.id)}
                  title="Delete category"
                >
                  ×
                </button>
              </div>
              <div className="tt-category-score">
                <span className={`tt-score-badge ${cat.productivityScore > 0 ? "tt-score-pos" : cat.productivityScore < 0 ? "tt-score-neg" : "tt-score-neutral"}`}>
                  {cat.productivityScore > 0 ? "Productive" : cat.productivityScore < 0 ? "Distracting" : "Neutral"}
                </span>
              </div>
              <div className="tt-category-rules">
                {tt.rules.filter(r => r.categoryId === cat.id).map(rule => (
                  <div className="tt-rule-chip" key={rule.id}>
                    <span className="tt-rule-type">{rule.matchType}</span>
                    <span className="tt-rule-value">{rule.matchValue}</span>
                    {rule.isAiGenerated && <span className="tt-rule-ai">✨</span>}
                    <button className="tt-rule-delete" onClick={() => tt.deleteRule(rule.id)}>×</button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {tt.categories.length === 0 && (
          <div className="tt-empty-categories">
            <span className="tt-empty-icon">🏷️</span>
            <p>No categories yet. Create your first category to start organizing your time.</p>
          </div>
        )}
      </div>

      {/* Rules Section */}
      <div className="tt-categories-section">
        <div className="tt-section-header">
          <h3 className="tt-section-title">Auto-Classification Rules</h3>
          <button className="tt-btn-add-sm" onClick={() => setShowAddRule(true)} disabled={tt.categories.length === 0}>
            + Add Rule
          </button>
        </div>

        {tt.rules.length === 0 && (
          <div className="tt-empty-categories">
            <span className="tt-empty-icon">🤖</span>
            <p>No rules yet. Add rules to automatically categorize your time entries based on app names, window titles, or keywords.</p>
          </div>
        )}
      </div>

      {/* Add Category Modal */}
      {showAddCategory && (
        <div className="tt-modal-overlay" onClick={() => setShowAddCategory(false)}>
          <div className="tt-modal" onClick={e => e.stopPropagation()}>
            <h3>New Category</h3>
            <div className="tt-form-group">
              <label>Name</label>
              <input className="tt-input" value={newName} onChange={e => setNewName(e.target.value)} placeholder="e.g. Development" autoFocus />
            </div>
            <div className="tt-form-row">
              <div className="tt-form-group">
                <label>Color</label>
                <input className="tt-input" type="color" value={newColor} onChange={e => setNewColor(e.target.value)} />
              </div>
              <div className="tt-form-group">
                <label>Icon</label>
                <div className="tt-icon-grid">
                  {ICON_OPTIONS.map(icon => (
                    <button
                      key={icon}
                      className={`tt-icon-option ${newIcon === icon ? "tt-icon-selected" : ""}`}
                      onClick={() => setNewIcon(icon)}
                    >
                      {icon}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="tt-form-group">
              <label>Productivity</label>
              <select className="tt-input" value={newScore} onChange={e => setNewScore(parseFloat(e.target.value) as ProductivityScore)}>
                {SCORE_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
            <div className="tt-form-actions">
              <button className="tt-btn-cancel" onClick={() => setShowAddCategory(false)}>Cancel</button>
              <button className="tt-btn-primary" onClick={handleAddCategory}>Create</button>
            </div>
          </div>
        </div>
      )}

      {/* Add Rule Modal */}
      {showAddRule && (
        <div className="tt-modal-overlay" onClick={() => setShowAddRule(false)}>
          <div className="tt-modal" onClick={e => e.stopPropagation()}>
            <h3>New Classification Rule</h3>
            <div className="tt-form-group">
              <label>Category</label>
              <select className="tt-input" value={newRuleCategoryId} onChange={e => setNewRuleCategoryId(e.target.value)}>
                <option value="">Select category...</option>
                {tt.categories.map(c => (
                  <option key={c.id} value={c.id}>{c.icon} {c.name}</option>
                ))}
              </select>
            </div>
            <div className="tt-form-group">
              <label>Match Type</label>
              <select className="tt-input" value={newRuleMatchType} onChange={e => setNewRuleMatchType(e.target.value as RuleMatchType)}>
                <option value="app">App Name</option>
                <option value="window_title">Window Title</option>
                <option value="url">URL</option>
                <option value="keyword">Keyword (any)</option>
              </select>
            </div>
            <div className="tt-form-group">
              <label>Match Value</label>
              <input className="tt-input" value={newRuleMatchValue} onChange={e => setNewRuleMatchValue(e.target.value)} placeholder="e.g. Visual Studio Code" />
            </div>
            <div className="tt-form-actions">
              <button className="tt-btn-cancel" onClick={() => setShowAddRule(false)}>Cancel</button>
              <button className="tt-btn-primary" onClick={handleAddRule}>Create Rule</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
