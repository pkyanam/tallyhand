// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppChromeProvider } from "@/components/app/app-chrome-provider";
import { useTimerStore } from "@/lib/timer-store";
import { projectRepo } from "@/lib/db/repos";
import { ProjectsContent } from "./projects-content";

const { snapshot, notify } = vi.hoisted(() => ({ snapshot: { value: undefined as unknown }, notify: vi.fn() }));
vi.mock("@/lib/data/use-live-query", () => ({ useLiveQuery: () => snapshot.value }));
vi.mock("@/lib/data/data-events", () => ({ notifyDataChanged: notify }));

function renderHub() { return render(<AppChromeProvider dataMode="local"><ProjectsContent /></AppChromeProvider>); }
beforeEach(() => {
  vi.clearAllMocks();
  useTimerStore.setState({ running: false, pending: null, projectId: null, startedAt: null });
  snapshot.value = { failed: false, clients: [{ id: "c-one", name: "Test Studio" }], rows: [{
    project: { id: "p-one", name: "Website", archived: false }, client: { id: "c-one", name: "Test Studio" },
    archived: false, trackedMinutes: 120, readyToInvoiceMinutes: 60, reservedMinutes: 60, lastActivityAt: 1,
  }] };
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("Projects hub", () => {
  it("links billing to the correct project filter and starts its timer", () => {
    renderHub();
    expect(screen.getByRole("link", { name: "Review billing" })).toHaveAttribute("href", "/ledger?project=p-one&billed=no");
    fireEvent.click(screen.getByRole("button", { name: "Start timer" }));
    expect(useTimerStore.getState()).toMatchObject({ running: true, projectId: "p-one" });
    expect(screen.getByRole("button", { name: "Start timer" })).toBeDisabled();
  });
  it("searches client names as well as project names", () => {
    renderHub();
    fireEvent.change(screen.getByRole("textbox", { name: "Search projects or clients" }), { target: { value: "studio" } });
    expect(screen.getByRole("heading", { name: "Website" })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "Search projects or clients" }), { target: { value: "missing" } });
    expect(screen.getByRole("heading", { name: "No matching projects" })).toBeInTheDocument();
  });
  it("never replaces an existing running timer", () => {
    useTimerStore.setState({ running: true, projectId: "other", startedAt: 123 });
    renderHub();
    const button = screen.getByRole("button", { name: "Start timer" });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(useTimerStore.getState()).toMatchObject({ projectId: "other", startedAt: 123 });
  });
  it("shows an actionable loading failure instead of misleading empty totals", () => {
    snapshot.value = { failed: true, rows: [] };
    renderHub();
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn’t load your projects");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(notify).toHaveBeenCalledOnce();
  });
  it("creates a project for the chosen client directly from the hub", async () => {
    const create = vi.spyOn(projectRepo, "create").mockResolvedValue({ id: "new" } as never);
    renderHub();
    fireEvent.click(screen.getByRole("button", { name: "New project" }));
    expect(screen.getByRole("combobox", { name: "Client" })).toHaveValue("c-one");
    fireEvent.change(screen.getByLabelText(/Project name/), { target: { value: "New work" } });
    fireEvent.click(screen.getByRole("button", { name: "Create project" }));
    await waitFor(() => expect(create).toHaveBeenCalledWith({ clientId: "c-one", name: "New work", rateOverride: undefined }));
    await waitFor(() => expect(screen.queryByRole("region", { name: "New project" })).not.toBeInTheDocument());
    expect(notify).toHaveBeenCalledOnce();
  });
  it("cancels project creation without saving", () => {
    const create = vi.spyOn(projectRepo, "create");
    renderHub();
    fireEvent.click(screen.getByRole("button", { name: "New project" }));
    fireEvent.change(screen.getByLabelText(/Project name/), { target: { value: "Discard" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(create).not.toHaveBeenCalled();
    expect(screen.queryByRole("region", { name: "New project" })).not.toBeInTheDocument();
  });

});
