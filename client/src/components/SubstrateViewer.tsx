import { useState } from "react";
import { apiGet } from "../hooks/useApi";

const FILE_TYPES = [
  "PLAN", "MEMORY", "HABITS", "SKILLS", "VALUES",
  "ID", "SECURITY", "CHARTER", "SUPEREGO", "CLAUDE",
  "PROGRESS", "CONVERSATION",
];

interface SubstrateContent {
  rawMarkdown: string;
  meta: { fileType: string };
}

export function SubstrateViewer() {
  const [selected, setSelected] = useState("PLAN");
  const [content, setContent] = useState("");

  const handleSelect = async (fileType: string) => {
    setSelected(fileType);
    try {
      const data = await apiGet<SubstrateContent>(`/api/substrate/${fileType}`);
      setContent(data.rawMarkdown);
    } catch {
      setContent("(unable to load)");
    }
  };

  return (
    <div className="substrate-viewer">
      <select
        value={selected}
        onChange={(e) => handleSelect(e.target.value)}
        data-testid="substrate-select"
      >
        {FILE_TYPES.map((ft) => (
          <option key={ft} value={ft}>{ft}</option>
        ))}
      </select>
      <pre className="substrate-content" data-testid="substrate-content">{content}</pre>
    </div>
  );
}
