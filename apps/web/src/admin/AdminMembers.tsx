import { useEffect, useRef, useState, type ChangeEvent, type DragEvent, type FormEvent } from "react";
import { z } from "zod";
import { apiUrl } from "../api-url";
import { validateWithZod } from "../forms/validation";
import { memberImportSummaryLabel } from "./copy";
import { createMember, deleteMember, importMembers, listMembersPage } from "./rooms-api";
import type { StoredMemberItem } from "./types";

const apiBase = apiUrl("");

const EXPECTED_COLUMNS = [
  "nome",
  "comungante",
  "sexo",
  "data_nascimento",
  "upa_ativo",
  "upa_ingresso",
  "ump_ativo",
  "ump_ingresso",
] as const;

const CSV_TEMPLATE_CONTENT = [
  EXPECTED_COLUMNS.join(","),
  "Paulo Apóstolo,sim,M,1985-04-12,nao,,nao,",
  "Silas Companheiro,sim,M,1998-06-01,sim,2024-01-10,nao,",
  "Lídia de Tiatira,sim,F,1995-03-20,sim,2023-05-01,sim,2023-05-01",
].join("\n");

const TEMPLATE_DATA_URL = `data:text/csv;charset=utf-8,${encodeURIComponent(CSV_TEMPLATE_CONTENT)}`;

export function AdminMembers() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [members, setMembers] = useState<StoredMemberItem[]>([]);
  const [totalMembers, setTotalMembers] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState("");
  const [manualName, setManualName] = useState("");
  const [manualCommunicant, setManualCommunicant] = useState(true);
  const [manualGender, setManualGender] = useState<"" | "M" | "F">("");
  const [manualBirthDate, setManualBirthDate] = useState("");
  const [manualError, setManualError] = useState<string | null>(null);
  const [isAddingMember, setIsAddingMember] = useState(false);
  const [deletingMemberId, setDeletingMemberId] = useState<string | null>(null);
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  const [selectedFileSizeKb, setSelectedFileSizeKb] = useState<string | null>(null);
  const [csvContent, setCsvContent] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importSummary, setImportSummary] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [reloadVersion, setReloadVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void listMembersPage(apiBase, { search, page, pageSize: 10 })
      .then((result) => {
        if (!cancelled) {
          setMembers(result.members);
          setTotalMembers(result.total);
          setTotalPages(result.totalPages);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setMembers([]);
          setTotalMembers(0);
          setTotalPages(1);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [reloadVersion, search, page]);

const csvFileSchema = z.object({
  file: z
    .custom<File>((val) => val instanceof File, "Por favor, envie um arquivo .CSV válido.")
    .refine(
      (file) => file.name.toLowerCase().endsWith(".csv") || file.type === "text/csv",
      "Por favor, envie um arquivo .CSV válido.",
    )
    .refine((file) => file.size > 0, "O arquivo CSV está vazio.")
    .refine(
      (file) => file.size <= 10 * 1024 * 1024,
      "O arquivo CSV excede o limite de 10MB.",
    ),
});

const csvImportSchema = z.object({
  file: z.string().trim().min(1, "Selecione ou solte um arquivo CSV antes de importar."),
});
  async function processSelectedFile(file: File) {
    setImportError(null);
    setImportSummary(null);

    const validation = validateWithZod(csvFileSchema, { file });
    if (!validation.ok) {
      setSelectedFileName(null);
      setSelectedFileSizeKb(null);
      setCsvContent("");
      setImportError(validation.firstError);
      return;
    }

    const text = await readFileAsText(file);
    setSelectedFileName(file.name);
    setSelectedFileSizeKb((file.size / 1024).toFixed(1));
    setCsvContent(text);
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) {
      void processSelectedFile(file);
    }
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(true);
  }

  function handleDragLeave(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(false);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file) {
      void processSelectedFile(file);
    }
  }

  async function handleImport() {
    setImportError(null);
    setImportSummary(null);

    const validation = validateWithZod(csvImportSchema, { file: csvContent });
    if (!validation.ok) {
      setImportError(validation.firstError);
      return;
    }

    setIsImporting(true);
    try {
      const report = await importMembers(apiBase, csvContent);
      setImportSummary(
        memberImportSummaryLabel(report.createdCount, report.updatedCount, report.rejectedCount),
      );
      setSelectedFileName(null);
      setSelectedFileSizeKb(null);
      setCsvContent("");
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      setReloadVersion((current) => current + 1);
    } catch {
      setImportError("Não foi possível importar a lista de membros.");
    } finally {
      setIsImporting(false);
    }
  }

  async function handleAddMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setManualError(null);
    const trimmed = manualName.trim();
    if (trimmed.length < 2) {
      setManualError("Informe o nome completo com ao menos 2 caracteres.");
      return;
    }

    setIsAddingMember(true);
    try {
      await createMember(apiBase, {
        fullName: trimmed,
        isCommunicant: manualCommunicant,
        isMale: manualGender === "" ? null : manualGender === "M",
        birthDate: manualBirthDate.trim().length > 0 ? manualBirthDate.trim() : null,
      });
      setManualName("");
      setManualCommunicant(true);
      setManualGender("");
      setManualBirthDate("");
      setPage(1);
      setReloadVersion((current) => current + 1);
    } catch {
      setManualError("Não foi possível cadastrar o membro.");
    } finally {
      setIsAddingMember(false);
    }
  }

  async function handleDeleteMember(memberId: string) {
    if (deletingMemberId) {
      return;
    }
    setDeletingMemberId(memberId);
    try {
      await deleteMember(apiBase, memberId);
      setReloadVersion((current) => current + 1);
    } catch {
      setManualError("Não foi possível remover o membro.");
    } finally {
      setDeletingMemberId(null);
    }
  }

  return (
    <div className="admin-page">
      <a className="detail-back-link" href="/admin">
        ← Voltar para Administração
      </a>
      <header className="page-intro">
        <h1>Rol de membros</h1>
        <p className="lede">
          Gerencie os membros da plataforma manualmente ou via importação de planilha CSV.
        </p>
      </header>

      <section className="panel" aria-labelledby="member-manual-heading">
        <h2 id="member-manual-heading">Adicionar membro</h2>
        <form className="member-manual-form" onSubmit={(event) => void handleAddMember(event)}>
          <div className="member-manual-grid">
            <div>
              <label htmlFor="manual-member-name">Nome completo</label>
              <input
                id="manual-member-name"
                type="text"
                value={manualName}
                onChange={(event) => setManualName(event.target.value)}
                placeholder="Ex.: Paulo Apóstolo"
              />
            </div>
            <div>
              <label htmlFor="manual-member-gender">Sexo</label>
              <select
                id="manual-member-gender"
                value={manualGender}
                onChange={(event) => setManualGender(event.target.value as "" | "M" | "F")}
              >
                <option value="">Não informado</option>
                <option value="M">Masculino</option>
                <option value="F">Feminino</option>
              </select>
            </div>
            <div>
              <label htmlFor="manual-member-birth">Data de nascimento</label>
              <input
                id="manual-member-birth"
                type="date"
                value={manualBirthDate}
                onChange={(event) => setManualBirthDate(event.target.value)}
              />
            </div>
          </div>
          <label className="checkbox-row" htmlFor="manual-member-communicant">
            <input
              id="manual-member-communicant"
              type="checkbox"
              checked={manualCommunicant}
              onChange={(event) => setManualCommunicant(event.target.checked)}
            />
            <span>Membro comungante</span>
          </label>
          {manualError ? (
            <p className="form-error" role="alert">
              {manualError}
            </p>
          ) : null}
          <button type="submit" disabled={isAddingMember}>
            {isAddingMember ? "Cadastrando…" : "Adicionar membro"}
          </button>
        </form>
      </section>

      <section className="panel" aria-labelledby="member-list-heading">
        <div className="member-list-header">
          <h2 id="member-list-heading">Membros cadastrados</h2>
          <span className="member-count-pill">Total: {totalMembers}</span>
        </div>
        <div className="member-search-row">
          <label htmlFor="member-search-input" className="sr-only">
            Buscar membro
          </label>
          <input
            id="member-search-input"
            type="search"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
            placeholder="Buscar membro por nome…"
          />
        </div>
        {members.length === 0 ? (
          <p className="muted">Nenhum membro encontrado.</p>
        ) : (
          <ul className="member-directory-list" aria-label="Lista de membros">
            {members.map((member) => (
              <li key={member.id} className="member-directory-row">
                <div className="member-directory-info">
                  <strong>{member.fullName}</strong>
                  <span className="muted">
                    {member.isCommunicant ? "Comungante" : "Não comungante"}
                    {member.isMale === true ? " · Masculino" : member.isMale === false ? " · Feminino" : ""}
                    {member.birthDate ? ` · ${member.birthDate}` : ""}
                  </span>
                </div>
                <button
                  type="button"
                  className="ghost danger-text"
                  disabled={deletingMemberId === member.id}
                  onClick={() => void handleDeleteMember(member.id)}
                >
                  {deletingMemberId === member.id ? "Removendo…" : "Remover"}
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="pagination-bar" aria-label="Paginação de membros">
          <button
            type="button"
            className="ghost"
            disabled={page <= 1}
            onClick={() => setPage((current) => Math.max(1, current - 1))}
          >
            Anterior
          </button>
          <span className="muted">
            Página {page} de {totalPages}
          </span>
          <button
            type="button"
            className="ghost"
            disabled={page >= totalPages}
            onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
          >
            Próxima
          </button>
        </div>
      </section>

      <section className="panel member-import-box" aria-labelledby="member-import-heading">
        <div className="member-import-header">
          <div>
            <h2 id="member-import-heading">Importar planilha CSV</h2>
            <p className="muted">
              Baixe o modelo esperado ou envie um arquivo CSV com o rol atualizado.
            </p>
          </div>
          <div className="member-import-badges">
            <span className="member-count-pill">Membros: {totalMembers} aptos</span>
            <a
              className="template-download-link"
              href={TEMPLATE_DATA_URL}
              download="modelo-membros-scelta.csv"
            >
              Baixar template CSV
            </a>
          </div>
        </div>

        <div
          className={isDragging ? "upload-zone dragging" : "upload-zone"}
          aria-invalid={Boolean(importError)}
          onClick={() => fileInputRef.current?.click()}
          onDragEnter={handleDragOver}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <input
            ref={fileInputRef}
            id="member-csv-file"
            type="file"
            accept=".csv,text/csv"
            aria-label="Arquivo CSV de membros"
            className="sr-only"
            onChange={handleFileChange}
          />
          <div className="upload-icon-box" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <path d="M19.35 10.04A7.49 7.49 0 0 0 12 4C9.11 4 6.6 5.64 5.35 8.04A5.994 5.994 0 0 0 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM14 13v4h-4v-4H7l5-5 5 5h-3z" />
            </svg>
          </div>
          <p className="upload-zone-title">
            Arraste e solte o arquivo CSV aqui ou{" "}
            <span className="upload-zone-cta">clique para selecionar</span>
          </p>
          <p className="upload-zone-subtitle">
            Apenas formato <code>.csv</code> (tamanho máximo de até 10MB)
          </p>

          <div className="upload-columns-box">
            <div className="upload-columns-title">Colunas esperadas no cabeçalho</div>
            <div className="upload-columns-list">
              {EXPECTED_COLUMNS.map((column) => (
                <span key={column} className="upload-column-badge">
                  {column}
                </span>
              ))}
            </div>
          </div>
        </div>

        <div className="upload-action-bar">
          <div className="upload-file-status" aria-live="polite">
            {selectedFileName ? (
              <span>
                <strong>{selectedFileName}</strong> ({selectedFileSizeKb} KB) pronto para importar
              </span>
            ) : (
              <span>Nenhum arquivo novo selecionado</span>
            )}
          </div>
          <button
            type="button"
            className="ghost"
            disabled={isImporting}
            onClick={() => void handleImport()}
          >
            {isImporting ? "Importando..." : "Importar membros"}
          </button>
        </div>

        {importSummary ? (
          <p className="import-summary" aria-live="polite">
            {importSummary}
          </p>
        ) : null}
        {importError ? (
          <p className="form-error" role="alert">
            {importError}
          </p>
        ) : null}
      </section>
    </div>
  );
}

function readFileAsText(file: File): Promise<string> {
  if (typeof file.text === "function") {
    return file.text();
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(new Error("file_read_failed"));
    reader.readAsText(file);
  });
}
