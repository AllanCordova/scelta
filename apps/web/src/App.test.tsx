import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "./App";

describe("App", () => {
  it("renders the Scelta brand", () => {
    render(<App />);
    expect(screen.getByText("Scelta")).toBeInTheDocument();
  });
});
