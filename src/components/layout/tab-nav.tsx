"use client";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface TabNavProps<T extends readonly string[]> {
  tabs: T;
  active: T[number];
  onChange: (tab: T[number]) => void;
}

export function TabNav<T extends readonly string[]>({
  tabs,
  active,
  onChange,
}: TabNavProps<T>) {
  return (
    <div className="w-full border-b bg-background">
      <div className="max-w-4xl mx-auto px-4">
        <Tabs value={active} onValueChange={(v) => { onChange(v); }}>
          <TabsList className="h-10 w-full justify-start rounded-none border-b-0 bg-transparent p-0">
            {tabs.map((tab) => (
              <TabsTrigger
                key={tab}
                value={tab}
                className="relative rounded-none border-b-2 border-transparent px-4 pb-3 pt-2 font-medium text-muted-foreground transition-none data-[state=active]:border-primary data-[state=active]:text-foreground data-[state=active]:shadow-none"
              >
                {tab}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>
    </div>
  );
}
