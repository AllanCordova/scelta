import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminMembers } from "./AdminMembers";

describe("AdminMembers", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/v1/admin/members/import") && init?.method === "POST") {
          return json({
            report: {
              createdCount: 2,
              updatedCount: 1,
              rejectedCount: 0,
              rejectedRows: [],
            },
          });
        }
        return json({
          members: [
            {
              id: "m-1",
              fullName: "Paulo Apóstolo",
              isCommunicant: true,
              isMale: true,
              birthDate: "1985-04-12",
              societyFlags: {},
            },
          ],
        });
      }),
    );
  });

  it("shows expected header columns, downloadable CSV template, and imports a selected CSV file", async () => {
    render(<AdminMembers />);

    expect(await screen.findByText("Membros: 1 aptos")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Baixar template CSV" })).toHaveAttribute(
      "download",
      "modelo-membros-scelta.csv",
    );
    expect(screen.getByText("nome")).toBeInTheDocument();
    expect(screen.getByText("comungante")).toBeInTheDocument();
    expect(screen.getByText("data_nascimento")).toBeInTheDocument();
    expect(screen.getByText("upa_ativo")).toBeInTheDocument();

    const fileInput = screen.getByLabelText("Arquivo CSV de membros");
    const csvFile = new File(
      ["nome,comungante,sexo,data_nascimento\nPaulo,sim,M,1985-04-12"],
      "membros.csv",
      { type: "text/csv" },
    );

    fireEvent.change(fileInput, { target: { files: [csvFile] } });
    expect(await screen.findByText(/membros\.csv/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Importar membros" }));
    expect(
      await screen.findByText("Importação concluída: 2 criados, 1 atualizados, 0 rejeitados."),
    ).toBeInTheDocument();
  });

  it("shows an error when attempting to import without selecting a file", async () => {
    render(<AdminMembers />);
    await screen.findByText("Membros: 1 aptos");

    fireEvent.click(screen.getByRole("button", { name: "Importar membros" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Selecione ou solte um arquivo CSV antes de importar.",
    );
  });
});

function json(body: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  );
}
