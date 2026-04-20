import type { BrushTool } from '../model/editing';

interface ToolGroup {
  tools: ToolDefinition[];
}

interface ToolDefinition {
  tool: BrushTool;
  icon: string;
  label: string;
}

const TOOL_GROUPS: ToolGroup[] = [
  {
    tools: [
      { tool: 'raise', icon: '▲', label: 'Raise' },
      { tool: 'lower', icon: '▼', label: 'Lower' },
      { tool: 'mountain', icon: '⛰', label: 'Mountain' },
      { tool: 'flatten', icon: '▬', label: 'Flatten' },
      { tool: 'smooth', icon: '〰', label: 'Smooth' },
      { tool: 'erode', icon: '≈', label: 'Erode' },
    ],
  },
  {
    tools: [
      { tool: 'raise-water', icon: '💧', label: 'Raise Wtr' },
      { tool: 'lower-water', icon: '🔽', label: 'Lower Wtr' },
      { tool: 'flood-water', icon: '🌊', label: 'Flood' },
      { tool: 'flood-lava', icon: '🌋', label: 'Flood Lava' },
      { tool: 'sponge', icon: '🧽', label: 'Sponge' },
    ],
  },
  {
    tools: [
      { tool: 'paint-terrain', icon: '🖌', label: 'Paint' },
      { tool: 'spray', icon: '💨', label: 'Spray' },
    ],
  },
  {
    tools: [
      { tool: 'set-spawn', icon: '🏠', label: 'Spawn Pt' },
    ],
  },
];

interface ToolPanelProps {
  activeTool: BrushTool;
  onSelectTool: (tool: BrushTool) => void;
}

export function ToolPanel({ activeTool, onSelectTool }: ToolPanelProps) {
  return (
    <div className="wp-toolpanel">
      {TOOL_GROUPS.map((group, gi) => (
        <div key={gi} className="wp-tool-group">
          {group.tools.map((tool) => (
            <button
              key={tool.tool}
              type="button"
              className={`wp-tool-btn${activeTool === tool.tool ? ' active' : ''}`}
              title={tool.label}
              onClick={() => onSelectTool(tool.tool)}
            >
              <span className="wp-tool-icon">{tool.icon}</span>
              <span className="wp-tool-label">{tool.label}</span>
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
