// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ProjectForm } from "./project-form";
afterEach(cleanup);
it("keeps project input on a failed save and allows a successful retry", async () => {
  const save = vi.fn().mockRejectedValueOnce(new Error("Offline")).mockResolvedValueOnce(undefined);
  render(<ProjectForm onSubmit={save} />);
  fireEvent.change(screen.getByLabelText(/Project name/), { target: { value: "Design" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Your entries are still here");
  expect(screen.getByLabelText(/Project name/)).toHaveValue("Design");
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(screen.getByLabelText(/Project name/)).toHaveValue(""));
});
