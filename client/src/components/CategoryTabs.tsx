import { Badge } from "@/components/ui/badge";

export interface CategoryTab {
  key: string; // "" = all
  label: string;
}

export const CATEGORY_TABS: CategoryTab[] = [
  { key: "", label: "Vše" },
  { key: "contract", label: "Smlouvy" },
  { key: "demand", label: "Výzvy" },
  { key: "request", label: "Žádosti" },
  { key: "invoice", label: "Faktury" },
  { key: "client", label: "Klienti" },
  { key: "internal", label: "Interní" },
  { key: "other", label: "Ostatní" },
];

interface CategoryTabsProps {
  active: string; // "" = all
  counts?: Record<string, number> | null;
  isLoading?: boolean;
  onChange: (key: string) => void;
}

export function CategoryTabs({ active, counts, isLoading, onChange }: CategoryTabsProps) {
  return (
    <div
      className="border-b border-border bg-background/60 px-4 py-2 flex flex-wrap gap-1.5 items-center"
      data-testid="category-tabs"
    >
      {CATEGORY_TABS.map((tab) => {
        const isActive = (active || "") === tab.key;
        const countKey = tab.key === "" ? "all" : tab.key;
        const count = counts?.[countKey];
        return (
          <button
            key={tab.key || "all"}
            type="button"
            onClick={() => onChange(tab.key)}
            className={`group inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors border ${
              isActive
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-card text-foreground border-border hover:bg-accent hover:text-accent-foreground"
            }`}
            data-testid={`tab-category-${tab.key || "all"}`}
            aria-pressed={isActive}
          >
            <span>{tab.label}</span>
            {isLoading ? (
              <span className="inline-block h-3.5 w-5 rounded bg-muted/60 animate-pulse" aria-hidden />
            ) : count !== undefined ? (
              <Badge
                variant={isActive ? "secondary" : "outline"}
                className={`px-1.5 py-0 text-[10px] font-normal h-4 min-w-[1.25rem] justify-center ${
                  isActive ? "" : "text-muted-foreground"
                }`}
              >
                {count}
              </Badge>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
