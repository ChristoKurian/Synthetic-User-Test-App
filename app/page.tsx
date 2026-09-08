"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";

type RunResult = {
  reportHtml: string;
  stats: Record<string, { successRate: number; n: number }>;
  usedFallbackSuccessSignal: boolean;
  personaSignals: string[] | null;
};

export default function Home() {
  const [urls, setUrls] = useState(["", ""]);
  const [goal, setGoal] = useState("");
  const [successSignal, setSuccessSignal] = useState("");
  const [personaFile, setPersonaFile] = useState<File | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RunResult | null>(null);

  const setUrl = (i: number, v: string) => setUrls((prev) => prev.map((u, idx) => (idx === i ? v : u)));
  const addUrl = () => setUrls((prev) => (prev.length < 3 ? [...prev, ""] : prev));
  const removeUrl = (i: number) => setUrls((prev) => prev.filter((_, idx) => idx !== i));

  async function runTest(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);
    setRunning(true);
    try {
      const form = new FormData();
      urls.forEach((u, i) => form.set(`url${i + 1}`, u));
      form.set("goal", goal);
      form.set("successSignal", successSignal);
      if (personaFile) form.set("personaFile", personaFile);

      const res = await fetch("/api/run", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Something went wrong.");
      } else {
        setResult(data);
      }
    } catch (err: any) {
      setError(String(err?.message || err));
    } finally {
      setRunning(false);
    }
  }

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto max-w-2xl px-6 py-16">
        <div className="mb-10">
          <h1 className="text-2xl font-semibold tracking-tight">Synthetic Usability Test</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Compare two or three live prototypes with simulated users — no real participants needed.
          </p>
        </div>

        <form onSubmit={runTest} className="space-y-8">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Prototypes</CardTitle>
              <CardDescription>Public URLs, no login required.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {urls.map((u, i) => (
                <div key={i} className="flex gap-2">
                  <Input
                    placeholder={`https://prototype-${String.fromCharCode(97 + i)}.example.com`}
                    value={u}
                    onChange={(e) => setUrl(i, e.target.value)}
                    required={i < 2}
                  />
                  {urls.length > 2 && (
                    <Button type="button" variant="ghost" size="sm" onClick={() => removeUrl(i)}>
                      Remove
                    </Button>
                  )}
                </div>
              ))}
              {urls.length < 3 && (
                <Button type="button" variant="outline" size="sm" onClick={addUrl}>
                  + Add a third version
                </Button>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Task</CardTitle>
              <CardDescription>What is a synthetic user trying to accomplish?</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="goal">Goal</Label>
                <Textarea
                  id="goal"
                  placeholder="e.g. Sign up for an account and reach the dashboard"
                  value={goal}
                  onChange={(e) => setGoal(e.target.value)}
                  required
                  rows={3}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="successSignal">
                  What does success look like? <span className="text-muted-foreground font-normal">(optional)</span>
                </Label>
                <Input
                  id="successSignal"
                  placeholder='e.g. "Welcome" or "Order confirmed"'
                  value={successSignal}
                  onChange={(e) => setSuccessSignal(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Text that only appears once the task is genuinely done. Without this we still measure clicks, time,
                  and friction — just not a hard success rate.
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Who&apos;s using it</CardTitle>
              <CardDescription>Optional — describe your users and we&apos;ll simulate them specifically.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-1.5">
                <Label htmlFor="personaFile">persona.md (optional)</Label>
                <Input
                  id="personaFile"
                  type="file"
                  accept=".md,.txt"
                  onChange={(e) => setPersonaFile(e.target.files?.[0] || null)}
                />
                <p className="text-xs text-muted-foreground">
                  A short description works fine — e.g. &quot;non-technical, on mobile, somewhat rushed.&quot; Leave
                  blank for a balanced default mix of behaviors.
                </p>
              </div>
            </CardContent>
          </Card>

          <Button type="submit" disabled={running} className="w-full">
            {running ? "Running synthetic sessions… this can take a couple of minutes" : "Run Test"}
          </Button>
        </form>

        {error && (
          <div className="mt-6 rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {result && (
          <div className="mt-10 space-y-4">
            <Separator />
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-medium">Report</h2>
              <div className="flex gap-2">
                {result.usedFallbackSuccessSignal && <Badge variant="secondary">No success signal — friction metrics only</Badge>}
                {result.personaSignals && result.personaSignals.length > 0 && (
                  <Badge variant="secondary">Persona: {result.personaSignals.join(", ")}</Badge>
                )}
              </div>
            </div>
            <iframe
              title="Comparison report"
              srcDoc={result.reportHtml}
              className="w-full rounded-lg border"
              style={{ height: "900px" }}
              sandbox=""
            />
          </div>
        )}
      </div>
    </main>
  );
}
