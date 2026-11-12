import { ClientOnly } from "@tanstack/react-router";
import {
  AllCommunityModule,
  ModuleRegistry,
  themeQuartz,
  type CellValueChangedEvent,
  type ColDef,
} from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import { useEffect, useState } from "react";

let registered = false;

function useGridTheme() {
  const [theme, setTheme] = useState<ReturnType<typeof themeQuartz.withParams> | null>(null);
  useEffect(() => {
    if (!registered) {
      ModuleRegistry.registerModules([AllCommunityModule]);
      registered = true;
    }
    const read = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    setTheme(
      themeQuartz.withParams({
        backgroundColor: read("--color-surface"),
        foregroundColor: read("--color-fg"),
        headerBackgroundColor: read("--color-bg"),
        headerTextColor: read("--color-muted"),
        accentColor: read("--color-primary"),
        borderColor: read("--color-line"),
        browserColorScheme: "dark",
        fontFamily: '"IBM Plex Mono", ui-monospace, monospace',
        fontSize: 13,
        wrapperBorderRadius: 0,
      }),
    );
  }, []);
  return theme;
}

export function Ledger<T>({
  rows,
  columns,
  empty,
  onCellValueChanged,
}: {
  rows: T[];
  columns: ColDef<T>[];
  empty: string;
  onCellValueChanged?: (event: CellValueChangedEvent<T>) => void;
}) {
  const theme = useGridTheme();
  return (
    <ClientOnly fallback={<div className="h-64 rounded-xl border border-line bg-surface" />}>
      {rows.length === 0 ? (
        <p className="rounded-xl border border-line bg-surface px-4 py-6 text-sm text-muted">{empty}</p>
      ) : !theme ? (
        <div className="h-64 rounded-xl border border-line bg-surface" />
      ) : (
        <div className="h-72 overflow-hidden rounded-xl border border-line">
          <AgGridReact
            theme={theme}
            rowData={rows}
            columnDefs={columns}
            defaultColDef={{ resizable: true, sortable: true, minWidth: 96 }}
            rowHeight={44}
            headerHeight={40}
            animateRows={false}
            onCellValueChanged={onCellValueChanged}
          />
        </div>
      )}
    </ClientOnly>
  );
}
